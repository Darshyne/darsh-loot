/**
 * Pure rules of sharing (lot 1, 2026-11-27): who is the party, how coins are split. No Foundry here: plain data in, plain data
 * out, tested by tests/share.test.mjs.
 */
import { COINS } from "./loot.mjs";

/**
 * Splits a purse between `count` members, denomination by denomination, without converting coins: each member gets the same
 * whole number of each coin. What does not divide stays where it is (`remainder: "source"`) or goes to the one who shares
 * (`"sharer"`).
 * @param {Record<string, number>} currency
 * @param {number} count
 * @param {{ remainder?: "source"|"sharer" }} [options]
 * @returns {{ each: Record<string, number>, bonus: Record<string, number>, left: Record<string, number>, any: boolean }}
 *   each: what every member receives ; bonus: what the sharer receives on top ; left: what stays at the source ; any: is there
 *   anything to hand to every member? Only positive amounts are listed.
 */
export function splitCoins(currency={}, count, { remainder="source" }={}) {
  const each = {}, bonus = {}, left = {};
  const members = Math.max(0, Math.floor(Number(count) || 0));
  for ( const key of COINS ) {
    const have = Math.max(0, Math.floor(Number(currency[key]) || 0));
    if ( !have || !members ) { if ( have ) left[key] = have; continue; }
    const share = Math.floor(have / members);
    const rest = have - (share * members);
    if ( share ) each[key] = share;
    if ( rest ) ((remainder === "sharer") ? bonus : left)[key] = rest;
  }
  return { each, bonus, left, any: Object.keys(each).length > 0 };
}

/**
 * Who shares. With a primary party: its player characters (`mode: "party"`), or only those with a token on the scene of the
 * loot (`"scene"`). Without one: the player-owned characters with a token on that scene. The character who shares is always in,
 * when it is a player character.
 * @param {{ party?: string[], present?: string[], owned?: string[], mode?: "party"|"scene", sharer?: string|null }} data
 *   party: ids of the primary party's player characters ; present: ids of the actors with a token on the scene ; owned: ids of
 *   the player-owned characters ; sharer: id of the character who shares (null: the GM, without a character).
 * @returns {string[]}  Actor ids, without duplicates, party order first.
 */
export function pickMembers({ party=[], present=[], owned=[], mode="party", sharer=null }={}) {
  const here = new Set(present);
  const picked = party.length
    ? ((mode === "scene") ? party.filter(id => here.has(id)) : [...party])
    : owned.filter(id => here.has(id));
  if ( sharer && !picked.includes(sharer) ) picked.push(sharer);
  return [...new Set(picked)];
}

/** « 3 gp, 2 sp », in the order of COINS; `labels` gives the short name of each coin. Empty purse: an empty string. */
export function coinsText(coins={}, labels={}) {
  return COINS.filter(key => (Number(coins[key]) || 0) > 0).map(key => `${coins[key]} ${labels[key] ?? key}`).join(", ");
}
