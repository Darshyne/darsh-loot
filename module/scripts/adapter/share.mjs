/**
 * Sharing, the writes (lot 1, 2026-11-27) — at the active GM, for a gesture that already holds its turn on every actor involved
 * (`inTurn`, adapter/ledger.mjs). Each write registers its undo: a share that breaks half-way gives everything back.
 */
import { loc } from "../shared.mjs";
import { addCoins, COINS } from "../core/loot.mjs";
import { splitCoins } from "../core/share.mjs";
import { operation } from "./ledger.mjs";
import { coinsLabel } from "./party.mjs";

const negative = coins => Object.fromEntries(Object.entries(coins).map(([k, v]) => [k, -v]));
const sum = (a, b) => { const out = { ...a }; for ( const [k, v] of Object.entries(b) ) out[k] = (out[k] ?? 0) + v; return out; };

/**
 * Splits the coins of `source` between `members`. What the source holds is read here, once the turn has come. Why not dnd5e's
 * `Award.awardCurrency`: it writes each sheet in a row with no way back, and hands the remainder to whoever comes last.
 * @param {Actor} source
 * @param {Actor[]} members
 * @param {{ remainder?: "source"|"sharer", sharer?: Actor|null }} [options]
 * @returns {Promise<{ each: object, bonus: object, left: object, names: string[] }>}
 */
export function shareCoinsNow(source, members, { remainder="source", sharer=null }={}) {
  // Everything is decided before the first write: a purse too small to give every member a coin is a plain refusal.
  const toSharer = (remainder === "sharer") && sharer && members.includes(sharer);
  const split = splitCoins(source.system.currency, members.length, { remainder: toSharer ? "sharer" : "source" });
  if ( members.length < 2 ) return Promise.reject(new Error(loc("Share.Alone")));
  if ( !split.any ) return Promise.reject(new Error(loc("Share.TooFew", { count: members.length })));
  const names = members.map(m => m.name);
  const plan = [loc("Share.Plan", { names: names.join(", "), each: coinsLabel(split.each) })];
  return operation({ label: loc("Share.Op", { from: source.name }), plan }, async op => {
    for ( const member of members ) {
      const gain = (toSharer && (member === sharer)) ? sum(split.each, split.bonus) : split.each;
      await member.update({ "system.currency": addCoins(member.system.currency, gain) });
      op.did(loc("Op.Step.CoinsIn", { who: member.name }),
        () => member.update({ "system.currency": addCoins(member.system.currency, negative(gain)) }));
    }
    const before = Object.fromEntries(COINS.map(k => [k, Number(source.system.currency[k]) || 0]));
    const after = Object.fromEntries(COINS.map(k => [k, split.left[k] ?? 0]));
    const taken = Object.fromEntries(COINS.map(k => [k, before[k] - after[k]]));
    await source.update({ "system.currency": { ...source.system.currency, ...after } });
    op.did(loc("Op.Step.CoinsOut", { who: source.name }), () => source.update({ "system.currency": addCoins(source.system.currency, taken) }));
    return { each: split.each, bonus: toSharer ? split.bonus : {}, left: split.left, names };
  });
}
