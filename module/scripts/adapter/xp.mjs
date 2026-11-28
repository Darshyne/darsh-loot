/**
 * XP rewards (lot 2, 2026-11-27) — dnd5e and the world: the encounter record, what an award would give, and the write.
 *
 * **The encounter record** lives in a hidden world setting (`rewards`), written by a GM only: who was fought, who fought, what
 * was already given. The « Rewards » window is only a view of it — closed, reopened, after a GM reload, it finds everything.
 * Lot 3 (end-of-combat loot) is meant to add its own part (`record.loot`) to the same record.
 *
 * **The write** reuses dnd5e's `Award.awardXP` (same rules as the system's /award: XP added to `system.details.xp.value`), one
 * character at a time inside an operation (adapter/ledger.mjs): a write that fails puts back what was already given.
 */
import { MODULE_ID, loc, setting } from "../shared.mjs";
import { splitXP, levelSpan, pendingXP, recipientsOf, alliesOf, pruneRecords, canLevelUp, isDefeated, challengeXP } from "../core/xp.mjs";
import { operation } from "./ledger.mjs";
import { isLive, endLootSwitch } from "../core/end-loot.mjs";
import { primaryPartyCharacters } from "./party.mjs";
import { engineRelation } from "./engine.mjs";

export const REWARDS_SETTING = "rewards";

/**
 * Why XP is off, or null when it is on: `"das"` — the DAS switch (`xpManage`, off by default: user's choice of 2026-11-27);
 * `"dnd5e"` — dnd5e levels up without XP (`levelingMode: noxp`).
 */
export function xpOffReason() {
  if ( !setting("xpManage") ) return "das";
  try { if ( game.settings.get("dnd5e", "levelingMode") === "noxp" ) return "dnd5e"; }
  catch { /* no dnd5e setting: XP stays on */ }
  return null;
}

/** XP is handled by DAS: its switch is on and dnd5e levels up with XP. */
export const xpEnabled = () => !xpOffReason();

/** The text saying why XP is off (`DLO.Rewards.Off.das` / `.dnd5e`). */
export const xpOffText = reason => loc(`Rewards.Off.${reason}`);

/** dnd5e's tables: XP per level, and the XP budget per character by level and difficulty. */
export function xpTables() {
  return { levels: CONFIG.DND5E?.CHARACTER_EXP_LEVELS ?? [], budget: CONFIG.DND5E?.ENCOUNTER_DIFFICULTY ?? [] };
}

/* -------------------------------------------- */
/*  The records                                 */
/* -------------------------------------------- */

/** Every record, most recent first (a copy: change it, then `putRecord`). */
export function readRecords() {
  const stored = setting(REWARDS_SETTING);
  const records = Array.isArray(stored?.records) ? stored.records : [];
  return foundry.utils.deepClone(records).sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
}

export const getRecord = id => readRecords().find(r => r.id === id) ?? null;

/** The record of a combat, if one was made. */
export const recordOfCombat = combatId => readRecords().find(r => r.combat === combatId) ?? null;

/** The record the window opens on: the most recent pending one, else the most recent. */
export function currentRecord() {
  const records = readRecords();
  // End-of-combat loot withdrawn (0.23.0): a record is live by its XP alone.
  const live = endLootSwitch.withdrawn ? (r => ["pending", "open"].includes(r?.status)) : isLive;
  return records.find(live) ?? records[0] ?? null;
}

/** Writes a record (replacing the one with its id) — GM only. Older finished records are pruned. */
export async function putRecord(record) {
  const others = readRecords().filter(r => r.id !== record.id);
  await game.settings.set(MODULE_ID, REWARDS_SETTING, { records: pruneRecords([record, ...others]) });
  return record;
}

/** Removes a record — GM only. */
export async function deleteRecord(id) {
  await game.settings.set(MODULE_ID, REWARDS_SETTING, { records: readRecords().filter(r => r.id !== id) });
}

/* -------------------------------------------- */
/*  Building a record                           */
/* -------------------------------------------- */

const tokenDoc = t => t?.document ?? t ?? null;

/** The characters who share XP: dnd5e's primary party, else every player-owned character. */
export function partyCharacters() {
  const party = primaryPartyCharacters();
  if ( party.length ) return party;
  return game.actors.filter(a => (a.type === "character") && a.hasPlayerOwner);
}

/** A character's line in a record. `include`: receives XP. */
export function memberEntry(actor, { present=false, include=present }={}) {
  return { uuid: actor.uuid, name: actor.name, img: actor.img, present, include,
    weight: Number(actor.getFlag?.(MODULE_ID, "xpWeight") ?? 1) };
}

/** A creature's line: its XP (dnd5e's `system.details.xp.value`, from its CR), defeated or not. */
export function foeEntry(token, actor=token?.actor, { defeated=null }={}) {
  const t = tokenDoc(token);
  const a = actor ?? t?.actor;
  const down = defeated ?? isDefeated({ dead: !!a?.statuses?.has?.("dead"), hp: a?.system?.attributes?.hp?.value ?? null });
  return { key: t?.uuid ?? a?.uuid, actor: a?.uuid ?? null, name: t?.name ?? a?.name ?? "?", img: a?.img ?? t?.texture?.src ?? "",
    xp: Math.max(0, Math.floor(Number(a?.system?.details?.xp?.value) || 0)), cr: a?.system?.details?.cr ?? null,
    defeated: !!down, include: !!down, awarded: false };
}

/** A summoned creature, a familiar or a companion a player owns: never a foe nor an ally that takes a share. */
function sideKick(actor) {
  return !!(actor?.hasPlayerOwner || actor?.getFlag?.("dnd5e", "summon"));
}

/**
 * How an NPC stands towards the party: the engine's factions against a character's token, else the dispositions.
 * @returns {"hostile"|"allied"|"neutral"}
 */
export function sideTowardsParty(token, partyToken=null) {
  const t = tokenDoc(token);
  const relation = partyToken ? engineRelation(tokenDoc(partyToken), t) : null;
  if ( relation ) return relation;
  const D = CONST.TOKEN_DISPOSITIONS ?? {};
  if ( t?.disposition === (D.HOSTILE ?? -1) ) return "hostile";
  if ( t?.disposition === (D.FRIENDLY ?? 1) ) return "allied";
  return "neutral";
}

/**
 * The record of a combat: the hostile creatures (ticked when defeated), the characters (those who fought ticked; with
 * `recipients: "party"` the absent ones too), the NPC allies (ticked: the DMG counts an NPC who helped as a share).
 * @param {Combat} combat
 * @param {object} [options]
 * @param {Set<string>|null} [options.defeated]  token uuids the Core calls defeated (`dnd5e-combat.combatEnded`); null: read here.
 * @returns {object|null}  null when nobody hostile took part.
 */
export function recordFromCombat(combat, { defeated=null }={}) {
  const combatants = Array.from(combat?.combatants?.contents ?? combat?.combatants ?? []).filter(c => c?.actor);
  const pcs = combatants.filter(c => c.actor.type === "character");
  const partyToken = pcs.find(c => c.token)?.token ?? null;
  const foes = [];
  const allies = [];
  for ( const c of combatants ) {
    if ( (c.actor.type === "character") || sideKick(c.actor) ) continue;
    const side = sideTowardsParty(c.token, partyToken);
    // The Core's verdict when it gave one (`combatEnded`: dead, ticked in the tracker, or a non-character at 0 HP); else read here.
    const down = defeated ? defeated.has(tokenDoc(c.token)?.uuid) : isDefeated({ dead: c.actor.statuses?.has?.("dead"),
      defeated: c.defeated, hp: c.actor.system?.attributes?.hp?.value ?? null });
    if ( side === "hostile" ) foes.push(foeEntry(c.token, c.actor, { defeated: down }));
    else if ( side === "allied" ) allies.push({ uuid: c.actor.uuid, name: c.token?.name ?? c.actor.name, img: c.actor.img, include: true });
  }
  if ( !foes.length ) return null;
  const party = partyCharacters();
  const fought = new Set(pcs.map(c => c.actor.uuid));
  const all = setting("xpRecipients") === "party";
  const members = new Map(party.map(a => [a.uuid, memberEntry(a, { present: fought.has(a.uuid), include: all || fought.has(a.uuid) })]));
  for ( const c of pcs ) if ( !members.has(c.actor.uuid) ) members.set(c.actor.uuid, memberEntry(c.actor, { present: true }));
  const scene = combat.scene ?? game.scenes?.get(combat._source?.scene) ?? null;
  return {
    id: foundry.utils.randomID(), combat: combat.id, scene: scene?.id ?? null, time: Date.now(),
    name: loc("Rewards.CombatName", { scene: scene?.name ?? "—", round: combat.round ?? 0 }),
    status: "pending", foes, members: [...members.values()], allies, bonus: 0, reason: "", split: null, awards: []
  };
}

/** A record made by hand (a noncombat challenge, a milestone): every character of the party ticked, no creature. */
export function emptyRecord() {
  return {
    id: foundry.utils.randomID(), combat: null, scene: canvas?.scene?.id ?? null, time: Date.now(),
    name: loc("Rewards.ManualName"), status: "pending", foes: [],
    members: partyCharacters().map(a => memberEntry(a, { present: true })), allies: [], bonus: 0, reason: "", split: null, awards: []
  };
}

/* -------------------------------------------- */
/*  What an award gives                         */
/* -------------------------------------------- */

const actorAt = uuid => fromUuidSync(uuid, { strict: false });
const levelOf = actor => Number(actor?.system?.details?.level) || 0;
const xpOf = actor => Number(actor?.system?.details?.xp?.value) || 0;

/** Where the remainder goes: the primary party's pool when there is one and the setting says so; else it is lost. */
function remainderMode() {
  return ((setting("xpRemainder") === "party") && game.actors.party) ? "party" : "lost";
}

/**
 * What an award of this record would give now — the window's preview and the GM's write use the same.
 * @param {object} record
 * @param {{ again?: boolean, only?: string[] }} [options]   `again`: count the foes already awarded too (a forced second award);
 *   `only`: these foes alone, without the bonus (« per kill »).
 * @returns {{ xp: number, bonus: number, foes: object[], mode: string, remainder: string, shares: { uuid, name, actor, xp }[], toParty: number,
 *   lost: number, allies: number }}
 */
export function planAward(record, { again=false, only=null }={}) {
  const { foes, xp, bonus } = pendingXP(record, { again, only });
  const mode = record.split ?? setting("xpSplit");
  const { levels } = xpTables();
  const people = recipientsOf(record).map(m => ({ entry: m, actor: actorAt(m.uuid) })).filter(p => p.actor);
  const remainder = remainderMode();
  const split = splitXP(xp, people.map(p => ({ id: p.entry.uuid, span: levelSpan(levelOf(p.actor), levels), weight: p.entry.weight })),
    { mode, allies: alliesOf(record).length, remainder });
  return {
    xp, bonus, foes, mode, remainder,
    shares: people.map(p => ({ uuid: p.entry.uuid, name: p.actor.name, actor: p.actor, xp: split.shares[p.entry.uuid] ?? 0 })),
    toParty: split.toParty, lost: split.lost, allies: split.allies
  };
}

/** The XP a challenge of this difficulty is worth for the ticked characters (DMG: noncombat challenges, milestones). */
export function challengeFor(record, difficulty) {
  const levels = recipientsOf(record).map(m => levelOf(actorAt(m.uuid)));
  return challengeXP(levels, difficulty, xpTables().budget);
}

/** dnd5e's XP write (`Award.awardXP`), or a plain update when the system does not offer it. */
async function addXP(actor, amount) {
  const Award = globalThis.dnd5e?.applications?.Award;
  if ( typeof Award?.awardXP === "function" ) return Award.awardXP(amount, [actor]);
  return actor.update({ "system.details.xp.value": xpOf(actor) + amount });
}

/**
 * Gives the XP of a plan and notes it in the record, in one operation — GM only. Everything is checked by the caller first.
 * @param {object} record
 * @param {object} plan          From `planAward`.
 * @param {{ by?: string, keepOpen?: boolean }} [options]   `keepOpen`: the record stays open (XP per kill during a combat).
 * @returns {Promise<{ shares: { uuid, name, xp, levelUp }[], toParty: number, lost: number, xp: number, record: object }>}
 */
export function awardNow(record, plan, { by="", keepOpen=false }={}) {
  const { levels } = xpTables();
  const party = (plan.toParty > 0) ? game.actors.party : null;
  const label = loc("Rewards.Op", { name: record.name });
  const lines = plan.shares.filter(s => s.xp > 0).map(s => loc("Rewards.PlanLine", { who: s.name, xp: s.xp }));
  return operation({ label, plan: lines }, async op => {
    const shares = [];
    for ( const s of plan.shares ) {
      if ( !(s.xp > 0) ) { shares.push({ uuid: s.uuid, name: s.name, xp: 0, levelUp: false }); continue; }
      const before = xpOf(s.actor);
      await addXP(s.actor, s.xp);
      op.did(loc("Rewards.Step", { who: s.name, xp: s.xp }),
        () => s.actor.update({ "system.details.xp.value": Math.max(0, xpOf(s.actor) - s.xp) }));
      shares.push({ uuid: s.uuid, name: s.name, xp: s.xp,
        levelUp: canLevelUp({ level: levelOf(s.actor), before, after: before + s.xp }, levels) });
    }
    if ( party ) {
      await addXP(party, plan.toParty);
      op.did(loc("Rewards.Step", { who: party.name, xp: plan.toParty }),
        () => party.update({ "system.details.xp.value": Math.max(0, xpOf(party) - plan.toParty) }));
    }
    const previous = foundry.utils.deepClone(record);
    const awarded = new Set(plan.foes.map(f => f.key));
    const next = foundry.utils.deepClone(record);
    for ( const f of next.foes ) if ( awarded.has(f.key) ) f.awarded = true;
    next.awards = [...(next.awards ?? []), { time: Date.now(), by, xp: plan.xp, bonus: plan.bonus ?? 0, reason: plan.bonus ? (record.reason ?? "") : "",
      shares: Object.fromEntries(shares.map(s => [s.uuid, s.xp])), toParty: party ? plan.toParty : 0, lost: plan.lost }];
    if ( plan.bonus ) { next.bonus = 0; next.reason = ""; }
    next.status = keepOpen ? "open" : "awarded";
    await putRecord(next);
    op.did(loc("Rewards.StepRecord"), () => putRecord(previous));
    return { shares, toParty: party ? plan.toParty : 0, lost: plan.lost, xp: plan.xp, record: next };
  });
}
