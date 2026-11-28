/**
 * End-of-combat loot (lot 3, 2026-11-27) — when the loot happens, who validates, and what the table sees.
 *
 * - **On or off** (world setting `lootManage`, on by default): off, nothing happens at the end of a combat and each corpse is rolled at
 *   its first search, as before lot 3.
 * - **How** (world setting `lootWhen`): `semi` (default: at the end of a combat the encounter record gets a loot part and the
 *   « Rewards » window opens at the active GM; the corpses are held until the GM validates), `auto` (validated at the end of the
 *   combat with the default mode, no window).
 * - **Validation** (GM only, request `darsh-loot.endLoot` to the active GM): each ticked corpse's treasure is rolled (DMG individual
 *   treasure, pockets, custom tables; once), its weapons kept special if asked, then in `grouped` mode everything is moved into an
 *   encounter chest put down among them (each corpse's loot seen flying in, by every client).
 * - **Before it**: a player who searches a held corpse is refused (« the GM is preparing the loot ») with a sound; the refusal may be
 *   forced (suite rule) — the corpse then leaves the encounter (its treasure rolled now) and the GM is told.
 * - **What the table sees**: a public card (« the loot of the encounter is ready », or « in the chest »), pings and a floating text
 *   over the corpses (or the chest), the sound of coins.
 */
import { MODULE_ID, loc, log, setting } from "../shared.mjs";
import { serial } from "./records.mjs";
import { askGM } from "./take.mjs";
import { confirmForce, tellForced } from "./force.mjs";
import { feedbackCard, playForAll, SOUNDS } from "./feedback.mjs";
import { ensureStore } from "./containers.mjs";
import { getRecord, putRecord, xpEnabled } from "../adapter/xp.mjs";
import {
  heldBy, lootableCorpses, keepSpecialWeapons, rollCorpse, createEncounterChest, gatherInto, dropIfEmpty
} from "../adapter/end-loot.mjs";
import { lootPart, mergeLoot, LOOT_MODES, endLootSwitch } from "../core/end-loot.mjs";

const DISTRIBUTE_QUERY = `${MODULE_ID}.endLoot`;
const RELEASE_QUERY = `${MODULE_ID}.releaseCorpse`;

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The GM's end-of-combat loot is on (`lootManage`, on by default) — and searching corpses too (`corpseLoot`). Always off while the
 * feature is withdrawn (core/end-loot.mjs `endLootSwitch`).
 */
export const lootEnabled = () => !endLootSwitch.withdrawn && (setting("lootManage") !== false) && (setting("corpseLoot") !== false);

/** Adds (or completes) the loot part of a record from its defeated foes, with the world's defaults. Changes the record. */
export function withLoot(record) {
  if ( !record || !lootEnabled() ) return record;
  if ( record.loot ) mergeLoot(record.loot, record.foes);
  else record.loot = lootPart(record.foes, { mode: setting("lootMode"), keepSpecial: setting("keepSpecial") });
  if ( !record.loot.corpses.length && (record.loot.status === "pending") ) record.loot.status = "none";
  return record;
}

/* -------------------------------------------- */
/*  Asking (any GM)                             */
/* -------------------------------------------- */

/**
 * Validates the loot of a record: rolls, and moves it into a chest in grouped mode. `mode` / `keepSpecial`: what the window shows
 * (else the record's own). Resolves to what was done, or null when refused.
 */
export function requestDistribute(id, { mode=null, keepSpecial=null }={}) {
  return askGM(DISTRIBUTE_QUERY, handleDistribute, { id, mode, keepSpecial }, { timeout: 60000 });
}

/* -------------------------------------------- */
/*  At the active GM                            */
/* -------------------------------------------- */

async function handleDistribute({ id, mode=null, keepSpecial=null }, { user }) {
  if ( !user?.isGM ) throw new Error(loc("Rewards.GMOnly"));
  return serial(async () => {
    const record = getRecord(id);
    if ( !record?.loot ) throw new Error(loc("Refus.Introuvable"));
    if ( record.loot.status !== "pending" ) throw new Error(loc("EndLoot.Already"));
    const chosen = LOOT_MODES.includes(mode) ? mode : record.loot.mode;
    const special = (keepSpecial === null) ? !!record.loot.keepSpecial : !!keepSpecial;
    const done = await distribute(record, { mode: chosen, keepSpecial: special, by: user.name });
    announce(record, done).catch(err => log.warn("loot card:", err.message));
    return { mode: done.mode, corpses: done.corpses, chest: done.chest?.region ?? null };
  });
}

/** Rolls each corpse, then gathers in grouped mode; the record is marked distributed. Inside `serial`. */
async function distribute(record, { mode, keepSpecial, by }) {
  const corpses = lootableCorpses(record);
  const pockets = setting("pockets");
  for ( const { token } of corpses ) {
    try {
      if ( keepSpecial ) await keepSpecialWeapons(token.actor);
      const rolled = await rollCorpse(token, { pockets });
      log.info(`end-of-combat treasure of ${token.name}:`, rolled);
    } catch(err) {
      log.warn(`treasure of ${token.name} not rolled:`, err.message);
    }
  }
  let chest = null;
  let gathered = [];
  if ( (mode === "grouped") && corpses.length ) {
    const scene = corpses[0].token.parent;
    const here = corpses.map(c => c.token).filter(t => t.parent === scene);
    const { region, behavior, tile } = await createEncounterChest(here, record);
    const store = await ensureStore(behavior);
    for ( const token of here ) {
      try {
        const moved = await gatherInto(token, store, tile);
        if ( moved.names.length || moved.coins.length ) gathered.push(token);
      } catch(err) {
        log.warn(`loot of ${token.name} not gathered:`, err.message);
      }
      // One flight after the other: each corpse's loot is seen going in.
      await pause(250);
    }
    if ( !(await dropIfEmpty(region)) ) chest = { region: region.uuid, behavior: behavior.uuid, scene: scene.id, tile: tile.id };
  }
  const next = getRecord(record.id) ?? record;
  next.loot = { ...next.loot, status: "done", mode, keepSpecial,
    chest, done: { time: Date.now(), by, corpses: corpses.map(c => c.entry.key), gathered: gathered.map(t => t.uuid) } };
  await putRecord(next);
  return { mode, chest, corpses: corpses.length, tokens: corpses.map(c => c.token), record: next };
}

/**
 * Seen and heard by all: a public card, a ping and a floating text over each corpse (individual) or over the first corpse with the
 * chest named (grouped), the sound of coins.
 */
function announce(record, done) {
  const [first, ...others] = done.tokens;
  if ( !first ) {
    playForAll(SOUNDS.nothing, 0.6);
    return ChatMessage.implementation.create({ whisper: game.users.filter(u => u.isGM).map(u => u.id),
      content: `<p><i class="fa-solid fa-sack-xmark"></i> ${foundry.utils.escapeHTML(loc("EndLoot.NoCorpse", { name: record.name }))}</p>`,
      flags: { [MODULE_ID]: { endLoot: record.id } } });
  }
  const text = done.chest ? loc("EndLoot.CardGrouped", { name: record.name, count: done.corpses })
    : ((done.mode === "grouped") ? loc("EndLoot.CardEmpty", { name: record.name })
      : loc("EndLoot.CardIndividual", { name: record.name, count: done.corpses }));
  const float = loc(done.chest ? "EndLoot.FloatGrouped" : "EndLoot.Float");
  return feedbackCard(first, text, { kind: "gain", icon: "fa-solid fa-sack-dollar", sound: SOUNDS.coins, float, ping: true,
    also: (done.chest ? [] : others).map(t => ({ token: t, text: float, kind: "gain" })), flags: { endLoot: record.id } });
}

/** A player forced the search of a held corpse: it leaves the encounter's loot, its treasure is rolled now, the GM is told. */
async function handleRelease({ key, force=false }, { user }) {
  const token = fromUuidSync(key, { strict: false });
  const record = heldBy(key);
  if ( !token?.actor || !record ) return true;
  if ( !user.isGM && !token.parent?.tokens.some(t => t.actor?.testUserPermission(user, "OWNER")) ) throw new Error(loc("Refus.PasAToi"));
  if ( !force && !user.isGM ) throw new Error(loc("EndLoot.Held"));
  await serial(async () => {
    const next = getRecord(record.id);
    const entry = next?.loot?.corpses.find(c => c.key === key);
    if ( !entry ) return;
    Object.assign(entry, { include: false, released: user.name });
    await putRecord(next);
  });
  await rollCorpse(token, { pockets: setting("pockets") }).catch(err => log.warn("treasure not rolled:", err.message));
  tellForced(user, loc("EndLoot.ForcedWhat", { name: token.name }), loc("EndLoot.Held"));
  return true;
}

/* -------------------------------------------- */
/*  Before a search                             */
/* -------------------------------------------- */

/**
 * Before a corpse is searched (runtime/open.mjs): free, or the GM, goes on; held, the player reads why, hears it, and may force.
 * @returns {Promise<boolean>}  false when the player gave up.
 */
export async function passHold(token) {
  if ( game.user.isGM || !heldBy(token) ) return true;
  foundry.audio.AudioHelper.play({ src: SOUNDS.failure, volume: 0.6, loop: false }, false)?.catch?.(() => {});
  if ( !(await confirmForce(loc("EndLoot.Held"))) ) return false;
  const answer = await askGM(RELEASE_QUERY, handleRelease, { key: token.uuid, force: true });
  return answer === true;
}

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

export function registerEndLootInit() {
  CONFIG.queries[DISTRIBUTE_QUERY] = handleDistribute;
  CONFIG.queries[RELEASE_QUERY] = handleRelease;
}

/** Exposed as `api.endLoot`. */
export const endLootApi = {
  /** GM: validate the loot of a record now (`{ mode: "individual"|"grouped", keepSpecial }`). */
  distribute: (id, options={}) => requestDistribute(id, options),
  /** The record holding this corpse (token) until the GM validates, or null. */
  heldBy: token => heldBy(token?.document ?? token),
  enabled: () => lootEnabled(),
  /** True when XP is handled too (the window then shows both parts). */
  xp: () => xpEnabled()
};
