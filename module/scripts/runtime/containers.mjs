/**
 * Conteneurs (SPEC §3.2) : le coffre (acteur Groupe) de chaque comportement « Conteneur », son tirage à la première
 * ouverture, et le déverrouillage (clé, crochetage aux outils de voleur, ou le MJ). Toute écriture se fait chez le MJ.
 */
import { MODULE_ID, loc, log } from "../shared.mjs";
import { route } from "./router.mjs";
import { askGM, checkAccess, sourceRef } from "./take.mjs";
import { CONTAINER_TYPE, registerContainerBehavior } from "../adapter/container-behavior.mjs";
import { keyItem } from "../adapter/dnd5e.mjs";
import { resolveSource } from "../adapter/sources.mjs";
import { rollContainer } from "../adapter/treasure.mjs";

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
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED },
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
  if ( method === "pick" ) {
    const rolls = await looter.actor.rollToolCheck({ tool: "thief", target: source.doc.system.dc }, { configure: false });
    const total = rolls?.[0]?.total;
    if ( total === undefined ) return null;
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
  if ( !ok ) return { ok: false };
  await behavior.update({ "system.locked": false });
  await prepare(behavior);
  return { ok: true };
}

/* -------------------------------------------- */
/*  Cycle de vie                                */
/* -------------------------------------------- */

/** Un conteneur supprimé emporte son coffre (seulement l'acteur créé pour lui). */
async function onDeleteBehavior(behavior) {
  if ( (behavior.type !== CONTAINER_TYPE) || !isActiveGM() || !behavior.system.actor ) return;
  const actor = fromUuidSync(behavior.system.actor, { strict: false });
  if ( actor?.getFlag(MODULE_ID, "containerOf") === behavior.uuid ) await actor.delete();
}

/** Un conteneur créé par le MJ reçoit son coffre tout de suite (le MJ peut le remplir avant la partie). */
async function onCreateBehavior(behavior) {
  if ( (behavior.type !== CONTAINER_TYPE) || !isActiveGM() || behavior.system.actor ) return;
  await ensureStore(behavior);
}

export function registerContainersInit() {
  registerContainerBehavior();
  CONFIG.queries[ROLL_QUERY] = handleRoll;
  CONFIG.queries[UNLOCK_QUERY] = handleUnlock;
}

export function registerContainers() {
  route("createRegionBehavior", "container store", behavior => onCreateBehavior(behavior));
  route("deleteRegionBehavior", "container store", behavior => onDeleteBehavior(behavior));
  // Des comportements créés avec leur région (ou supprimés avec elle) ne tirent que les hooks de la région.
  route("createRegion", "container store", region => { for ( const b of region.behaviors ) onCreateBehavior(b); });
  route("deleteRegion", "container store", region => { for ( const b of region.behaviors ) onDeleteBehavior(b); });
}
