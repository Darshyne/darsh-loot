/**
 * Poser un objet au sol (SPEC §3.8) : glisser un objet de la fiche de son personnage et le lâcher sur la carte.
 * Le joueur choisit la quantité ; le MJ ramène le point à portée de lancer, l'écarte du token (un tas sous soi ne se
 * clique pas), l'ajoute au tas qui est là ou en crée un (tuile + conteneur, adapter/drop.mjs), y range l'objet, puis
 * révèle la tuile à la fin de l'effet de lancer (runtime/drop-fx.mjs). Le MJ peut aussi lâcher un objet du monde ou
 * d'un compendium : une copie, exactement là où il la pose.
 */
import { MODULE_ID, loc, setting, log } from "../shared.mjs";
import { route } from "./router.mjs";
import { askGM } from "./take.mjs";
import { ensureStore } from "./containers.mjs";
import { PHYSICAL_TYPES, canLeaveOwner } from "../core/loot.mjs";
import { FLIGHT_MS, clampDrop, outsideRect, soundKind, pileSpot } from "../core/drop.mjs";
import { createPile, pileAt, pileTile, pileCenter, moveItem, realignPiles, MIXED_PILE_IMG } from "../adapter/drop.mjs";
import { DROP_ITEMS_HOOK } from "../adapter/engine.mjs";

export { clearIfEmpty } from "../adapter/drop.mjs";

const DROP_QUERY = `${MODULE_ID}.drop`;

/**
 * Le geste est-il actif ? Réglage `dropMode` : « on » (défaut) ou « off ». L'ancienne valeur « auto » (laissé à Item
 * Piles tant qu'il était actif, jusqu'à la 0.11) vaut « on ».
 */
export function dropEnabled() {
  return setting("dropMode") !== "off";
}

/** Le token du personnage qui pose l'objet, sur la scène affichée : le token contrôlé s'il est à lui, sinon le premier. */
function dropperToken(actor) {
  const controlled = canvas.tokens.controlled.map(t => t.document).find(t => t.actor === actor);
  return controlled ?? canvas.scene?.tokens.find(t => t.actor === actor) ?? null;
}

/** Combien en poser ? Toute la pile par défaut ; null si l'on renonce. */
async function askQuantity(item) {
  const max = item.system.quantity ?? 1;
  if ( max <= 1 ) return 1;
  const value = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Drop.QuantityTitle", { name: item.name }), icon: "fa-solid fa-hand-holding" },
    content: `<label class="dlo-qty-field">${loc("Drop.Quantity")}
      <input type="number" name="quantity" min="1" max="${max}" value="${max}" autofocus></label>`,
    ok: { label: loc("Drop.Confirm"), callback: (event, button) => button.form.elements.quantity.valueAsNumber },
    rejectClose: false
  });
  if ( !Number.isFinite(value) || (value < 1) ) return null;
  return Math.min(Math.floor(value), max);
}

async function onDropCanvasData(board, data) {
  if ( (data.type !== "Item") || !dropEnabled() || !data.uuid ) return;
  const item = await fromUuid(data.uuid).catch(() => null);
  if ( !item || !PHYSICAL_TYPES.has(item.type) ) return;
  const payload = { item: item.uuid, x: data.x, y: data.y, scene: canvas.scene.id, level: canvas.level?.id ?? null };
  if ( item.parent instanceof Actor ) {
    if ( !item.parent.isOwner ) return;
    const dropper = dropperToken(item.parent);
    if ( !dropper ) return ui.notifications.warn(loc("Drop.NotOnScene"));
    const quantity = await askQuantity(item);
    if ( !quantity ) return;
    Object.assign(payload, { dropper: dropper.uuid, quantity });
  } else if ( !game.user.isGM ) return;
  return askGM(DROP_QUERY, handleDrop, payload);
}

/** Chez le MJ. */
async function handleDrop(payload, { user }) {
  const item = await fromUuid(payload.item);
  if ( !item || !PHYSICAL_TYPES.has(item.type) ) throw new Error(loc("Refus.Introuvable"));
  const owner = item.parent instanceof Actor ? item.parent : null;
  let dropper = null;
  let scene = game.scenes.get(payload.scene);
  let point = { x: payload.x, y: payload.y };
  let level = payload.level;
  let elevation = 0;
  let from = point;

  if ( owner ) {
    if ( !owner.testUserPermission(user, "OWNER") ) throw new Error(loc("Refus.PasAToi"));
    dropper = fromUuidSync(payload.dropper, { strict: false });
    if ( !dropper || (dropper.actor !== owner) ) throw new Error(loc("Drop.NotOnScene"));
    scene = dropper.parent;
    const size = scene.grid.size;
    const s = dropper._source;
    const rect = { x: s.x, y: s.y, w: s.width * size, h: s.height * size };
    const center = { x: rect.x + (rect.w / 2), y: rect.y + (rect.h / 2) };
    // Portée : du centre du token, sa demi-taille plus la portée de fouille (5 ft : la case voisine).
    const maxDist = (Math.max(rect.w, rect.h) / 2) + ((setting("reach") / scene.grid.distance) * size);
    // Hors de son propre token (1 px au-delà du bord suffit : le centrage ci-dessous prend la case voisine).
    point = outsideRect(rect, clampDrop(center, point, maxDist), 1);
    level = s.level ?? level;
    elevation = s.elevation ?? 0;
    from = center;
  } else if ( !user.isGM ) throw new Error(loc("Refus.PasAToi"));

  const quantity = owner ? payload.quantity : (item.system.quantity ?? 1);
  const region = await putOnGround({ scene, point, level, elevation, from, item, owner, quantity });
  if ( !region ) throw new Error(loc("Drop.NotGear", { item: item.name }));
  return { region: region.uuid, quantity };
}

/**
 * `alreadySpent` (0.15.1) : l'unité a déjà été retirée de la fiche du porteur (arme lancée, décomptée par dnd5e).
 * Chez le MJ : pose un objet au sol, **au centre de la case** où tombe `point` — dans le tas de cette case s'il y en
 * a un (un seul tas par case, §3.8), sinon dans un nouveau — avec l'effet de lancer depuis `from`. Sert au geste de
 * poser, aux armes de jet (§3.10) ; `owner` : l'acteur qui perd l'objet (sinon une copie de `item`).
 * @returns {Promise<RegionDocument>}  La région du tas.
 */
export async function putOnGround({ scene, point, level=null, elevation=0, from, item, owner=null, quantity=1, flight=true, alreadySpent=false }) {
  // 0.15.1 : l'attaque d'un PNJ (arme naturelle, « Dague ombrale » sans équipement) ne tombe pas au sol : pas de tas.
  if ( owner && !canLeaveOwner({ fromNpc: owner.type === "npc", properties: item.system.properties }) ) return null;
  // Dans le quart haut-gauche de la case où tombe le point (visible sous une créature, un seul tas par case).
  const center = pileSpot(scene.grid.getTopLeftPoint(point), scene.grid.size);
  // `flight: false` (arme de jet, §3.10) : pas de vol — le lancer est déjà animé par le moteur ; le son seul.
  const lastDrop = { id: foundry.utils.randomID(), from: from ?? center, to: center, img: item.img,
    sound: soundKind({ type: item.type, subtype: item.system.type?.value }), ...(flight ? {} : { noFlight: true }) };
  let region = pileAt(scene, center, level);
  let tile;
  let created = false;
  if ( region ) {
    tile = pileTile(region);
    lastDrop.to = pileCenter(region);
  } else {
    ({ region, tile } = await createPile(scene, center, { level, elevation, img: item.img, name: loc("Drop.PileName"), lastDrop }));
    created = true;
  }
  const store = await ensureStore(region.behaviors.contents[0]);
  // `alreadySpent` : l'unité a déjà quitté la fiche (un lancer : dnd5e la décompte lui-même) — on la crée sans en retirer une autre.
  if ( owner ) await moveItem(owner, store, item.id, quantity, { copy: alreadySpent });
  else await store.createEmbeddedDocuments("Item", [game.items.fromCompendium(item)]);

  // L'icône du tas : celle de l'objet s'il est seul, un sac sinon.
  const img = (store.items.size === 1) ? store.items.contents[0].img : MIXED_PILE_IMG;
  const update = {};
  if ( tile.texture.src !== img ) update["texture.src"] = img;
  if ( !created ) update[`flags.${MODULE_ID}.lastDrop`] = lastDrop;
  if ( Object.keys(update).length ) await tile.update(update);
  // Révélée à l'atterrissage : pendant le vol, chacun voit l'objet voler, pas le tas déjà posé. Les clients lancent leur
  // vol un peu après la création (le temps de charger l'image : ~250 ms vu en jeu) — d'où la marge.
  if ( created && flight ) setTimeout(() => tile.update({ alpha: 1 }), FLIGHT_MS + 350);
  else if ( created ) await tile.update({ alpha: 1 });
  return region;
}

/** Sans glisser (tests, macros) : poser `quantity` exemplaires d'un objet du personnage vers un point de la scène. */
export function requestDrop(item, point, quantity) {
  const dropper = dropperToken(item.parent);
  if ( !dropper ) return ui.notifications.warn(loc("Drop.NotOnScene"));
  return askGM(DROP_QUERY, handleDrop, { item: item.uuid, x: point.x, y: point.y, scene: canvas.scene.id,
    level: canvas.level?.id ?? null, dropper: dropper.uuid, quantity: quantity ?? item.system.quantity ?? 1 });
}

/**
 * Le moteur fait lâcher ses armes et son bouclier à une créature (Injonction « Lâche », son SPEC §40.3) : chez le MJ
 * actif, on se propose de les poser en tas dans sa case — sauf si le geste est coupé (`dropMode`). Un objet qui n'a pas pu
 * être posé reste sur la fiche, déséquipé : rien n'est perdu.
 */
function onEngineDrop(takers, { token, items }) {
  if ( !dropEnabled() || !game.users.activeGM?.isSelf || !token?.actor || !items?.length ) return;
  takers.push(async () => {
    const scene = token.parent;
    const size = scene.grid.size;
    const s = token._source;
    const center = { x: s.x + ((s.width * size) / 2), y: s.y + ((s.height * size) / 2) };
    for ( const item of items ) {
      try {
        const region = await putOnGround({ scene, point: center, level: s.level ?? null, elevation: s.elevation ?? 0, from: center,
          item, owner: token.actor, quantity: item.system.quantity ?? 1 });
        // 0.15.2 : une attaque de créature ne tombe pas (pas d'objet à poser) — lâchée quand même : déséquipée, comme le repli du moteur.
        if ( !region && token.actor.items.has(item.id) ) await item.update({ "system.equipped": false });
      } catch ( err ) {
        log.warn(`dropped item not placed (${item.name}):`, err.message);
        if ( token.actor.items.has(item.id) ) await item.update({ "system.equipped": false });
      }
    }
    return true;
  });
}

export function registerDropInit() {
  CONFIG.queries[DROP_QUERY] = handleDrop;
}

export function registerDrop() {
  route("dropCanvasData", "drop an item on the ground", (board, data) => { onDropCanvasData(board, data); });
  route(DROP_ITEMS_HOOK, "items dropped by the engine", onEngineDrop);
  // Tas posés avant la 0.7.1 : tuile recalée au centre de sa case (une fois, par le MJ actif).
  if ( game.users.activeGM?.isSelf ) realignPiles().catch(err => log.warn("pile realignment:", err.message));
}
