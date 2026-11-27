/**
 * Marchands (SPEC §3.7) : ce qui lit les fiches dnd5e — qui est un marchand, son étal, ce qu'un personnage peut lui
 * vendre, le devis d'un troc, le réassort. Règles : core/shop.mjs.
 *
 * Un marchand est un **PNJ** dont le drapeau `flags.darsh-loot.merchant` est activé ; son stock est son inventaire, sa
 * caisse sa bourse. Chaque objet peut porter `flags.darsh-loot.shop` : `hidden` (caché des joueurs), `notForSale`
 * (exposé, pas à vendre), `base` (quantité de référence du stock fixe), `rolled` (tiré sur table), `bought` (racheté à
 * un joueur).
 */
import { MODULE_ID } from "../shared.mjs";
import { COINS, canLeaveOwner, PHYSICAL_TYPES } from "../core/loot.mjs";
import {
  normalizeMerchant, toCp, modifiersFor, buyPrice, sellPrice, goodsOf, wares, stolenVerdict, worstVerdict, settle, cleanCart,
  restockPlan, coinsFor, purseValue, fromItemPiles, appendLog
} from "../core/shop.mjs";
import { drawItems } from "./treasure.mjs";
import { moveItemNow } from "./drop.mjs";
import { loc } from "../shared.mjs";

/** La configuration (normalisée) du marchand que serait cet acteur. */
export const merchantOf = actor => normalizeMerchant(actor?.getFlag(MODULE_ID, "merchant"));

/** Cet acteur tient-il boutique ? */
export function isMerchant(actor) {
  return (actor?.type === "npc") && (actor.getFlag(MODULE_ID, "merchant")?.enabled === true);
}

/**
 * Un marchand vivant (acteur) : pas l'état « mort », et des PV au-dessus de 0 — sauf s'il n'a pas de PV maximum (PNJ créé sans
 * points de vie : dnd5e lui met 0 PV, il n'est pas mort pour autant ; signalé sur le Discord le 2026-11-19).
 */
export function merchantAlive(actor) {
  if ( !isMerchant(actor) || actor.statuses.has("dead") ) return false;
  const hp = actor.system.attributes?.hp;
  if ( !(Number(hp?.max) > 0) ) return true;
  return (hp.value ?? 1) > 0;
}

/**
 * How long a shop the GM has shown stays open to the players it was shown to (ms): a session. Lot 0 (audit of 2026-11-26,
 * defect 10): a shop addressed by its **actor** has neither place nor reach — that is meant for a shop without a token, which the
 * GM shows. The GM client only accepts it for a shop it has shown (`flags.darsh-loot.shown`: when, and to whom), or for a merchant
 * set to trade from anywhere (`remote`, 2026-11-27: journal links, the sheet button).
 */
export const SHOWN_VALID_MS = 12 * 3600000;

/** May this user trade with this shop through its actor (no token, no reach)? */
export function shopOpenTo(actor, user) {
  if ( user?.isGM || merchantOf(actor).remote ) return true;
  const shown = actor?.getFlag(MODULE_ID, "shown");
  return !!shown && ((Date.now() - (Number(shown.time) || 0)) < SHOWN_VALID_MS) && (shown.users ?? []).includes(user?.id);
}

/** Un token de marchand vivant, sur sa scène. */
export const merchantToken = tokenDoc => merchantAlive(tokenDoc?.actor);

/** Sous quels noms et UUID ce marchand est connu (pour reconnaître ce qu'on lui a volé, §3.3). */
export function identityOf(actor, token=null) {
  return { names: [actor.name, token?.name].filter(Boolean), uuids: [actor.uuid, token?.uuid, token?.actor?.uuid].filter(Boolean) };
}

/** Un montant en pc, écrit « 12 po 5 pa » (abréviations de dnd5e ; « 0 » en pc). */
export function formatPrice(cp) {
  const abbr = k => game.i18n.localize(CONFIG.DND5E.currencies[k]?.abbreviation ?? k);
  const coins = Object.entries(coinsFor(cp));
  if ( !coins.length ) return `0 ${abbr("cp")}`;
  return coins.map(([k, n]) => `${n} ${abbr(k)}`).join(" ");
}

/** La bourse d'un acteur telle qu'on l'affiche : les pièces présentes, des plus précieuses aux moindres. */
export function purseView(actor) {
  const currency = actor?.system.currency ?? {};
  return COINS.filter(k => (Number(currency[k]) || 0) > 0)
    .map(k => ({ key: k, value: Number(currency[k]), abbr: game.i18n.localize(CONFIG.DND5E.currencies[k]?.abbreviation ?? k) }));
}

/** Le prix de base d'un objet en pc ; un contenant vaut aussi ce qu'il contient (sinon son contenu partirait gratis). */
function baseCpOf(item, actor) {
  const own = toCp(item.system.price?.value, item.system.price?.denomination);
  if ( item.type !== "container" ) return own;
  const inside = actor.items.filter(i => i.system.container === item.id);
  return own + inside.reduce((sum, i) => sum + (baseCpOf(i, actor) * (i.system.quantity ?? 1)), 0);
}

/** The stolen marks of the items stored in this bag, bags inside it included. */
function stolenInside(actor, id, seen=new Set()) {
  if ( seen.has(id) ) return [];
  seen.add(id);
  return actor.items.filter(i => i.system.container === id).flatMap(i => [
    ...(i.getFlag(MODULE_ID, "stolen") ? [i.getFlag(MODULE_ID, "stolen")] : []),
    ...((i.type === "container") ? stolenInside(actor, i.id, seen) : [])]);
}

/** Les objets d'un acteur en données simples, pour core/shop.mjs. */
function plainItems(actor) {
  return actor.items.map(i => {
    const shop = i.getFlag(MODULE_ID, "shop") ?? {};
    return {
      id: i.id, type: i.type, name: i.name, img: i.img,
      quantity: i.system.quantity ?? 0,
      container: i.system.container ?? null,
      equipped: !!i.system.equipped,
      baseCp: baseCpOf(i, actor),
      hidden: shop.hidden === true, notForSale: shop.notForSale === true,
      base: Number.isFinite(shop.base) ? shop.base : null, rolled: shop.rolled === true, bought: shop.bought === true,
      // The GM's own price for this item in this shop (copper pieces), and whether restocks leave it alone.
      priceCp: (Number.isFinite(shop.price) && (shop.price >= 0)) ? shop.price : null, locked: shop.locked === true,
      stolen: i.getFlag(MODULE_ID, "stolen") ?? null,
      // Lot 0 (defect 15): the stolen marks of everything stored in this bag, at any depth.
      stolenInside: (i.type === "container") ? stolenInside(actor, i.id) : [],
      // Lot 0 (defect 1): what this actor cannot hand over (an NPC item that is not gear).
      stuck: !canLeaveOwner({ fromNpc: actor.type === "npc", properties: i.system.properties })
    };
  });
}

/**
 * L'étal tel qu'un personnage le voit : chaque marchandise avec son prix à l'unité pour lui.
 * @param {Actor} actor              Le marchand.
 * @param {Actor|null} buyer         Le personnage qui regarde (sa remise, l'attitude du marchand envers lui).
 * @param {{ gm?: boolean }} [options]  Le MJ voit aussi ce qui est caché, épuisé ou sans prix.
 */
export function stockView(actor, buyer=null, { gm=false }={}) {
  const merchant = merchantOf(actor);
  // A price typed by the GM replaces the item's own (and the merchant and type factors, see `modifiersFor`).
  const items = plainItems(actor).map(i => ((i.priceCp !== null) ? { ...i, autoCp: i.baseCp, baseCp: i.priceCp } : i));
  return goodsOf(items, { gm, infiniteStock: merchant.infiniteStock }).map(e => {
    const modifiers = modifiersFor(merchant, { type: e.type, characterId: buyer?.id ?? null, fixed: e.priceCp !== null });
    return { ...e, modifiers, unit: buyPrice(e.baseCp, 1, modifiers), available: merchant.infiniteStock ? Infinity : e.quantity };
  });
}

/**
 * Ce que le personnage peut proposer à ce marchand, avec ce qu'il en donnerait à l'unité ; un objet volé que le
 * marchand refuse est marqué (`verdict: "refuse"`), un objet racheté par un receleur aussi (`"fence"`).
 */
export function waresView(seller, actor, token=null) {
  const merchant = merchantOf(actor);
  const identity = identityOf(actor, token);
  return wares(plainItems(seller)).map(e => {
    const modifiers = modifiersFor(merchant, { type: e.type, characterId: seller.id });
    const verdict = worstVerdict([e.stolen, ...(e.stolenInside ?? [])].map(mark => stolenVerdict(merchant, mark, identity)));
    const rate = (verdict === "fence") ? merchant.fenceRate : 1;
    return { ...e, modifiers, verdict, rate, unit: sellPrice(e.baseCp, 1, modifiers, rate), available: e.quantity };
  });
}

/**
 * Le devis d'un troc : le panier confronté au stock et à l'inventaire (quantités plafonnées, objets disparus ou refusés
 * retirés), les prix de chaque ligne, le solde et les bourses après. Calculé chez le joueur pour l'affichage, refait
 * chez le MJ avant d'exécuter.
 * @param {Actor} actor                   Le marchand.
 * @param {TokenDocument|null} token      Son token (pour reconnaître ce qu'on lui a volé).
 * @param {Actor} buyer                   Le personnage.
 * @param {{ buy?: {id, quantity}[], sell?: {id, quantity}[] }} cart
 * @returns {{ buy: object[], sell: object[], buyTotal: number, sellTotal: number, net: number, ok: boolean,
 *   reason?: string, player: object, merchant: object, changed: boolean, empty: boolean }}
 */
export function quote(actor, token, buyer, cart={}) {
  const merchant = merchantOf(actor);
  const stock = stockView(actor, buyer).filter(e => !e.notForSale);
  const mine = waresView(buyer, actor, token).filter(e => e.verdict !== "refuse");
  const lines = (wanted, entries, price) => {
    const byId = new Map(entries.map(e => [e.id, e]));
    const clean = cleanCart(wanted ?? [], Object.fromEntries(entries.map(e => [e.id, e.available])));
    return clean.map(l => {
      const e = byId.get(l.id);
      return { id: l.id, quantity: l.quantity, name: e.name, img: e.img, price: price(e, l.quantity) };
    });
  };
  const buy = lines(cart.buy, stock, (e, q) => buyPrice(e.baseCp, q, e.modifiers));
  const sell = lines(cart.sell, mine, (e, q) => sellPrice(e.baseCp, q, e.modifiers, e.rate));
  const total = list => list.reduce((sum, l) => sum + l.price, 0);
  const same = (a, b) => JSON.stringify((a ?? []).map(l => [l.id, Math.floor(Number(l.quantity) || 0)]).sort())
    === JSON.stringify(b.map(l => [l.id, l.quantity]).sort());
  const result = settle({ buyTotal: total(buy), sellTotal: total(sell), playerPurse: buyer.system.currency,
    merchantPurse: actor.system.currency, infiniteCoins: merchant.infiniteCoins });
  return { buy, sell, buyTotal: total(buy), sellTotal: total(sell), ...result,
    changed: !same(cart.buy, buy) || !same(cart.sell, sell), empty: !buy.length && !sell.length };
}

/**
 * Exécute un troc dont le devis est bon — chez le MJ : les objets vendus rejoignent l'étal (empilés, marque de vol
 * ôtée, notés « rachetés »), les objets achetés passent au personnage (le stock infini ne baisse pas), les bourses
 * prennent leur valeur d'après solde. `op` : the operation that undoes it all when a write fails (adapter/ledger.mjs). Le devis donne les bourses d'arrivée : il doit avoir été fait dans le même tour
 * (`inTurn`, adapter/ledger.mjs) que cet appel, sur le marchand et le personnage — sinon une bourse qui a bougé entre
 * les deux serait écrasée.
 */
export async function executeDeal(actor, buyer, deal, op) {
  const merchant = merchantOf(actor);
  const names = { bought: [], sold: [] };
  const label = m => (m.quantity > 1 ? `${m.name} (${m.quantity})` : m.name);
  for ( const line of deal.sell ) {
    names.sold.push(label(await moveItemNow(buyer, actor, line.id, line.quantity, { anyType: true, launder: true, shop: { bought: true }, op })));
  }
  for ( const line of deal.buy ) {
    const moved = await moveItemNow(actor, buyer, line.id, line.quantity, { copy: merchant.infiniteStock, op });
    // Checked before the first write by the caller (`unsellable`); if it happens anyway, the deal stops and is undone.
    if ( moved.kept ) throw new Error(loc("Shop.Stuck", { name: moved.name }));
    names.bought.push(label(moved));
  }
  if ( deal.net !== 0 ) {
    // The purses are written inside the turn held on both actors: putting back the value read here is exact.
    const before = { buyer: { ...buyer.system.currency }, merchant: { ...actor.system.currency } };
    await buyer.update({ "system.currency": deal.player });
    op.did(loc("Op.Step.Purse", { who: buyer.name }), () => buyer.update({ "system.currency": before.buyer }));
    if ( !merchant.infiniteCoins ) {
      await actor.update({ "system.currency": deal.merchant });
      op.did(loc("Op.Step.Purse", { who: actor.name }), () => actor.update({ "system.currency": before.merchant }));
    }
  }
  return names;
}

/**
 * Lot 0 (audit of 2026-11-26, defect 1): the first wanted item this merchant cannot hand over — an NPC item without the `gear`
 * property (imported merchant, item older than dnd5e 6.0). Asked before the first write: such an item was shown, priced and
 * paid for, and nothing was delivered.
 * @returns {string|null}  Its name, or null when everything can change hands.
 */
export function unsellable(actor, wanted=[]) {
  for ( const { id } of wanted ) {
    const item = actor.items.get(id);
    if ( item && !canLeaveOwner({ fromNpc: actor.type === "npc", properties: item.system.properties }) ) return item.name;
  }
  return null;
}

/* -------------------------------------------- */
/*  Stock (côté MJ)                             */
/* -------------------------------------------- */

/**
 * Note l'état présent comme référence du réassort : la quantité de chaque objet du stock fixe (ni tiré, ni racheté) et
 * la caisse. À appeler chez le MJ.
 */
export async function memorizeStock(actor) {
  const updates = plainItems(actor).filter(i => !i.rolled && !i.bought && (i.quantity > 0))
    .map(i => ({ _id: i.id, [`flags.${MODULE_ID}.shop.base`]: i.quantity }));
  if ( updates.length ) await actor.updateEmbeddedDocuments("Item", updates);
  await actor.setFlag(MODULE_ID, "merchant.purse", Object.fromEntries(COINS.map(k => [k, Number(actor.system.currency?.[k]) || 0])));
  return updates.length;
}

/**
 * Restock — on the GM's side. `mode` (core/shop.mjs `restockPlan`): `full` (drawn and bought items leave, the fixed stock and the
 * till go back to their reference, the tables are drawn), `add` (the tables are drawn on top), `tables` (only the drawn items are
 * renewed). Locked items are left alone. Identical drawn items are stacked.
 * @returns {Promise<{ removed: number, restored: number, drawn: string[] }>}
 */
export async function restock(actor, mode="full") {
  const merchant = merchantOf(actor);
  const plan = restockPlan(plainItems(actor), mode);
  const removable = plan.remove.filter(id => actor.items.has(id));
  if ( removable.length ) await actor.deleteEmbeddedDocuments("Item", removable, { deleteContents: true });
  if ( plan.restore.length ) await actor.updateEmbeddedDocuments("Item", plan.restore.map(r => ({ _id: r.id, "system.quantity": r.quantity })));
  const purse = actor.getFlag(MODULE_ID, "merchant")?.purse;
  if ( plan.purse && purse ) await actor.update({ "system.currency": purse });

  const drawn = [];
  for ( const table of (plan.draw ? merchant.tables : []) ) {
    const rolls = Math.max(0, (await new Roll(table.rolls).evaluate({ allowInteractive: false })).total);
    for ( const result of await drawItems(table.uuid, rolls) ) {
      const data = await asWare(result);
      if ( !data ) continue;
      const same = drawn.find(d => (d.name === data.name) && (d.type === data.type) && (d.type !== "container"));
      if ( same ) same.system.quantity = (same.system.quantity ?? 1) + (data.system?.quantity ?? 1);
      else { foundry.utils.setProperty(data, `flags.${MODULE_ID}.shop`, { rolled: true }); drawn.push(data); }
    }
  }
  if ( drawn.length ) await actor.createEmbeddedDocuments("Item", drawn);
  return { removed: removable.length, restored: plan.restore.length, drawn: drawn.map(d => d.name) };
}

/* -------------------------------------------- */
/*  Stall editing (GM, from the shop window)    */
/* -------------------------------------------- */

/** The GM's price for this item in this shop, in copper pieces; null goes back to the automatic price. */
export function setStallPrice(item, cp) {
  if ( (cp === null) || (cp === undefined) ) return item.update({ [`flags.${MODULE_ID}.shop.-=price`]: null });
  return item.update({ [`flags.${MODULE_ID}.shop.price`]: Math.max(0, Math.round(Number(cp) || 0)) });
}

/**
 * The quantity on the stall. An item of the fixed stock (not drawn, not bought) also takes it as its restock reference: the GM
 * who sets « 10 arrows » wants 10 after the next restock.
 */
export function setStallQuantity(item, quantity) {
  const q = Math.max(0, Math.floor(Number(quantity) || 0));
  const shop = item.getFlag(MODULE_ID, "shop") ?? {};
  const update = { "system.quantity": q };
  if ( !shop.rolled && !shop.bought ) update[`flags.${MODULE_ID}.shop.base`] = q;
  return item.update(update);
}

/** The stall flags of an item, merged (`hidden`, `notForSale`, `locked`…). */
export function setStallFlags(item, flags) {
  return item.update(Object.fromEntries(Object.entries(flags).map(([k, v]) => [`flags.${MODULE_ID}.shop.${k}`, v])));
}

/** An item that is not gear (legacy NPC item) becomes gear: the merchant can hand it over. */
export function makeSellable(item) {
  const properties = new Set(item.system.properties ?? []);
  properties.add("gear");
  return item.update({ "system.properties": [...properties] });
}

/**
 * Items dropped on the stall by the GM (from the sidebar, a compendium, another sheet): copied onto the merchant as fixed stock
 * (their quantity is the restock reference). An identical item already on the stall (same type and name, fixed stock) is stacked.
 * @param {Actor} actor
 * @param {object[]} sources  Item data (`toObject()`).
 * @returns {Promise<string[]>}  The names added.
 */
export async function addToStall(actor, sources) {
  const create = [];
  const names = [];
  for ( const source of sources ) {
    if ( !PHYSICAL_TYPES.has(source?.type) ) continue;
    const data = foundry.utils.deepClone(source);
    delete data._id;
    if ( data.system ) { delete data.system.container; data.system.equipped = false; }
    const quantity = Math.max(1, Math.floor(Number(data.system?.quantity) || 1));
    const same = (data.type !== "container") && actor.items.find(i => (i.type === data.type) && (i.name === data.name)
      && !i.system.container && !i.getFlag(MODULE_ID, "shop")?.rolled && !i.getFlag(MODULE_ID, "shop")?.bought);
    if ( same ) await setStallQuantity(same, (same.system.quantity ?? 0) + quantity);
    else {
      if ( data.flags?.[MODULE_ID] ) { delete data.flags[MODULE_ID].shop; delete data.flags[MODULE_ID].stolen; }
      foundry.utils.setProperty(data, `flags.${MODULE_ID}.shop`, { base: quantity });
      create.push(data);
    }
    names.push(data.name);
  }
  if ( create.length ) await actor.createEmbeddedDocuments("Item", create);
  return names;
}

/** Remove an item from the stall (a bag leaves with what it holds). */
export function removeFromStall(item) {
  return item.delete({ deleteContents: true });
}

/** Rename the merchant: the actor, its prototype token, and the token the shop was opened from. */
export async function renameMerchant(actor, token, name) {
  const n = String(name ?? "").trim();
  if ( !n ) return false;
  if ( n !== actor.name ) await actor.update({ name: n, "prototypeToken.name": n });
  if ( token && (token.documentName === "Token") && (token.name !== n) ) await token.update({ name: n });
  return true;
}

/** Open or close the shop (`closed` in the merchant flag). Returns whether it is now closed. */
export async function setClosed(actor, closed) {
  await actor.setFlag(MODULE_ID, "merchant.closed", !!closed);
  return !!closed;
}

/**
 * Back to a plain NPC: the merchant settings, the sales log and the stall marks of its items go; the items, coins and tokens stay.
 */
export async function unmakeMerchant(actor) {
  const marked = actor.items.filter(i => i.getFlag(MODULE_ID, "shop") !== undefined)
    .map(i => ({ _id: i.id, [`flags.${MODULE_ID}.-=shop`]: null }));
  if ( marked.length ) await actor.updateEmbeddedDocuments("Item", marked);
  await actor.update({ [`flags.${MODULE_ID}.-=merchant`]: null, [`flags.${MODULE_ID}.-=log`]: null });
  return !isMerchant(actor);
}

/* -------------------------------------------- */
/*  Sales log                                   */
/* -------------------------------------------- */

/** The merchant's sales and theft log, oldest first. */
export function salesLog(actor) {
  const log = actor?.getFlag(MODULE_ID, "log");
  return Array.isArray(log) ? log : [];
}

/**
 * One more line in the merchant's log — on the GM's side. `entry`: `{ kind: "deal"|"theft"|"caught", who, user, bought?, sold?,
 * net?, item? }`; the real and the world time are added.
 */
export function recordSale(actor, entry) {
  const line = { ...entry, time: Date.now(), worldTime: game.time?.worldTime ?? 0 };
  return actor.setFlag(MODULE_ID, "log", appendLog(salesLog(actor), line));
}

/** Empty the log. */
export function clearSalesLog(actor) {
  return actor.unsetFlag(MODULE_ID, "log");
}

/**
 * Ce qu'un résultat de table devient à l'étal : un **sort** devient son parchemin (les tables de réassort de la
 * campagne tirent des sorts ; `Item5e.createScrollFromSpell`, documents/item.mjs:1346, sans dialogue — le prix est celui
 * que dnd5e donne au parchemin) ; tout autre objet tel quel. null si le parchemin n'a pas pu être fait.
 */
async function asWare(data) {
  if ( data.type !== "spell" ) return data;
  try {
    const scroll = await CONFIG.Item.documentClass.createScrollFromSpell(data, {}, { dialog: false });
    return scroll ? (scroll.toObject?.() ?? scroll) : null;
  } catch(err) {
    console.warn(`${MODULE_ID} | could not create the scroll for "${data.name}":`, err.message);
    return null;
  }
}

/** Valeur de la caisse en pc. */
export const tillValue = actor => purseValue(actor.system.currency);

/* -------------------------------------------- */
/*  Item Piles                                  */
/* -------------------------------------------- */

/** Cet acteur est-il un marchand d'Item Piles (qu'on peut reprendre) ? */
export function itemPilesMerchant(actor) {
  return fromItemPiles(actor?.flags?.["item-piles"]?.data) !== null;
}

/**
 * Reprend tous les marchands d'Item Piles du monde — chez le MJ. Un marchand déjà repris (notre drapeau présent) est
 * laissé tel quel, sauf `force`. `dry` : rien n'est écrit, le bilan dit ce qui serait repris (`todo`) d'après les
 * drapeaux d'Item Piles (étal = objets de la fiche).
 * @returns {Promise<Array<{ name: string, id: string, todo: boolean, done: boolean, goods: number, hidden: number, notForSale: number, tables: number, till: number }>>}
 */
export async function convertAllItemPiles({ force=false, dry=false }={}) {
  const report = [];
  for ( const actor of game.actors ) {
    if ( !itemPilesMerchant(actor) ) continue;
    const already = actor.getFlag(MODULE_ID, "merchant") !== undefined;
    const todo = !already || force;
    const till = purseValue(actor.system.currency);
    if ( dry && todo ) {
      const theirs = item => item.flags?.["item-piles"]?.item ?? {};
      const flag = fromItemPiles(actor.flags["item-piles"].data);
      report.push({ name: actor.name, id: actor.id, todo, done: false, goods: actor.items.size,
        hidden: actor.items.filter(i => theirs(i).hidden === true).length, notForSale: actor.items.filter(i => theirs(i).notForSale === true).length,
        tables: flag?.tables?.length ?? 0, till });
      continue;
    }
    if ( todo ) await convertItemPiles(actor);
    const stock = stockView(actor, null, { gm: true });
    report.push({ name: actor.name, id: actor.id, todo, done: todo, goods: stockView(actor).length,
      hidden: stock.filter(e => e.hidden).length, notForSale: stock.filter(e => e.notForSale).length,
      tables: merchantOf(actor).tables.length, till });
  }
  return report;
}

/**
 * Reprend un marchand d'Item Piles — chez le MJ : sa configuration devient la nôtre, les drapeaux de ses objets
 * (`hidden`, `notForSale`) aussi, et son stock présent devient la référence du réassort. Ses drapeaux Item Piles sont
 * laissés en place (rien n'est perdu ; Item Piles désactivé, ils dorment).
 * @returns {Promise<object|null>}  La configuration posée, ou null si ce n'est pas un marchand d'Item Piles.
 */
export async function convertItemPiles(actor) {
  const flag = fromItemPiles(actor?.flags?.["item-piles"]?.data);
  if ( !flag ) return null;
  await actor.update({ [`flags.${MODULE_ID}.merchant`]: flag });
  const updates = [];
  for ( const item of actor.items ) {
    const theirs = item.flags?.["item-piles"]?.item ?? {};
    const shop = {};
    if ( theirs.hidden === true ) shop.hidden = true;
    if ( theirs.notForSale === true ) shop.notForSale = true;
    if ( Object.keys(shop).length ) updates.push({ _id: item.id, [`flags.${MODULE_ID}.shop`]: shop });
  }
  if ( updates.length ) await actor.updateEmbeddedDocuments("Item", updates);
  await memorizeStock(actor);
  return merchantOf(actor);
}
