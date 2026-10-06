/**
 * Fonctions de test exposées sous `api.mcp` : le connecteur MCP les appelle chez le MJ (`call-module-api`, verrou « Outils
 * de test » du connecteur — jamais dans le monde de production). Rien ici ne sert au jeu.
 */
import { MODULE_ID } from "../shared.mjs";
import { merchantSource } from "../adapter/sources.mjs";
import { merchantOf, isMerchant, stockView, waresView, quote, restock, memorizeStock, convertItemPiles, convertAllItemPiles, formatPrice } from "../adapter/shop.mjs";
import { openSource } from "./open.mjs";
import { configureMerchant } from "./shop.mjs";
import { ShopWindow } from "../apps/shop-window.mjs";
import { MerchantConfig } from "../apps/merchant-config.mjs";
import { tileToZone } from "./tile-zone.mjs";
import { runZone } from "./zones.mjs";
import { tileShape } from "../adapter/tile-outline.mjs";
import { requestSearch, passiveCheck } from "./hidden.mjs";
import { concealedThings, passiveScore } from "../adapter/hidden.mjs";

function tokenOf(tokenId) {
  if ( !game.user.isGM ) throw new Error("réservé au MJ");
  const token = canvas.scene?.tokens.get(tokenId);
  if ( !token ) throw new Error(`token ${tokenId} absent de la scène affichée`);
  return token;
}

/** Ce qui est chargé : version, requêtes inscrites, réglages. */
function status() {
  return {
    version: game.modules.get(MODULE_ID)?.version,
    queries: Object.keys(CONFIG.queries).filter(k => k.startsWith(`${MODULE_ID}.`)).sort(),
    container: !!CONFIG.RegionBehavior.dataModels[`${MODULE_ID}.container`],
    zones: ["macro", "scene", "document"].filter(t => !!CONFIG.RegionBehavior.dataModels[`${MODULE_ID}.${t}`]),
    world: game.world.id,
    scene: canvas.scene?.name ?? null,
    activeGM: game.users.activeGM?.name ?? null
  };
}

/** L'état d'un marchand : sa configuration, son étal (vu du MJ), sa caisse ; avec `looterId`, ce qu'un personnage y voit. */
function shopState({ tokenId, looterId=null }) {
  const token = tokenOf(tokenId);
  const looter = looterId ? tokenOf(looterId) : null;
  const tell = e => ({ id: e.id, name: e.name, quantity: e.quantity, unit: e.unit, price: formatPrice(e.unit),
    hidden: e.hidden, notForSale: e.notForSale, base: e.base, rolled: e.rolled, bought: e.bought, verdict: e.verdict ?? null });
  return {
    merchant: isMerchant(token.actor) ? merchantOf(token.actor) : null,
    purse: token.actor.system.currency,
    stock: stockView(token.actor, looter?.actor ?? null, { gm: !looter }).map(tell),
    wares: looter ? waresView(looter.actor, token.actor, token).map(tell) : []
  };
}

/** Le devis d'un panier, tel que le MJ le calculerait. */
function shopQuote({ tokenId, looterId, buy=[], sell=[] }) {
  const token = tokenOf(tokenId);
  const q = quote(token.actor, token, tokenOf(looterId).actor, { buy, sell });
  return { buyTotal: q.buyTotal, sellTotal: q.sellTotal, net: q.net, ok: q.ok, reason: q.reason ?? null, changed: q.changed,
    buy: q.buy.map(l => ({ id: l.id, quantity: l.quantity, price: l.price })), sell: q.sell.map(l => ({ id: l.id, quantity: l.quantity, price: l.price })) };
}

const shopRestock = ({ tokenId }) => restock(tokenOf(tokenId).actor);
const shopMemorize = ({ tokenId }) => memorizeStock(tokenOf(tokenId).actor);
const shopConvert = async ({ tokenId }) => !!(await convertItemPiles(tokenOf(tokenId).actor));

/** Reprend tous les marchands d'Item Piles du monde ; bilan par marchand, et leur token sur la scène affichée. */
async function shopConvertAll({ force=false }={}) {
  const report = await convertAllItemPiles({ force });
  return report.map(r => ({ ...r, till: formatPrice(r.till), token: canvas.scene?.tokens.find(t => t.actorId === r.id)?.id ?? null }));
}

/** Les marchands du monde (les nôtres), avec leur token sur la scène affichée s'ils y sont. */
function shopList() {
  return game.actors.filter(a => isMerchant(a)).map(a => ({ id: a.id, name: a.name, goods: stockView(a).length,
    token: canvas.scene?.tokens.find(t => t.actorId === a.id)?.id ?? null, itemPiles: !!a.flags?.["item-piles"]?.data?.enabled }));
}

/** Ouvre chez le MJ la boutique (étal seul, ou au nom de `looterId`) ou les réglages du marchand. */
async function shopOpen({ tokenId, looterId=null, config=false }) {
  const token = tokenOf(tokenId);
  if ( config ) await configureMerchant(token.actor);
  else await openSource(merchantSource(token), looterId ? tokenOf(looterId) : null);
  return { shops: ShopWindow.open.size, configs: MerchantConfig.open.size };
}

/** Ferme les fenêtres de boutique et de réglages ouvertes chez le MJ. */
async function shopClose() {
  const apps = [...ShopWindow.open.values(), ...MerchantConfig.open.values()];
  for ( const app of apps ) await app.close();
  return { closed: apps.length };
}

/* ---- zones « DAS · … » (SPEC §3.12) ---- */

function regionOf(regionId) {
  if ( !game.user.isGM ) throw new Error("réservé au MJ");
  const region = canvas.scene?.regions.get(regionId);
  if ( !region ) throw new Error(`région ${regionId} absente de la scène affichée`);
  return region;
}

/** La forme qu'aurait la zone d'une tuile : contour tracé ou rectangle, nombre de points, boîte englobante. */
function zoneShape({ tileId }) {
  const tile = canvas.scene?.tiles.get(tileId);
  if ( !tile ) throw new Error(`tuile ${tileId} absente de la scène affichée`);
  const { points, traced } = tileShape(tile);
  const xs = points.filter((_, i) => !(i % 2)), ys = points.filter((_, i) => i % 2);
  return { traced, points: points.length / 2, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    tile: { x: tile.x, y: tile.y, width: tile.width, height: tile.height, anchor: [tile.texture.anchorX, tile.texture.anchorY] } };
}

/** Crée la zone d'une tuile comme le bouton du HUD, marquée d'essai (`flags.darsh-loot.test`). */
async function zoneFromTile({ tileId, kind="container", name="", system={} }) {
  const tile = canvas.scene?.tiles.get(tileId);
  if ( !tile ) throw new Error(`tuile ${tileId} absente de la scène affichée`);
  const region = await tileToZone(tile, { kind, name, system, openSheet: false });
  await region.setFlag(MODULE_ID, "test", true);
  return zoneState({ regionId: region.id });
}

/** Une région et ses comportements, tels qu'enregistrés. */
function zoneState({ regionId }) {
  const region = regionOf(regionId);
  return {
    id: region.id, name: region.name, visibility: region.visibility, hidden: region.hidden,
    points: (region.shapes[0]?.points?.length ?? 0) / 2,
    behaviors: region.behaviors.map(b => ({ id: b.id, type: b.type, name: b.name, disabled: b.disabled,
      displayName: b.system.displayName ?? null, system: b.system.toObject() }))
  };
}

/** Se servir d'une zone comme par un clic du MJ (pour un token, ou personne) ; rend la scène vue et les fenêtres ouvertes après. */
async function zoneUse({ regionId, tokenId=null }) {
  const region = regionOf(regionId);
  const behavior = region.behaviors.contents[0];
  await runZone(behavior, tokenId ? tokenOf(tokenId) : null);
  await new Promise(resolve => setTimeout(resolve, 300));
  return { viewed: canvas.scene?.name ?? null,
    windows: [...foundry.applications.instances.values()].filter(a => a.rendered).map(a => a.title) };
}

/** Ce qui est caché sur la scène affichée, et, pour un token, s'il l'atteint (distance) et sa valeur passive. */
function hiddenState({ tokenId=null }={}) {
  const token = tokenId ? tokenOf(tokenId) : null;
  return concealedThings(canvas.scene).map(t => ({ kind: t.kind, key: t.key, hidden: t.hidden, tried: t.tried,
    distance: token ? t.distance(token) : null, passive: token ? passiveScore(token.actor, t.hidden.skill) : null }));
}

/** « Fouiller les environs » pour ce token, comme le bouton (le MJ joue le joueur). */
const hiddenSearch = ({ tokenId }) => requestSearch(tokenOf(tokenId));

/** Rejouer la Perception passive de ce token, comme s'il venait de bouger. */
const hiddenPassive = async ({ tokenId }) => { await passiveCheck(tokenOf(tokenId), { x: true }); return hiddenState({ tokenId }); };

/** Coche ou décoche « trouvée » sur la première zone DAS d'une région (recacher : `found: false`). */
async function hiddenSet({ regionId, found }) {
  const behavior = regionOf(regionId).behaviors.find(b => b.type.startsWith(`${MODULE_ID}.`));
  await behavior.update({ "system.hidden.found": !!found });
  await new Promise(resolve => setTimeout(resolve, 500));
  const region = regionOf(regionId);
  return { found: behavior.system.hidden.found, concealed: region.getFlag(MODULE_ID, "concealed") ?? null,
    tiles: region.parent.tiles.filter(t => region.polygonTree.testPoint({ x: t.x, y: t.y })).map(t => ({ id: t.id, hidden: t.hidden })),
    tried: behavior.getFlag(MODULE_ID, "tried") ?? null };
}

/** Retire les régions d'essai (et, par les hooks, les coffres de leurs conteneurs) sur toutes les scènes. */
async function removeTestZones() {
  let regions = 0;
  for ( const scene of game.scenes ) {
    const ids = scene.regions.filter(r => r.getFlag(MODULE_ID, "test") === true).map(r => r.id);
    if ( ids.length ) { await scene.deleteEmbeddedDocuments("Region", ids); regions += ids.length; }
  }
  return { regions };
}

/**
 * Retire ce qu'un essai a créé : les acteurs et les tables du monde marqués `flags.darsh-loot.test` et leurs tokens, sur toutes les
 * scènes. Rien d'autre n'est touché.
 */
async function removeTestActors() {
  const actors = game.actors.filter(a => a.getFlag(MODULE_ID, "test") === true);
  let tokens = 0;
  for ( const scene of game.scenes ) {
    const ids = scene.tokens.filter(t => actors.some(a => a.id === t.actorId)).map(t => t.id);
    if ( ids.length ) { await scene.deleteEmbeddedDocuments("Token", ids); tokens += ids.length; }
  }
  const names = actors.map(a => a.name);
  if ( actors.length ) await Actor.implementation.deleteDocuments(actors.map(a => a.id));
  // Les tables d'essai, marquées de même.
  const tables = game.tables.filter(t => t.getFlag(MODULE_ID, "test") === true);
  const tableNames = tables.map(t => t.name);
  if ( tables.length ) await RollTable.implementation.deleteDocuments(tables.map(t => t.id));
  return { actors: names, tokens, tables: tableNames };
}

export const testApi = Object.freeze({ status, shopState, shopQuote, shopRestock, shopMemorize, shopConvert, shopOpen, shopClose, shopConvertAll, shopList, removeTestActors,
  zoneShape, zoneFromTile, zoneState, zoneUse, removeTestZones, hiddenState, hiddenSearch, hiddenPassive, hiddenSet });
