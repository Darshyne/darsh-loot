/**
 * Vol à la tire (SPEC §3.3). Le joueur lance son test d'Escamotage (dés visibles, sans dialogue) ; le MJ calcule le DD
 * (Perception passive de la victime, ou son jet si elle est sur ses gardes, majorée par la valeur et le poids — le DD
 * exact n'est jamais montré), tranche, déplace l'objet marqué volé, ou fait repérer le voleur.
 * Hors combat, au contact (réglage de portée), un seul essai par objet et par voleur.
 */
import { MODULE_ID, loc, setting } from "../shared.mjs";
import { route } from "./router.mjs";
import { TOKEN_MENU_HOOK } from "../adapter/engine.mjs";
import { pocketSource } from "../adapter/sources.mjs";
import { askGM, checkAccess, sourceRef, announce } from "./take.mjs";
import { ensureRolled } from "./treasure.mjs";
import { transfer } from "../adapter/dnd5e.mjs";
import { livingNPC, stealDC, triedBy } from "../adapter/theft.mjs";
import { stolenFlag } from "../core/theft.mjs";

const STEAL_QUERY = `${MODULE_ID}.steal`;

/**
 * Tenter de voler un objet (ou la bourse, `"coins"`) dans les poches de la source.
 * @returns {Promise<{ ok: boolean }|null>}
 */
export async function requestSteal(source, thief, itemId) {
  if ( game.combat?.started ) return ui.notifications.warn(loc("Steal.InCombat"));
  const rolls = await thief.actor.rollSkill({ skill: "slt" }, { configure: false });
  const total = rolls?.[0]?.total;
  if ( total === undefined ) return null;
  const result = await askGM(STEAL_QUERY, handleSteal, { source: sourceRef(source), looter: thief.uuid, itemId, total });
  if ( result?.ok === true ) ui.notifications.info(loc("Steal.Success"));
  else if ( result?.ok === false ) ui.notifications.warn(loc("Steal.Caught", { name: source.name }));
  return result;
}

async function handleSteal(payload, { user }) {
  const { source, looter } = checkAccess(payload, user);
  const victim = source.doc;
  if ( (source.kind !== "pocket") || !livingNPC(victim) ) throw new Error(loc("Refus.Introuvable"));
  if ( game.combat?.started ) throw new Error(loc("Steal.InCombat"));
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
  if ( setting("theftHostile") ) await victim.update({ disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE });
  ChatMessage.implementation.create({
    content: `<p>${loc("Chat.Caught", { thief: thief.name, victim: victim.name, total, dc })}</p>`,
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    speaker: ChatMessage.implementation.getSpeaker({ token: victim }),
    flags: { [MODULE_ID]: { caught: true } }
  });
}

/** Avant d'ouvrir la fenêtre des poches : le trésor de la victime (pièces, poches) est tiré, comme à sa mort. */
export function preparePocket(source) {
  return ensureRolled(source.doc);
}

export function registerTheft() {
  CONFIG.queries[STEAL_QUERY] = handleSteal;
}

/**
 * « Voler » dans le menu contextuel d'un PNJ vivant qu'on ne possède pas (menu du moteur, hook `tokenMenu`), hors combat,
 * pour le personnage en main — décision utilisateur du 2026-10-06 : le vol quitte Alt + clic, Alt étant la touche de
 * surbrillance (§3.12) et celle d'avantage de l'attaque au clic du moteur, qui peut valoir hors combat. `visit` : y aller
 * d'abord si l'on est trop loin, puis ouvrir les poches (runtime/open.mjs).
 */
export function registerTheftMenu(visit) {
  route(TOKEN_MENU_HOOK, "menu: Pickpocket", (entries, { token, target }) => {
    if ( !token?.actor || !target || (target === token) || game.combat?.started ) return;
    if ( !livingNPC(target) || target.isOwner ) return;
    // Jamais une créature invoquée (familier, invocation) : dnd5e la marque de l'item qui l'a appelée (`flags.dnd5e.summon.origin`,
    // documents/activity/summon.mjs:145) — 0.14.1, retour de séance : « Voler » s'offrait sur le familier d'un joueur.
    if ( target.actor?.getFlag("dnd5e", "summon.origin") ) return;
    entries.push({ icon: "fa-solid fa-hand", label: loc("Steal.Menu"), run: () => visit(pocketSource(target), token) });
  });
}
