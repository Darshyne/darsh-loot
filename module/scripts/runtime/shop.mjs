/**
 * Marchands (SPEC §3.7, étape 8) : le troc demandé par un joueur est refait et exécuté par le MJ actif (le joueur n'a
 * aucun droit sur le marchand) ; réassort, réglages et drapeaux d'étal sont au MJ. Entrées : clic sur le marchand hors
 * combat (runtime/pointer.mjs), « Commercer » dans le menu contextuel du moteur, bouton du HUD de token (MJ).
 */
import { MODULE_ID, loc, setting, log } from "../shared.mjs";
import { route } from "./router.mjs";
import { askGM, sourceRef } from "./take.mjs";
import { resolveSource, merchantSource } from "../adapter/sources.mjs";
import { TOKEN_MENU_HOOK } from "../adapter/engine.mjs";
import {
  merchantOf, merchantToken, isMerchant, quote, executeDeal, restock, memorizeStock, convertItemPiles, formatPrice
} from "../adapter/shop.mjs";
import { MerchantConfig } from "../apps/merchant-config.mjs";

const DEAL_QUERY = `${MODULE_ID}.shopDeal`;
const SHOW_QUERY = `${MODULE_ID}.shopShow`;

/** Le personnage derrière ce qui agit : un token, ou l'acteur lui-même (boutique sans token). */
const actorOf = looter => ((looter instanceof Actor) ? looter : (looter?.actor ?? null));

/* -------------------------------------------- */
/*  Côté joueur                                 */
/* -------------------------------------------- */

/** Conclure : le panier part au MJ. Rend le bilan, ou null (refus dit au joueur). */
export function requestDeal(source, looter, cart) {
  return askGM(DEAL_QUERY, handleDeal, { source: sourceRef(source), looter: looter.uuid, buy: cart.buy ?? [], sell: cart.sell ?? [] });
}

/* -------------------------------------------- */
/*  Chez le MJ                                  */
/* -------------------------------------------- */

/** Trocs en cours par marchand : deux joueurs qui concluent en même temps passent l'un après l'autre. */
const busy = new Map();

async function handleDeal(payload, { user }) {
  const source = resolveSource(payload.source);
  const looter = fromUuidSync(payload.looter, { strict: false });
  const buyer = actorOf(looter);
  if ( !source || (source.kind !== "merchant") || !source.exists() || !buyer ) throw new Error(loc("Shop.Gone"));
  if ( !buyer.testUserPermission(user, "OWNER") ) throw new Error(loc("Refus.PasAToi"));
  if ( buyer === source.actor ) throw new Error(loc("Refus.PasAToi"));
  if ( !user.isGM ) {
    if ( merchantOf(source.actor).closed ) throw new Error(loc("Shop.Closed"));
    if ( source.distance(looter) > setting("reach") ) throw new Error(loc("Shop.TooFar"));
  }
  const previous = busy.get(source.uuid) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(() => deal(source, looter, payload));
  busy.set(source.uuid, run);
  try { return await run; }
  finally { if ( busy.get(source.uuid) === run ) busy.delete(source.uuid); }
}

async function deal(source, looter, payload) {
  const actor = source.actor;
  const buyer = actorOf(looter);
  const q = quote(actor, source.doc, buyer, { buy: payload.buy, sell: payload.sell });
  // Le devis du MJ fait foi : un stock ou un inventaire qui a bougé depuis le panier du joueur annule le troc.
  if ( q.changed ) throw new Error(loc("Shop.Changed"));
  if ( q.empty ) throw new Error(loc("Shop.Nothing"));
  if ( !q.ok ) throw new Error(loc(q.reason === "playerFunds" ? "Shop.NoFunds" : "Shop.MerchantNoFunds"));
  const names = await executeDeal(actor, buyer, q);
  log.info(`troc : ${buyer.name} chez ${actor.name} — achète [${names.bought.join(", ")}], vend [${names.sold.join(", ")}], solde ${q.net} pc`);
  announceDeal(looter, source, names, q);
  return { bought: names.bought, sold: names.sold, net: q.net };
}

/** Le bilan d'un troc, au MJ ou à tous (réglage `announce`). */
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
/*  MJ : réglages, stock                        */
/* -------------------------------------------- */

const gmOnly = () => {
  if ( game.user.isGM ) return true;
  ui.notifications.warn(loc("Refus.MJSeul"));
  return false;
};

/** Réassortir ce marchand (MJ). */
export async function requestRestock(source) {
  if ( !gmOnly() ) return null;
  const result = await restock(source.actor);
  ui.notifications.info(loc("Shop.Restocked", { name: source.name, count: result.drawn.length }));
  return result;
}

/** Les actions de la fenêtre de réglages. */
const CONFIG_ACTIONS = {
  /** Enregistre le drapeau ; la première activation note le stock présent comme référence du réassort. */
  save: async (actor, flag) => {
    if ( !gmOnly() ) return;
    const first = flag.enabled && !actor.getFlag(MODULE_ID, "merchant")?.purse;
    await actor.update({ [`flags.${MODULE_ID}.merchant`]: flag });
    if ( first ) await memorizeStock(actor);
  },
  memorize: actor => (gmOnly() ? memorizeStock(actor) : 0),
  convert: actor => (gmOnly() ? convertItemPiles(actor) : null)
};

/** Ouvre les réglages de marchand de cet acteur (MJ). */
export function configureMerchant(actor) {
  if ( !gmOnly() ) return null;
  return MerchantConfig.show(actor, CONFIG_ACTIONS);
}

/** MJ : pose les drapeaux d'étal d'un objet (caché, pas à vendre). */
function flagItem(item, shop) {
  if ( !gmOnly() ) return null;
  return item.update({ [`flags.${MODULE_ID}.shop`]: shop });
}

/**
 * MJ : montrer la boutique aux joueurs connectés — elle s'ouvre chez chacun pour son personnage (son token sur la scène,
 * sinon son personnage attitré). Sert surtout aux boutiques **sans token** (un marchand de Vallaki joué sans carte).
 */
export async function showShop(source) {
  if ( !gmOnly() ) return 0;
  const players = game.users.filter(u => u.active && !u.isGM);
  for ( const user of players ) {
    user.query(SHOW_QUERY, { source: sourceRef(source) }, { timeout: 10000 }).catch(err => log.warn("boutique non montrée :", err.message));
  }
  ui.notifications.info(loc("Shop.Shown", { name: source.name, count: players.length }));
  return players.length;
}

/** Ce que la boutique reçoit pour agir (apps/shop-window.mjs). */
export const SHOP_ACTIONS = { deal: requestDeal, restock: requestRestock, configure: configureMerchant, flag: flagItem, show: showShop };

/* -------------------------------------------- */
/*  Entrées                                     */
/* -------------------------------------------- */

/**
 * « Commercer » dans le menu contextuel d'un marchand (menu du moteur), pour le personnage en main — MJ compris, qui
 * commerce alors au nom du token qu'il a sélectionné. `visit` : ouvrir la boutique en y allant d'abord (runtime/open.mjs).
 */
function tokenMenu(visit) {
  return (entries, { token, target }) => {
    if ( !token?.actor || !merchantToken(target) || (target === token) || game.combat?.started ) return;
    entries.push({ icon: "fa-solid fa-store", label: loc("Shop.Menu"), run: () => visit(merchantSource(target), token) });
  };
}

/** MJ : bouton du HUD d'un PNJ — sa boutique s'il est marchand, sinon les réglages pour en faire un. */
function hudButton(open) {
  return (hud, html) => {
    const tokenDoc = hud.document;
    if ( !game.user.isGM || (tokenDoc?.actor?.type !== "npc") ) return;
    const column = html.querySelector(".col.left");
    if ( !column || column.querySelector(".dlo-hud-shop") ) return;
    const merchant = isMerchant(tokenDoc.actor);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "control-icon dlo-hud dlo-hud-shop";
    button.dataset.tooltip = loc(merchant ? "Shop.HudOpen" : "Shop.HudMake");
    button.innerHTML = `<i class="fa-solid fa-store"></i>`;
    // Le MJ ouvre l'étal sans personnage (gestion) ; pour commercer au nom d'un PJ : « Commercer » au clic droit.
    button.addEventListener("click", () => (merchant ? open(merchantSource(tokenDoc), null) : configureMerchant(tokenDoc.actor)));
    column.append(button);
  };
}

/**
 * MJ : dans la barre latérale des acteurs, clic droit sur un PNJ — « Ouvrir la boutique » (un marchand, même sans token)
 * et « Réglages de marchand ». Hook du cœur V14 : `getActorContextOptions` (client/applications/sidebar/
 * document-directory.mjs:224), entrées `{ label, icon, visible(li), onClick(event, li) }`.
 */
function directoryMenu(open) {
  return (app, options) => {
    const actorOfEntry = li => game.actors.get(li.closest("[data-entry-id]")?.dataset.entryId);
    options.push({
      label: "DLO.Shop.HudOpen", icon: "fa-solid fa-store",
      visible: li => game.user.isGM && isMerchant(actorOfEntry(li)),
      onClick: (event, li) => open(merchantSource(actorOfEntry(li)), null)
    }, {
      label: "DLO.Merchant.Menu", icon: "fa-solid fa-gear",
      visible: li => game.user.isGM && (actorOfEntry(li)?.type === "npc"),
      onClick: (event, li) => configureMerchant(actorOfEntry(li))
    });
  };
}

/**
 * @param {Function} open  Ouvrir une source (`open(source, looter)`) : chez un joueur à qui le MJ montre une boutique, pour
 *   son token sur la scène, sinon son personnage attitré.
 */
export function registerShopInit(open) {
  CONFIG.queries[DEAL_QUERY] = handleDeal;
  CONFIG.queries[SHOW_QUERY] = ({ source: ref }) => {
    const source = resolveSource(ref);
    if ( !source?.exists() ) return false;
    // Son token sélectionné, sinon celui de son personnage attitré, sinon un de ses personnages sur la scène ; à défaut de
    // token, le personnage lui-même (attitré, sinon le premier qu'il possède).
    const mine = canvas.tokens?.controlled.find(t => t.document.isOwner)?.document
      ?? canvas.scene?.tokens.find(t => t.actorId === game.user.character?.id)
      ?? canvas.scene?.tokens.find(t => t.isOwner && (t.actor?.type === "character"))
      ?? game.user.character ?? game.actors.find(a => (a.type === "character") && a.isOwner) ?? null;
    open(source, mine);
    return true;
  };
}

/**
 * @param {{ open: Function, visit: Function }} ways  Ouvrir une source (`open(source, looter)`), y aller puis l'ouvrir
 *   (`visit(source, looter)`) — passés par le point d'entrée : runtime/open.mjs connaît déjà ce fichier.
 */
export function registerShop({ open, visit }) {
  route(TOKEN_MENU_HOOK, "menu : Commercer", tokenMenu(visit));
  route("renderTokenHUD", "bouton Boutique", hudButton(open));
  route("getActorContextOptions", "barre latérale : Boutique", directoryMenu(open));
}
