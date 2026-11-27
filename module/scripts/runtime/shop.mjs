/**
 * Merchants (SPEC §3.7, step 8): the deal a player asks for is quoted again and carried out by the active GM (the player has no
 * right on the merchant); restock, settings and stall editing are the GM's. Ways in: a click on the merchant out of combat or a
 * double click (runtime/pointer.mjs), « Trade » / « Open the shop » in the Core's token menu, the token HUD button (GM), the actors
 * sidebar (GM), the shop entries of the merchant's sheet header menu, a `@Shop[…]` link in a journal.
 */
import { MODULE_ID, loc, setting, sceneSetting, log } from "../shared.mjs";
import { route } from "./router.mjs";
import { askGM, sourceRef } from "./take.mjs";
import { requestSteal } from "./theft.mjs";
import { landingSound } from "./drop-fx.mjs";
import { resolveSource, merchantSource, pocketSource } from "../adapter/sources.mjs";
import { TOKEN_MENU_HOOK, engineNotice } from "../adapter/engine.mjs";
import { inTurn, operation } from "../adapter/ledger.mjs";
import { boxInSight } from "../adapter/hidden.mjs";
import {
  merchantOf, merchantToken, isMerchant, quote, executeDeal, unsellable, restock, memorizeStock, convertItemPiles, formatPrice,
  shopOpenTo, SHOWN_VALID_MS, setStallPrice, setStallQuantity, setStallFlags, makeSellable, addToStall, removeFromStall,
  renameMerchant, setClosed, recordSale, clearSalesLog, unmakeMerchant
} from "../adapter/shop.mjs";
import { MerchantConfig } from "../apps/merchant-config.mjs";
import { escape } from "../apps/shop-parts.mjs";

const DEAL_QUERY = `${MODULE_ID}.shopDeal`;
const SHOW_QUERY = `${MODULE_ID}.shopShow`;

/** The character behind what acts: a token, or the actor itself (a shop without a token). */
const actorOf = looter => ((looter instanceof Actor) ? looter : (looter?.actor ?? null));

/* -------------------------------------------- */
/*  Player side                                 */
/* -------------------------------------------- */

/**
 * Conclude: the cart goes to the GM. Returns the outcome, or null (the refusal is told to the player). A deal that went through
 * is felt by the buyer only (user's choice, 2026-11-27): the sound of coins and a floating text over their token.
 */
export async function requestDeal(source, looter, cart) {
  const result = await askGM(DEAL_QUERY, handleDeal, { source: sourceRef(source), looter: looter.uuid, buy: cart.buy ?? [], sell: cart.sell ?? [] });
  if ( result ) dealFeedback(looter, result);
  return result;
}

/** The buyer's own feedback: coins heard, the balance floating over their token (when they have one on the scene). */
function dealFeedback(looter, result) {
  landingSound("coins")?.catch?.(() => {});
  const text = (result.net > 0) ? loc("Shop.FloatPaid", { price: formatPrice(result.net) })
    : ((result.net < 0) ? loc("Shop.FloatEarned", { price: formatPrice(-result.net) }) : loc("Shop.Done"));
  if ( looter?.documentName === "Token" ) engineNotice(looter, text, "gain");
}

/* -------------------------------------------- */
/*  GM side                                     */
/* -------------------------------------------- */

async function handleDeal(payload, { user }) {
  const source = resolveSource(payload.source);
  const looter = fromUuidSync(payload.looter, { strict: false });
  const buyer = actorOf(looter);
  if ( !source || (source.kind !== "merchant") || !source.exists() || !buyer ) throw new Error(loc("Shop.Gone"));
  if ( !buyer.testUserPermission(user, "OWNER") ) throw new Error(loc("Refus.PasAToi"));
  if ( buyer === source.actor ) throw new Error(loc("Refus.PasAToi"));
  if ( !user.isGM ) {
    if ( merchantOf(source.actor).closed ) throw new Error(loc("Shop.Closed"));
    if ( source.doc.documentName === "Actor" ) {
      // A shop addressed by its actor (no place, no reach): shown by the GM to this player, or open from anywhere (`remote`).
      if ( !shopOpenTo(source.actor, user) ) throw new Error(loc("Shop.NotShown"));
    } else {
      // A merchant on a scene: the character must be there too, as a token, within reach and not behind a wall.
      if ( (looter.documentName !== "Token") || (source.distance(looter) > sceneSetting("reach", looter.parent)) ) throw new Error(loc("Shop.TooFar"));
      if ( !boxInSight(looter, source.box()) ) throw new Error(loc("Refus.Mur"));
    }
  }
  // Two players concluding at once go one after the other; the quote is made in the same turn as the writes, on the merchant
  // **and** the character: its purse does not move (trade, theft, another merchant) in between.
  return inTurn([source.actor, buyer], () => deal(source, looter, payload, user));
}

async function deal(source, looter, payload, user) {
  const actor = source.actor;
  const buyer = actorOf(looter);
  // Lot 0 (defect 1): everything is checked before the first write — an item the merchant cannot hand over is never charged.
  const stuck = unsellable(actor, payload.buy ?? []);
  if ( stuck ) throw new Error(loc("Shop.Stuck", { name: stuck }));
  const q = quote(actor, source.doc, buyer, { buy: payload.buy, sell: payload.sell });
  // The GM's quote rules: a stock or an inventory that moved since the player's cart cancels the deal.
  if ( q.changed ) throw new Error(loc("Shop.Changed"));
  if ( q.empty ) throw new Error(loc("Shop.Nothing"));
  if ( !q.ok ) throw new Error(loc(q.reason === "playerFunds" ? "Shop.NoFunds" : "Shop.MerchantNoFunds"));
  // Lot 0 (defect 3): one operation — a write that fails puts back goods and purses, and the GM reads what happened.
  const line = l => (l.quantity > 1 ? `${l.name} (${l.quantity})` : l.name);
  const plan = [
    ...(q.buy.length ? [loc("Shop.ChatBought", { what: q.buy.map(line).join(", "), price: formatPrice(q.buyTotal) })] : []),
    ...(q.sell.length ? [loc("Shop.ChatSold", { what: q.sell.map(line).join(", "), price: formatPrice(q.sellTotal) })] : [])
  ];
  const names = await operation({ label: loc("Shop.Chat", { buyer: buyer.name, merchant: actor.name }), plan },
    op => executeDeal(actor, buyer, q, op));
  log.info(`trade: ${buyer.name} with ${actor.name} — buys [${names.bought.join(", ")}], sells [${names.sold.join(", ")}], balance ${q.net} cp`);
  // The sales log is written after the deal: a log that fails to be written never undoes a deal.
  recordSale(actor, { kind: "deal", who: buyer.name, user: user?.name ?? "", bought: names.bought, sold: names.sold, net: q.net,
    paid: q.buyTotal, earned: q.sellTotal }).catch(err => log.warn("sales log:", err.message));
  announceDeal(looter, source, names, q);
  return { bought: names.bought, sold: names.sold, net: q.net };
}

/** The outcome of a deal, to the GM or to everyone (setting `announce`). */
function announceDeal(looter, source, names, q) {
  const mode = setting("announce");
  if ( mode === "none" ) return;
  const parts = [];
  if ( names.bought.length ) parts.push(loc("Shop.ChatBought", { what: names.bought.join(", "), price: formatPrice(q.buyTotal) }));
  if ( names.sold.length ) parts.push(loc("Shop.ChatSold", { what: names.sold.join(", "), price: formatPrice(q.sellTotal) }));
  const balance = (q.net > 0) ? loc("Shop.ChatPaid", { price: formatPrice(q.net) })
    : ((q.net < 0) ? loc("Shop.ChatEarned", { price: formatPrice(-q.net) }) : loc("Shop.Even"));
  const content = `<p>${loc("Shop.Chat", { buyer: looter.name, merchant: source.name })}</p><ul>${parts.map(p => `<li>${p}</li>`).join("")}</ul><p>${balance}</p>`;
  const whisper = (mode === "gm") ? game.users.filter(u => u.isGM).map(u => u.id) : [];
  const speaker = ChatMessage.implementation.getSpeaker((looter instanceof Actor) ? { actor: looter } : { token: looter });
  ChatMessage.implementation.create({ content, whisper, speaker, flags: { [MODULE_ID]: { shop: true } } });
}

/* -------------------------------------------- */
/*  GM: settings, stock                         */
/* -------------------------------------------- */

const gmOnly = () => {
  if ( game.user.isGM ) return true;
  ui.notifications.warn(loc("Refus.MJSeul"));
  return false;
};

/**
 * Restock this merchant (GM). `mode`: `full`, `add` or `tables` (core/shop.mjs `restockPlan`); without one, the GM chooses in a
 * small window (the shop window's button).
 */
export async function requestRestock(source, mode=null) {
  if ( !gmOnly() ) return null;
  const chosen = mode ?? await chooseRestock(source);
  if ( !chosen ) return null;
  const result = await restock(source.actor, chosen);
  ui.notifications.info(loc("Shop.Restocked", { name: source.name, count: result.drawn.length }));
  return result;
}

/** The three restocks, as buttons. Resolves to the mode, or null. */
async function chooseRestock(source) {
  const tables = merchantOf(source.actor).tables.length;
  const button = (action, icon) => ({ action, icon, label: loc(`Shop.RestockMode.${action}`) });
  return foundry.applications.api.DialogV2.wait({
    window: { title: loc("Shop.RestockTitle", { name: source.name }), icon: "fa-solid fa-boxes-stacked" },
    content: `<p>${loc("Shop.RestockAsk")}</p><ul class="dlo-restock-help">
      <li><b>${loc("Shop.RestockMode.full")}</b> — ${loc("Shop.RestockHelp.full")}</li>
      <li><b>${loc("Shop.RestockMode.add")}</b> — ${loc("Shop.RestockHelp.add")}</li>
      <li><b>${loc("Shop.RestockMode.tables")}</b> — ${loc("Shop.RestockHelp.tables")}</li></ul>
      ${tables ? "" : `<p class="dlo-hint">${loc("Shop.RestockNoTables")}</p>`}`,
    buttons: [button("full", "fa-solid fa-rotate"), button("add", "fa-solid fa-plus"), button("tables", "fa-solid fa-dice")],
    rejectClose: false
  }).catch(() => null);
}

/** The settings form's actions. */
const CONFIG_ACTIONS = {
  /** Writes the flag (and the name, when given); the first activation notes the present stock as the restock reference. */
  save: async (actor, flag, name=null, token=null) => {
    if ( !gmOnly() ) return;
    const first = flag.enabled && !actor.getFlag(MODULE_ID, "merchant")?.purse;
    await actor.update({ [`flags.${MODULE_ID}.merchant`]: flag });
    if ( name ) await renameMerchant(actor, token, name);
    if ( first ) await memorizeStock(actor);
  },
  memorize: actor => (gmOnly() ? memorizeStock(actor) : 0),
  convert: actor => (gmOnly() ? convertItemPiles(actor) : null)
};

/** Opens this actor's merchant settings (GM). */
export function configureMerchant(actor) {
  if ( !gmOnly() ) return null;
  return MerchantConfig.show(actor, CONFIG_ACTIONS);
}

/** GM: make this NPC a merchant (enabled, its present stock noted as reference), then open its shop. */
export async function makeMerchant(actor, open) {
  if ( !gmOnly() || (actor?.type !== "npc") ) return null;
  if ( !isMerchant(actor) ) await CONFIG_ACTIONS.save(actor, { ...(actor.getFlag(MODULE_ID, "merchant") ?? {}), enabled: true });
  return open(merchantSource(actor), null);
}

/** GM: a new merchant, an NPC in this folder (or none), opened at once. */
export async function createMerchant(folder, open) {
  if ( !gmOnly() ) return null;
  const actor = await Actor.implementation.create({
    name: loc("Shop.NewMerchant"), type: "npc", folder: folder?.id ?? null, img: "icons/svg/coins.svg",
    system: { attributes: { hp: { value: 4, max: 4 } } },
    prototypeToken: { actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL },
    flags: { [MODULE_ID]: { merchant: { enabled: true, infiniteCoins: true } } }
  });
  await memorizeStock(actor);
  return open(merchantSource(actor), null);
}

/** GM: open or close a shop, with a word for the GM. */
export async function toggleClosed(actor) {
  if ( !gmOnly() ) return null;
  const closed = await setClosed(actor, !merchantOf(actor).closed);
  ui.notifications.info(loc(closed ? "Shop.NowClosed" : "Shop.NowOpen", { name: actor.name }));
  return closed;
}

/**
 * GM: back to a plain NPC, after a confirmation (user's request, 2026-11-27): settings, log and stall marks go, items and coins stay.
 */
export async function cancelMerchant(actor) {
  if ( !gmOnly() || !isMerchant(actor) ) return false;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: loc("Shop.UnmakeTitle", { name: actor.name }), icon: "fa-solid fa-store-slash" },
    content: `<p>${loc("Shop.UnmakeAsk", { name: escape(actor.name) })}</p>`,
    rejectClose: false
  });
  if ( !ok ) return false;
  await unmakeMerchant(actor);
  ui.notifications.info(loc("Shop.Unmade", { name: actor.name }));
  return true;
}

/**
 * GM: show the shop to the connected players — it opens for each, for their character (their token on the scene, else their
 * assigned character). Mostly for shops **without a token** (a merchant played without a map).
 */
export async function showShop(source) {
  if ( !gmOnly() ) return 0;
  const players = game.users.filter(u => u.active && !u.isGM);
  // Noted on the merchant before the windows open: a shop shown by its actor is open to these players only (see `shopOpenTo`).
  if ( source.doc.documentName === "Actor" ) await source.actor.setFlag(MODULE_ID, "shown", { time: Date.now(), users: players.map(u => u.id) });
  for ( const user of players ) {
    user.query(SHOW_QUERY, { source: sourceRef(source) }, { timeout: 10000 }).catch(err => log.warn("shop not shown:", err.message));
  }
  ui.notifications.info(loc("Shop.Shown", { name: source.name, count: players.length }));
  return players.length;
}

/** GM: ask before removing an item from the stall. */
async function removeItem(item) {
  if ( !gmOnly() ) return null;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: loc("Shop.RemoveTitle"), icon: "fa-solid fa-trash" },
    content: `<p>${loc("Shop.RemoveAsk", { name: escape(item.name) })}</p>`, rejectClose: false
  }).catch(() => false);
  return ok ? removeFromStall(item) : null;
}

/** The `@Shop[uuid]{label}` text of a merchant, for a journal (copied to the clipboard). */
export async function copyShopLink(source) {
  const text = `@Shop[${source.actor.uuid}]{${source.actor.name}}`;
  await game.clipboard?.copyPlainText?.(text) ?? navigator.clipboard?.writeText(text);
  ui.notifications.info(loc("Shop.LinkCopied", { text }));
  return text;
}

/**
 * A player steals an item from the stall (the « Steal » entry of the shop's item menu): the pockets of the merchant's token, through
 * the usual theft (GM approval when asked, Sleight of Hand, the GM decides). Only for a merchant on the scene and a character token.
 */
function stealFromStall(source, looter, itemId) {
  if ( (source.doc.documentName !== "Token") || (looter?.documentName !== "Token") ) return ui.notifications.warn(loc("Shop.StealNeedsTokens"));
  return requestSteal(pocketSource(source.doc), looter, itemId);
}

/** What the shop window receives to act (apps/shop-window.mjs): it never writes by itself. */
export const SHOP_ACTIONS = {
  deal: requestDeal, restock: source => requestRestock(source), configure: configureMerchant, show: showShop,
  save: (actor, flag, name, token) => CONFIG_ACTIONS.save(actor, flag, name, token),
  memorize: actor => CONFIG_ACTIONS.memorize(actor),
  convert: actor => CONFIG_ACTIONS.convert(actor),
  flag: (item, shop) => (gmOnly() ? setStallFlags(item, shop) : null),
  price: (item, cp) => (gmOnly() ? setStallPrice(item, cp) : null),
  quantity: (item, q) => (gmOnly() ? setStallQuantity(item, q) : null),
  sellable: item => (gmOnly() ? makeSellable(item) : null),
  add: (actor, sources) => (gmOnly() ? addToStall(actor, sources) : null),
  remove: removeItem,
  rename: (actor, token, name) => (gmOnly() ? renameMerchant(actor, token, name) : null),
  toggleClosed,
  clearLog: actor => (gmOnly() ? clearSalesLog(actor) : null),
  link: copyShopLink,
  steal: stealFromStall
};

/* -------------------------------------------- */
/*  Ways in                                     */
/* -------------------------------------------- */

/**
 * The Core's token menu:
 *  - on a merchant, for the character in hand (another token): « Trade » (players and GM — the GM then trades for that token);
 *  - GM, on the merchant's own token (nothing else in hand: the Core shows the token's own menu): « Open the shop » (the stall to
 *    manage) and « Open / Close the shop », « Cancel the shop ». Making a merchant is not offered on tokens (user's request, 2026-11-27: it
 *    cluttered the menu): the actors sidebar and the sheet's header menu do it.
 * `visit`: walk within reach first, then open (runtime/open.mjs).
 */
function tokenMenu({ open, visit }) {
  return (entries, { token, target }) => {
    if ( !target?.actor ) return;
    if ( game.user.isGM && (token === target) ) {
      if ( merchantToken(target) ) {
        const closed = merchantOf(target.actor).closed;
        entries.push({ icon: "fa-solid fa-store", label: loc("Shop.HudOpen"), run: () => open(merchantSource(target), null) });
        entries.push({ icon: closed ? "fa-solid fa-door-open" : "fa-solid fa-door-closed", label: loc(closed ? "Shop.OpenShop" : "Shop.CloseShop"),
          run: () => toggleClosed(target.actor) });
        entries.push({ icon: "fa-solid fa-store-slash", label: loc("Shop.Unmake"), run: () => cancelMerchant(target.actor) });
      }
      return;
    }
    if ( !token?.actor || !merchantToken(target) || (target === token) || game.combat?.started ) return;
    entries.push({ icon: "fa-solid fa-store", label: loc("Shop.Menu"), run: () => visit(merchantSource(target), token) });
    if ( game.user.isGM ) entries.push({ icon: "fa-solid fa-boxes-stacked", label: loc("Shop.HudOpen"), run: () => open(merchantSource(target), null) });
  };
}

/**
 * GM: the token HUD button of a merchant, to its shop. No button on other NPCs (user's request, 2026-11-27: « Make it a merchant »
 * cluttered the HUD; the actors sidebar and the sheet's header menu do it).
 */
function hudButton(open) {
  return (hud, html) => {
    const tokenDoc = hud.document;
    if ( !game.user.isGM || (tokenDoc?.actor?.type !== "npc") || !isMerchant(tokenDoc.actor) ) return;
    const column = html.querySelector(".col.left");
    if ( !column || column.querySelector(".dlo-hud-shop") ) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "control-icon dlo-hud dlo-hud-shop";
    button.dataset.tooltip = loc("Shop.HudOpen");
    button.innerHTML = `<i class="fa-solid fa-store"></i>`;
    // The GM opens the stall without a character (to manage it); to trade for a character: « Trade » in the menu.
    button.addEventListener("click", () => open(merchantSource(tokenDoc), null));
    column.append(button);
  };
}

/**
 * GM: in the actors sidebar, right click on an NPC — « Open the shop » and « Open / Close the shop » (a merchant, even without a
 * token), « Make it a merchant » (an NPC that is not one), « Merchant settings ». On a folder: « New merchant ». V14 core hooks
 * `getActorContextOptions` / `getFolderContextOptions` (client/applications/sidebar/document-directory.mjs:216-226): they are called
 * **once**, when the sidebar first renders — before `ready`, so they are routed at `init` (they used to be routed at `ready` and
 * never showed, user report of 2026-11-27).
 */
function directoryMenu(open) {
  return (app, options) => {
    if ( app?.documentName && (app.documentName !== "Actor") ) return;
    const actorOfEntry = li => game.actors.get(li.closest("[data-entry-id]")?.dataset.entryId);
    options.push({
      label: "DLO.Shop.HudOpen", icon: "<i class=\"fa-solid fa-store\"></i>",
      visible: li => game.user.isGM && isMerchant(actorOfEntry(li)),
      onClick: (event, li) => open(merchantSource(actorOfEntry(li)), null)
    }, {
      label: "DLO.Shop.HudMake", icon: "<i class=\"fa-solid fa-store\"></i>",
      visible: li => game.user.isGM && (actorOfEntry(li)?.type === "npc") && !isMerchant(actorOfEntry(li)),
      onClick: (event, li) => makeMerchant(actorOfEntry(li), open)
    }, {
      label: "DLO.Shop.OpenShop", icon: "<i class=\"fa-solid fa-door-open\"></i>",
      visible: li => game.user.isGM && isMerchant(actorOfEntry(li)) && merchantOf(actorOfEntry(li)).closed,
      onClick: (event, li) => toggleClosed(actorOfEntry(li))
    }, {
      label: "DLO.Shop.CloseShop", icon: "<i class=\"fa-solid fa-door-closed\"></i>",
      visible: li => game.user.isGM && isMerchant(actorOfEntry(li)) && !merchantOf(actorOfEntry(li)).closed,
      onClick: (event, li) => toggleClosed(actorOfEntry(li))
    }, {
      label: "DLO.Merchant.Menu", icon: "<i class=\"fa-solid fa-gear\"></i>",
      visible: li => game.user.isGM && isMerchant(actorOfEntry(li)),
      onClick: (event, li) => configureMerchant(actorOfEntry(li))
    }, {
      label: "DLO.Shop.Unmake", icon: "<i class=\"fa-solid fa-store-slash\"></i>",
      visible: li => game.user.isGM && isMerchant(actorOfEntry(li)),
      onClick: (event, li) => cancelMerchant(actorOfEntry(li))
    });
  };
}

function folderMenu(open) {
  return (app, options) => {
    if ( app?.documentName !== "Actor" ) return;
    options.push({
      label: "DLO.Shop.NewMerchantMenu", icon: "<i class=\"fa-solid fa-store\"></i>",
      visible: () => game.user.isGM,
      onClick: (event, li) => createMerchant(game.folders.get(li.closest("[data-folder-id]")?.dataset.folderId), open)
    });
  };
}

/**
 * The shop's entries in the sheet's own header menu (the « ⋮ » toggle, beside « Configure Sheet »), like the dnd5e system's own
 * entries (user's request, 2026-11-27): a button drawn in the header kept vanishing in the user's worlds when the shop was opened or
 * closed. The core asks for these entries each time the menu opens (`_headerControlButtons`, hook `getHeaderControls<Class>`), so
 * they always match the actor's state — nothing to keep in sync. « View the shop » for whoever looks at a merchant (the GM to manage
 * it, a player for their character); the rest is the GM's, as in the actors sidebar's menu.
 */
function sheetControls({ open, openFor }) {
  return (app, controls) => {
    const actor = app.document ?? app.actor;
    if ( !(actor instanceof Actor) || !Array.isArray(controls) ) return;
    const merchant = () => isMerchant(actor);
    const gmMerchant = () => game.user.isGM && merchant();
    controls.push({
      icon: "fa-solid fa-store", label: "DLO.Shop.HudOpen", visible: merchant,
      onClick: () => openFor(app.token ?? actor)
    }, {
      icon: "fa-solid fa-store", label: "DLO.Shop.HudMake",
      visible: () => game.user.isGM && (actor.type === "npc") && !merchant(),
      onClick: () => makeMerchant(actor, open)
    }, {
      icon: "fa-solid fa-door-open", label: "DLO.Shop.OpenShop", visible: () => gmMerchant() && merchantOf(actor).closed,
      onClick: () => toggleClosed(actor)
    }, {
      icon: "fa-solid fa-door-closed", label: "DLO.Shop.CloseShop", visible: () => gmMerchant() && !merchantOf(actor).closed,
      onClick: () => toggleClosed(actor)
    }, {
      icon: "fa-solid fa-gear", label: "DLO.Merchant.Menu", visible: gmMerchant,
      onClick: () => configureMerchant(actor)
    }, {
      icon: "fa-solid fa-store-slash", label: "DLO.Shop.Unmake", visible: gmMerchant,
      onClick: () => cancelMerchant(actor)
    });
  };
}

/** `@Shop[uuid]{label}` in a journal or a chat message: a link that opens that merchant's shop. */
const SHOP_LINK = /@Shop\[([^\]]+)\](?:\{([^}]+)\})?/g;

function enrichShopLink(match) {
  const [, uuid, label] = match;
  const doc = fromUuidSync(uuid, { strict: false });
  const a = document.createElement("a");
  a.className = "content-link dlo-shop-link";
  a.dataset.shopUuid = uuid;
  a.draggable = false;
  a.innerHTML = `<i class="fa-solid fa-store"></i> ${escape(label ?? doc?.name ?? loc("Shop.Stall"))}`;
  if ( !doc ) a.classList.add("broken");
  return a;
}

/**
 * The character a player shops with: their selected token, else their assigned character's token on the scene, else one of their
 * characters on the scene; without a token, the character itself (assigned, else the first they own).
 */
export function myShopper() {
  return canvas.tokens?.controlled.find(t => t.document.isOwner && (t.actor?.type === "character"))?.document
    ?? canvas.scene?.tokens.find(t => t.actorId === game.user.character?.id)
    ?? canvas.scene?.tokens.find(t => t.isOwner && (t.actor?.type === "character"))
    ?? game.user.character ?? game.actors.find(a => (a.type === "character") && a.isOwner) ?? null;
}

/**
 * Open a merchant's shop from a document (an actor, or a token): the GM opens the stall to manage it; a player opens it for their
 * character — through the merchant's token on their scene when there is one (reach applies), else through its actor (open only if
 * the GM showed it, or if it is open from anywhere).
 */
export function openShopOf(doc, open) {
  const actor = (doc instanceof Actor) ? doc : doc?.actor;
  if ( !isMerchant(actor) ) return ui.notifications.warn(loc("Shop.NotMerchant", { name: actor?.name ?? "?" }));
  if ( game.user.isGM ) return open(merchantSource(doc), null);
  const token = (doc?.documentName === "Token") ? doc
    : (canvas.scene?.tokens.find(t => (t.actorId === actor.id) && t.actorLink) ?? null);
  return open(merchantSource(token ?? actor), myShopper());
}

/**
 * @param {Function} open  Open a source (`open(source, looter)`).
 */
export function registerShopInit(open) {
  CONFIG.queries[DEAL_QUERY] = handleDeal;
  CONFIG.queries[SHOW_QUERY] = ({ source: ref }) => {
    const source = resolveSource(ref);
    if ( !source?.exists() ) return false;
    open(source, myShopper());
    return true;
  };
  // Routed at `init`: the sidebar builds its context menus once, before `ready`.
  route("getActorContextOptions", "sidebar: Shop", directoryMenu(open));
  route("getFolderContextOptions", "sidebar: new merchant", folderMenu(open));
  CONFIG.TextEditor?.enrichers?.push({ id: `${MODULE_ID}-shop`, pattern: SHOP_LINK, enricher: enrichShopLink });
  // In the capture phase: the core's own handler of `a.content-link` (the link's look) never sees this click.
  globalThis.document?.addEventListener("click", event => {
    const link = event.target?.closest?.("a.dlo-shop-link[data-shop-uuid]");
    if ( !link ) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const doc = fromUuidSync(link.dataset.shopUuid, { strict: false });
    if ( !doc ) return ui.notifications.warn(loc("Shop.Gone"));
    openShopOf(doc, open);
  }, true);
}

/**
 * @param {{ open: Function, visit: Function }} ways  Open a source (`open(source, looter)`), walk there then open
 *   (`visit(source, looter)`) — given by the entry point: runtime/open.mjs already knows this file.
 */
export function registerShop({ open, visit }) {
  route(TOKEN_MENU_HOOK, "menu: Shop", tokenMenu({ open, visit }));
  route("renderTokenHUD", "Shop button", hudButton(open));
  const openFor = doc => openShopOf(doc, open);
  route("getHeaderControlsActorSheetV2", "sheet: Shop entries in the header menu", sheetControls({ open, openFor }));
}

/** How long a shown shop stays open to its players (re-exported for the tests and the API). */
export { SHOWN_VALID_MS };
