/**
 * The « Loot » status (user's request, 2026-11-27, in place of a particle glint): a golden purse among the token's status icons,
 * put on a dead NPC that still has something to take — items, coins, or treasure not rolled yet — and taken off when it is empty.
 * The same corpses the Alt highlight rings (`corpsesToDraw` rules), but as a real status effect: every client sees it, with the
 * token, and nothing is drawn on top of the map.
 *
 * Only the active GM writes it, after a short pause that gathers a burst of changes (a corpse emptied item by item gives one
 * write). It follows: death and revival (status effects), items taken or added, coins, a treasure roll (actor update), a token
 * placed, the scene shown, the setting. Hidden from the token HUD: it is not a condition the GM sets by hand.
 */
import { MODULE_ID, setting, log } from "../shared.mjs";
import { route } from "./router.mjs";
import { searchableCorpse, lootView } from "../adapter/dnd5e.mjs";
import { mayHaveTreasure } from "../adapter/treasure.mjs";
import { lootMarkWanted } from "../core/loot-visuals.mjs";

export const LOOT_STATUS = "darsh-loot-loot";
export const LOOT_ICON = `modules/${MODULE_ID}/assets/icons/loot.svg`;

/** How long a burst of changes is gathered before the marks are written (ms). */
const SYNC_MS = 300;

const pending = new Set();   // token documents to check
let timer = null;

const isActiveGM = () => !!game.users?.activeGM?.isSelf;

/** Does this token's actor deserve the mark now? */
export function lootMarkFor(tokenDoc) {
  const actor = tokenDoc?.actor;
  return lootMarkWanted({
    enabled: setting("lootMark") !== false,
    corpse: !!(actor && searchableCorpse(tokenDoc)),
    hasLoot: !!actor && !lootView(actor).empty,
    unrolled: !!actor && !!setting("autoTreasure") && mayHaveTreasure(actor)
  });
}

async function syncToken(tokenDoc) {
  const actor = tokenDoc?.actor;
  if ( !actor || !tokenDoc.parent ) return;
  const want = lootMarkFor(tokenDoc);
  if ( want === actor.statuses.has(LOOT_STATUS) ) return;
  await actor.toggleStatusEffect(LOOT_STATUS, { active: want });
}

async function flush() {
  timer = null;
  const tokens = [...pending];
  pending.clear();
  for ( const t of tokens ) {
    try { await syncToken(t); }
    catch(err) { log.warn("loot mark:", err.message); }
  }
}

function queue(tokens) {
  if ( !isActiveGM() ) return;
  for ( const t of tokens ) if ( t && !t.destroyed ) pending.add(t);
  if ( pending.size && !timer ) timer = setTimeout(flush, SYNC_MS);
}

/** The tokens of an actor (a synthetic token actor, or every placed token of a world actor). */
function tokensOf(actor) {
  if ( !actor ) return [];
  if ( actor.isToken ) return [actor.token];
  return actor.getDependentTokens?.() ?? [];
}

const fromEmbedded = doc => {
  const parent = doc?.parent;
  // An item inside an actor, or an effect on an actor (not on an item).
  if ( parent?.documentName === "Actor" ) queue(tokensOf(parent));
  else if ( parent?.parent?.documentName === "Actor" ) queue(tokensOf(parent.parent));
};

/** Every token of every scene (the setting changed). */
function sweepAll() {
  for ( const scene of game.scenes ?? [] ) queue(scene.tokens.contents);
}

/**
 * The status, added to the system's list at `setup`: dnd5e 6 rebuilds `CONFIG.statusEffects` at `i18nInit`, as an object keyed by
 * id (dnd5e.mjs `_configureStatusEffects`), so an entry added at `init` is lost. An array (another system) gets it pushed.
 */
export function registerLootMarkInit() {
  const status = { id: LOOT_STATUS, name: "DLO.LootMark.Status", img: LOOT_ICON, hud: false };
  if ( Array.isArray(CONFIG.statusEffects) ) {
    if ( !CONFIG.statusEffects.some(s => s.id === LOOT_STATUS) ) CONFIG.statusEffects.push(status);
  } else CONFIG.statusEffects[LOOT_STATUS] = status;
}

export function registerLootMark() {
  for ( const hook of ["createActiveEffect", "deleteActiveEffect", "createItem", "deleteItem", "updateItem"] ) route(hook, "loot mark", fromEmbedded);
  route("updateActor", "loot mark", actor => queue(tokensOf(actor)));
  route("createToken", "loot mark", token => queue([token]));
  // A synthetic (unlinked) token's items and coins live in its delta: some of their changes only reach `updateToken`.
  route("updateToken", "loot mark", (token, changes) => { if ( changes?.delta ) queue([token]); });
  route("canvasReady", "loot mark", () => queue(canvas.scene?.tokens.contents ?? []));
  route(`${MODULE_ID}.lootMark`, "loot mark", sweepAll);
  if ( canvas?.ready ) queue(canvas.scene?.tokens.contents ?? []);
}
