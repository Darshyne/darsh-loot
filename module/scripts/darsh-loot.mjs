/**
 * Butin et commerce (darsh-loot) — point d'entrée. Voir SPEC.md.
 */
import { MODULE_ID } from "./shared.mjs";
import { registerSettings } from "./runtime/settings.mjs";
import { registerTake, requestTake } from "./runtime/take.mjs";
import { registerTreasure, ensureRolled } from "./runtime/treasure.mjs";
import { registerContainersInit, registerContainers, ensureContainer, requestUnlock } from "./runtime/containers.mjs";
import { registerCorpses, openLoot } from "./runtime/corpses.mjs";
import { registerWindows, openSource, visitSource } from "./runtime/open.mjs";
import { registerPointer } from "./runtime/pointer.mjs";
import { registerZonesInit, runZone } from "./runtime/zones.mjs";
import { registerTileZone, tileToZone } from "./runtime/tile-zone.mjs";
import { registerTheft, requestSteal } from "./runtime/theft.mjs";
import { registerStolenMark } from "./runtime/stolen-mark.mjs";
import { registerNecromancyInit, registerNecromancy, requestAnimate, raisable } from "./runtime/necromancy.mjs";
import { registerDropInit, registerDrop, requestDrop, dropEnabled } from "./runtime/drop.mjs";
import { registerDropFx } from "./runtime/drop-fx.mjs";
import { registerThrow } from "./runtime/throw.mjs";
import { registerTradeInit, registerTrade, startTrade } from "./runtime/trade.mjs";
import { registerShopInit, registerShop, configureMerchant, requestDeal, requestRestock, showShop } from "./runtime/shop.mjs";
import { merchantOf, isMerchant, quote, stockView, convertItemPiles, convertAllItemPiles, memorizeStock } from "./adapter/shop.mjs";
import { listRoutes } from "./runtime/router.mjs";
import { testApi } from "./runtime/testing.mjs";
import { lootView, corpseToken } from "./adapter/dnd5e.mjs";
import { corpseSource, containerSource, pocketSource, merchantSource } from "./adapter/sources.mjs";
import { createGenericTables } from "./adapter/treasure.mjs";

const doc = token => token?.document ?? token;
/** L'acteur d'un token, d'un document de token ou d'un acteur. */
const actorOf = thing => { const d = doc(thing); return (d instanceof Actor) ? d : (d?.actor ?? null); };

Hooks.once("init", () => {
  registerSettings();
  registerTake();
  registerTreasure();
  registerContainersInit();
  registerZonesInit();
  registerTheft();
  registerNecromancyInit();
  registerDropInit();
  registerTradeInit();
  registerShopInit((source, looter) => openSource(source, looter));
});

Hooks.once("ready", () => {
  registerWindows();
  registerCorpses();
  registerContainers();
  registerPointer();
  registerTileZone();
  registerStolenMark();
  registerNecromancy();
  registerDrop();
  registerDropFx();
  registerThrow();
  registerTrade();
  registerShop({ open: openSource, visit: visitSource });
  game.modules.get(MODULE_ID).api = {
    /* ---- marchands (SPEC §3.7) ---- */
    /**
     * Ouvre la boutique d'un marchand (son token, ou l'acteur pour une boutique sans token) pour un personnage (token ou
     * acteur) ; sans personnage : l'étal seul (MJ).
     */
    shop: (token, looter=null) => openSource(merchantSource(doc(token)), doc(looter)),
    /** MJ : montrer la boutique aux joueurs connectés (elle s'ouvre chez chacun pour son personnage). */
    showShop: token => showShop(merchantSource(doc(token))),
    /** MJ : les réglages de marchand d'un PNJ (acteur ou token). */
    configureMerchant: actorOrToken => configureMerchant(doc(actorOrToken)?.actor ?? actorOrToken),
    /** MJ : fait d'un PNJ un marchand (ou le modifie) sans fenêtre — `{ enabled, buy, sell, attitude, tables… }`. */
    setMerchant: async (actorOrToken, flag={}) => {
      const actor = doc(actorOrToken)?.actor ?? actorOrToken;
      const first = !actor.getFlag(MODULE_ID, "merchant")?.purse;
      await actor.update({ [`flags.${MODULE_ID}.merchant`]: { enabled: true, ...flag } });
      if ( first ) await memorizeStock(actor);
      return merchantOf(actor);
    },
    isMerchant: actorOrToken => isMerchant(doc(actorOrToken)?.actor ?? actorOrToken),
    merchant: actorOrToken => merchantOf(doc(actorOrToken)?.actor ?? actorOrToken),
    /** L'étal tel qu'un personnage le voit, et le devis d'un panier `{ buy: [{ id, quantity }], sell: […] }`. */
    stock: (token, looter=null) => stockView(actorOf(token), actorOf(looter), { gm: game.user.isGM }),
    quote: (token, looter, cart) => quote(actorOf(token), doc(token), actorOf(looter), cart),
    /** Conclure un troc sans fenêtre (tests) : le MJ refait le devis et exécute. */
    deal: (token, looter, cart) => requestDeal(merchantSource(doc(token)), doc(looter), cart),
    /** MJ : réassortir (stock fixe à sa référence, tables retirées), noter le stock présent comme référence. */
    restock: token => requestRestock(merchantSource(doc(token))),
    memorizeStock: actorOrToken => memorizeStock(doc(actorOrToken)?.actor ?? actorOrToken),
    /** MJ : reprendre un marchand d'Item Piles (ses drapeaux restent en place). */
    convertItemPiles: actorOrToken => convertItemPiles(doc(actorOrToken)?.actor ?? actorOrToken),
    /** MJ : reprendre tous les marchands d'Item Piles du monde ; rend un bilan par marchand. `{ force: true }` : refaire. */
    convertAllItemPiles: options => (game.user.isGM ? convertAllItemPiles(options) : null),
    /** Poser au sol sans glisser : un objet du personnage, un point de la scène, une quantité (toute la pile sinon). */
    drop: (item, point, quantity) => requestDrop(item, point, quantity),
    /** Ouvrir un échange entre son personnage et un autre PJ (acteurs, ou tokens). Aussi : « Échanger » au clic droit. */
    trade: (from, to) => startTrade(from?.actor ?? from, to?.actor ?? to),
    /** Le geste « glisser un objet sur la carte » est-il actif (réglage `dropMode`) ? */
    dropEnabled: () => dropEnabled(),
    /**
     * Relever un cadavre d'humanoïde (Petit ou Moyen) : kind "skeleton" ou "zombie", caster = token du lanceur
     * (propriétaire du mort-vivant ; un joueur doit le posséder et être à 10 ft). Pour le moteur : Animation des morts,
     * Doigt de mort (SPEC §4).
     */
    animate: (corpse, { kind, caster=null }={}) => requestAnimate(doc(corpse), { kind, caster: doc(caster) }),
    raisable: token => raisable(doc(token)),
    /** Ouvre les poches d'un PNJ vivant (vol à la tire). */
    openPockets: (token, thief) => openSource(pocketSource(doc(token)), doc(thief)),
    /** Tenter un vol sans fenêtre (tests) : un id d'objet, ou "coins" pour la bourse. */
    steal: (token, thief, itemId) => requestSteal(pocketSource(doc(token)), doc(thief), itemId),
    /** Objet volé ? Renvoie le drapeau { from, fromUuid, place, time } ou null. */
    stolen: item => item?.getFlag(MODULE_ID, "stolen") ?? null,
    /** Mettre un PNJ sur ses gardes (jet de Perception au lieu de la passive), ou l'en retirer. */
    setAlert: (actorOrToken, alert=true) => {
      const actor = actorOrToken?.actor ?? actorOrToken;
      return alert ? actor.setFlag(MODULE_ID, "alert", true) : actor.unsetFlag(MODULE_ID, "alert");
    },
    /** Ouvre la fenêtre de fouille d'un token mort (TokenDocument ou Token). */
    open: (token, looter) => openLoot(doc(token), doc(looter)),
    /** Se servir d'une zone « DAS · … » (macro, scène, document) comme par un clic, pour un personnage (token) ou personne. */
    useZone: (behavior, looter=null) => runZone(behavior, doc(looter)),
    /** MJ : créer une zone de la forme d'une tuile — `{ kind: "container"|"macro"|"scene"|"document", name, system }`. */
    tileToZone: (tile, options) => tileToZone(doc(tile), { openSheet: false, ...options }),
    /** Ouvre un conteneur (le comportement de région « Conteneur »). */
    openContainer: (behavior, looter) => openSource(containerSource(behavior), doc(looter)),
    /** Ce qu'un token mort ou un coffre (acteur) porte, tel que la fenêtre le montre. */
    view: tokenOrActor => lootView(doc(tokenOrActor)?.actor ?? tokenOrActor),
    isCorpse: token => corpseToken(doc(token)),
    /** Prendre sans fenêtre (tests) : { itemIds, coins }. */
    take: (corpse, looter, what) => requestTake(corpseSource(doc(corpse)), doc(looter), what),
    takeFromContainer: (behavior, looter, what) => requestTake(containerSource(behavior), doc(looter), what),
    /** Déverrouiller : "key", "pick" (test d'outils de voleur du joueur), "gm". */
    unlock: (behavior, looter, method) => requestUnlock(containerSource(behavior), doc(looter), method),
    /** Tirer le trésor d'un cadavre, ou préparer un conteneur, maintenant (sinon à la première ouverture). */
    roll: token => ensureRolled(doc(token)),
    prepareContainer: behavior => ensureContainer(behavior),
    /** MJ : créer dans le monde les tables génériques de conteneurs (coffre, tonneau, caisse…), sans doublon. */
    createTables: () => createGenericTables(),
    /**
     * Donner à un PNJ sa propre table de butin, tirée en plus de son trésor (UUID d'une RollTable ; null pour l'ôter).
     * Résultats : objet lié, lien @UUID d'objet dans le texte (tables d'objets magiques du DMG), sinon objet « butin ».
     */
    setTable: (actorOrToken, uuid) => {
      const actor = actorOrToken?.actor ?? actorOrToken;
      return uuid ? actor.setFlag(MODULE_ID, "table", uuid) : actor.unsetFlag(MODULE_ID, "table");
    },
    routes: listRoutes,
    /** Fonctions de test pour le connecteur MCP (`call-module-api`, monde de test seulement). */
    mcp: testApi
  };
});
