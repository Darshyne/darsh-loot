/**
 * Conteneurs (SPEC §3.2) : le coffre (acteur Groupe) de chaque comportement « Conteneur », son tirage à la première
 * ouverture, et le déverrouillage (clé, crochetage aux outils de voleur, ou le MJ). Toute écriture se fait chez le MJ.
 */
import { MODULE_ID, loc, log, setting } from "../shared.mjs";
import { route } from "./router.mjs";
import { askGM, checkAccess, sourceRef } from "./take.mjs";
import { CONTAINER_TYPE, registerContainerBehavior, containerSounds } from "../adapter/container-behavior.mjs";
import { keyItem } from "../adapter/dnd5e.mjs";
import { resolveSource } from "../adapter/sources.mjs";
import { rollContainer } from "../adapter/treasure.mjs";
import { trapGate, springTrap } from "./traps.mjs";
import { feedbackCard, playForAll, SOUNDS } from "./feedback.mjs";
import { waitForDice, newRollMessage } from "../adapter/dice.mjs";
import { createContainerFromToken, fillFromActor } from "../adapter/drop.mjs";
import { TOKEN_MENU_HOOK } from "../adapter/engine.mjs";

const ROLL_QUERY = `${MODULE_ID}.containerRoll`;
const UNLOCK_QUERY = `${MODULE_ID}.unlock`;
const FOLDER_FLAG = "containers";

const isActiveGM = () => game.users.activeGM?.isSelf === true;

/* -------------------------------------------- */
/*  Le coffre : un acteur Groupe                */
/* -------------------------------------------- */

/**
 * Le dossier « Butin — conteneurs » des acteurs, créé au besoin — une seule fois même si plusieurs coffres naissent
 * ensemble (trois régions créées d'un coup avaient donné deux dossiers).
 */
let folderPending = null;
function storeFolder() {
  const found = game.folders.find(f => (f.type === "Actor") && f.getFlag(MODULE_ID, FOLDER_FLAG));
  if ( found ) return Promise.resolve(found);
  folderPending ??= Folder.implementation.create({ name: loc("Container.Folder"), type: "Actor", color: "#6b5634",
    flags: { [MODULE_ID]: { [FOLDER_FLAG]: true } } }).finally(() => { folderPending = null; });
  return folderPending;
}

/** Chez le MJ : l'acteur du coffre de ce comportement, créé s'il manque. */
export function ensureStore(behavior) {
  const current = behavior.system.actor ? fromUuidSync(behavior.system.actor, { strict: false }) : null;
  if ( current ) return Promise.resolve(current);
  // Un seul coffre par comportement, même si le hook de création et un appel direct arrivent ensemble.
  if ( !pendingStores.has(behavior.uuid) ) {
    pendingStores.set(behavior.uuid, createStore(behavior).finally(() => pendingStores.delete(behavior.uuid)));
  }
  return pendingStores.get(behavior.uuid);
}

const pendingStores = new Map();

async function createStore(behavior) {
  const folder = await storeFolder();
  const actor = await Actor.implementation.create({
    name: loc("Container.ActorName", { name: behavior.system.displayName || behavior.region?.name || "?" }),
    type: "group",
    img: "icons/containers/chest/chest-reinforced-steel-oak-tan.webp",
    folder: folder.id,
    // Aucun droit : le coffre ne s'affiche pas dans la barre des acteurs des joueurs. La fenêtre de butin lit son
    // contenu (les acteurs sont tous envoyés aux clients) et toute prise passe par le MJ.
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    flags: { [MODULE_ID]: { containerOf: behavior.uuid } }
  });
  await behavior.update({ "system.actor": actor.uuid });
  return actor;
}

/** Chez le MJ : coffre créé et contenu tiré (une fois), si le conteneur est ouvert. */
async function prepare(behavior) {
  const actor = await ensureStore(behavior);
  if ( !behavior.system.rolled && !behavior.system.locked ) {
    const result = await rollContainer(behavior, actor);
    log.info(`contents of ${behavior.system.displayName}:`, result);
  }
  return actor;
}

const pending = new Map();

async function handleRoll({ behavior: uuid }) {
  const behavior = fromUuidSync(uuid, { strict: false });
  if ( behavior?.type !== CONTAINER_TYPE ) return null;
  if ( !pending.has(uuid) ) pending.set(uuid, prepare(behavior).finally(() => pending.delete(uuid)));
  await pending.get(uuid);
  return true;
}

/** Avant d'ouvrir la fenêtre : le coffre existe et, s'il n'est pas verrouillé, son contenu est tiré. Ne lève jamais. */
export async function ensureContainer(behavior) {
  if ( behavior.system.actor && (behavior.system.rolled || behavior.system.locked) ) return;
  const gm = game.users.activeGM;
  if ( !gm ) return;
  try {
    if ( gm.isSelf ) await handleRoll({ behavior: behavior.uuid });
    else await gm.query(ROLL_QUERY, { behavior: behavior.uuid }, { timeout: 15000 });
  } catch(err) {
    log.warn("could not prepare the container:", err.message);
  }
}

/* -------------------------------------------- */
/*  Serrure                                     */
/* -------------------------------------------- */

/**
 * Tenter d'ouvrir une serrure. Clé ou MJ : directement. Crochetage : le joueur lance lui-même son test d'outils de
 * voleur (dés visibles, sans dialogue), le MJ compare au DD. Un échec ne coûte rien de plus qu'un nouvel essai.
 */
export async function requestUnlock(source, looter, method) {
  const payload = { source: sourceRef(source), looter: looter?.uuid ?? null, method };
  // 0.16.0 : un coffre au piège repéré, réglé pour partir au crochetage raté ou à l'ouverture : on demande d'abord.
  if ( (method !== "gm") && !game.user.isGM && !(await trapGate(source.doc, looter, (method === "pick") ? ["pick", "open"] : ["open"])) ) return null;
  if ( method === "pick" ) {
    // 0.17.2 (règles DAS du 2026-10-27) : le verdict n'arrive qu'après la fin des dés 3D.
    const known = new Set(game.messages.keys());
    const rolls = await looter.actor.rollToolCheck({ tool: "thief", target: source.doc.system.dc }, { configure: false });
    const total = rolls?.[0]?.total;
    if ( total === undefined ) return null;
    await waitForDice(newRollMessage(known));
    payload.total = total;
  }
  const result = await askGM(UNLOCK_QUERY, handleUnlock, payload);
  if ( result?.ok === false ) ui.notifications.info(loc("Lock.Failed"));
  return result;
}

async function handleUnlock(payload, { user }) {
  // Le MJ ouvre sans personnage ni portée ; les autres méthodes passent par les contrôles communs.
  const { source, looter } = ((payload.method === "gm") && user.isGM)
    ? { source: resolveSource(payload.source), looter: null }
    : checkAccess(payload, user);
  const behavior = source?.doc;
  if ( behavior?.type !== CONTAINER_TYPE ) throw new Error(loc("Refus.Introuvable"));
  if ( !behavior.system.locked ) return { ok: true };
  let ok = false;
  if ( payload.method === "gm" ) ok = user.isGM;
  else if ( payload.method === "key" ) ok = !!keyItem(looter.actor, behavior.system.key);
  else if ( payload.method === "pick" ) ok = Number(payload.total) >= behavior.system.dc;
  // 0.16.0 : coffre piégé — la serrure qui résiste (crochetage raté) ou le couvercle qui s'ouvre font partir le piège, s'il est
  // réglé pour ce moment.
  if ( !ok ) {
    await unlockFeedback(looter, source, payload.method, false);
    if ( (payload.method === "pick") && looter ) await springTrap(behavior, looter, "pick");
    return { ok: false };
  }
  await behavior.update({ "system.locked": false });
  await unlockFeedback(looter, source, payload.method, true);
  if ( looter ) await springTrap(behavior, looter, "open");
  await prepare(behavior);
  return { ok: true };
}

/**
 * 0.17.2 (règles DAS du 2026-10-27) : chez le MJ actif, l'issue d'une serrure se voit et s'entend chez tous — carte publique, texte
 * flottant au-dessus du token, son de serrure (runtime/feedback.mjs). Le MJ qui ouvre lui-même : le son seul.
 */
async function unlockFeedback(looter, source, method, ok) {
  // 2026-10-28 : le jeu de sons du coffre (ceux des portes), sinon la serrure de métal du cœur.
  const set = containerSounds(source.doc);
  const success = set?.unlock ?? SOUNDS.success, failure = set?.test ?? SOUNDS.failure;
  if ( !looter ) { if ( ok ) playForAll(success); return; }
  const names = { name: looter.name, source: source.name };
  if ( !ok ) {
    await feedbackCard(looter, loc("Lock.PickFailCard", names), { kind: "refused", icon: "fa-solid fa-lock", sound: failure,
      float: loc("Lock.FloatFailed") });
    return;
  }
  const text = (method === "key")
    ? loc("Lock.KeyCard", { ...names, key: keyItem(looter.actor, source.doc.system.key)?.name ?? "" })
    : loc("Lock.PickedCard", names);
  await feedbackCard(looter, text, { kind: "gain", icon: "fa-solid fa-lock-open", sound: success, float: loc("Lock.FloatUnlocked") });
}

/* -------------------------------------------- */
/*  Cycle de vie                                */
/* -------------------------------------------- */

/**
 * Un conteneur supprimé emporte son coffre (seulement l'acteur créé pour lui) — 0.15.6 : seulement si le réglage de monde
 * `deleteStores` le demande (désactivé par défaut, décision de l'utilisateur : supprimer un acteur en cascade est risqué ; le coffre
 * reste alors dans « Butin — conteneurs », au MJ de le retirer).
 */
async function onDeleteBehavior(behavior) {
  if ( (behavior.type !== CONTAINER_TYPE) || !isActiveGM() || !behavior.system.actor || !setting("deleteStores") ) return;
  const actor = fromUuidSync(behavior.system.actor, { strict: false });
  if ( actor?.getFlag(MODULE_ID, "containerOf") === behavior.uuid ) await actor.delete();
}

/** Un conteneur créé par le MJ reçoit son coffre tout de suite (le MJ peut le remplir avant la partie). */
async function onCreateBehavior(behavior) {
  if ( (behavior.type !== CONTAINER_TYPE) || !isActiveGM() || behavior.system.actor ) return;
  await ensureStore(behavior);
}

/* -------------------------------------------- */
/*  Un token Groupe devient un conteneur        */
/* -------------------------------------------- */

/**
 * 2026-10-28 (demande de l'utilisateur) : le MJ convertit un token d'acteur Groupe posé sur la carte en conteneur — tuile à son
 * image, région « Conteneur », coffre qui reçoit une copie de ses objets et de son argent ; le token est retiré, l'acteur du monde
 * reste. Le contenu étant celui du groupe, rien n'est tiré.
 * @param {TokenDocument} token
 * @returns {Promise<RegionDocument|null>}
 */
export async function convertGroupToken(token) {
  if ( !game.user.isGM || (token?.actor?.type !== "group") ) return null;
  const region = await createContainerFromToken(token);
  await fillFromActor(await ensureStore(region.behaviors.contents[0]), token.actor);
  await token.delete();
  ui.notifications.info(loc("Container.Converted", { name: region.name }));
  return region;
}

/** L'entrée du menu contextuel du MJ sur un token Groupe (menu du moteur, hook `tokenMenu`). */
function onTokenMenu(entries, { target }) {
  if ( !game.user.isGM || (target?.actor?.type !== "group") ) return;
  entries.push({ icon: "fa-solid fa-box-open", label: loc("Container.ConvertMenu"),
    run: () => convertGroupToken(target).catch(err => {
      log.warn("group → container:", err.message);
      ui.notifications.warn(loc("Notice.Refused", { reason: err.message }));
    }) });
}

export function registerContainersInit() {
  registerContainerBehavior();
  CONFIG.queries[ROLL_QUERY] = handleRoll;
  CONFIG.queries[UNLOCK_QUERY] = handleUnlock;
}

/** Chez le MJ : les coffres créés en « Limité » avant la 0.15.5 ne s'affichent plus chez les joueurs. */
async function hideOldStores() {
  const { LIMITED, NONE } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const updates = game.actors.filter(a => a.getFlag(MODULE_ID, "containerOf") && (a.ownership.default === LIMITED))
    .map(a => ({ _id: a.id, "ownership.default": NONE }));
  if ( updates.length ) await Actor.implementation.updateDocuments(updates);
}

export function registerContainers() {
  if ( isActiveGM() ) hideOldStores().catch(err => log.warn("could not hide the container actors:", err.message));
  route("createRegionBehavior", "container store", behavior => onCreateBehavior(behavior));
  route("deleteRegionBehavior", "container store", behavior => onDeleteBehavior(behavior));
  // Des comportements créés avec leur région (ou supprimés avec elle) ne tirent que les hooks de la région.
  route("createRegion", "container store", region => { for ( const b of region.behaviors ) onCreateBehavior(b); });
  route("deleteRegion", "container store", region => { for ( const b of region.behaviors ) onDeleteBehavior(b); });
  route(TOKEN_MENU_HOOK, "menu: group → container", onTokenMenu);
}
