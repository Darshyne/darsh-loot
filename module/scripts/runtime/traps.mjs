/**
 * Pièges « DAS · Piège » (SPEC §3.12).
 *
 * - **Déclenchement** : un token (n'importe lequel) entre dans la zone de déclenchement, plus bas que sa hauteur. Le client
 *   qui le déplace l'arrête ; le MJ actif arrête tous les déplacements de la scène, puis l'acteur piège utilise son activité
 *   sur les tokens de la **zone d'effet** — la résolution (sauvegarde, dégâts, états) est celle du moteur de combat, qui
 *   sait jouer l'activité d'un acteur sans token (vérifié le 2026-10-06). Le piège se désarme ; il se **réarme** jamais, à la
 *   main (case « armé »), ou après un délai en temps du monde, vérifié à l'entrée suivante.
 * - Un piège déclenché est **repéré** (tout le monde l'a vu partir).
 * - **Repéré** : sa région est marquée « à éviter » pour le moteur (adapter/engine.mjs, son SPEC §103 : son chemin la contourne) et il brille en
 *   rouge en permanence (runtime/highlight.mjs) ; **désamorçable** d'un clic (outils de voleur, DD du piège) — un échec
 *   ne fait rien, ou déclenche le piège, selon son réglage.
 * - La détection (passive, fouille active) est celle de l'option « cachée » (runtime/hidden.mjs).
 */
import { MODULE_ID, loc, log, setting } from "../shared.mjs";
import { route } from "./router.mjs";
import { askGM } from "./take.mjs";
import { haltScene } from "./hidden.mjs";
import { TRAP_ZONE, TrapZoneType, registerTrapBehavior, sceneTraps, trapKnown } from "../adapter/trap-behavior.mjs";
import { regionDistance } from "../adapter/dnd5e.mjs";
import { engineUsageConfig, setEngineAvoid } from "../adapter/engine.mjs";

const DISARM_QUERY = `${MODULE_ID}.disarm`;

const isActiveGM = () => game.users.activeGM?.isSelf === true;

/* -------------------------------------------- */
/*  Réarmement, hauteur, cibles                 */
/* -------------------------------------------- */

/** Le piège est-il armé maintenant ? Un réarmement par délai se constate ici (temps du monde). */
function armedNow(behavior) {
  const s = behavior.system;
  if ( s.disarmed ) return false;
  if ( s.armed ) return true;
  return (s.rearm === "time") && Number.isFinite(s.triggeredAt) && (game.time.worldTime >= s.triggeredAt + (s.delay * 60));
}

/** Le sol de la zone sous ce token : le bas de la région s'il est fini, sinon la base de son niveau. */
function groundOf(region, token) {
  const bottom = region.elevation?.bottom;
  if ( Number.isFinite(bottom) ) return bottom;
  return region.parent.levels?.get?.(token._source.level)?.elevation?.base ?? 0;
}

/** Le token est-il assez bas pour déclencher (une créature qui vole au-dessus passe) ? */
function lowEnough(behavior, token) {
  return (token._source.elevation ?? 0) <= groundOf(behavior.region, token) + behavior.system.height;
}

/** La zone d'effet : la région désignée, sinon celle du déclencheur. */
function effectRegionOf(behavior) {
  const uuid = behavior.system.effectRegion;
  return (uuid ? fromUuidSync(uuid, { strict: false }) : null) ?? behavior.region;
}

/** Les tokens dans la zone d'effet (centre dans un de ses polygones, même niveau). */
function tokensIn(region) {
  return region.parent.tokens.filter(t => {
    const size = region.parent.grid.size;
    const c = { x: t._source.x + (t._source.width * size / 2), y: t._source.y + (t._source.height * size / 2) };
    if ( t._source.level && (typeof region.includedInLevel === "function") && !region.includedInLevel(t._source.level) ) return false;
    return region.polygonTree.testPoint(c);
  });
}

/** L'activité du piège : celle qui est nommée, sinon la première activité du premier objet qui en a. */
async function activityOf(behavior) {
  const actor = behavior.system.actor ? await fromUuid(behavior.system.actor) : null;
  if ( !actor ) return null;
  const id = behavior.system.activity;
  for ( const item of actor.items ) {
    const activities = item.system.activities;
    if ( !activities?.size ) continue;
    if ( id ) { const found = activities.get(id); if ( found ) return found; }
    else return activities.contents[0];
  }
  return null;
}

/* -------------------------------------------- */
/*  Déclenchement                               */
/* -------------------------------------------- */

/**
 * Le token arrêté en pleine animation reste à cheval sur deux cases (vu le 2026-10-06 : x = 3571 au lieu de 3640) : le MJ
 * le pose sur la case où est son centre — la dalle, où il a mis le pied — par un déplacement instantané (`displace`).
 */
async function snapToCell(token) {
  await new Promise(resolve => setTimeout(resolve, 400));   // le temps que le client qui déplace ait arrêté
  const grid = token.parent.grid;
  if ( grid.isGridless ) return;
  const size = grid.size;
  const center = { x: token._source.x + (token._source.width * size / 2), y: token._source.y + (token._source.height * size / 2) };
  const cell = grid.getTopLeftPoint(grid.getOffset(center));
  // Le coin de la case de son centre, moins sa demi-taille au-delà d'une case (un grand token reste centré).
  const x = cell.x - (Math.floor((token._source.width - 1) / 2) * size);
  const y = cell.y - (Math.floor((token._source.height - 1) / 2) * size);
  if ( (x === token._source.x) && (y === token._source.y) ) return;
  try { await token.move({ x, y, action: "displace" }); }
  catch(err) { log.warn(`piège : ${token.name} pas recalé`, err.message); }
}

const firing = new Set();

/**
 * Chez le MJ actif : le piège part. Il est repéré, désarmé (heure notée pour un réarmement), tout s'arrête, puis l'acteur
 * piège utilise son activité sur les tokens de la zone d'effet, par le moteur.
 */
export async function fireTrap(behavior, triggerer=null) {
  if ( firing.has(behavior.uuid) ) return false;
  firing.add(behavior.uuid);
  try {
    const scene = behavior.region.parent;
    haltScene(scene);
    if ( triggerer ) snapToCell(triggerer);
    await behavior.update({ "system.armed": false, "system.triggeredAt": game.time.worldTime, "system.hidden.found": true });
    const activity = await activityOf(behavior);
    if ( !activity ) { log.warn(`piège ${behavior.uuid} : pas d'acteur ou d'activité`); return false; }
    const targets = tokensIn(effectRegionOf(behavior));
    log.info(`piège ${behavior.system.displayName} : ${activity.item.name} sur ${targets.map(t => t.name).join(", ") || "personne"}`
      + (triggerer ? ` (déclenché par ${triggerer.name})` : ""));
    await useOnTargets(activity, scene, targets);
    return true;
  } catch(err) {
    log.warn("piège :", err.message);
    return false;
  } finally {
    firing.delete(behavior.uuid);
  }
}

/**
 * L'activité utilisée par le MJ sur ces cibles : dnd5e lit les cibles de l'utilisateur au moment de l'utilisation, il faut
 * donc les désigner, sur la scène affichée par le MJ. Ses cibles d'avant lui sont rendues.
 */
async function useOnTargets(activity, scene, targets) {
  if ( canvas.scene !== scene ) log.warn("piège : le MJ n'affiche pas la scène du piège, l'activité part sans cible");
  const before = [...game.user.targets].map(t => t.id);
  const viewed = canvas.scene === scene;
  if ( viewed ) canvas.tokens.setTargets(targets.map(t => t.id), { mode: "replace" });
  try {
    await activity.use({ ...engineUsageConfig(), consume: false }, { configure: false });
  } finally {
    if ( viewed ) canvas.tokens.setTargets(before.filter(id => canvas.tokens.get(id)), { mode: "replace" });
  }
}

/**
 * L'évènement du cœur : un token entre dans la zone de déclenchement. Son client l'arrête (seul le client qui déplace le
 * peut, documents/token.mjs:762) ; le MJ actif juge et déclenche.
 */
function onEnter(behavior, event) {
  const token = event.data?.token;
  if ( !token || !armedNow(behavior) || !lowEnough(behavior, token) ) return;
  if ( event.user?.isSelf ) { try { token.stopMovement(); } catch(err) { /* déjà arrêté */ } }
  if ( isActiveGM() ) fireTrap(behavior, token);
}

/* -------------------------------------------- */
/*  Repéré : éviter, désamorcer                 */
/* -------------------------------------------- */

/** Chez le MJ : la région d'un piège repéré (et pas désamorcé) est à éviter par le chemin du moteur ; sinon, plus. */
async function syncAvoid(behavior) {
  const region = behavior.region;
  if ( !region ) return;
  await setEngineAvoid(region, trapKnown(behavior));
}

/**
 * Désamorcer : le joueur lance son test d'outils de voleur (dés visibles, sans dialogue, comme le crochetage), le MJ compare
 * au DD du piège. Échec : rien, ou le piège part, selon son réglage.
 */
export async function requestDisarm(behavior, looter) {
  if ( !looter ) { ui.notifications.warn(loc("Window.NoLooter")); return null; }
  const rolls = await looter.actor.rollToolCheck({ tool: "thief", target: behavior.system.disarmDc }, { configure: false });
  const total = rolls?.[0]?.total;
  if ( total === undefined ) return null;
  const result = await askGM(DISARM_QUERY, handleDisarm, { behavior: behavior.uuid, looter: looter.uuid, total });
  if ( result?.ok === true ) ui.notifications.info(loc("TrapZone.Disarmed"));
  else if ( result?.ok === false ) ui.notifications.warn(loc(result.fired ? "TrapZone.DisarmFired" : "TrapZone.DisarmFailed"));
  return result;
}

async function handleDisarm({ behavior: uuid, looter: looterUuid, total }, { user }) {
  const behavior = fromUuidSync(uuid, { strict: false });
  const looter = fromUuidSync(looterUuid, { strict: false });
  if ( (behavior?.type !== TRAP_ZONE) || !looter?.actor ) throw new Error(loc("Refus.Introuvable"));
  if ( !looter.actor.testUserPermission(user, "OWNER") ) throw new Error(loc("Refus.PasAToi"));
  if ( !user.isGM && !trapKnown(behavior) ) throw new Error(loc("Refus.Introuvable"));
  if ( !user.isGM && (regionDistance(looter, behavior.region) > setting("reach")) ) throw new Error(loc("Refus.Loin"));
  if ( behavior.system.disarmed ) return { ok: true };
  if ( Number(total) >= behavior.system.disarmDc ) {
    await behavior.update({ "system.disarmed": true, "system.armed": false });
    return { ok: true };
  }
  if ( (behavior.system.failure === "trigger") && armedNow(behavior) ) {
    await fireTrap(behavior, looter);
    return { ok: false, fired: true };
  }
  return { ok: false, fired: false };
}

/** Les pièges repérés d'une scène, désamorçables (pour la souris). */
export function knownTraps(scene) {
  return sceneTraps(scene).filter(b => trapKnown(b));
}

export function registerTrapsInit() {
  registerTrapBehavior();
  TrapZoneType.onEnter = onEnter;
  CONFIG.queries[DISARM_QUERY] = handleDisarm;
}

export function registerTraps() {
  const sync = behavior => { if ( isActiveGM() && (behavior.type === TRAP_ZONE) ) syncAvoid(behavior); };
  route("updateRegionBehavior", "piège repéré", sync);
  route("createRegionBehavior", "piège repéré", sync);
  route("createRegion", "piège repéré", region => { for ( const b of region.behaviors ) sync(b); });
}
