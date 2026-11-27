/**
 * XP rewards (lot 2, 2026-11-27) — the pure rules. No Foundry here: tables and levels come in as arguments.
 *
 * Rules as written (DMG 2024, « Character Advancement », read in the premium module's journal): when the adventurers overcome
 * monsters — by killing, routing, capturing or cleverly avoiding them — they divide the total XP value evenly among themselves;
 * NPCs who gave substantial help count as party members for the division. Noncombat challenges and milestones are worth the XP
 * of an encounter of the same difficulty (low, moderate, high: the « XP Budget per Character » table × the characters).
 * « Same progression » and « per-character coefficient » are house options (user's choices of 2026-11-27), offered as such.
 */

/** When XP is given (world setting `xpWhen`). */
export const XP_WHEN = Object.freeze(["semi", "auto", "kill", "manual"]);

/** How it is divided (world setting `xpSplit`). */
export const XP_SPLIT = Object.freeze(["equal", "level", "weight"]);

/** Encounter difficulties of the DMG 2024, in the column order of dnd5e's `ENCOUNTER_DIFFICULTY`. */
export const DIFFICULTIES = Object.freeze(["low", "moderate", "high"]);

/** How many records the world keeps besides the pending ones. */
export const KEEP_RECORDS = 20;

const whole = n => Math.max(0, Math.floor(Number(n) || 0));

/**
 * The XP span of a character's current level: from the XP that reached it to the XP of the next one (dnd5e's
 * `CHARACTER_EXP_LEVELS`, index = level − 1). At the last level, the span of the level before it.
 * @param {number} level
 * @param {number[]} table
 */
export function levelSpan(level, table) {
  const n = table?.length ?? 0;
  if ( n < 2 ) return 1;
  const l = Math.min(Math.max(1, Math.floor(Number(level) || 1)), n - 1);
  return Math.max(1, table[l] - table[l - 1]);
}

/**
 * Divides `total` XP between `recipients` (and `allies`, NPCs who count as a share but receive nothing).
 * - `equal` (the DMG): the same share for everyone;
 * - `level` (« same progression »): each share in proportion to the XP span of the character's current level, so that everyone
 *   moves the same fraction towards the next level; an ally weighs the average of the characters;
 * - `weight`: each share in proportion to a coefficient set by the GM (0 = nothing); an ally weighs 1.
 * Every share is rounded down. What does not divide goes to the party's pool (`remainder: "party"`) or is lost (`"lost"`); the
 * allies' shares are always lost. Nothing is created: shares + toParty + lost === total.
 * @param {number} total
 * @param {{ id: string, span?: number, weight?: number }[]} recipients
 * @param {{ mode?: string, allies?: number, remainder?: "party"|"lost" }} [options]
 * @returns {{ total: number, shares: Record<string, number>, toParty: number, lost: number, allies: number }}
 */
export function splitXP(total, recipients, { mode="equal", allies=0, remainder="party" }={}) {
  total = whole(total);
  allies = whole(allies);
  const shares = Object.fromEntries(recipients.map(r => [r.id, 0]));
  const out = { total, shares, toParty: 0, lost: 0, allies: 0 };
  if ( !total ) return out;
  const weightOf = r => {
    if ( mode === "level" ) return Math.max(1, Number(r.span) || 1);
    if ( mode === "weight" ) return Math.max(0, Number(r.weight ?? 1) || 0);
    return 1;
  };
  const weights = recipients.map(weightOf);
  const sum = weights.reduce((a, b) => a + b, 0);
  const allyWeight = (mode === "level") ? (recipients.length ? sum / recipients.length : 1) : 1;
  const all = sum + (allies * allyWeight);
  if ( !(all > 0) ) { out.lost = total; return out; }
  let given = 0;
  recipients.forEach((r, i) => {
    const xp = Math.floor((total * weights[i]) / all);
    shares[r.id] = xp;
    given += xp;
  });
  out.allies = allies ? Math.floor((total * allies * allyWeight) / all) : 0;
  const rest = total - given - out.allies;
  if ( (remainder === "party") && recipients.length ) out.toParty = rest;
  out.lost = out.allies + ((remainder === "party") && recipients.length ? 0 : rest);
  return out;
}

/**
 * The XP an encounter of this difficulty is worth for the party (DMG: noncombat challenges, milestones): the « XP Budget per
 * Character » of the party's level × the number of characters. dnd5e's `ENCOUNTER_DIFFICULTY[level] = [low, moderate, high]`.
 * @param {number[]} levels       The characters' levels.
 * @param {"low"|"moderate"|"high"} difficulty
 * @param {number[][]} table
 */
export function challengeXP(levels, difficulty, table) {
  // A character without a class yet counts as level 1.
  const list = levels.map(l => Math.max(1, Math.floor(Number(l) || 0)));
  if ( !list.length || !table?.length ) return 0;
  const level = Math.min(Math.max(1, Math.round(list.reduce((a, b) => a + b, 0) / list.length)), table.length - 1);
  const column = DIFFICULTIES.indexOf(difficulty);
  return whole(table[level]?.[column]) * list.length;
}

/** A foe counts once it is defeated: dead, marked defeated in the tracker, or out of hit points. */
export function isDefeated({ dead=false, defeated=false, hp=null }={}) {
  return !!(dead || defeated || ((hp !== null) && (Number(hp) <= 0)));
}

/**
 * The XP still to give in a record: the foes ticked and not yet awarded, plus the bonus. `again`: every foe ticked, awarded or
 * not (a forced second award). `only`: these foes alone (keys), without the bonus (« per kill »).
 * @returns {{ foes: object[], xp: number, bonus: number }}
 */
export function pendingXP(record, { again=false, only=null }={}) {
  const keys = only ? new Set(only) : null;
  const foes = (record?.foes ?? []).filter(f => f.include && (again || !f.awarded) && (!keys || keys.has(f.key)));
  const bonus = keys ? 0 : whole(record?.bonus);
  const xp = foes.reduce((s, f) => s + whole(f.xp), 0) + bonus;
  return { foes, xp, bonus };
}

/** The characters who receive XP in a record: ticked. */
export const recipientsOf = record => (record?.members ?? []).filter(m => m.include);

/** The NPC allies who take a share: ticked. */
export const alliesOf = record => (record?.allies ?? []).filter(a => a.include);

/**
 * What the world keeps: every pending or open record, and the `keep` most recent others.
 * @param {object[]} records
 */
export function pruneRecords(records, keep=KEEP_RECORDS) {
  const live = r => ["pending", "open"].includes(r.status);
  const done = records.filter(r => !live(r)).sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, keep);
  const kept = new Set([...records.filter(live), ...done]);
  return records.filter(r => kept.has(r));
}

/** The level a character reaches with this XP (dnd5e's `CHARACTER_EXP_LEVELS`): the count of thresholds at or below it. */
export function levelForXP(xp, table) {
  if ( !table?.length ) return 0;
  return Math.max(1, table.filter(t => xp >= t).length);
}

/**
 * Does this award newly let the character go up a level? True when it crosses a threshold and the level it allows is above
 * the character's current one.
 * @param {{ level: number, before: number, after: number }} character
 * @param {number[]} table
 */
export function canLevelUp({ level, before, after }, table) {
  const allowed = levelForXP(after, table);
  return (allowed > levelForXP(before, table)) && (allowed > (Number(level) || 0));
}
