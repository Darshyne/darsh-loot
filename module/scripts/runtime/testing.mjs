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

export const testApi = Object.freeze({ status, shopState, shopQuote, shopRestock, shopMemorize, shopConvert, shopOpen, shopClose, shopConvertAll, shopList, removeTestActors });
