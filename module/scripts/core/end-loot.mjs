/**
 * End-of-combat loot (lot 3, 2026-11-27) — the pure rules. No Foundry here.
 *
 * At the end of a combat the encounter record (adapter/xp.mjs) gets a loot part: the corpses of the defeated hostile creatures,
 * « held » until the GM validates (a player who searches one is told the GM is preparing the loot; the refusal may be forced).
 * Validation rolls each corpse's treasure (DMG individual treasure, pockets, custom tables) and then:
 *  - `individual`: the loot stays on each corpse, searched as before;
 *  - `grouped`: everything is moved into one « encounter chest » (a ground pile with a chest icon), deleted once emptied.
 * Nothing is held by the window: closed, reopened, after a GM reload, the record says it all.
 *
 * Custom tables (request of IncognitoAnkh, Core#48): rules by CR range, creature type and size, the first that matches wins; a
 * table set on the NPC itself (`flags.darsh-loot.table`) comes on top, as before.
 */

/** When the end-of-combat loot happens (world setting `lootWhen`). `first`: no end-of-combat step, treasure at the first search. */
export const LOOT_WHEN = Object.freeze(["semi", "auto", "first"]);

/** Where the loot goes (world setting `lootMode`, and per encounter in the window). */
export const LOOT_MODES = Object.freeze(["individual", "grouped"]);

/** What a custom table rule does to the DMG treasure: adds to it, or replaces it (coins and pockets). */
export const RULE_EFFECTS = Object.freeze(["add", "replace"]);

/**
 * The loot part of a record, from its foes: every defeated one is a corpse to loot (ticked).
 * @param {{ key: string, name: string, img: string, defeated: boolean }[]} foes
 * @param {{ mode?: string, keepSpecial?: boolean }} [options]
 */
export function lootPart(foes, { mode="individual", keepSpecial=false }={}) {
  return {
    status: "pending", mode: LOOT_MODES.includes(mode) ? mode : "individual", keepSpecial: !!keepSpecial,
    corpses: (foes ?? []).filter(f => f?.defeated && f.key).map(corpseEntry), chest: null, done: null
  };
}

const corpseEntry = f => ({ key: f.key, name: f.name ?? "?", img: f.img ?? "", include: true });

/**
 * Adds to a loot part the defeated foes it does not list yet (a record kept from « per kill », a creature counted by hand).
 * A loot part already distributed is left as it is. Returns the same object.
 */
export function mergeLoot(loot, foes) {
  if ( !loot || (loot.status !== "pending") ) return loot;
  const known = new Set(loot.corpses.map(c => c.key));
  for ( const f of foes ?? [] ) if ( f?.defeated && f.key && !known.has(f.key) ) loot.corpses.push(corpseEntry(f));
  return loot;
}

/** Is this record still waiting for the GM: its XP not given, or its loot not distributed? */
export function isLive(record) {
  return ["pending", "open"].includes(record?.status) || (record?.loot?.status === "pending");
}

/**
 * The record whose loot holds this corpse (token uuid): pending, and the corpse ticked. null when free.
 * @param {object[]} records
 * @param {string} key
 */
export function holdingRecord(records, key) {
  if ( !key ) return null;
  return (records ?? []).find(r => (r?.loot?.status === "pending") && r.loot.corpses.some(c => c.include && (c.key === key))) ?? null;
}

/** The corpses a validation works on: ticked. */
export const corpsesToLoot = loot => (loot?.corpses ?? []).filter(c => c.include);

/**
 * Where the encounter chest goes: the grid cell nearest to the middle of the corpses, at its centre.
 * @param {{ x: number, y: number }[]} points   Corpse centres.
 * @param {number} size                         Grid size in pixels.
 * @returns {{ x: number, y: number }|null}
 */
export function chestSpot(points, size) {
  const list = (points ?? []).filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  if ( !list.length || !(size > 0) ) return null;
  const x = list.reduce((s, p) => s + p.x, 0) / list.length;
  const y = list.reduce((s, p) => s + p.y, 0) / list.length;
  return { x: (Math.floor(x / size) * size) + (size / 2), y: (Math.floor(y / size) * size) + (size / 2) };
}

/* -------------------------------------------- */
/*  Custom table rules                          */
/* -------------------------------------------- */

const num = (v, fallback) => {
  if ( (v === "") || (v === null) || (v === undefined) ) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * A rule as stored, cleaned: CR range (empty = no bound), creature type and size ("" = any), table uuid, draws (1–20), effect.
 * @returns {{ id: string, crMin: number|null, crMax: number|null, type: string, size: string, table: string, draws: number, effect: string }}
 */
export function cleanRule(rule={}) {
  return {
    id: String(rule.id ?? ""),
    crMin: num(rule.crMin, null), crMax: num(rule.crMax, null),
    type: String(rule.type ?? ""), size: String(rule.size ?? ""),
    table: String(rule.table ?? ""),
    draws: Math.min(20, Math.max(1, Math.floor(num(rule.draws, 1)))),
    effect: RULE_EFFECTS.includes(rule.effect) ? rule.effect : "add"
  };
}

/** Does this rule apply to a creature (`{ cr, type, size }`)? A rule without a table never applies. */
export function ruleMatches(rule, { cr=0, type="", size="" }={}) {
  const r = cleanRule(rule);
  if ( !r.table ) return false;
  const value = num(cr, 0);
  if ( (r.crMin !== null) && (value < r.crMin) ) return false;
  if ( (r.crMax !== null) && (value > r.crMax) ) return false;
  if ( r.type && (r.type !== type) ) return false;
  if ( r.size && (r.size !== size) ) return false;
  return true;
}

/** The first rule that applies to a creature, cleaned, or null. */
export function matchRule(rules, creature) {
  const found = (rules ?? []).find(r => ruleMatches(r, creature));
  return found ? cleanRule(found) : null;
}

/** The name of the « Rewards » window and its shortcuts (an i18n key): « XP », « Loot », or both, after what is on. */
export function titleKey(xp, loot) {
  if ( xp && loot ) return "DLO.EndLoot.Title.both";
  return loot ? "DLO.EndLoot.Title.loot" : "DLO.Rewards.Title";
}
