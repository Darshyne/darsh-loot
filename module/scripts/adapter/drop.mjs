/**
 * Tas au sol (SPEC §3.8) : une **tuile** d'une demi-case avec l'icône de l'objet (ce que tout le monde voit) et une
 * **région** « Conteneur » de même emprise (§3.2 : fouille, curseur, coffre Groupe). Les deux se reconnaissent par
 * `flags.darsh-loot.pile`. Règles : core/drop.mjs.
 */
import { MODULE_ID } from "../shared.mjs";
import { CONTAINER_TYPE } from "./container-behavior.mjs";
import { stackTarget } from "../core/loot.mjs";
import { PILE_FRACTION, pileSpot } from "../core/drop.mjs";

/** Icône d'un tas de plusieurs objets différents. */
export const MIXED_PILE_IMG = "icons/containers/bags/sack-cloth-stitched-brown.webp";

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
 * tuile.
 */
export async function realignPiles() {
  for ( const scene of game.scenes ) {
    const size = scene.grid.size;
    const half = (size * PILE_FRACTION) / 2;
    const tiles = [];
    const regions = [];
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
    }
    if ( regions.length ) await scene.updateEmbeddedDocuments("Region", regions);
    if ( tiles.length ) await scene.updateEmbeddedDocuments("Tile", tiles);
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
    behaviors: [{ name, type: CONTAINER_TYPE, system: { label: name, rolled: true } }]
  }]);
  return { region, behavior: region.behaviors.contents[0], tile };
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
    const img = ((store.items.size === 1) && !coins) ? store.items.contents[0].img : MIXED_PILE_IMG;
    if ( tile && (tile.texture.src !== img) ) await tile.update({ "texture.src": img });
    return;
  }
  if ( tile ) await tile.delete();
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
export async function moveItem(from, to, itemId, quantity, { anyType=false, launder=false, shop=null, copy=false }={}) {
  const Item5e = CONFIG.Item.documentClass;
  const item = from.items.get(itemId);
  const available = item.system.quantity ?? 1;
  // Un stock infini (`copy`) ne plafonne pas à ce qui reste sur la fiche.
  const moved = copy ? Math.max(1, Math.floor(Number(quantity) || 1)) : Math.max(1, Math.min(Number(quantity) || available, available));
  // Prix à l'unité en pc (pour l'empilement à l'étal d'objets sans source de compendium).
  const priceOf = i => (Number(i.system.price?.value) || 0) * ({ pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 }[i.system.price?.denomination] ?? 100);
  // Un objet dont le contenant n'existe pas sur la fiche (référence orpheline, fréquente à l'étal d'un marchand importé)
  // est au premier niveau.
  const owned = to.items.map(i => ({ id: i.id, type: i.type, name: i.name,
    source: i._stats?.compendiumSource ?? null, container: to.items.has(i.system.container) ? i.system.container : null, price: priceOf(i) }));
  const stolen = !launder && !!item.getFlag(MODULE_ID, "stolen");
  const stackOn = ((item.type !== "container") && !stolen)
    ? stackTarget(owned, { type: item.type, name: item.name, source: item._stats?.compendiumSource ?? null, price: priceOf(item) }, { anyType }) : null;
  if ( stackOn ) {
    const target = to.items.get(stackOn);
    await target.update({ "system.quantity": (target.system.quantity ?? 0) + moved });
  } else {
    const data = await Item5e.createWithContents([item]);
    foundry.utils.setProperty(data[0], "system.quantity", moved);
    if ( foundry.utils.hasProperty(data[0], "system.equipped") ) foundry.utils.setProperty(data[0], "system.equipped", false);
    // Les drapeaux d'étal (caché, quantité de référence, tiré…) ne suivent pas l'objet ; ceux du receveur sont posés.
    for ( const d of data ) {
      if ( d.flags?.[MODULE_ID] ) delete d.flags[MODULE_ID].shop;
      if ( launder && d.flags?.[MODULE_ID] ) delete d.flags[MODULE_ID].stolen;
    }
    if ( shop ) foundry.utils.setProperty(data[0], `flags.${MODULE_ID}.shop`, shop);
    await Item5e.createDocuments(data, { keepId: true, parent: to });
  }
  if ( copy ) return { name: item.name, quantity: moved };
  if ( moved >= available ) await item.delete({ deleteContents: true });
  else await item.update({ "system.quantity": available - moved });
  return { name: item.name, quantity: moved };
}
