/**
 * Ce que fait le clic sur une zone interactive « DAS · … » (SPEC §3.12), chez celui qui clique : lancer une macro,
 * aller sur une scène, ouvrir un document. Repris de `coc7-dialogues` (scripts/macro-behavior.js, scene-behavior.js,
 * document-behavior.js) ; le droit de lecture d'un document passe ici par une requête au MJ actif (`User#query`, comme
 * nos autres écritures) au lieu du socket de `coc7-dialogues`.
 */
import { MODULE_ID, loc, log, setting } from "../shared.mjs";
import { askGM } from "./take.mjs";
import { MACRO_ZONE, SCENE_ZONE, DOCUMENT_ZONE, registerZoneBehaviors } from "../adapter/zone-behaviors.mjs";
import { regionDistance } from "../adapter/dnd5e.mjs";
import { behaviorConcealed } from "../adapter/hidden.mjs";

const GRANT_QUERY = `${MODULE_ID}.grantDocument`;

/**
 * Le clic sur une zone, pour le token qui agit (null : pas de personnage, une zone sans portée exigée).
 * @param {RegionBehavior} behavior
 * @param {TokenDocument|null} looter
 */
export async function runZone(behavior, looter=null) {
  try {
    if ( behavior.type === MACRO_ZONE ) return await runMacro(behavior, looter);
    if ( behavior.type === SCENE_ZONE ) return await goToScene(behavior);
    if ( behavior.type === DOCUMENT_ZONE ) return await openDocument(behavior, looter);
  } catch(err) {
    log.warn(`zone ${behavior.uuid}:`, err.message);
    ui.notifications.warn(loc("Notice.Refused", { reason: err.message }));
  }
  return null;
}

/* -------------------------------------------- */
/*  Macro au clic                               */
/* -------------------------------------------- */

/**
 * Lance la macro de la zone **sans exiger de droit dessus** (`Macro#execute` refuse sans le droit Limité) : on refait ce
 * que fait le cœur (client/documents/macro.mjs, `#executeScript` / `#executeChat`). La macro est choisie par le MJ dans
 * la zone ; elle écrit avec les droits du joueur, ce contournement n'en donne aucun de plus.
 */
async function runMacro(behavior, looter) {
  const macro = behavior.system.macro ? await fromUuid(behavior.system.macro) : null;
  if ( macro?.documentName !== "Macro" ) return ui.notifications.warn(loc("Zone.NoMacro"));
  const ChatMessage = foundry.documents.ChatMessage.implementation;
  const speaker = looter ? ChatMessage.getSpeaker({ token: looter }) : ChatMessage.getSpeaker();
  if ( macro.type === "chat" ) return ui.chat.processMessage(macro.command, { speaker });
  const token = looter?.object ?? (canvas.ready ? canvas.tokens.get(speaker.token) : null) ?? null;
  const actor = token?.actor ?? game.actors.get(speaker.actor) ?? null;
  const scope = { behavior, region: behavior.region, looter };
  const fn = new foundry.utils.AsyncFunction("speaker", "actor", "token", "character", "scope", `{${macro.command}\n}`);
  return fn.call(macro, speaker, actor, token, game.user.character, scope);
}

/* -------------------------------------------- */
/*  Vers une scène                              */
/* -------------------------------------------- */

async function goToScene(behavior) {
  const scene = behavior.system.targetScene ? await fromUuid(behavior.system.targetScene) : null;
  if ( scene?.documentName !== "Scene" ) return ui.notifications.warn(loc("Zone.NoScene"));
  if ( behavior.system.activateForAll && game.user.isGM ) return scene.activate();
  if ( scene.isView ) return null;
  return scene.view();
}

/* -------------------------------------------- */
/*  Ouvrir un document                          */
/* -------------------------------------------- */

const isJournalTarget = doc => ["JournalEntry", "JournalEntryPage"].includes(doc?.documentName);

function canRead(doc) {
  if ( !doc ) return false;
  if ( doc.documentName === "JournalEntryPage" ) {
    return doc.parent.testUserPermission(game.user, "OBSERVER") && doc.testUserPermission(game.user, "OBSERVER");
  }
  return doc.testUserPermission(game.user, "OBSERVER");
}

function show(doc) {
  if ( doc.documentName === "JournalEntryPage" ) return doc.parent.sheet.render(true, { pageId: doc.id });
  return doc.sheet.render(true);
}

/** Attendre que le document, tout juste partagé, arrive chez ce client. */
async function waitForDocument(uuid, tries=20) {
  for ( let i = 0; i < tries; i++ ) {
    const doc = await fromUuid(uuid);
    if ( doc && canRead(doc) ) return doc;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return null;
}

async function openDocument(behavior, looter) {
  const uuid = behavior.system.document;
  if ( !uuid ) return ui.notifications.warn(loc("Zone.NoDocument"));
  let doc = await fromUuid(uuid);
  if ( doc && !isJournalTarget(doc) ) return ui.notifications.warn(loc("Zone.NoDocument"));
  if ( !canRead(doc) ) {
    // Un joueur ne reçoit même pas un journal sur lequel il n'a aucun droit : le MJ le lui accorde, si la zone le permet.
    if ( !behavior.system.grant || game.user.isGM ) return ui.notifications.warn(loc("Zone.NoPermission"));
    const ok = await askGM(GRANT_QUERY, handleGrant, { behavior: behavior.uuid, looter: looter?.uuid ?? null });
    if ( !ok ) return null;
    doc = await waitForDocument(uuid);
    if ( !doc ) return ui.notifications.warn(loc("Zone.GrantFailed"));
  }
  return show(doc);
}

/**
 * Chez le MJ : accorder Observateur sur le document **de la zone** (jamais un document choisi par le joueur) au joueur
 * qui clique, après les contrôles (zone permise, à portée si elle l'exige). Ne baisse jamais un droit plus haut.
 */
async function handleGrant({ behavior: behaviorUuid, looter: looterUuid }, { user }) {
  const behavior = fromUuidSync(behaviorUuid, { strict: false });
  if ( (behavior?.type !== DOCUMENT_ZONE) || behavior.disabled || !behavior.system.grant ) throw new Error(loc("Refus.Introuvable"));
  if ( (behavior.parent?.hidden || behaviorConcealed(behavior)) && !user.isGM ) throw new Error(loc("Refus.Introuvable"));
  if ( behavior.system.reach && !user.isGM ) {
    const looter = looterUuid ? fromUuidSync(looterUuid, { strict: false }) : null;
    if ( !looter?.actor?.testUserPermission(user, "OWNER") ) throw new Error(loc("Refus.PasAToi"));
    if ( regionDistance(looter, behavior.region) > setting("reach") ) throw new Error(loc("Refus.Loin"));
  }
  const doc = await fromUuid(behavior.system.document ?? "");
  if ( !isJournalTarget(doc) ) throw new Error(loc("Zone.NoDocument"));
  const { OBSERVER } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const journal = (doc.documentName === "JournalEntryPage") ? doc.parent : doc;
  if ( !journal.testUserPermission(user, "OBSERVER") ) await journal.update({ [`ownership.${user.id}`]: OBSERVER });
  // Une page hérite du journal, sauf si elle a ses propres droits, plus bas.
  if ( (doc !== journal) && !doc.testUserPermission(user, "OBSERVER") ) await doc.update({ [`ownership.${user.id}`]: OBSERVER });
  return true;
}

export function registerZonesInit() {
  registerZoneBehaviors();
  CONFIG.queries[GRANT_QUERY] = handleGrant;
}
