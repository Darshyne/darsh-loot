/**
 * XP rewards (lot 2, 2026-11-27) — when XP is given, by whom, and what the table sees.
 *
 * - **When** (world setting `xpWhen`): `semi` (default: at the end of a combat the « Rewards » window opens at the active GM on
 *   the encounter's record, the GM adjusts and gives), `auto` (given at the end of the combat, no window), `kill` (each hostile
 *   creature's XP given as it is defeated; what is left at the end of the combat too), `manual` (the record is kept, nothing
 *   opens). With dnd5e's « level up without XP » (`noxp`) nothing happens and no shortcut shows (user's choice, 2026-11-27).
 * - **Who gives**: a GM only, through the request `darsh-loot.awardXP` to the active GM (any GM may click; one client writes).
 *   « Already given » can be forced (suite rule): the window asks, the request comes back with `force`.
 * - **What the table sees**: a public card naming each share, « +150 XP » over every character on the scene (a ping around each,
 *   the floating text drawn by each client from the card), a horn heard by all; « can level up » when a threshold is crossed.
 * - **Shortcuts** (GM): the toolbar of tokens, a button in the header of dnd5e's Group sheet, the Core's right-click menu on a
 *   character (also under the portraits of Combat UI's party column, which shows the Core's entries), the macro of the « GM
 *   tools » compendium, `api.rewards.open()`. Players have no entry: giving XP is the GM's (they get the card and the floats).
 * « Combat over » and « creature defeated » come from the Core (`dnd5e-combat.combatEnded` / `creatureDefeated`, §555, after
 * 0.294.0): the Core decides who is defeated (dead, ticked in the tracker, a non-character at 0 HP) and says it once per creature.
 */
import { MODULE_ID, loc, log, setting } from "../shared.mjs";
import { route } from "./router.mjs";
import { serial } from "./records.mjs";
import { lootEnabled, withLoot, requestDistribute } from "./end-loot.mjs";
import { heldBy } from "../adapter/end-loot.mjs";
import { LootRulesWindow } from "../apps/loot-rules-window.mjs";
import { askForce } from "./force.mjs";
import { feedbackCard, playForAll, SOUNDS } from "./feedback.mjs";
import { inTurn } from "../adapter/ledger.mjs";
import { forceableRefusal } from "../core/force.mjs";
import { pendingXP } from "../core/xp.mjs";
import { tokenOnScene } from "../adapter/party.mjs";
import { TOKEN_MENU_HOOK, COMBAT_ENDED_HOOK, CREATURE_DEFEATED_HOOK } from "../adapter/engine.mjs";
import {
  REWARDS_SETTING, xpEnabled, xpOffReason, xpOffText, readRecords, getRecord, recordOfCombat, currentRecord, putRecord, deleteRecord, recordFromCombat,
  emptyRecord, foeEntry, planAward, awardNow
} from "../adapter/xp.mjs";
import { RewardsWindow } from "../apps/rewards-window.mjs";
import { titleKey } from "../core/end-loot.mjs";

const AWARD_QUERY = `${MODULE_ID}.awardXP`;
export const REWARDS_HOOK = `${MODULE_ID}.rewards`;


/* -------------------------------------------- */
/*  Asking (any GM)                             */
/* -------------------------------------------- */

/**
 * Gives the XP still pending in a record. « Already given » comes back as a refusal the GM may force.
 * @param {string} id
 * @returns {Promise<object|null>}  What was given, or null when refused.
 */
export function requestAward(id) {
  return askForce(AWARD_QUERY, handleAward, { id });
}

/* -------------------------------------------- */
/*  At the active GM                            */
/* -------------------------------------------- */

async function handleAward({ id, force=false, only=null, keepOpen=false }, { user }) {
  if ( !user?.isGM ) throw new Error(loc("Rewards.GMOnly"));
  if ( xpOffReason() ) throw new Error(xpOffText(xpOffReason()));
  return serial(async () => {
    const record = getRecord(id);
    if ( !record ) throw new Error(loc("Refus.Introuvable"));
    let plan = planAward(record, { only });
    if ( !plan.xp ) {
      if ( only || !record.awards?.length || !pendingXP(record, { again: true }).xp ) throw new Error(loc("Rewards.Nothing"));
      if ( !force ) throw forceableRefusal(loc("Rewards.Already"));
      plan = planAward(record, { again: true });
    }
    if ( !plan.shares.some(s => s.xp > 0) ) throw new Error(loc("Rewards.NoOne"));
    const done = await inTurn(plan.shares.map(s => s.actor), () => awardNow(record, plan, { by: user.name, keepOpen }));
    announce(record, done).catch(err => log.warn("rewards card:", err.message));
    if ( force && !user.isSelf ) log.info(`${user.name} gave the XP of « ${record.name} » again`);
    return { xp: done.xp, toParty: done.toParty, lost: done.lost, shares: done.shares.map(s => ({ name: s.name, xp: s.xp, levelUp: s.levelUp })) };
  });
}

/**
 * Seen and heard by all: a public card with each share, « +150 XP » over every character on the record's scene (with a ping),
 * the horn. Without any of them on the scene: the card and the sound.
 */
function announce(record, done) {
  const given = done.shares.filter(s => s.xp > 0);
  const parts = given.map(s => loc("Rewards.CardShare", { who: s.name, xp: s.xp }));
  const ups = given.filter(s => s.levelUp).map(s => s.name);
  const text = [
    loc("Rewards.Card", { name: record.name, xp: done.xp, shares: parts.join(", ") }),
    done.toParty ? loc("Rewards.CardParty", { xp: done.toParty }) : "",
    done.lost ? loc("Rewards.CardLost", { xp: done.lost }) : "",
    ups.length ? loc("Rewards.CardLevelUp", { names: ups.join(", ") }) : ""
  ].filter(Boolean).join(" ");
  const scene = game.scenes?.get(record.scene) ?? canvas?.scene ?? null;
  const floats = given.map(s => ({ token: tokenOnScene(scene, fromUuidSync(s.uuid, { strict: false })),
    text: s.levelUp ? loc("Rewards.FloatLevelUp", { xp: s.xp }) : loc("Rewards.Float", { xp: s.xp }) })).filter(f => f.token);
  if ( !floats.length ) {
    playForAll(SOUNDS.xp, 0.6);
    return ChatMessage.implementation.create({ content: `<p><i class="fa-solid fa-trophy"></i> ${foundry.utils.escapeHTML(text)}</p>`,
      flags: { [MODULE_ID]: { rewards: record.id } } });
  }
  const [main, ...others] = floats;
  return feedbackCard(main.token, text, { kind: "gain", icon: "fa-solid fa-trophy", sound: SOUNDS.xp, float: main.text, ping: true,
    also: others.map(o => ({ token: o.token, text: o.text, kind: "gain" })), flags: { rewards: record.id } });
}

/* -------------------------------------------- */
/*  End of combat, defeated creatures           */
/* -------------------------------------------- */

const activeGM = () => !!game.users.activeGM?.isSelf;

/** Merges what the end of a combat shows into the record made during it (« per kill »): new foes, those defeated since. */
function mergeRecords(kept, fresh) {
  if ( !fresh ) return kept;
  const byKey = new Map(kept.foes.map(f => [f.key, f]));
  for ( const f of fresh.foes ) {
    const old = byKey.get(f.key);
    if ( !old ) kept.foes.push(f);
    else if ( !old.awarded && f.defeated && !old.defeated ) Object.assign(old, { defeated: true, include: true });
  }
  return kept;
}

/**
 * The active GM, when a combat is over (Core `combatEnded`, only for a combat that was played): the record is made, then given,
 * shown or kept according to `xpWhen`.
 */
function onCombatEnd({ combat, defeated }={}) {
  const xp = xpEnabled();
  const loot = lootEnabled();
  if ( !combat || !activeGM() || (!xp && !loot) ) return;
  const when = setting("xpWhen");
  const down = new Set((defeated ?? []).map(t => t?.uuid).filter(Boolean));
  return serial(async () => {
    const fresh = recordFromCombat(combat, { defeated: down });
    const kept = recordOfCombat(combat.id);
    if ( !fresh && !kept ) return null;
    const record = kept ? mergeRecords(kept, fresh) : fresh;
    // Lot 3: with XP off the record only carries the loot (status « none »: nothing to give).
    if ( xp ) record.status = "pending";
    else if ( !kept ) record.status = "none";
    withLoot(record);
    // XP off and no corpse to loot: nothing to keep.
    if ( !xp && !kept && (record.loot?.status !== "pending") ) return null;
    await putRecord(record);
    return record;
  }).then(async record => {
    if ( !record ) return;
    let opened = false;
    if ( xp ) {
      const left = pendingXP(record).xp;
      if ( ["auto", "kill"].includes(when) ) {
        if ( left ) await requestAward(record.id);
        else if ( record.awards?.length ) await serial(() => putRecord({ ...getRecord(record.id), status: "awarded" }));
      } else if ( when === "semi" ) {
        openRewards(record.id);
        opened = true;
      } else {
        ui.notifications.info(loc("Rewards.Kept", { name: record.name }));
      }
    }
    if ( record.loot?.status !== "pending" ) return;
    if ( setting("lootWhen") === "auto" ) await requestDistribute(record.id);
    else if ( !opened ) openRewards(record.id);
  });
}

/** The started combat a token takes part in, or null. */
function combatOf(token) {
  return game.combats?.find(c => c.started && c.combatants.some(cb => (cb.tokenId === token.id) && (cb.sceneId === token.parent?.id))) ?? null;
}

/** « Per kill »: a hostile creature of a running combat was just defeated (Core `creatureDefeated`) — its XP given now, never twice. */
function onDefeated({ token, actor, combat }={}) {
  if ( !token || !combat || !activeGM() || !xpEnabled() || (setting("xpWhen") !== "kill") ) return;
  if ( (actor ?? token.actor)?.type === "character" ) return;
  return serial(async () => {
    const record = recordOfCombat(combat.id) ?? recordFromCombat(combat);
    if ( !record ) return null;
    record.status = "open";
    let foe = record.foes.find(f => f.key === token.uuid);
    if ( !foe ) {
      // A creature that joined after the record was made: added if it is hostile.
      const fresh = recordFromCombat(combat);
      foe = fresh?.foes.find(f => f.key === token.uuid) ?? null;
      if ( !foe ) return null;
      record.foes.push(foe);
    }
    if ( foe.awarded ) return null;
    Object.assign(foe, { defeated: true, include: true });
    await putRecord(record);
    return { id: record.id, key: foe.key };
  }).then(hit => (hit ? askForce(AWARD_QUERY, handleAward, { id: hit.id, only: [hit.key], keepOpen: true }) : null));
}

/* -------------------------------------------- */
/*  The window                                  */
/* -------------------------------------------- */

/** What the window may do: everything goes through here (a window never knows runtime/). */
const handlers = {
  list: () => readRecords(),
  get: id => getRecord(id),
  current: () => currentRecord(),
  save: record => serial(async () => {
    await putRecord(record);
    // A coefficient set for a character is kept on its sheet: the next encounter starts from it.
    for ( const m of record.members ?? [] ) {
      const actor = fromUuidSync(m.uuid, { strict: false });
      const weight = Number(m.weight ?? 1);
      if ( actor && (Number(actor.getFlag(MODULE_ID, "xpWeight") ?? 1) !== weight) ) await actor.setFlag(MODULE_ID, "xpWeight", weight).catch(() => {});
    }
    return record;
  }),
  create: () => serial(() => putRecord(emptyRecord())),
  dismiss: id => serial(async () => {
    const record = getRecord(id);
    if ( !record ) return null;
    // Lot 3: loot set aside — its corpses are free again (searched as before, treasure at the first search). A record whose XP was
    // given or whose loot was distributed is kept (marked); any other is removed.
    const loot = (record.loot?.status === "pending") ? { ...record.loot, status: "dismissed" } : record.loot;
    const xpLive = ["pending", "open"].includes(record.status);
    if ( record.awards?.length || (record.loot?.status === "done") ) {
      return putRecord({ ...record, status: record.awards?.length ? "awarded" : (xpLive ? "dismissed" : record.status), loot });
    }
    return deleteRecord(id);
  }),
  award: id => requestAward(id),
  distribute: (id, options) => requestDistribute(id, options),
  rules: () => LootRulesWindow.show(),
  openChest: record => openChest(record)
};

/** GM: opens the « Rewards » window (on a record, else the most recent pending one). */
export function openRewards(id=null) {
  if ( !game.user.isGM ) return null;
  // DAS's XP switched off (the default) and no end-of-combat loot: nothing to open, the GM is told where to switch it on.
  if ( (xpOffReason() === "das") && !lootEnabled() ) { ui.notifications.info(xpOffText("das")); return null; }
  return RewardsWindow.show(id, handlers);
}

/** GM: opens the encounter chest of a record (its search window), if it is still there. */
function openChest(record) {
  const behavior = record?.loot?.chest?.behavior ? fromUuidSync(record.loot.chest.behavior, { strict: false }) : null;
  if ( !behavior ) { ui.notifications.info(loc("EndLoot.ChestGone")); return null; }
  return game.modules.get(MODULE_ID)?.api?.openContainer?.(behavior, null) ?? null;
}

/** GM: counts a defeated creature met out of combat in the current record (a new one when nothing is pending), then opens it. */
async function countCreature(token) {
  const record = await serial(async () => {
    let current = currentRecord();
    if ( !current || !["pending", "open"].includes(current.status) ) current = emptyRecord();
    if ( !current.foes.some(f => f.key === token.uuid) ) current.foes.push(foeEntry(token, token.actor, { defeated: true }));
    if ( !xpEnabled() && (current.status === "pending") && !current.awards?.length ) current.status = "none";
    return putRecord(withLoot(current));
  });
  openRewards(record.id);
}

/* -------------------------------------------- */
/*  Shortcuts                                   */
/* -------------------------------------------- */

const shortcutsShown = () => game.user?.isGM && (xpEnabled() || lootEnabled());

/** The toolbar of tokens: a button (GM). */
function sceneControls(controls) {
  const tokens = controls?.tokens;
  // The XP button: only while DAS handles XP (user's request, 27/11) — the loot window opens by itself at the end of a combat.
  if ( !tokens?.tools || !game.user?.isGM || !xpEnabled() || !setting("xpToolbar") ) return;
  tokens.tools.dloRewards = {
    name: "dloRewards", title: titleKey(xpEnabled(), lootEnabled()), icon: "fa-solid fa-trophy", order: Object.keys(tokens.tools).length,
    button: true, visible: true, onChange: () => openRewards()
  };
}

/** The Core's right-click menu (GM): « Count in the rewards » on a hostile creature defeated out of combat; « Encounter loot… » on a held corpse. */
function tokenMenu(entries, { target }) {
  if ( !target?.actor || !shortcutsShown() ) return;
  // 2026-11-27 (user's request): no « XP… » entry on a character — the toolbar, the Group sheet and the macro open the window.
  if ( target.actor.type === "character" ) return;
  const dead = target.actor.statuses?.has?.("dead");
  // Lot 3: a corpse held for an encounter's loot — « Loot of the encounter… » opens the window on it.
  const holding = dead ? heldBy(target) : null;
  if ( holding ) {
    entries.push({ icon: "fa-solid fa-sack-dollar", label: loc("EndLoot.Menu"), run: () => openRewards(holding.id) });
    return;
  }
  if ( !dead || combatOf(target) || target.actor.hasPlayerOwner ) return;
  const current = currentRecord();
  if ( current?.foes?.some(f => f.key === target.uuid) && ["pending", "open"].includes(current.status) ) return;
  entries.push({ icon: "fa-solid fa-trophy", label: loc(xpEnabled() ? "Rewards.Count" : "EndLoot.Count"), run: () => countCreature(target) });
}

/** dnd5e's Group sheet: a button in its header (GM). */
function groupSheetButton(app, element) {
  const header = (element instanceof HTMLElement ? element : app.element)?.querySelector(".window-header");
  if ( !header || header.querySelector(".dlo-sheet-rewards") || !game.user?.isGM || !xpEnabled() ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "header-control icon fa-solid fa-trophy dlo-sheet-rewards";
  const title = game.i18n.localize(titleKey(xpEnabled(), lootEnabled()));
  button.dataset.tooltip = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openRewards();
  });
  const first = header.querySelector(".header-control");
  if ( first ) first.before(button);
  else header.append(button);
}

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

/** At `init`: the request, and the toolbar (built once before `ready`). */
export function registerRewardsInit() {
  CONFIG.queries[AWARD_QUERY] = handleAward;
  route("getSceneControlButtons", "rewards: toolbar button", sceneControls);
}

/** At `ready`: combat end, defeats, menus, the Group sheet button, the window following its record. */
export function registerRewards() {
  route(COMBAT_ENDED_HOOK, "rewards: end of combat", onCombatEnd);
  route(CREATURE_DEFEATED_HOOK, "rewards: creature defeated (per kill)", onDefeated);
  route(TOKEN_MENU_HOOK, "menu: Rewards", tokenMenu);
  route("renderGroupActorSheet", "sheet: Rewards button", groupSheetButton);
  route(REWARDS_HOOK, "rewards: window follows its record", () => RewardsWindow.refresh());
}

/** Exposed as `api.rewards`. */
export const rewardsApi = {
  /** GM: open the window (on a record id, else the most recent pending one). */
  open: (id=null) => openRewards(id),
  /** Every encounter record, most recent first. */
  records: () => readRecords(),
  record: id => getRecord(id),
  /** GM: give the XP still pending in a record (`{ force: true }`: again, even if already given). */
  award: (id, { force=false }={}) => (force ? handleAward({ id, force }, { user: game.user }) : requestAward(id)),
  /** GM: what an award of this record would give now (no write). */
  preview: id => { const r = getRecord(id); if ( !r ) return null; const p = planAward(r);
    return { xp: p.xp, mode: p.mode, remainder: p.remainder, toParty: p.toParty, lost: p.lost, shares: p.shares.map(s => ({ name: s.name, uuid: s.uuid, xp: s.xp })) }; },
  /** GM: make and keep the record of a combat now (as at its end), without giving anything. */
  recordCombat: combat => (game.user.isGM ? serial(async () => { const r = recordFromCombat(combat); return r ? putRecord(r) : null; }) : null),
  /** GM: change a record (`{ bonus, split, members, foes… }` merged into it). */
  update: (id, changes) => (game.user.isGM ? serial(async () => { const r = getRecord(id); return r ? putRecord({ ...r, ...changes, id }) : null; }) : null),
  /** GM: a new record made by hand (every character of the party ticked). */
  create: () => (game.user.isGM ? handlers.create() : null),
  /** GM: remove a record. */
  remove: id => (game.user.isGM ? serial(() => deleteRecord(id)) : null),
  /** GM: count a defeated creature (token) in the current record. */
  count: token => (game.user.isGM ? countCreature(token?.document ?? token) : null),
  enabled: () => xpEnabled(),
  SETTING: REWARDS_SETTING
};
