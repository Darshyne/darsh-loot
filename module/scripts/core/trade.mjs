/**
 * Échange entre joueurs (SPEC §3.6, étape 7) — état pur, testé par tests/trade.test.mjs. L'état vit chez le MJ actif, qui
 * le relaie aux deux joueurs ; chacun ne modifie que son côté (« a » : celui qui propose, « b » : l'autre).
 *
 * Règle : toute modification d'une offre retire les deux validations (on ne valide que ce qu'on a vu) ; l'échange se
 * fait quand les deux côtés ont validé.
 */
import { COINS } from "./loot.mjs";

/** Un échange neuf entre deux personnages. */
export function newTrade({ id, a, b }) {
  const side = s => ({ actor: s.actor, name: s.name, user: s.user ?? null, items: [], coins: {}, accepted: false });
  return { id, a: side(a), b: side(b), done: false, cancelled: false };
}

/** A trade nobody has touched for this long is abandoned (ms): the GM client cancels it (lot 0, defect 9). */
export const TRADE_MAX_IDLE_MS = 30 * 60000;

/** How many trades one player may have proposed and left open at the same time. */
export const TRADE_MAX_OPEN = 3;

/**
 * The trades to cancel because nobody touched them for too long.
 * @param {Iterable<{ id: string, touched?: number }>} trades
 * @param {number} now
 * @returns {string[]}  Their ids.
 */
export function staleTrades(trades, now, maxIdle=TRADE_MAX_IDLE_MS) {
  return [...trades].filter(t => (now - (t.touched ?? now)) > maxIdle).map(t => t.id);
}

/** L'autre côté. */
export const other = side => (side === "a" ? "b" : "a");

/** Des pièces propres : entiers positifs seulement, dans les monnaies connues. */
export function cleanCoins(coins={}) {
  const out = {};
  for ( const key of COINS ) {
    const n = Math.floor(Number(coins[key]) || 0);
    if ( n > 0 ) out[key] = n;
  }
  return out;
}

/**
 * Remplace l'offre d'un côté (objets `{ id, quantity }`, pièces) : les deux validations tombent.
 * Un objet en double est fusionné ; une quantité nulle le retire.
 */
export function setOffer(trade, side, { items=[], coins={} }={}) {
  const merged = new Map();
  for ( const { id, quantity } of items ) {
    const q = Math.floor(Number(quantity) || 0);
    if ( !id || (q <= 0) ) continue;
    merged.set(id, (merged.get(id) ?? 0) + q);
  }
  const offer = { items: [...merged].map(([id, quantity]) => ({ id, quantity })), coins: cleanCoins(coins) };
  return {
    ...trade,
    [side]: { ...trade[side], ...offer, accepted: false },
    [other(side)]: { ...trade[other(side)], accepted: false }
  };
}

/** Un côté valide l'échange tel qu'il est. */
export function accept(trade, side) {
  return { ...trade, [side]: { ...trade[side], accepted: true } };
}

/** Un côté retire sa validation. */
export function unaccept(trade, side) {
  return { ...trade, [side]: { ...trade[side], accepted: false } };
}

/** Les deux ont validé, et il y a quelque chose à échanger. */
export function ready(trade) {
  const something = s => (s.items.length > 0) || (Object.keys(s.coins).length > 0);
  return !trade.done && !trade.cancelled && trade.a.accepted && trade.b.accepted && (something(trade.a) || something(trade.b));
}

/**
 * An offer without the items stored inside a bag that is itself offered (lot 0, audit of 2026-11-26, defect 2): the bag leaves
 * with its contents, so an item inside it must not be moved a second time — it no longer exists once the bag is gone, and the
 * trade used to break half-way.
 * @param {{id: string, quantity: number}[]} items
 * @param {Record<string, string|null>} containerOf  For each item id of the sheet, the id of the bag it is stored in.
 * @returns {{ items: {id: string, quantity: number}[], changed: boolean }}
 */
export function withoutContained(items, containerOf={}) {
  const offered = new Set(items.map(i => i.id));
  const insideOffered = id => {
    const seen = new Set();
    for ( let parent = containerOf[id]; parent && !seen.has(parent); parent = containerOf[parent] ) {
      if ( offered.has(parent) ) return true;
      seen.add(parent);
    }
    return false;
  };
  const kept = items.filter(i => !insideOffered(i.id));
  return { items: kept, changed: kept.length !== items.length };
}

/**
 * Ce qu'un côté peut vraiment donner, confronté à ce qu'il possède : quantités plafonnées, objets disparus retirés,
 * pièces plafonnées à la bourse. `owned` : `{ [id]: quantity }` ; `purse` : sa bourse.
 * @returns {{ items: {id: string, quantity: number}[], coins: object, changed: boolean }}
 */
export function clampOffer(offer, owned, purse) {
  const items = offer.items
    .filter(i => owned[i.id] !== undefined)
    .map(i => ({ id: i.id, quantity: Math.min(i.quantity, owned[i.id]) }))
    .filter(i => i.quantity > 0);
  const coins = {};
  for ( const [key, n] of Object.entries(offer.coins) ) {
    const m = Math.min(n, Math.floor(Number(purse?.[key]) || 0));
    if ( m > 0 ) coins[key] = m;
  }
  const same = (items.length === offer.items.length) && items.every((i, k) => i.quantity === offer.items[k].quantity)
    && (JSON.stringify(coins) === JSON.stringify(offer.coins));
  return { items, coins, changed: !same };
}
