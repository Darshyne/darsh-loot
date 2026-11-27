/**
 * Giving (lot 1, 2026-11-27): hand an item, part of a stack or coins to another character without opening a trade.
 * Drag the item (or the coins of the sheet's purse) onto the other character's token. No right-click menu entry: the user
 * keeps « Trade » alone there (2026-11-27).
 * The player asks, the active GM checks and writes, as one operation inside `inTurn`. Setting `giveMode`: « direct » (the
 * default: it arrives at once), « ask » (the receiver's player agrees first — the GM answers for a character nobody holds),
 * « off ». The giver must be within reach of the receiver, on the same V14 level, with no wall in between: a refusal the
 * player may force, the GM being told (runtime/force.mjs).
 */
import { MODULE_ID, loc, setting, sceneSetting, log } from "../shared.mjs";
import { askForce, tellForced } from "./force.mjs";
import { feedbackCard, SOUNDS } from "./feedback.mjs";
import { forceableRefusal } from "../core/force.mjs";
import { canReceive, needsConsent } from "../core/give.mjs";
import { PHYSICAL_TYPES, clampCoins, coinsOf, takenQuantity } from "../core/loot.mjs";
import { inTurn, operation } from "../adapter/ledger.mjs";
import { moveItemNow, moveCoinsNow, canHandOver, COIN_PILE_IMG } from "../adapter/drop.mjs";
import { tokenDistance } from "../adapter/dnd5e.mjs";
import { boxInSight } from "../adapter/hidden.mjs";
import { coinsLabel } from "../adapter/party.mjs";
import { askQuantity } from "../apps/quantity-dialog.mjs";
import { askCoins } from "../apps/coins-dialog.mjs";

const GIVE_QUERY = `${MODULE_ID}.give`;
const OFFER_QUERY = `${MODULE_ID}.giveOffer`;

/** How long the receiver has to answer in « ask » mode (ms). */
const OFFER_MS = 60000;

const giveMode = () => setting("giveMode");

/* -------------------------------------------- */
/*  Player side                                 */
/* -------------------------------------------- */

/** May `giver` (a token I hold) give something to `receiver` (another token)? What the menu and the drag ask. */
export function canGive(giver, receiver) {
  const from = giver?.actor, to = receiver?.actor;
  if ( !from || !to || !from.isOwner || (giveMode() === "off") ) return false;
  return canReceive({ same: (from === to) || (giver === receiver), type: to.type, playerOwned: !!to.hasPlayerOwner, byGM: game.user.isGM });
}

/** The token under a point of the viewed scene that `giver` may give to (the topmost one), or null. */
export function receiverAt(giver, point) {
  if ( !canvas?.ready || (giver?.parent !== canvas.scene) || !Number.isFinite(point?.x) || !Number.isFinite(point?.y) ) return null;
  const under = canvas.tokens.placeables.filter(t => t.visible && t.bounds.contains(point.x, point.y) && canGive(giver, t.document));
  return under.at(-1)?.document ?? null;
}

/**
 * Asks the active GM to hand over an item and / or coins.
 * @param {TokenDocument} giver
 * @param {TokenDocument} receiver
 * @param {{ item?: string, quantity?: number, coins?: Record<string, number> }} what
 */
export function requestGive(giver, receiver, what={}) {
  if ( !giver || !receiver ) return ui.notifications.warn(loc("Refus.Introuvable"));
  // In « ask » mode the answer waits for the receiver: no « the GM has not answered » before that.
  const timeout = (giveMode() === "ask") ? OFFER_MS + 10000 : 15000;
  return askForce(GIVE_QUERY, handleGive, { giver: giver.uuid, receiver: receiver.uuid, item: what.item ?? null,
    quantity: what.quantity ?? null, coins: what.coins ?? null }, { timeout });
}

/** An item dragged onto a character: how many, then the request. */
export async function giveItemTo(giver, receiver, item) {
  const quantity = await askQuantity({ title: loc("Give.QuantityTitle", { name: item.name, to: receiver.name }), label: loc("Give.Quantity"),
    max: (item.type === "container") ? 1 : (item.system.quantity ?? 1), ok: loc("Give.Confirm"), icon: "fa-solid fa-hand-holding-heart" });
  if ( !quantity ) return null;
  return requestGive(giver, receiver, { item: item.id, quantity });
}

/** Coins handed to a character (dragged from the sheet, or the menu): how many, then the request. */
export async function giveCoinsTo(giver, receiver, key=null) {
  const have = Object.fromEntries(coinsOf(giver.actor.system.currency).map(c => [c.key, c.value]));
  if ( !Object.keys(have).length ) return ui.notifications.info(loc("Give.NoCoins"));
  const coins = await askCoins({ title: loc("Give.CoinsTitle", { to: receiver.name }), have, ok: loc("Give.Confirm"),
    preset: (key && have[key]) ? { [key]: have[key] } : {}, icon: "fa-solid fa-hand-holding-heart" });
  if ( !coins ) return null;
  return requestGive(giver, receiver, { coins });
}

/** At the receiver's player (« ask » mode): accept or refuse, within a minute. Only a GM client may ask. */
async function handleOffer({ giver, receiver, what }, { user }={}) {
  if ( !user?.isGM ) return false;
  const escape = foundry.utils.escapeHTML;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("Give.OfferTitle"), icon: "fa-solid fa-hand-holding-heart" },
    classes: ["dlo-give-offer"],
    content: `<p>${escape(loc("Give.Offer", { giver, receiver, what }))}</p>`,
    buttons: [
      { action: "yes", label: loc("Give.Accept"), icon: "fa-solid fa-check", default: true, callback: () => true },
      { action: "no", label: loc("Give.Refuse"), icon: "fa-solid fa-xmark", callback: () => false }
    ],
    render: (event, dialog) => { setTimeout(() => dialog.close?.().catch?.(() => {}), OFFER_MS); },
    rejectClose: false
  });
  return answer === true;
}

/* -------------------------------------------- */
/*  At the GM                                   */
/* -------------------------------------------- */

/** Who answers for this character: a connected player who owns it (its assigned player first), never the giver's — else the GM. */
function holderOf(actor, requester) {
  const owners = game.users.filter(u => u.active && !u.isGM && (u.id !== requester.id) && actor.testUserPermission(u, "OWNER"));
  return owners.find(u => u.character === actor) ?? owners[0] ?? game.users.activeGM;
}

/** A token's footprint in grid squares (what `boxInSight` takes). */
function boxOf(token) {
  const size = token.parent.grid.size;
  return { col: token._source.x / size, row: token._source.y / size, w: token._source.width, h: token._source.height };
}

/** What the giver can really hand over of what is asked, read now: `{ item, quantity, coins, label }`, or a refusal. */
function possibleGift(from, payload) {
  let item = null, quantity = 0;
  if ( payload.item ) {
    item = from.items.get(payload.item);
    if ( !item || !PHYSICAL_TYPES.has(item.type) ) throw new Error(loc("Refus.Introuvable"));
    if ( !canHandOver(from, item.id) ) throw new Error(loc("Drop.NotGear", { item: item.name }));
    quantity = (item.type === "container") ? (item.system.quantity ?? 1) : takenQuantity(item.system.quantity ?? 1, payload.quantity);
  }
  const { coins, any } = clampCoins(payload.coins, from.system.currency);
  if ( !item && !any ) throw new Error(loc("Give.Nothing"));
  const label = [item ? ((quantity > 1) ? `${item.name} (${quantity})` : item.name) : "", any ? coinsLabel(coins) : ""].filter(Boolean).join(", ");
  return { item, quantity, coins, any, label };
}

async function handleGive(payload, { user }) {
  const giver = fromUuidSync(payload.giver, { strict: false });
  const receiver = fromUuidSync(payload.receiver, { strict: false });
  const from = giver?.actor, to = receiver?.actor;
  if ( !from || !to || (giver.documentName !== "Token") || (receiver.documentName !== "Token") ) throw new Error(loc("Refus.Introuvable"));
  if ( !from.testUserPermission(user, "OWNER") ) throw new Error(loc("Refus.PasAToi"));
  const mode = giveMode();
  if ( !user.isGM && (mode === "off") ) throw new Error(loc("Give.Off"));
  if ( !canReceive({ same: (from === to) || (giver === receiver), type: to.type, playerOwned: !!to.hasPlayerOwner, byGM: user.isGM }) ) {
    throw new Error(loc("Give.NotTo", { name: receiver.name }));
  }
  // Checked before anyone is asked: there is something to give.
  const first = possibleGift(from, payload);

  // Within reach, on the same V14 level, no wall in between — unless the player forces it (the GM is then told).
  let forced = null;
  if ( !user.isGM ) {
    const obstacle = (giver.parent !== receiver.parent) ? loc("Give.Far")
      : (tokenDistance(giver, receiver) > sceneSetting("reach", giver.parent)) ? loc("Give.Far")
        : (!boxInSight(giver, boxOf(receiver)) ? loc("Refus.Mur") : null);
    if ( obstacle && !payload.force ) throw forceableRefusal(obstacle);
    forced = obstacle;
  }

  // « Ask » mode: the receiver's player agrees first. Nothing has been written, nothing is held meanwhile.
  if ( needsConsent({ mode, byGM: user.isGM, ownsReceiver: to.testUserPermission(user, "OWNER") }) ) {
    const holder = holderOf(to, user);
    if ( !holder ) throw new Error(loc("Give.NobodyThere", { name: receiver.name }));
    const offer = { giver: giver.name, receiver: receiver.name, what: first.label };
    let accepted = false;
    try {
      accepted = holder.isSelf ? await handleOffer(offer, { user: game.user })
        : await holder.query(OFFER_QUERY, offer, { timeout: OFFER_MS + 5000 });
    } catch(err) {
      log.warn("gift offer not answered:", err.message);
    }
    if ( accepted !== true ) throw new Error(loc("Give.Declined", { name: receiver.name }));
  }

  const given = await inTurn([from, to], () => {
    // The turn has come (and, in « ask » mode, a minute may have passed): what is still there is read again.
    const gift = possibleGift(from, payload);
    return operation({ label: loc("Give.Op", { from: from.name, to: to.name }), plan: [gift.label], journal: !!(gift.item && gift.any) }, async op => {
      const out = { names: [], coins: {} };
      if ( gift.item ) {
        const moved = await moveItemNow(from, to, gift.item.id, gift.quantity, { op });
        if ( moved.quantity ) out.names.push((moved.quantity > 1) ? `${moved.name} (${moved.quantity})` : moved.name);
        out.img = gift.item.img;
      }
      if ( gift.any ) out.coins = await moveCoinsNow(from, to, gift.coins, { op });
      return out;
    });
  });
  announceGift({ giver, receiver, given });
  tellForced(user, loc("Give.ForcedWhat", { who: giver.name, to: receiver.name }), forced);
  return { names: given.names, coins: given.coins };
}

/** Seen and heard by all: a public card, the thing flying from the giver to the receiver, a floating text over each. */
function announceGift({ giver, receiver, given }) {
  const what = [...given.names, coinsLabel(given.coins)].filter(Boolean).join(", ");
  if ( !what ) return null;
  const size = giver.parent.grid.size;
  const from = { x: giver._source.x + ((giver._source.width * size) / 2), y: giver._source.y + ((giver._source.height * size) / 2) };
  const same = giver.parent === receiver.parent;
  return feedbackCard(giver, loc("Give.Card", { giver: giver.name, receiver: receiver.name, what }), {
    kind: "gain", icon: "fa-solid fa-hand-holding-heart", sound: given.names.length ? SOUNDS.rummage : SOUNDS.coins, float: `−${what}`,
    also: same ? [{ token: receiver, text: `+${what}`, kind: "gain" }] : [],
    flags: { give: true, ...(same ? { flyFx: { scene: giver.parent.id, from, to: [receiver.uuid], img: given.img ?? COIN_PILE_IMG } } : {}) }
  });
}

export function registerGiveInit() {
  CONFIG.queries[GIVE_QUERY] = handleGive;
  CONFIG.queries[OFFER_QUERY] = handleOffer;
}
