/**
 * Sharing loot with the party (lot 1, 2026-11-27 — issue darsh-loot#19). A player asks, the active GM checks and writes.
 *
 * Coins: « Share the coins » in the search window of a corpse, a container or a ground pile, and in the right-click menu of
 * the Core, next to « Search ». The coins are split between the party's characters (adapter/party.mjs: dnd5e's primary party,
 * or the player-owned characters on the scene), coin by coin, without conversion; what does not divide stays where it is, or
 * goes to the one who shares (setting `shareRemainder`). One operation: a write that fails gives everything back.
 */
import { MODULE_ID, loc, setting, sceneSetting } from "../shared.mjs";
import { route } from "./router.mjs";
import { checkAccess, sourceRef, TAKE_KINDS } from "./take.mjs";
import { askForce, tellForced } from "./force.mjs";
import { feedbackCard, playForAll, SOUNDS } from "./feedback.mjs";
import { playDrop } from "./drop-fx.mjs";
import { canApproach, approachSource } from "./approach.mjs";
import { inTurn } from "../adapter/ledger.mjs";
import { resolveSource } from "../adapter/sources.mjs";
import { clearIfEmpty } from "../adapter/drop.mjs";
import { partyMembers, sceneOfSource, coinsLabel, tokenOnScene } from "../adapter/party.mjs";
import { shareCoinsNow } from "../adapter/share.mjs";
import { coinsOf } from "../core/loot.mjs";

const SHARE_COINS_QUERY = `${MODULE_ID}.shareCoins`;

/** What every client draws flying from the loot to each member. */
const COIN_IMG = "icons/commodities/currency/coins-plain-stack-gold.webp";

/* -------------------------------------------- */
/*  Player side                                 */
/* -------------------------------------------- */

/**
 * Asks the active GM to split the coins of a source between the party. A GM may ask without a character in hand.
 * « Too far » and « a wall is in the way » can be forced (runtime/force.mjs).
 * @param {object} source          A corpse or a container (adapter/sources.mjs).
 * @param {TokenDocument|null} looter
 */
export function requestShareCoins(source, looter) {
  return askForce(SHARE_COINS_QUERY, handleShareCoins, { source: sourceRef(source), looter: looter?.uuid ?? null });
}

/** Who would share what this source holds, as this client sees it (the window's tooltip; the GM client decides). */
export function sharersOf(source, looter) {
  return partyMembers(sceneOfSource(source), looter?.actor ?? null);
}

/* -------------------------------------------- */
/*  At the GM                                   */
/* -------------------------------------------- */

/** The checks every share starts with: the source, the character, reach — and a source one takes from, unlocked. */
function shareAccess(payload, user) {
  let access;
  if ( user.isGM && !payload.looter ) {
    const source = resolveSource(payload.source);
    if ( !source?.exists() ) throw new Error(loc("Refus.Introuvable"));
    access = { source, looter: null };
  }
  else access = checkAccess(payload, user, { canForce: true });
  const { source } = access;
  if ( !TAKE_KINDS.includes(source.kind) ) throw new Error(loc("Refus.Introuvable"));
  if ( source.locked() ) throw new Error(loc("Lock.Locked"));
  if ( !source.actor ) throw new Error(loc("Refus.Introuvable"));
  return access;
}

async function handleShareCoins(payload, { user }) {
  const { source, looter, forced } = shareAccess(payload, user);
  const scene = sceneOfSource(source);
  const members = partyMembers(scene, looter?.actor ?? null);
  if ( members.length < 2 ) throw new Error(loc("Share.Alone"));
  const shared = await inTurn([source.actor, ...members], async () => {
    // Once the turn has come the source may be gone (a pile emptied by the take before this one).
    if ( !source.exists() ) throw new Error(loc("Refus.Introuvable"));
    const done = await shareCoinsNow(source.actor, members, { remainder: setting("shareRemainder"), sharer: looter?.actor ?? null });
    if ( source.kind === "container" ) await clearIfEmpty(source.doc.parent);
    return done;
  });
  announceShare({ source, scene, looter, members, shared });
  tellForced(user, loc("Share.ForcedWhat", { who: looter?.name ?? user.name }), forced);
  return { each: shared.each, left: shared.left, bonus: shared.bonus, names: shared.names };
}

/** The centre of a source on its scene, in pixels (its `box()` is in grid squares). */
function sourceCentre(source, scene) {
  const box = source.box?.();
  const size = scene?.grid?.size;
  if ( !box || !size ) return null;
  return { x: (box.col + (box.w / 2)) * size, y: (box.row + (box.h / 2)) * size };
}

/** A token's centre, from its stored position. */
function tokenCentre(token) {
  const size = token.parent.grid.size;
  return { x: token._source.x + ((token._source.width * size) / 2), y: token._source.y + ((token._source.height * size) / 2) };
}

/**
 * Seen and heard by all: a public card (who shared, what each one gets, what is left), « +3 gp » floating over each member on
 * the scene, the coins flying from the loot to each of them, the sound of coins.
 */
function announceShare({ source, scene, looter, members, shared }) {
  const each = coinsLabel(shared.each);
  const text = [
    loc("Share.Card", { names: shared.names.join(", "), each }),
    Object.keys(shared.bonus).length ? loc("Share.CardBonus", { who: looter?.name ?? "", rest: coinsLabel(shared.bonus) }) : "",
    Object.keys(shared.left).length ? loc("Share.CardLeft", { rest: coinsLabel(shared.left) }) : ""
  ].filter(Boolean).join(" ");
  const tokens = members.map(m => tokenOnScene(scene, m)).filter(Boolean);
  const float = `+${each}`;
  const main = looter ?? tokens[0] ?? null;
  const from = sourceCentre(source, scene);
  const flags = (from && tokens.length) ? { shareFx: { scene: scene.id, from, to: tokens.map(t => t.uuid), img: COIN_IMG } } : {};
  if ( !main ) {
    // Nobody of the party is on the scene (a GM sharing a chest for absent characters): the card and the sound only.
    playForAll(SOUNDS.coins, 0.6);
    return ChatMessage.implementation.create({ content: `<p><i class="fa-solid fa-coins"></i> ${foundry.utils.escapeHTML(text)}</p>`,
      flags: { [MODULE_ID]: { share: true } } });
  }
  return feedbackCard(main, text, { kind: "gain", icon: "fa-solid fa-coins", sound: SOUNDS.coins, float: tokens.includes(main) ? float : text,
    also: tokens.filter(t => t !== main).map(t => ({ token: t, text: float, kind: "gain" })), flags: { share: true, ...flags } });
}

/** On every client: the coins of a share fly from the loot to each member's token (nothing is written). */
function onCreateMessage(message) {
  const fx = message.getFlag?.(MODULE_ID, "shareFx");
  if ( !fx || !canvas?.ready || (canvas.scene?.id !== fx.scene) || ((Date.now() - (message.timestamp ?? 0)) > 10000) ) return;
  for ( const uuid of fx.to ?? [] ) {
    const token = fromUuidSync(uuid, { strict: false });
    if ( token?.parent === canvas.scene ) playDrop(token, { from: fx.from, to: tokenCentre(token), img: fx.img, mute: true });
  }
}

/* -------------------------------------------- */
/*  Menu                                        */
/* -------------------------------------------- */

/** What `registerShare` receives from the entry point (runtime/open.mjs, which itself knows this file). */
const steps = { prepare: async () => true };

/**
 * « Share the coins » in the Core's right-click menu (runtime/pointer.mjs adds it under « Search », for players and GM alike).
 * From the menu, without the window: walk within reach, open the source as a search does (treasure rolled, trapped chest),
 * then share its coins — or say there are none.
 */
export async function shareCoinsFrom(source, looter) {
  if ( !source?.exists() ) return null;
  if ( looter && canApproach() && (source.distance(looter) > sceneSetting("reach", looter.parent)) ) await approachSource(source, looter);
  if ( source.locked() ) return ui.notifications.warn(loc("Lock.Locked"));
  if ( !(await steps.prepare(source, looter)) ) return null;
  if ( !coinsOf(source.actor?.system.currency).length ) return ui.notifications.info(loc("Share.NoCoins"));
  return requestShareCoins(source, looter);
}

export function registerShareInit() {
  CONFIG.queries[SHARE_COINS_QUERY] = handleShareCoins;
}

/** @param {{ prepare: (source: object, looter: TokenDocument|null) => Promise<boolean> }} given */
export function registerShare({ prepare }={}) {
  if ( prepare ) steps.prepare = prepare;
  route("createChatMessage", "share: coins flying to each member", onCreateMessage);
}
