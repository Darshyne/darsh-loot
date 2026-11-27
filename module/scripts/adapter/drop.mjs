/**
 * Tas au sol (SPEC §3.8) : une **tuile** d'une demi-case avec l'icône de l'objet (ce que tout le monde voit) et une
 * **région** « Conteneur » de même emprise (§3.2 : fouille, curseur, coffre Groupe). Les deux se reconnaissent par
 * `flags.darsh-loot.pile`. Règles : core/drop.mjs.
 */
import { MODULE_ID, loc } from "../shared.mjs";
import { CONTAINER_TYPE } from "./container-behavior.mjs";
import { stackTarget, canLeaveOwner, addCoins, clampCoins, COINS } from "../core/loot.mjs";
import { PILE_FRACTION, pileSpot, pileLevelFix } from "../core/drop.mjs";
import { levelBase } from "./sight.mjs";
import { inTurn, operation } from "./ledger.mjs";
import { snapshotWithContents, clearAttunement } from "./dnd5e.mjs";

/** Icône d'un tas de plusieurs objets différents. */
export const MIXED_PILE_IMG = "icons/containers/bags/sack-cloth-stitched-brown.webp";

/** Lot 1: the icon of a pile that holds coins only. */
export const COIN_PILE_IMG = "icons/commodities/currency/coins-plain-stack-gold.webp";

/** The icon of a pile, from what its store holds: the item when it is alone, coins when there is nothing else, a sack otherwise. */
export function pileImage(store) {
  const coins = Object.values(store?.system.currency ?? {}).some(v => v > 0);
  if ( !store?.items.size ) return coins ? COIN_PILE_IMG : MIXED_PILE_IMG;
  return ((store.items.size === 1) && !coins) ? store.items.contents[0].img : MIXED_PILE_IMG;
}

/** La région d'un tas. */
export const isPileRegion = region => !!region?.getFlag(MODULE_ID, "pile");

/** Le tas (région) sous ce point de la scène, sur ce niveau, s'il y en a un. */
export function pileAt(scene, point, level) {
  return scene.regions.find(r => isPileRegion(r) && (!level || r.includedInLevel(level))
    && r.polygonTree.testPoint(point)) ?? null;
}

/** La tuile d'un tas. */
export function pileTile(region) {
  const id = region.getFlag(MODULE_ID, "pile")?.tile;
  return id ? region.parent.tiles.get(id) : null;
}

/** Le centre d'un tas : celui de sa région (la tuile y est ancrée par son centre). */
export function pileCenter(region) {
  const b = region.bounds;
  return { x: b.x + (b.width / 2), y: b.y + (b.height / 2) };
}

/**
 * Chez le MJ, au chargement : les tas posés par une version antérieure (tuile décalée avant la 0.7.1, tas centré sur
 * sa case en 0.7.1–0.7.2) sont remis à leur place, le **quart haut-gauche** de la case où ils sont (0.7.3) : région et
 * tuile. Et un tas resté transparent (révélation manquée) est révélé. Since 2026-11-25, on a V14 upper floor: the region takes its
 * tile's levels and a tile under the floor of its level is raised onto it (`pileLevelFix`).
 */
export async function realignPiles() {
  for ( const scene of game.scenes ) {
    const size = scene.grid.size;
    const half = (size * PILE_FRACTION) / 2;
    const tiles = [];
    const regions = [];
    const unseen = [];
    const levelSync = [];
    const floors = [];
    for ( const region of scene.regions ) {
      if ( !isPileRegion(region) ) continue;
      const spot = pileSpot(scene.grid.getTopLeftPoint(pileCenter(region)), size);
      const x = Math.round(spot.x);
      const y = Math.round(spot.y);
      const shape = region.shapes[0];
      if ( shape && ((shape.x !== x - half) || (shape.y !== y - half)) ) {
        regions.push({ _id: region.id, shapes: [{ ...shape.toObject?.() ?? shape, x: x - half, y: y - half }] });
      }
      const tile = pileTile(region);
      if ( tile && ((tile.x !== x) || (tile.y !== y) || (tile.texture.anchorX !== 0.5) || (tile.texture.anchorY !== 0.5)) ) {
        tiles.push({ _id: tile.id, x, y, "texture.anchorX": 0.5, "texture.anchorY": 0.5 });
      }
      // Un tas naît transparent et n'est révélé qu'à la fin du vol, par le MJ : s'il a rechargé ou s'est déconnecté
      // entre-temps, le tas est resté invisible pour tout le monde.
      if ( tile?.alpha === 0 ) unseen.push({ _id: tile.id, alpha: 1 });
      // V14 levels: the region follows its tile's floor, and a tile left under the floor of its level is raised onto it.
      if ( tile ) {
        const tileSource = tile._source ?? tile;
        const tileLevels = [...(tileSource.levels ?? [])];
        const fix = pileLevelFix({ tileLevels, regionLevels: [...((region._source ?? region).levels ?? [])],
          elevation: tileSource.elevation ?? 0, base: levelBase(scene, tileLevels[0]) });
        if ( fix.levels ) levelSync.push({ _id: region.id, levels: fix.levels });
        if ( Number.isFinite(fix.elevation) ) floors.push({ _id: tile.id, elevation: fix.elevation });
      }
    }
    if ( regions.length ) await scene.updateEmbeddedDocuments("Region", regions);
    if ( levelSync.length ) await scene.updateEmbeddedDocuments("Region", levelSync);
    if ( tiles.length ) await scene.updateEmbeddedDocuments("Tile", tiles);
    if ( unseen.length ) await scene.updateEmbeddedDocuments("Tile", unseen);
    if ( floors.length ) await scene.updateEmbeddedDocuments("Tile", floors);
  }
}

/**
 * Crée un tas centré sur `center` : la tuile (née transparente : l'effet de lancer la révèle à l'atterrissage) puis la
 * région et son conteneur (déjà tiré, rien à tirer).
 * @returns {Promise<{ region: RegionDocument, behavior: RegionBehavior, tile: TileDocument }>}
 */
export async function createPile(scene, center, { level=null, elevation=0, img, name, lastDrop }) {
  const size = scene.grid.size * PILE_FRACTION;
  const x = Math.round(center.x - (size / 2));   // coin de la région (ses formes se donnent par le coin)
  const y = Math.round(center.y - (size / 2));
  const levels = level ? [level] : [];
  // V14 : `x`/`y` d'une tuile sont son point d'ancrage, le centre de l'image par défaut (`texture.anchorX/Y` 0,5 —
  // client/documents/tile.mjs:47, canvas/placeables/tile.mjs:275), pas son coin : la tuile se pose sur le centre.
  const [tile] = await scene.createEmbeddedDocuments("Tile", [{
    texture: { src: img, anchorX: 0.5, anchorY: 0.5 }, x: Math.round(center.x), y: Math.round(center.y),
    width: size, height: size, elevation, levels, alpha: 0, sort: 1000,
    flags: { [MODULE_ID]: lastDrop ? { pileTile: true, lastDrop } : { pileTile: true } }
  }]);
  const [region] = await scene.createEmbeddedDocuments("Region", [{
    name, color: "#b58a45", levels, visibility: CONST.REGION_VISIBILITY.LAYER,
    shapes: [{ type: "rectangle", x, y, width: size, height: size }],
    flags: { [MODULE_ID]: { pile: { tile: tile.id } } },
    behaviors: [{ name, type: CONTAINER_TYPE, system: { label: name, rolled: true, sound: "" } }]
  }]);
  return { region, behavior: region.behaviors.contents[0], tile };
}

/**
 * 0.15.5 : un objet « conteneur » du monde ou d'un compendium posé sur la carte par le MJ devient un **conteneur posé** (pas un
 * tas) : une tuile d'une case à son image, centrée sur la case, et une région « Conteneur » de même emprise liée à elle
 * (`flags.darsh-loot.tile`), à son nom. Il reste vide une fois fouillé. Son coffre reçoit le **contenu** du sac (objets et
 * argent), pas le sac. À appeler chez le MJ.
 * @returns {Promise<RegionDocument>}
 */
export async function createPlacedContainer(scene, center, item, { level=null, elevation=0 }={}) {
  const size = scene.grid.size;
  const levels = level ? [level] : [];
  const [tile] = await scene.createEmbeddedDocuments("Tile", [{
    texture: { src: item.img, anchorX: 0.5, anchorY: 0.5 }, x: Math.round(center.x), y: Math.round(center.y),
    width: size, height: size, elevation, levels, sort: 1000, flags: { [MODULE_ID]: { objectTile: true } }
  }]);
  const [region] = await scene.createEmbeddedDocuments("Region", [{
    name: item.name, color: "#b58a45", levels, visibility: CONST.REGION_VISIBILITY.LAYER,
    shapes: [{ type: "rectangle", x: Math.round(center.x - (size / 2)), y: Math.round(center.y - (size / 2)), width: size, height: size }],
    flags: { [MODULE_ID]: { tile: tile.id } },
    // 2026-10-28 : un coffre posé a le son de porte par défaut du conteneur (bois) ; seuls les tas sont muets.
    behaviors: [{ name: item.name, type: CONTAINER_TYPE, system: { label: item.name, rolled: true } }]
  }]);
  return region;
}

/**
 * 2026-10-28 : un token d'acteur **Groupe** converti en conteneur par le MJ (menu contextuel) — une tuile à l'image du token,
 * de son emprise, et une région « Conteneur » de même emprise liée à elle, au nom de l'acteur. Le contenu se copie ensuite
 * (`fillFromActor`). Le token, lui, est retiré par l'appelant. À appeler chez un MJ.
 * @returns {Promise<RegionDocument>}
 */
export async function createContainerFromToken(token) {
  const scene = token.parent;
  const s = token._source;
  const size = scene.grid.size;
  const width = s.width * size, height = s.height * size;
  const levels = s.level ? [s.level] : [];
  const name = token.name || token.actor?.name || "?";
  // Même visuel que le token : la tuile et le token se dessinent par le même `mesh.resize(width, height, { fit, scaleX, scaleY })`
  // et la même ancre (canvas/placeables/tile.mjs `_refreshSize`, token.mjs `_refreshMeshSizeAndScale`) — on recopie toute la
  // texture (échelle, miroir, ajustement, teinte, ancre) et l'opacité, posée au centre du token. Avec l'anneau dynamique, l'image est
  // celle du sujet de l'anneau ; l'anneau lui-même n'existe pas pour une tuile.
  const { src, fit, scaleX, scaleY, anchorX, anchorY, offsetX, offsetY, tint, alphaThreshold } = s.texture;
  const subject = s.ring?.enabled ? s.ring.subject?.texture : null;
  const [tile] = await scene.createEmbeddedDocuments("Tile", [{
    texture: { src: subject || src, fit, scaleX, scaleY, anchorX, anchorY, offsetX, offsetY, tint, alphaThreshold },
    x: Math.round(s.x + (width / 2)), y: Math.round(s.y + (height / 2)), alpha: s.alpha ?? 1,
    width, height, rotation: s.rotation ?? 0, elevation: s.elevation ?? 0, levels, hidden: !!s.hidden, sort: 1000,
    flags: { [MODULE_ID]: { objectTile: true } }
  }]);
  const [region] = await scene.createEmbeddedDocuments("Region", [{
    name, color: "#b58a45", levels, visibility: CONST.REGION_VISIBILITY.LAYER,
    shapes: [{ type: "rectangle", x: s.x, y: s.y, width, height }],
    flags: { [MODULE_ID]: { tile: tile.id } },
    behaviors: [{ name, type: CONTAINER_TYPE, system: { label: name, rolled: true } }]
  }]);
  return region;
}

/** Le contenu d'un acteur (objets, rangement dans les sacs gardé, et argent), copié dans `store`. */
export async function fillFromActor(store, actor) {
  const items = actor.items.map(i => i.toObject());
  if ( items.length ) await CONFIG.Item.documentClass.createDocuments(items, { keepId: true, parent: store });
  const update = {};
  for ( const [k, v] of Object.entries(actor.system.currency ?? {}) ) {
    if ( Number(v) > 0 ) update[`system.currency.${k}`] = (Number(store.system.currency?.[k]) || 0) + Number(v);
  }
  if ( Object.keys(update).length ) await store.update(update);
}

/** Le contenu d'un sac (objets, sous-sacs compris, et argent), prêt à créer dans `store` : le sac lui-même n'y est pas. */
export async function fillWithContents(store, bag) {
  const Item5e = CONFIG.Item.documentClass;
  const [first, ...inside] = await Item5e.createWithContents([bag]);
  // Ce qui était au premier niveau du sac est au premier niveau du coffre.
  for ( const d of inside ) if ( d.system?.container === first._id ) d.system.container = null;
  if ( inside.length ) await Item5e.createDocuments(inside, { keepId: true, parent: store });
  const coins = bag.system.currency ?? {};
  const update = {};
  for ( const [k, v] of Object.entries(coins) ) {
    if ( Number(v) > 0 ) update[`system.currency.${k}`] = (Number(store.system.currency?.[k]) || 0) + Number(v);
  }
  if ( Object.keys(update).length ) await store.update(update);
}

/**
 * Après une prise dans un tas, chez le MJ : un tas vidé disparaît (tuile et région — le coffre part avec la région) ;
 * sinon son icône suit ce qui reste (l'objet s'il est seul, un sac sinon).
 */
export async function clearIfEmpty(region) {
  if ( !isPileRegion(region) ) return;
  const behavior = region.behaviors.contents[0];
  const store = behavior?.system.actor ? fromUuidSync(behavior.system.actor, { strict: false }) : null;
  const coins = Object.values(store?.system.currency ?? {}).some(v => v > 0);
  const tile = pileTile(region);
  if ( store && (store.items.size || coins) ) {
    const img = pileImage(store);
    if ( tile && (tile.texture.src !== img) ) await tile.update({ "texture.src": img });
    return;
  }
  // La tuile part avec la région (lien zone ↔ tuile, runtime/tile-zone.mjs) ; supprimer les deux ici ferait un doublon.
  await region.delete();
}

/**
 * Déplace `quantity` exemplaires d'un objet d'un acteur à un autre (le contenu d'un sac suit), en le déséquipant ; un
 * consommable ou un objet de butin identique déjà présent reçoit la quantité. À appeler chez le MJ.
 * Options (marchands, §3.7) : `anyType` — empiler aussi armes, outils… identiques (l'étal d'un marchand) ; `launder` — la
 * marque de vol est ôtée (un objet revendu) ; `shop` — drapeaux `flags.darsh-loot.shop` posés sur l'objet créé (rien : ceux
 * de la source sont retirés) ; `copy` — la source garde sa quantité (stock infini).
 * @returns {Promise<{ name: string, quantity: number }>}
 */
export function moveItem(from, to, itemId, quantity, options={}) {
  return inTurn([from, to], () => moveItemNow(from, to, itemId, quantity, options));
}

/**
 * The move itself, for a gesture that already holds its turn on both actors (`inTurn`, adapter/ledger.mjs: a trade, a deal).
 * What the giver holds and the taker's stack are read here, once the turn has come.
 * Lot 0 (audit of 2026-11-26, defects 3–4): each write registers its undo with `op` (the caller's operation: a trade, a deal);
 * without `op` the move is its own operation — a source that cannot be reduced takes back what the taker received.
 */
export function moveItemNow(from, to, itemId, quantity, options={}) {
  if ( options.op ) return moveItemSteps(from, to, itemId, quantity, options);
  // Checked here too, so that a missing item stays a plain refusal, outside any operation.
  if ( !from.items.get(itemId) ) return Promise.reject(new Error(loc("Refus.Introuvable")));
  return operation({ label: loc("Op.Move", { from: from.name, to: to.name }), journal: false },
    op => moveItemSteps(from, to, itemId, quantity, { ...options, op }));
}

/**
 * Can this item of `from` be handed over at all? An NPC only gives its gear (core/loot.mjs `canLeaveOwner`). To ask **before**
 * the first write of a gesture that charges for it (lot 0, defect 1).
 */
export function canHandOver(from, itemId) {
  const held = from.items.get(itemId);
  return !!held && canLeaveOwner({ fromNpc: from.type === "npc", properties: held.system.properties });
}

async function moveItemSteps(from, to, itemId, quantity, { anyType=false, launder=false, shop=null, copy=false, op }) {
  const Item5e = CONFIG.Item.documentClass;
  const held = from.items.get(itemId);
  // Gone while waiting (the same item dropped or given twice in a row): a refusal, nothing moves.
  if ( !held ) throw new Error(loc("Refus.Introuvable"));
  // 0.15.1: from an NPC only gear leaves, as its « gear » version (`asGear`, data/item/templates/physical-item.mjs:367: the
  // Player's Handbook Dagger rather than the Vampire Familiar's « Umbral Dagger »), like a search (adapter/dnd5e.mjs `transfer`).
  // A creature's attack does not become an item: nothing moves.
  const fromNpc = from.type === "npc";
  if ( !canLeaveOwner({ fromNpc, properties: held.system.properties }) ) return { name: held.name, quantity: 0, kept: true };
  const item = fromNpc ? ((await held.system.asGear?.()) ?? held) : held;
  const available = held.system.quantity ?? 1;
  // An infinite stock (`copy`) is not capped by what is left on the sheet. Always a whole number: a fractional quantity (macro,
  // `api.drop`) would leave half an arrow on each side.
  const moved = copy ? Math.max(1, Math.floor(Number(quantity) || 1))
    : Math.max(1, Math.min(Math.floor(Number(quantity) || available), available));
  // Unit price in cp (to stack, on a stall, items without a compendium source).
  const priceOf = i => (Number(i.system.price?.value) || 0) * ({ pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 }[i.system.price?.denomination] ?? 100);
  // An item whose container does not exist on the sheet (orphan reference, common on an imported merchant's stall) is at the
  // top level.
  const owned = to.items.map(i => ({ id: i.id, type: i.type, name: i.name,
    source: i._stats?.compendiumSource ?? null, container: to.items.has(i.system.container) ? i.system.container : null, price: priceOf(i) }));
  const stolen = !launder && !!item.getFlag(MODULE_ID, "stolen");
  const stackOn = ((item.type !== "container") && !stolen)
    ? stackTarget(owned, { type: item.type, name: item.name, source: item._stats?.compendiumSource ?? null, price: priceOf(item) }, { anyType }) : null;
  const what = moved > 1 ? `${item.name} (${moved})` : item.name;
  if ( stackOn ) {
    const target = to.items.get(stackOn);
    await target.update({ "system.quantity": (target.system.quantity ?? 0) + moved });
    op.did(loc("Op.Step.Received", { who: to.name, what }), async () => {
      const stack = to.items.get(stackOn);
      if ( stack ) await stack.update({ "system.quantity": Math.max(0, (stack.system.quantity ?? 0) - moved) });
    });
  } else {
    const data = await Item5e.createWithContents([item]);
    // The « gear » version of an NPC item keeps the id of the NPC's item (`keepId`): no clash at the taker's.
    foundry.utils.setProperty(data[0], "system.quantity", moved);
    if ( foundry.utils.hasProperty(data[0], "system.equipped") ) foundry.utils.setProperty(data[0], "system.equipped", false);
    // Stall flags (hidden, reference quantity, rolled…) do not follow the item; the taker's are set. Nor does attunement
    // (lot 0, defect 14).
    for ( const d of data ) {
      if ( d.flags?.[MODULE_ID] ) delete d.flags[MODULE_ID].shop;
      if ( launder && d.flags?.[MODULE_ID] ) delete d.flags[MODULE_ID].stolen;
      clearAttunement(d);
    }
    if ( shop ) foundry.utils.setProperty(data[0], `flags.${MODULE_ID}.shop`, shop);
    await Item5e.createDocuments(data, { keepId: true, parent: to });
    const top = data[0]._id;
    op.did(loc("Op.Step.Received", { who: to.name, what }), async () => {
      if ( to.items.has(top) ) await to.deleteEmbeddedDocuments("Item", [top], { deleteContents: true });
    });
  }
  if ( copy ) return { name: item.name, quantity: moved };
  if ( moved >= available ) {
    const snapshot = snapshotWithContents(from, held.id);
    await held.delete({ deleteContents: true });
    op.did(loc("Op.Step.Removed", { who: from.name, what }),
      () => Item5e.createDocuments(snapshot.filter(d => !from.items.has(d._id)), { keepId: true, parent: from }));
  } else {
    await held.update({ "system.quantity": available - moved });
    op.did(loc("Op.Step.Removed", { who: from.name, what }), async () => {
      const left = from.items.get(held.id);
      if ( left ) await left.update({ "system.quantity": (left.system.quantity ?? 0) + moved });
    });
  }
  return { name: item.name, quantity: moved };
}

/* -------------------------------------------- */
/*  Coins (lot 1, 2026-11-27)                   */
/* -------------------------------------------- */

/**
 * Moves coins from one actor to another (dropped on the ground, given), for a gesture that already holds its turn on both
 * (`inTurn`). What the giver holds is read here: never more than what is there. Each write registers its undo with `op` (the
 * caller's operation); without `op` the move is its own operation.
 * @param {Actor} from
 * @param {Actor} to
 * @param {Record<string, number>} asked
 * @returns {Promise<Record<string, number>>}  What moved (empty: nothing to move — a refusal is the caller's business).
 */
export function moveCoinsNow(from, to, asked, { op=null }={}) {
  if ( op ) return moveCoinsSteps(from, to, asked, op);
  if ( !clampCoins(asked, from.system.currency).any ) return Promise.resolve({});
  return operation({ label: loc("Op.Move", { from: from.name, to: to.name }), journal: false }, own => moveCoinsSteps(from, to, asked, own));
}

async function moveCoinsSteps(from, to, asked, op) {
  const { coins, any } = clampCoins(asked, from.system.currency);
  if ( !any ) return {};
  const minus = Object.fromEntries(COINS.map(k => [k, -(coins[k] ?? 0)]));
  await to.update({ "system.currency": addCoins(to.system.currency, coins) });
  op.did(loc("Op.Step.CoinsIn", { who: to.name }), () => to.update({ "system.currency": addCoins(to.system.currency, minus) }));
  await from.update({ "system.currency": addCoins(from.system.currency, minus) });
  op.did(loc("Op.Step.CoinsOut", { who: from.name }), () => from.update({ "system.currency": addCoins(from.system.currency, coins) }));
  return coins;
}
