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
import { moveItem } from "../adapter/drop.mjs";
import { addCoins, COINS } from "../core/loot.mjs";
import { newTrade, setOffer, accept, unaccept, ready, clampOffer, other } from "../core/trade.mjs";
import { TradeWindow } from "../apps/trade-window.mjs";

const Q = {
  open: `${MODULE_ID}.tradeOpen`,
  update: `${MODULE_ID}.tradeUpdate`,
  accept: `${MODULE_ID}.tradeAccept`,
  cancel: `${MODULE_ID}.tradeCancel`,
  state: `${MODULE_ID}.tradeState`
};

/** Les échanges en cours, chez le MJ actif. */
const trades = new Map();

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
  update: (id, offer) => askGM(Q.update, handleUpdate, { id, offer }),
  accept: (id, value) => askGM(Q.accept, handleAccept, { id, value }),
  cancel: id => askGM(Q.cancel, handleCancel, { id })
};

/** Chez chacun des deux : l'état arrive, la fenêtre s'ouvre ou se redessine. */
function handleState(trade) {
  try {
    TradeWindow.show(trade, tradeActions);
  } catch(err) {
    // Sans ceci, l'erreur ne remontait qu'au MJ, en simple avertissement : rien ne s'ouvrait, sans rien dire.
    log.error("fenêtre d'échange", err);
    ui.notifications.error(loc("Trade.WindowFailed", { reason: err.message }));
    throw err;
  }
  return true;
}

/* -------------------------------------------- */
/*  Chez le MJ                                  */
/* -------------------------------------------- */

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
    else user.query(Q.state, state, { timeout: 10000 }).catch(err => log.warn("échange : état non remis", err.message));
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
  if ( !trade || trade.done || trade.cancelled ) throw new Error(loc("Trade.Over"));
  return trade;
}

async function handleOpen({ from, to, item, quantity }, { user }) {
  const a = fromUuidSync(from, { strict: false });
  const b = fromUuidSync(to, { strict: false });
  if ( !a || !b ) throw new Error(loc("Refus.Introuvable"));
  if ( !a.testUserPermission(user, "OWNER") ) throw new Error(loc("Refus.PasAToi"));
  const holder = holderOf(b, user);
  if ( !holder ) throw new Error(loc("Trade.NobodyThere", { name: b.name }));
  let trade = newTrade({ id: foundry.utils.randomID(), a: { actor: a.uuid, name: a.name, user: user.id },
    b: { actor: b.uuid, name: b.name, user: holder.id } });
  if ( item && a.items.get(item) ) trade = setOffer(trade, "a", { items: [{ id: item, quantity }] });
  trades.set(trade.id, trade);
  await broadcast(trade);
  return { id: trade.id };
}

async function handleUpdate({ id, offer }, { user }) {
  const trade = findTrade(id);
  const side = sideOf(trade, user);
  if ( !side ) throw new Error(loc("Refus.PasAToi"));
  const actor = fromUuidSync(trade[side].actor, { strict: false });
  const owned = Object.fromEntries(actor.items.map(i => [i.id, i.system.quantity ?? 1]));
  const clamped = clampOffer({ items: offer.items ?? [], coins: offer.coins ?? {} }, owned, actor.system.currency);
  const next = setOffer(trade, side, clamped);
  trades.set(id, next);
  await broadcast(next);
  return true;
}

async function handleAccept({ id, value }, { user }) {
  let trade = findTrade(id);
  const side = sideOf(trade, user);
  if ( !side ) throw new Error(loc("Refus.PasAToi"));
  trade = value ? accept(trade, side) : unaccept(trade, side);
  trades.set(id, trade);
  if ( ready(trade) ) trade = await execute(trade);
  trades.set(id, trade);
  await broadcast(trade);
  if ( trade.done ) trades.delete(id);
  return true;
}

async function handleCancel({ id }, { user }) {
  const trade = trades.get(id);
  if ( !trade ) return true;
  if ( !sideOf(trade, user) && !user.isGM ) throw new Error(loc("Refus.PasAToi"));
  const next = { ...trade, cancelled: true, cancelledBy: user.name };
  trades.delete(id);
  await broadcast(next);
  return true;
}

/**
 * L'échange lui-même : chaque offre est confrontée à ce que le personnage possède encore — si elle a changé (un objet
 * vendu entre-temps), les validations tombent et rien ne bouge — puis les objets et les pièces passent d'un côté à l'autre.
 */
async function execute(trade) {
  const actors = { a: fromUuidSync(trade.a.actor, { strict: false }), b: fromUuidSync(trade.b.actor, { strict: false }) };
  if ( !actors.a || !actors.b ) return { ...trade, cancelled: true };
  for ( const side of ["a", "b"] ) {
    const owned = Object.fromEntries(actors[side].items.map(i => [i.id, i.system.quantity ?? 1]));
    const clamped = clampOffer(trade[side], owned, actors[side].system.currency);
    if ( clamped.changed ) return setOffer(trade, side, clamped);   // validations retirées
  }
  const names = { a: [], b: [] };
  for ( const side of ["a", "b"] ) {
    const giver = actors[side];
    const taker = actors[other(side)];
    for ( const { id, quantity } of trade[side].items ) {
      const moved = await moveItem(giver, taker, id, quantity);
      names[side].push(moved.quantity > 1 ? `${moved.name} (${moved.quantity})` : moved.name);
    }
    const coins = trade[side].coins;
    if ( Object.keys(coins).length ) {
      const minus = Object.fromEntries(COINS.map(k => [k, -(coins[k] ?? 0)]));
      await giver.update({ "system.currency": addCoins(giver.system.currency, minus) });
      await taker.update({ "system.currency": addCoins(taker.system.currency, coins) });
      for ( const [k, n] of Object.entries(coins) ) names[side].push(`${n} ${CONFIG.DND5E.currencies[k]?.abbreviation ?? k}`);
    }
  }
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
}

export function registerTrade() {
  route(TOKEN_MENU_HOOK, "menu : Échanger", onTokenMenu);
}
