/**
 * Vol à la tire (SPEC §3.3). Le joueur lance son test d'Escamotage (dés visibles, sans dialogue) ; le MJ calcule le DD
 * (Perception passive de la victime, ou son jet si elle est sur ses gardes, majorée par la valeur et le poids — le DD
 * exact n'est jamais montré), tranche, déplace l'objet marqué volé, ou fait repérer le voleur.
 * Hors combat, au contact (réglage de portée), un seul essai par objet et par voleur.
 *
 * 0.21.0 (issue #5) : réglage `pickpocket` (activé / coupé / accord du MJ), entrée visible en combat avec sa raison, et le vol par un
 * PNJ du MJ sur un personnage (`npcSteal`, jet caché, réussite secrète, échec vu et entendu de tous).
 */
import { MODULE_ID, loc, setting, sceneSetting, log } from "../shared.mjs";
import { route } from "./router.mjs";
import { TOKEN_MENU_HOOK } from "../adapter/engine.mjs";
import { pocketSource, victimSource } from "../adapter/sources.mjs";
import { askGM, checkAccess, sourceRef, announce } from "./take.mjs";
import { ensureRolled } from "./treasure.mjs";
import { transfer } from "../adapter/dnd5e.mjs";
import { livingNPC, livingPC, stealDC, triedBy, victimView, victimDC, moveCoins } from "../adapter/theft.mjs";
import { stolenFlag, pickpocketMode, stealMenuState, purseHandful, pickRandom } from "../core/theft.mjs";
import { coinsOf } from "../core/loot.mjs";
import { feedbackCard, SOUNDS } from "./feedback.mjs";
import { landingSound } from "./drop-fx.mjs";
import { engineNotice } from "../adapter/engine.mjs";
import { waitForDice, newRollMessage, showDiceLocally } from "../adapter/dice.mjs";
import { canApproach, approachSource } from "./approach.mjs";
import { NpcStealWindow } from "../apps/npc-steal-window.mjs";

const STEAL_QUERY = `${MODULE_ID}.steal`;
const APPROVAL_QUERY = `${MODULE_ID}.stealApproval`;
/** Le MJ a une minute pour répondre ; un accord vaut dix minutes pour ce voleur et cette victime. */
const APPROVAL_MS = 60000;
const APPROVAL_VALID_MS = 10 * 60000;
const escape = s => foundry.utils.escapeHTML(String(s ?? ""));
const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);

/** Accords du MJ en cours (chez le MJ actif, en mémoire) : `voleur|victime` → fin de validité. */
const approvals = new Map();
const approvalKey = (thiefActorId, victimUuid) => `${thiefActorId}|${victimUuid}`;
function approved(thiefActorId, victimUuid) {
  const until = approvals.get(approvalKey(thiefActorId, victimUuid));
  return !!until && (until > Date.now());
}

/** Un refus du menu : notification et texte flottant au-dessus de son token (chez soi). */
function refuse(token, text) {
  ui.notifications.warn(text);
  engineNotice(token, text, "refused");
  return null;
}

/**
 * Tenter de voler un objet (ou la bourse, `"coins"`) dans les poches de la source.
 * @returns {Promise<{ ok: boolean }|null>}
 */
export async function requestSteal(source, thief, itemId) {
  if ( game.combat?.started ) return ui.notifications.warn(loc("Steal.InCombat"));
  // 0.21.0 : coupé, le joueur ne lance même pas son dé (le MJ refuserait de toute façon).
  if ( !game.user.isGM && (pickpocketMode(setting("pickpocket")) === "off") ) return ui.notifications.warn(loc("Steal.Disabled"));
  const known = new Set(game.messages.keys());
  const rolls = await thief.actor.rollSkill({ skill: "slt" }, { configure: false });
  const total = rolls?.[0]?.total;
  if ( total === undefined ) return null;
  // 0.17.2 (règles DAS du 2026-10-27) : le verdict n'arrive qu'après la fin des dés 3D.
  await waitForDice(newRollMessage(known));
  const result = await askGM(STEAL_QUERY, handleSteal, { source: sourceRef(source), looter: thief.uuid, itemId, total });
  // Réussi : discret par nature — le voleur seul voit et entend (le MJ a le message de `announce`). Raté : chez tous (`caught`).
  if ( result?.ok === true ) {
    ui.notifications.info(loc("Steal.Success"));
    engineNotice(thief, loc("Steal.FloatStolen"), "gain");
    landingSound("coins");
  }
  else if ( result?.ok === false ) ui.notifications.warn(loc("Steal.Caught", { name: source.name }));
  return result;
}

async function handleSteal(payload, { user }) {
  const { source, looter } = checkAccess(payload, user);
  const victim = source.doc;
  if ( (source.kind !== "pocket") || !livingNPC(victim) ) throw new Error(loc("Refus.Introuvable"));
  if ( game.combat?.started ) throw new Error(loc("Steal.InCombat"));
  // 0.21.0 (issue #5) : le réglage se vérifie chez le MJ — un joueur ne passe pas outre par une macro.
  if ( !user.isGM ) {
    const mode = pickpocketMode(setting("pickpocket"));
    if ( mode === "off" ) throw new Error(loc("Steal.Disabled"));
    if ( (mode === "approval") && !approved(looter.actor.id, victim.uuid) ) throw new Error(loc("Steal.NeedApproval"));
  }
  const actor = victim.actor;
  const thiefId = looter.actor.id;
  const tried = triedBy(actor, thiefId);
  if ( tried.has(payload.itemId) ) throw new Error(loc("Steal.AlreadyTried"));
  const dc = await stealDC(actor, payload.itemId);
  if ( dc === null ) throw new Error(loc("Steal.Impossible"));

  await actor.setFlag(MODULE_ID, `tried.${thiefId}`, [...tried, payload.itemId]);
  const ok = Number(payload.total) >= dc;
  if ( ok ) {
    const stolen = stolenFlag({ from: victim.name, fromUuid: actor.uuid, place: victim.parent?.name, time: game.time.worldTime });
    const what = (payload.itemId === "coins") ? { coins: true } : { itemIds: [payload.itemId], stolen };
    const taken = await transfer(actor, looter.actor, what);
    announce(looter, source, taken, true);
  } else {
    await caught(victim, looter, payload.total, dc);
  }
  return { ok };
}

/** Raté : la victime s'en aperçoit — elle devient méfiante, le MJ est prévenu, et, selon le réglage, elle devient hostile. */
async function caught(victim, thief, total, dc) {
  await victim.actor.setFlag(MODULE_ID, "alert", true);
  // 0.17.2 (règles DAS du 2026-10-27) : le vol raté se voit et s'entend chez tous.
  await feedbackCard(thief, loc("Steal.CaughtCard", { thief: thief.name, victim: victim.name }), { kind: "refused", icon: "fa-solid fa-hand",
    sound: SOUNDS.failure, float: loc("Steal.FloatCaught") });
  if ( setting("theftHostile") ) await victim.update({ disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE });
  ChatMessage.implementation.create({
    content: `<p>${loc("Chat.Caught", { thief: thief.name, victim: victim.name, total, dc })}</p>`,
    whisper: gmIds(),
    speaker: ChatMessage.implementation.getSpeaker({ token: victim }),
    flags: { [MODULE_ID]: { caught: true } }
  });
}

/* ---- accord du MJ (réglage « Accord du MJ ») ---- */

/** Chez le MJ : une fenêtre Accepter / Refuser, refusée d'elle-même au bout d'une minute. Rend true si le MJ accepte. */
function askApproval(text) {
  return new Promise(resolve => {
    let done = false;
    let timer = null;
    const finish = v => { if ( done ) return; done = true; clearTimeout(timer); resolve(v); };
    const dialog = new foundry.applications.api.DialogV2({
      window: { title: loc("Steal.ApprovalTitle"), icon: "fa-solid fa-hand" },
      content: `<p>${escape(text)}</p>`,
      buttons: [
        { action: "yes", label: loc("Steal.ApprovalYes"), icon: "fa-solid fa-check", callback: () => true },
        { action: "no", label: loc("Steal.ApprovalNo"), icon: "fa-solid fa-xmark", default: true, callback: () => false }
      ],
      submit: result => finish(result === true)
    });
    dialog.addEventListener?.("close", () => finish(false));
    timer = setTimeout(() => { finish(false); dialog.close().catch(() => {}); }, APPROVAL_MS);
    foundry.audio.AudioHelper.play({ src: SOUNDS.discover, volume: 0.8, loop: false }, false)?.catch?.(() => {});
    dialog.render({ force: true });
  });
}

async function handleApproval(payload, { user }) {
  const source = checkSourceForApproval(payload, user);
  const thief = fromUuidSync(payload.looter, { strict: false });
  if ( user.isGM || (pickpocketMode(setting("pickpocket")) !== "approval") ) return { ok: true };
  const ok = await askApproval(loc("Steal.ApprovalAsk", { user: user.name, thief: thief.name, victim: source.doc.name }));
  if ( ok ) approvals.set(approvalKey(thief.actor.id, source.doc.uuid), Date.now() + APPROVAL_VALID_MS);
  return { ok };
}

/** Les contrôles d'une demande d'accord : un PNJ vivant, un personnage du joueur, le réglage pas coupé (la distance viendra après). */
function checkSourceForApproval({ source: ref, looter: looterUuid }, user) {
  const thief = fromUuidSync(looterUuid, { strict: false });
  const victim = fromUuidSync(ref?.uuid, { strict: false });
  if ( !thief?.actor || (ref?.kind !== "pocket") || (victim?.documentName !== "Token") || !livingNPC(victim) ) {
    throw new Error(loc("Refus.Introuvable"));
  }
  if ( !thief.actor.testUserPermission(user, "OWNER") ) throw new Error(loc("Refus.PasAToi"));
  if ( !user.isGM && (pickpocketMode(setting("pickpocket")) === "off") ) throw new Error(loc("Steal.Disabled"));
  return pocketSource(victim);
}

/** Le joueur choisit « Voler » : accord du MJ s'il le faut, puis y aller et ouvrir les poches. */
async function startPickpocket(target, token, visit) {
  const source = pocketSource(target);
  if ( !game.user.isGM && (pickpocketMode(setting("pickpocket")) === "approval") ) {
    ui.notifications.info(loc("Steal.ApprovalWait"));
    const answer = await askGM(APPROVAL_QUERY, handleApproval, { source: sourceRef(source), looter: token.uuid }, { timeout: APPROVAL_MS + 15000 });
    if ( !answer ) return null;
    if ( !answer.ok ) return refuse(token, loc("Steal.ApprovalRefused"));
  }
  return visit(source, token);
}

/** Avant d'ouvrir la fenêtre des poches : le trésor de la victime (pièces, poches) est tiré, comme à sa mort. */
export function preparePocket(source) {
  return ensureRolled(source.doc);
}

/* ---- 0.21.0 (issue #5) : un PNJ vole un personnage ---- */

/** Un refus de `npcSteal` : avertissement (jamais une erreur : les scénarios comptent les erreurs de console). */
function npcRefusal(reason) {
  log.warn("npcSteal refused:", reason);
  ui.notifications.warn(reason);
  return { ok: null, reason };
}

/**
 * MJ : un PNJ tente de voler un personnage. Escamotage du PNJ en jet secret (aucun message de jet ; les dés 3D chez le MJ seul), contre la Perception passive du
 * personnage majorée par la valeur et le poids de l'objet (core/theft.mjs). Réussite : l'objet passe au PNJ marqué volé (la bourse : une
 * poignée, 1d4 × 10 % de chaque pièce), le MJ seul est prévenu (le joueur aussi avec le réglage `npcTheftNotice`). Échec : carte, texte
 * flottant au-dessus des deux tokens, ping et son, chez tous. Un seul essai par objet et par voleur.
 * Prévue pour être appelée aussi par un module voisin (une IA de PNJ) : `allowCombat` pour un vol en combat, `total` pour un jet déjà fait.
 * @param {{ thief: TokenDocument, victim: TokenDocument, itemId?: string, allowCombat?: boolean, total?: number, silent?: boolean }} options
 *   itemId : id d'un objet du personnage, "coins" pour la bourse, "random" (défaut) pour un objet possible au hasard.
 * @returns {Promise<{ ok: boolean|null, itemId?: string, dc?: number, total?: number, what?: string[], reason?: string }>}
 */
export async function npcSteal({ thief, victim, itemId="random", allowCombat=false, total=null }={}) {
  if ( !game.user.isGM ) return npcRefusal(loc("Refus.MJSeul"));
  if ( !thief?.actor || !victim?.actor || !livingNPC(thief) || !livingPC(victim) ) return npcRefusal(loc("Refus.Introuvable"));
  if ( !allowCombat && game.combat?.started ) return npcRefusal(loc("Steal.InCombat"));
  const source = victimSource(victim);
  if ( source.distance(thief) > sceneSetting("reach", thief.parent) ) return npcRefusal(loc("Refus.Loin"));
  const actor = victim.actor;
  const view = victimView(actor, thief.actor.id);
  const all = [...(view.purse ? [view.purse] : []), ...view.entries];
  if ( itemId === "random" ) itemId = pickRandom(all);
  if ( !itemId ) return npcRefusal(loc("Steal.NothingLeft"));
  const entry = all.find(e => e.id === itemId);
  if ( !entry ) return npcRefusal(loc("Refus.Introuvable"));
  if ( !entry.possible ) return npcRefusal(loc("Steal.Impossible"));
  if ( entry.tried ) return npcRefusal(loc("Steal.AlreadyTriedNpc"));

  let handful = null;
  if ( itemId === "coins" ) {
    const percent = 10 * (await new Roll("1d4").evaluate({ allowInteractive: false })).total;
    handful = purseHandful(actor.system.currency, percent);
    // Quelques pièces seulement : la poignée en prend une de la première sorte présente.
    if ( !Object.keys(handful).length ) {
      const first = coinsOf(actor.system.currency)[0];
      if ( first ) handful = { [first.key]: 1 };
    }
  }
  const dc = victimDC(actor, itemId, handful);
  if ( dc === null ) return npcRefusal(loc("Steal.Impossible"));

  if ( total === null ) {
    // Jet secret sans message (un jet « MJ seul » se voit quand même chez les joueurs, masqué) : le total va dans le bilan du MJ.
    const rolls = await thief.actor.rollSkill({ skill: "slt" }, { configure: false }, { create: false });
    total = rolls?.[0]?.total;
    if ( total === undefined ) return { ok: null, reason: "no roll" };
    // Règle DAS : le verdict attend la fin des dés 3D, qui roulent chez le MJ seul.
    await showDiceLocally(rolls[0]);
  }
  total = Number(total);
  const thiefId = thief.actor.id;
  await actor.setFlag(MODULE_ID, `tried.${thiefId}`, [...triedBy(actor, thiefId), itemId]);
  const ok = total >= dc;
  const speaker = ChatMessage.implementation.getSpeaker({ token: thief });
  if ( !ok ) {
    await feedbackCard(thief, loc("Steal.NpcCaughtCard", { thief: thief.name, victim: victim.name }), { kind: "refused", icon: "fa-solid fa-hand",
      sound: SOUNDS.failure, float: loc("Steal.FloatCaught"), ping: true,
      also: [{ token: victim, text: loc("Steal.FloatNoticed"), kind: "prompt" }] });
    ChatMessage.implementation.create({ whisper: gmIds(), speaker, flags: { [MODULE_ID]: { caught: true } },
      content: `<p>${escape(loc("Chat.NpcCaught", { thief: thief.name, victim: victim.name, what: entry.id === "coins" ? loc("Steal.Purse") : entry.name, total, dc }))}</p>` });
    return { ok, itemId, dc, total, what: [] };
  }

  let what;
  if ( itemId === "coins" ) {
    const moved = await moveCoins(actor, thief.actor, handful);
    what = moved.map(c => `${c.value} ${CONFIG.DND5E.currencies[c.key]?.abbreviation ?? c.key}`);
  } else {
    const stolen = stolenFlag({ from: victim.name, fromUuid: actor.uuid, place: victim.parent?.name, time: game.time.worldTime });
    what = (await transfer(actor, thief.actor, { itemIds: [itemId], stolen })).names;
  }
  // Réussi : discret. Le MJ seul entend les pièces et lit le bilan ; le joueur ne l'apprend qu'avec le réglage.
  landingSound("coins");
  ChatMessage.implementation.create({ whisper: gmIds(), speaker, flags: { [MODULE_ID]: { npcStole: true } },
    content: `<p>${escape(loc("Chat.NpcStole", { thief: thief.name, victim: victim.name, what: what.join(", "), total, dc }))}</p>` });
  if ( setting("npcTheftNotice") ) {
    const owners = game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.id);
    if ( owners.length ) ChatMessage.implementation.create({ whisper: [...owners, ...gmIds()],
      speaker: ChatMessage.implementation.getSpeaker({ token: victim }),
      content: `<p><i class="fa-solid fa-hand"></i> ${escape(loc("Steal.NoticeVictim", { what: what.join(", ") }))}</p>` });
  }
  return { ok, itemId, dc, total, what };
}

/** MJ : y aller avec le PNJ s'il est trop loin, puis ouvrir les poches du personnage (fenêtre du MJ, DD exacts). */
export async function visitVictim(victim, thief) {
  const source = victimSource(victim);
  if ( canApproach() && (source.distance(thief) > sceneSetting("reach", thief.parent)) ) await approachSource(source, thief);
  return NpcStealWindow.show(source, thief, (src, npc, itemId) => npcSteal({ thief: npc, victim: src.doc, itemId }));
}

export function registerTheft() {
  CONFIG.queries[STEAL_QUERY] = handleSteal;
  CONFIG.queries[APPROVAL_QUERY] = handleApproval;
}

/**
 * Le menu contextuel (menu du moteur, hook `tokenMenu`) :
 *  - joueur : « Voler » sur un PNJ vivant qu'on ne possède pas, pour le personnage en main — décision utilisateur du 2026-10-06 : le
 *    vol quitte Alt + clic, Alt étant la touche de surbrillance (§3.12) et celle d'avantage de l'attaque au clic du moteur. `visit` : y
 *    aller d'abord si l'on est trop loin, puis ouvrir les poches (runtime/open.mjs) ;
 *  - MJ (0.21.0) : « Voler à … » sur un personnage, quand le token en main est un PNJ vivant.
 * En combat, l'entrée reste visible avec sa raison (issue #5 : un joueur ne la trouvait pas) ; réglage coupé : pas d'entrée joueur.
 */
export function registerTheftMenu(visit) {
  route(TOKEN_MENU_HOOK, "menu: Pickpocket", (entries, { token, target }) => {
    if ( !token?.actor || !target || (target === token) ) return;
    const inCombat = !!game.combat?.started;
    // MJ : son PNJ vole un personnage.
    if ( game.user.isGM && (token.actor.type === "npc") && livingNPC(token) && livingPC(target) ) {
      const label = loc("Steal.MenuNpc", { name: target.name });
      if ( inCombat ) entries.push({ icon: "fa-solid fa-hand", label: loc("Steal.MenuCombat", { label }), run: () => refuse(token, loc("Steal.InCombat")) });
      else entries.push({ icon: "fa-solid fa-hand", label, run: () => visitVictim(target, token) });
      return;
    }
    if ( !livingNPC(target) || target.isOwner ) return;
    // Jamais une créature invoquée (familier, invocation) : dnd5e la marque de l'item qui l'a appelée (`flags.dnd5e.summon.origin`,
    // documents/activity/summon.mjs:145) — 0.14.1, retour de séance : « Voler » s'offrait sur le familier d'un joueur.
    if ( target.actor?.getFlag("dnd5e", "summon.origin") ) return;
    const state = stealMenuState({ mode: setting("pickpocket"), inCombat });
    if ( state === "hidden" ) return;
    if ( state === "combat" ) {
      entries.push({ icon: "fa-solid fa-hand", label: loc("Steal.MenuCombat", { label: loc("Steal.Menu") }), run: () => refuse(token, loc("Steal.InCombat")) });
      return;
    }
    entries.push({ icon: "fa-solid fa-hand", label: loc("Steal.Menu"), run: () => startPickpocket(target, token, visit) });
  });
}
