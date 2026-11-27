/**
 * Sharing loot with the party (lot 1, 2026-11-27 — issue darsh-loot#19). A player asks, the active GM checks and writes.
 *
 * Coins: « Share » in the search window of a corpse, a container or a ground pile (no right-click menu entry: the user found
 * it one too many, 2026-11-27). The coins are split between the party's characters (adapter/party.mjs: dnd5e's primary party,
 * or the player-owned characters on the scene), coin by coin, without conversion; what does not divide stays where it is, or
 * goes to the one who shares (setting `shareRemainder`). One operation: a write that fails gives everything back.
 */
import { MODULE_ID, loc, setting } from "../shared.mjs";
import { checkAccess, sourceRef, TAKE_KINDS } from "./take.mjs";
import { askForce, tellForced } from "./force.mjs";
import { feedbackCard, playForAll, SOUNDS } from "./feedback.mjs";
import { inTurn } from "../adapter/ledger.mjs";
import { resolveSource } from "../adapter/sources.mjs";
import { clearIfEmpty } from "../adapter/drop.mjs";
import { partyMembers, sceneOfSource, coinsLabel, tokenOnScene } from "../adapter/party.mjs";
import { shareCoinsNow } from "../adapter/share.mjs";

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
  const flags = (from && tokens.length) ? { flyFx: { scene: scene.id, from, to: tokens.map(t => t.uuid), img: COIN_IMG } } : {};
  if ( !main ) {
    // Nobody of the party is on the scene (a GM sharing a chest for absent characters): the card and the sound only.
    playForAll(SOUNDS.coins, 0.6);
    return ChatMessage.implementation.create({ content: `<p><i class="fa-solid fa-coins"></i> ${foundry.utils.escapeHTML(text)}</p>`,
      flags: { [MODULE_ID]: { share: true } } });
  }
  return feedbackCard(main, text, { kind: "gain", icon: "fa-solid fa-coins", sound: SOUNDS.coins, float: tokens.includes(main) ? float : text,
    also: tokens.filter(t => t !== main).map(t => ({ token: t, text: float, kind: "gain" })), flags: { share: true, ...flags } });
}

export function registerShareInit() {
  CONFIG.queries[SHARE_COINS_QUERY] = handleShareCoins;
}
