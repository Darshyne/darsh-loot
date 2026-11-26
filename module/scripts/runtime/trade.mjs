/**
 * Échange entre joueurs (SPEC §3.6, étape 7) : « Échanger » dans le menu contextuel du token d'un autre PJ (le menu du
 * moteur de combat, son hook public `dnd5e-combat.tokenMenu`) — à n'importe quelle distance (décisions utilisateur
 * 2026-09-30) — ouvre une fenêtre d'échange, vide, chez les deux joueurs. Chacun y glisse ce qu'il donne et valide ;
 * quand les deux ont validé la même chose, le MJ actif fait l'échange.
 *
 * L'état vit chez le MJ actif (un joueur ne peut pas écrire chez l'autre) : les joueurs lui envoient leurs gestes
 * (requêtes `darsh-loot.trade*`), il relaie l'état aux deux (`darsh-loot.tradeState`).
 */
import { MODULE_ID, loc, log } from "../shared.mjs";
import { askGM } from "./take.mjs";
import { route } from "./router.mjs";
import { TOKEN_MENU_HOOK } from "../adapter/engine.mjs";
import { moveItemNow } from "../adapter/drop.mjs";
import { inTurn, operation } from "../adapter/ledger.mjs";
import { addCoins, COINS } from "../core/loot.mjs";
import {
  newTrade, setOffer, accept, unaccept, ready, clampOffer, withoutContained, tradable, other, staleTrades, TRADE_MAX_OPEN
} from "../core/trade.mjs";
import { TradeWindow } from "../apps/trade-window.mjs";

const Q = {
  open: `${MODULE_ID}.tradeOpen`,
  update: `${MODULE_ID}.tradeUpdate`,
  accept: `${MODULE_ID}.tradeAccept`,
  cancel: `${MODULE_ID}.tradeCancel`,
  state: `${MODULE_ID}.tradeState`,
  reset: `${MODULE_ID}.tradeReset`
};

/**
 * The trades in progress, at the active GM — in memory only. A reload of that client, or another GM becoming the active one,
 * loses them: instead of leaving both players with a window whose every button answers « this trade is over », the trade is then
 * **cancelled cleanly on both sides, with a message** (lot 0, audit of 2026-11-26, defect 8):
 *  - each state carries `gm`, the user id of the GM client holding it; a player client that sees this GM disconnect, or another
 *    GM become the active one, closes its window (`onUserConnected`);
 *  - a GM client that becomes ready holds no trade: it tells every connected player so (`tradeReset`), which closes the windows a
 *    missed disconnection would have left.
 * Nothing has been written at that point (a trade writes only once both sides have agreed, in one operation — adapter/ledger.mjs).
 */
const trades = new Map();

/** Les échanges que le MJ est en train d'exécuter (objets et pièces en route) : plus aucun geste n'y est reçu. */
const executing = new Set();

/* -------------------------------------------- */
/*  Côté joueur                                 */
/* -------------------------------------------- */

/** Peut-on proposer un échange de ce personnage à cet autre ? Un autre PJ, que je ne tiens pas. */
export function canTrade(fromActor, toActor) {
  return !!fromActor && !!toActor && (fromActor !== toActor) && fromActor.isOwner && !toActor.isOwner
    && (toActor.type === "character");
}

/** Ouvrir un échange (fenêtre vide) entre mon personnage et un autre PJ. */
export function startTrade(fromActor, toActor) {
  if ( !canTrade(fromActor, toActor) ) return ui.notifications.warn(loc("Trade.Impossible"));
  return askGM(Q.open, handleOpen, { from: fromActor.uuid, to: toActor.uuid });
}

/** « Échanger » dans le menu contextuel du token d'un autre PJ (menu du moteur). */
function onTokenMenu(entries, { token, target }) {
  if ( !canTrade(token?.actor, target?.actor) ) return;
  entries.push({ icon: "fa-solid fa-right-left", label: loc("Trade.Menu"), run: () => startTrade(token.actor, target.actor) });
}

/** Mettre à jour mon offre, valider, retirer ma validation, annuler — depuis la fenêtre. */
export const tradeActions = {
  update: async (id, offer) => {
    const answer = await askGM(Q.update, handleUpdate, { id, offer });
    // What the GM client left out of my offer (a spell, something I am wearing): said here, the window shows the rest.
    if ( answer?.left?.length ) ui.notifications.warn(loc("Trade.NotTradable", { names: answer.left.join(", ") }));
    return answer;
  },
  accept: (id, value, rev) => askGM(Q.accept, handleAccept, { id, value, rev }),
  cancel: id => askGM(Q.cancel, handleCancel, { id })
};

/** Chez chacun des deux : l'état arrive, la fenêtre s'ouvre ou se redessine. */
function handleState(trade) {
  try {
    TradeWindow.show(trade, tradeActions);
  } catch(err) {
    // Sans ceci, l'erreur ne remontait qu'au MJ, en simple avertissement : rien ne s'ouvrait, sans rien dire.
    log.error("trade window", err);
    ui.notifications.error(loc("Trade.WindowFailed", { reason: err.message }));
    throw err;
  }
  return true;
}

/** The GM client that held my trades is gone (or is no longer the active one): they are cancelled here, with the reason. */
function onUserConnected(user, connected) {
  if ( !user?.isGM ) return;
  const active = game.users.activeGM?.id ?? null;
  TradeWindow.cancelWhere(trade => !!trade.gm && ((trade.gm !== active) || ((trade.gm === user.id) && !connected)), loc("Trade.GMLeft"));
}

/** A GM client that has just loaded holds no trade: every window still open here belongs to a trade it lost. Only a GM may say so. */
function handleReset(_payload, { user }={}) {
  if ( !user?.isGM ) return false;
  TradeWindow.cancelWhere(() => true, loc("Trade.GMLeft"));
  return true;
}

/* -------------------------------------------- */
/*  Chez le MJ                                  */
/* -------------------------------------------- */

/** Active GM, at load: tell the connected players that no trade survived (see `trades`). */
function announceReset() {
  if ( game.users.activeGM?.isSelf !== true ) return;
  for ( const user of game.users.filter(u => u.active && !u.isGM) ) {
    user.query(Q.reset, {}, { timeout: 10000 }).catch(err => log.warn("trade reset not delivered:", err.message));
  }
}

/**
 * Abandoned trades are cancelled, with a message to both sides (lot 0, defect 9): they used to stay in memory for ever. Looked
 * at whenever a trade is opened.
 */
async function purgeStale() {
  for ( const id of staleTrades(trades.values(), Date.now()) ) {
    const trade = trades.get(id);
    if ( !trade || executing.has(id) ) continue;
    trades.delete(id);
    await broadcast({ ...trade, cancelled: true, reason: loc("Trade.Expired") });
  }
}

/** Stores the trade as just touched. */
function keep(trade) {
  const next = { ...trade, touched: Date.now() };
  trades.set(next.id, next);
  return next;
}

/**
 * Le joueur qui tient ce personnage face à `requester` : un joueur connecté qui le **possède** (son joueur attitré
 * d'abord), jamais celui qui propose l'échange — sinon le MJ. (Vu en jeu : un joueur dont le personnage attitré est ce
 * PJ sans le posséder se retrouvait des deux côtés.)
 */
function holderOf(actor, requester) {
  const owners = game.users.filter(u => u.active && !u.isGM && (u.id !== requester.id)
    && actor.testUserPermission(u, "OWNER"));
  return owners.find(u => u.character === actor) ?? owners[0] ?? game.users.activeGM;
}

/** L'état tel qu'on l'envoie : chaque objet avec son nom et son image (l'autre joueur ne voit pas forcément la fiche). */
function publicState(trade) {
  const withInfo = side => {
    const actor = fromUuidSync(trade[side].actor, { strict: false });
    return {
      ...trade[side],
      items: trade[side].items.map(i => {
        const item = actor?.items.get(i.id);
        return { ...i, name: item?.name ?? "?", img: item?.img ?? "icons/svg/item-bag.svg" };
      })
    };
  };
  return { ...trade, a: withInfo("a"), b: withInfo("b") };
}

/** Envoie l'état aux deux joueurs (ou au MJ lui-même s'il tient un côté). */
async function broadcast(trade) {
  const state = publicState(trade);
  const users = new Set([trade.a.user, trade.b.user]);
  for ( const id of users ) {
    const user = game.users.get(id);
    if ( !user?.active ) continue;
    if ( user.isSelf ) handleState(state);
    else user.query(Q.state, state, { timeout: 10000 }).catch(err => log.warn("trade: state not delivered", err.message));
  }
}

/** Le côté que tient cet utilisateur dans cet échange (le MJ peut tenir l'un ou l'autre), ou null. */
function sideOf(trade, user) {
  if ( trade.a.user === user.id ) return "a";
  if ( trade.b.user === user.id ) return "b";
  return null;
}

function findTrade(id) {
  const trade = trades.get(id);
  if ( !trade || trade.done || trade.cancelled || executing.has(id) ) throw new Error(loc("Trade.Over"));
  return trade;
}

async function handleOpen({ from, to, item, quantity }, { user }) {
  const a = fromUuidSync(from, { strict: false });
  const b = fromUuidSync(to, { strict: false });
  if ( !a || !b ) throw new Error(loc("Refus.Introuvable"));
  if ( !a.testUserPermission(user, "OWNER") ) throw new Error(loc("Refus.PasAToi"));
  // Lot 0 (audit of 2026-11-26, defect 13): the menu only offers another player character; a crafted request could name an NPC
  // or a merchant, whose side the GM client would then have held.
  if ( (a === b) || (!user.isGM && (b.type !== "character")) ) throw new Error(loc("Trade.Impossible"));
  const holder = holderOf(b, user);
  if ( !holder ) throw new Error(loc("Trade.NobodyThere", { name: b.name }));
  await purgeStale();
  // The same two characters already trading: that trade is shown again instead of a second one.
  const open = [...trades.values()].filter(t => !t.done && !t.cancelled && (t.a.user === user.id));
  const same = open.find(t => (t.a.actor === a.uuid) && (t.b.actor === b.uuid));
  if ( same ) { await broadcast(same); return { id: same.id }; }
  if ( !user.isGM && (open.length >= TRADE_MAX_OPEN) ) throw new Error(loc("Trade.TooMany"));
  let trade = newTrade({ id: foundry.utils.randomID(), a: { actor: a.uuid, name: a.name, user: user.id },
    b: { actor: b.uuid, name: b.name, user: holder.id } });
  trade.gm = game.user.id;
  if ( item && a.items.get(item) ) trade = setOffer(trade, "a", { items: [{ id: item, quantity }] });
  trade = keep(trade);
  await broadcast(trade);
  return { id: trade.id };
}

/**
 * What this character can really give of an offer: quantities capped to what is owned, missing items and coins removed, and no
 * item stored in a bag that is itself offered (the bag leaves with its contents).
 * @returns {{ items: object[], coins: object, changed: boolean }}
 */
function possibleOffer(offer, actor) {
  const owned = Object.fromEntries(actor.items.map(i => [i.id, i.system.quantity ?? 1]));
  const clamped = clampOffer({ items: offer.items, coins: offer.coins }, owned, actor.system.currency);
  const allowed = tradable(clamped.items, Object.fromEntries(actor.items.map(i => [i.id, { type: i.type, equipped: !!i.system.equipped }])));
  const loose = withoutContained(allowed.items, Object.fromEntries(actor.items.map(i => [i.id, i.system.container ?? null])));
  return { items: loose.items, coins: clamped.coins, changed: clamped.changed || loose.changed || (allowed.left.length > 0),
    left: allowed.left.map(id => actor.items.get(id)?.name ?? id) };
}

async function handleUpdate({ id, offer }, { user }) {
  const trade = findTrade(id);
  const side = sideOf(trade, user);
  if ( !side ) throw new Error(loc("Refus.PasAToi"));
  const actor = fromUuidSync(trade[side].actor, { strict: false });
  const possible = possibleOffer({ items: offer.items ?? [], coins: offer.coins ?? {} }, actor);
  const next = keep(setOffer(trade, side, possible));
  await broadcast(next);
  return { ok: true, left: possible.left };
}

async function handleAccept({ id, value, rev }, { user }) {
  // Un second « valider » pendant l'exécution (double clic) : déjà pris en compte, l'échange ne se refait pas.
  if ( executing.has(id) ) return true;
  let trade = findTrade(id);
  const side = sideOf(trade, user);
  if ( !side ) throw new Error(loc("Refus.PasAToi"));
  // Lot 0 (audit of 2026-11-26, defect 11): an agreement names the revision of the offers it was given on. If the other side
  // changed its offer just before the click, this player would agree to something never shown: refused, and the current state is
  // sent again so the window shows what is really on the table.
  if ( value && (rev !== trade.rev) ) {
    await broadcast(trade);
    throw new Error(loc("Trade.Changed"));
  }
  trade = keep(value ? accept(trade, side) : unaccept(trade, side));
  if ( ready(trade) ) {
    // Noté avant la première attente : l'échange accepté des deux côtés reste dans `trades` tant qu'il s'exécute.
    executing.add(id);
    try { trade = await execute(trade); }
    catch(err) {
      // The exchange failed and was undone (adapter/ledger.mjs): both agreements fall, both players see the trade as it was.
      trade = unaccept(unaccept(trade, "a"), "b");
      trades.set(id, trade);
      await broadcast(trade);
      throw err;
    }
    finally { executing.delete(id); }
  }
  trades.set(id, trade);
  await broadcast(trade);
  if ( trade.done ) trades.delete(id);
  return true;
}

async function handleCancel({ id }, { user }) {
  const trade = trades.get(id);
  if ( !trade || executing.has(id) ) return true;   // en cours d'exécution : trop tard pour annuler
  if ( !sideOf(trade, user) && !user.isGM ) throw new Error(loc("Refus.PasAToi"));
  const next = { ...trade, cancelled: true, cancelledBy: user.name };
  trades.delete(id);
  await broadcast(next);
  return true;
}

/**
 * L'échange lui-même : chaque offre est confrontée à ce que le personnage possède encore — si elle a changé (un objet
 * vendu entre-temps), les validations tombent et rien ne bouge — puis les objets et les pièces passent d'un côté à l'autre.
 * Le tout dans un même tour sur les deux personnages (adapter/ledger.mjs) : rien d'autre n'écrit sur leurs fiches entre la
 * confrontation et la dernière écriture.
 */
async function execute(trade) {
  const actors = { a: fromUuidSync(trade.a.actor, { strict: false }), b: fromUuidSync(trade.b.actor, { strict: false }) };
  if ( !actors.a || !actors.b ) return { ...trade, cancelled: true };
  return inTurn([actors.a, actors.b], () => exchange(trade, actors));
}

async function exchange(trade, actors) {
  // Everything is checked before the first write (lot 0, defects 2–3): an offer that no longer holds drops both agreements.
  for ( const side of ["a", "b"] ) {
    const possible = possibleOffer(trade[side], actors[side]);
    if ( possible.changed ) return setOffer(trade, side, possible);
  }
  const coinLabel = (k, n) => `${n} ${CONFIG.DND5E.currencies[k]?.abbreviation ?? k}`;
  const plan = ["a", "b"].map(side => loc("Op.Gives", { who: trade[side].name, what: [
    ...trade[side].items.map(i => { const item = actors[side].items.get(i.id); return i.quantity > 1 ? `${item?.name} (${i.quantity})` : item?.name; }),
    ...Object.entries(trade[side].coins).map(([k, n]) => coinLabel(k, n))].join(", ") || "—" }));
  // One operation: a write that fails puts every item and coin back, and the GM reads what happened.
  const names = await operation({ label: loc("Op.Trade", { a: trade.a.name, b: trade.b.name }), plan }, async op => {
    const given = { a: [], b: [] };
    for ( const side of ["a", "b"] ) {
      const giver = actors[side];
      const taker = actors[other(side)];
      for ( const { id, quantity } of trade[side].items ) {
        const moved = await moveItemNow(giver, taker, id, quantity, { op });
        given[side].push(moved.quantity > 1 ? `${moved.name} (${moved.quantity})` : moved.name);
      }
      const coins = trade[side].coins;
      if ( Object.keys(coins).length ) {
        const minus = Object.fromEntries(COINS.map(k => [k, -(coins[k] ?? 0)]));
        await giver.update({ "system.currency": addCoins(giver.system.currency, minus) });
        op.did(loc("Op.Step.CoinsOut", { who: giver.name }), () => giver.update({ "system.currency": addCoins(giver.system.currency, coins) }));
        await taker.update({ "system.currency": addCoins(taker.system.currency, coins) });
        op.did(loc("Op.Step.CoinsIn", { who: taker.name }), () => taker.update({ "system.currency": addCoins(taker.system.currency, minus) }));
        for ( const [k, n] of Object.entries(coins) ) given[side].push(coinLabel(k, n));
      }
    }
    return given;
  });
  const users = [...new Set([trade.a.user, trade.b.user, ...game.users.filter(u => u.isGM).map(u => u.id)])];
  ChatMessage.implementation.create({
    content: `<p>${loc("Trade.Chat", { a: trade.a.name, b: trade.b.name,
      gaveA: names.a.join(", ") || "—", gaveB: names.b.join(", ") || "—" })}</p>`,
    whisper: users, flags: { [MODULE_ID]: { trade: true } }
  });
  return { ...trade, done: true };
}

export function registerTradeInit() {
  CONFIG.queries[Q.open] = handleOpen;
  CONFIG.queries[Q.update] = handleUpdate;
  CONFIG.queries[Q.accept] = handleAccept;
  CONFIG.queries[Q.cancel] = handleCancel;
  CONFIG.queries[Q.state] = handleState;
  CONFIG.queries[Q.reset] = handleReset;
}

export function registerTrade() {
  route(TOKEN_MENU_HOOK, "menu: Trade", onTokenMenu);
  route("userConnected", "trades of a GM who left", onUserConnected);
  announceReset();
}
