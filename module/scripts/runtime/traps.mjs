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
 *
 * 0.16.0 : **coffres et portes piégés**. Le même piège (acteur, activité, zone d'effet, réarmement, désamorçage, détection) se
 * pose sur un conteneur (`system.trap`) ou une porte (`flags.darsh-loot.trap`) ; tout passe par la poignée de piège
 * (adapter/trapped.mjs). Il part **à l'ouverture** (le coffre qu'on ouvre, la serrure qui cède ; la porte qui s'ouvre, par le cœur
 * ou le moteur) et / ou **au crochetage raté**. Sans zone d'effet, il ne touche que celui qui ouvre. Repéré, ouvrir demande d'abord :
 * désamorcer, ouvrir quand même ou renoncer.
 */
import { MODULE_ID, loc, log, sceneSetting } from "../shared.mjs";
import { route, routeClaim } from "./router.mjs";
import { askGM } from "./take.mjs";
import { haltScene } from "./hidden.mjs";
import { TRAP_ZONE, TrapZoneType, registerTrapBehavior, sceneTraps, trapKnown } from "../adapter/trap-behavior.mjs";
import { trapLevelOf } from "../adapter/dnd5e.mjs";
import { trapHandle, handleKnown, handleDistance, trappedThings, isDoorWall } from "../adapter/trapped.mjs";
import { trapChecks, pickTier, targetsLevel, armedAt, triggersOn, normalizeTrap } from "../core/traps.mjs";
import { normalizeHidden } from "../core/hidden.mjs";
import { engineUsageConfig, engineGivenTargetsMessage, setEngineAvoid, LOCK_ATTEMPT_HOOK, DOOR_MENU_HOOK } from "../adapter/engine.mjs";

const DISARM_QUERY = `${MODULE_ID}.disarm`;
const TRIGGER_QUERY = `${MODULE_ID}.trapTrigger`;
/** Émis chez le MJ actif quand un piège part : `{ behavior, region, effectRegion, actor, activity, triggerer, targets, kind, wall }`. */
const TRAP_FIRED_HOOK = `${MODULE_ID}.trapFired`;

const isActiveGM = () => game.users.activeGM?.isSelf === true;

/** Une poignée de piège (adapter/trapped.mjs), depuis une poignée ou un document (zone, conteneur, mur). */
const asHandle = x => ((x?.kind && x.doc) ? x : trapHandle(x));

/* -------------------------------------------- */
/*  Réarmement, hauteur, cibles                 */
/* -------------------------------------------- */

/** Le piège est-il armé maintenant ? Un réarmement par délai se constate ici (temps du monde). */
function armedNow(h) {
  return !!h && armedAt(h.trap, game.time.worldTime);
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

/**
 * La zone d'effet : la région désignée ; sinon, pour une zone « DAS · Piège », la région du déclencheur ; pour un coffre ou une
 * porte, aucune (le piège ne touche que celui qui ouvre).
 */
function effectRegionOf(h) {
  const uuid = h.trap.effectRegion;
  const region = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  if ( region?.documentName === "Region" ) return region;
  return (h.kind === "zone") ? h.region : null;
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

/** Les cibles : les tokens de la zone d'effet, ou, sans zone, celui qui a déclenché. */
function targetsOf(h, triggerer) {
  const region = effectRegionOf(h);
  if ( region ) return tokensIn(region);
  return triggerer ? [triggerer] : [];
}

/**
 * L'activité du piège : celle qui est nommée ; sinon, parmi les activités du premier objet qui en a, celle de la tranche de
 * niveaux des cibles (un piège du DMG 2024 en a une par tranche, core/traps.mjs `pickTier`), à défaut la première.
 */
async function activityOf(h, targets=[]) {
  const actor = h.trap.actor ? await fromUuid(h.trap.actor) : null;
  if ( !actor ) return null;
  const id = h.trap.activity;
  for ( const item of actor.items ) {
    const activities = item.system.activities;
    if ( !activities?.size ) continue;
    if ( id ) { const found = activities.get(id); if ( found ) return found; continue; }
    const level = targetsLevel(targets.filter(t => t.actor).map(t => trapLevelOf(t.actor)));
    const tier = pickTier(activities.contents.map(a => ({ id: a.id, name: a.name })), level);
    return activities.get(tier) ?? activities.contents[0];
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
  catch(err) { log.warn(`trap: ${token.name} not snapped to its cell`, err.message); }
}

const firing = new Set();

/**
 * Chez le MJ actif : le piège part (zone, coffre ou porte). Il est repéré, désarmé (heure notée pour un réarmement), tout
 * s'arrête, puis l'acteur piège utilise son activité sur les cibles, par le moteur.
 */
export async function fireTrap(target, triggerer=null) {
  const h = asHandle(target);
  if ( !h || firing.has(h.uuid) ) return false;
  firing.add(h.uuid);
  try {
    const scene = h.scene;
    haltScene(scene);
    // Une zone : le déclencheur y a mis le pied, on le recale sur sa case. Un coffre, une porte : il est déjà arrêté devant.
    if ( triggerer && (h.kind === "zone") ) snapToCell(triggerer);
    await h.update({ armed: false, triggeredAt: game.time.worldTime, "hidden.found": true });
    const targets = targetsOf(h, triggerer);
    const activity = await activityOf(h, targets);
    if ( !activity ) { log.warn(`trap ${h.uuid}: no actor or activity`); return false; }
    log.info(`trap ${h.name || h.kind}: ${activity.name || activity.item.name} on ${targets.map(t => t.name).join(", ") || "nobody"}`
      + (triggerer ? ` (triggered by ${triggerer.name})` : ""));
    // Hook public : un module d'animation peut jouer le piège (BLFX ne joue rien sans token source, et l'acteur piège n'en a
    // pas). On ne connaît pas qui l'écoute. `behavior` : le comportement (zone ou conteneur), null pour une porte (`wall`).
    Hooks.callAll(TRAP_FIRED_HOOK, { behavior: h.wall ? null : h.doc, region: h.region, effectRegion: effectRegionOf(h),
      actor: activity.actor, activity, triggerer, targets, kind: h.kind, wall: h.wall });
    await useOnTargets(activity, scene, targets);
    return true;
  } catch(err) {
    log.warn("trap:", err.message);
    return false;
  } finally {
    firing.delete(h.uuid);
  }
}

/**
 * L'activité utilisée par le MJ sur ces cibles : dnd5e lit les cibles de l'utilisateur au moment de l'utilisation, il faut
 * donc les désigner, sur la scène affichée par le MJ. Ses cibles d'avant lui sont rendues.
 */
async function useOnTargets(activity, scene, targets) {
  if ( canvas.scene !== scene ) log.warn("trap: the GM is not viewing the trap's scene, the activity goes off without targets");
  const before = [...game.user.targets].map(t => t.id);
  const viewed = canvas.scene === scene;
  if ( viewed ) canvas.tokens.setTargets(targets.map(t => t.id), { mode: "replace" });
  try {
    // Sans gabarit : la zone d'effet est la nôtre. Un piège du DMG 2024 en déclare un (la Statue au souffle de feu : un cône
    // de 15 ft) que dnd5e ferait poser à la souris (activity/mixin.mjs:449-451, `create.measuredTemplate`).
    await activity.use({ ...engineUsageConfig(), consume: false, create: { measuredTemplate: false } }, { configure: false },
      engineGivenTargetsMessage());
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
  if ( !token || !armedNow(trapHandle(behavior)) || !lowEnough(behavior, token) ) return;
  if ( event.user?.isSelf ) { try { token.stopMovement(); } catch(err) { /* déjà arrêté */ } }
  if ( isActiveGM() ) fireTrap(behavior, token);
}

/* -------------------------------------------- */
/*  Coffres et portes : ouvrir                  */
/* -------------------------------------------- */

/**
 * Chez le MJ actif : un coffre ou une porte piégé vient d'être ouvert (`open`) ou sa serrure vient de résister (`pick`) par ce
 * token. Le piège part s'il est armé et réglé pour ce moment. Rend true s'il est parti.
 */
export async function springTrap(target, looter, moment) {
  const h = asHandle(target);
  if ( !h || (h.kind === "zone") || !armedNow(h) || !triggersOn(h.trap, moment) ) return false;
  return fireTrap(h, looter);
}

/** Demander au MJ de faire partir le piège de ce coffre ou de cette porte, ouvert par ce token. */
export function requestSpring(target, looter, moment) {
  const h = asHandle(target);
  if ( !h || !looter || !armedNow(h) || !triggersOn(h.trap, moment) ) return Promise.resolve(null);
  return askGM(TRIGGER_QUERY, handleTrigger, { target: h.uuid, looter: looter.uuid, moment }).catch(err => {
    log.warn("trap:", err.message);
    return null;
  });
}

async function handleTrigger({ target, looter: looterUuid, moment }, { user }) {
  const h = trapHandle(fromUuidSync(target, { strict: false }));
  const looter = fromUuidSync(looterUuid, { strict: false });
  if ( !h || !looter?.actor ) throw new Error(loc("Refus.Introuvable"));
  if ( !looter.actor.testUserPermission(user, "OWNER") ) throw new Error(loc("Refus.PasAToi"));
  return { fired: await springTrap(h, looter, moment) };
}

/**
 * Chez le joueur, avant d'ouvrir un coffre ou une porte dont le piège est **repéré** et armé pour l'un de ces moments : désamorcer,
 * ouvrir quand même, ou renoncer. Rend true s'il peut ouvrir (piège inconnu, désamorcé à l'instant, ou ouvert quand même).
 */
export async function trapGate(target, looter, moments=["open"]) {
  const h = asHandle(target);
  if ( !h || !handleKnown(h) || !armedNow(h) || !moments.some(m => triggersOn(h.trap, m)) ) return true;
  const name = foundry.utils.escapeHTML(h.name || loc(h.wall ? "TrappedTrap.ThisDoor" : "TrappedTrap.ThisContainer"));
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("TrappedTrap.GateTitle"), icon: "fa-solid fa-burst" },
    content: `<p>${loc("TrappedTrap.GateText", { name })}</p>`,
    buttons: [
      { action: "disarm", label: loc("TrappedTrap.GateDisarm"), icon: "fa-solid fa-screwdriver-wrench", default: true },
      { action: "open", label: loc("TrappedTrap.GateOpen"), icon: "fa-solid fa-triangle-exclamation" },
      { action: "cancel", label: loc("TrapZone.ConfirmNo") }
    ],
    rejectClose: false
  }).catch(() => null);
  if ( choice === "open" ) return true;
  if ( choice !== "disarm" ) return false;
  const result = await requestDisarm(h, looter, { confirm: false });
  return result?.ok === true;
}

/* -------------------------------------------- */
/*  Repéré : éviter, désamorcer                 */
/* -------------------------------------------- */

/**
 * Chez le MJ : la région d'un piège repéré (et pas désamorcé) est à éviter par le chemin du moteur ; sinon, plus. Seulement les
 * zones « DAS · Piège » : un coffre ou une porte piégé ne part pas quand on passe à côté.
 */
async function syncAvoid(behavior) {
  const region = behavior.region;
  if ( !region ) return;
  await setEngineAvoid(region, trapKnown(behavior));
}

/**
 * Désamorcer : le joueur lance son test d'outils de voleur (dés visibles, sans dialogue, comme le crochetage), le MJ compare
 * au DD du piège. Échec : rien, ou le piège part, selon son réglage.
 */
export async function requestDisarm(target, looter, { confirm=true }={}) {
  const h = asHandle(target);
  if ( !h ) return null;
  if ( !looter ) { ui.notifications.warn(loc("Window.NoLooter")); return null; }
  // 0.14.3 (retour de séance) : confirmer avant le jet — un clic sur le piège ne doit pas lancer les dés par mégarde. Ni le DD ni
  // l'issue d'un échec ne sont dits. (Déjà demandé par `trapGate` devant un coffre ou une porte.)
  if ( confirm ) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: loc("TrapZone.ConfirmTitle"), icon: "fa-solid fa-screwdriver-wrench" },
      content: `<p>${loc("TrapZone.ConfirmText", { name: foundry.utils.escapeHTML(looter.name ?? ""), trap: foundry.utils.escapeHTML(h.name || loc("TrapZone.ThisTrap")) })}</p>`,
      yes: { label: loc("TrapZone.ConfirmYes"), icon: "fa-solid fa-dice-d20" },
      no: { label: loc("TrapZone.ConfirmNo") },
      rejectClose: false
    }).catch(() => false);
    if ( !ok ) return null;
  }
  const rolls = await looter.actor.rollToolCheck({ tool: "thief", target: h.trap.disarmDc }, { configure: false });
  const total = rolls?.[0]?.total;
  if ( total === undefined ) return null;
  const result = await askGM(DISARM_QUERY, handleDisarm, { behavior: h.uuid, looter: looter.uuid, total });
  if ( result?.ok === true ) ui.notifications.info(loc("TrapZone.Disarmed"));
  else if ( result?.ok === false ) ui.notifications.warn(loc(result.fired ? "TrapZone.DisarmFired" : "TrapZone.DisarmFailed"));
  return result;
}

async function handleDisarm({ behavior: uuid, looter: looterUuid, total }, { user }) {
  const h = trapHandle(fromUuidSync(uuid, { strict: false }));
  const looter = fromUuidSync(looterUuid, { strict: false });
  if ( !h || !looter?.actor ) throw new Error(loc("Refus.Introuvable"));
  if ( !looter.actor.testUserPermission(user, "OWNER") ) throw new Error(loc("Refus.PasAToi"));
  if ( !user.isGM && !handleKnown(h) ) throw new Error(loc("Refus.Introuvable"));
  if ( !user.isGM && (handleDistance(looter, h) > sceneSetting("reach", looter.parent)) ) throw new Error(loc("Refus.Loin"));
  if ( h.trap.disarmed ) return { ok: true };
  if ( Number(total) >= h.trap.disarmDc ) {
    await h.update({ disarmed: true, armed: false });
    log.info(`trap ${h.name || h.kind}: disarmed by ${looter.name} (${total})`);
    return { ok: true };
  }
  if ( (h.trap.failure === "trigger") && armedNow(h) ) {
    await fireTrap(h, looter);
    return { ok: false, fired: true };
  }
  return { ok: false, fired: false };
}

/* -------------------------------------------- */
/*  DD lus dans un piège du DMG                 */
/* -------------------------------------------- */

/**
 * Chez le MJ : quand un piège reçoit son acteur (création, ou acteur changé), ses DD de détection et de désamorçage sont lus
 * dans le texte de ses capacités (core/traps.mjs : les liens de jet du DMG 2024). Une seule fois par acteur (marque
 * `checksFrom` sur une zone, `trapChecksFrom` sur un coffre ou une porte) : une retouche à la main n'est pas écrasée. Un acteur
 * sans test (fait main) : rien.
 */
export async function applyTrapChecks(target) {
  const h = asHandle(target);
  const uuid = h?.trap.actor;
  const flag = (h?.kind === "zone") ? "checksFrom" : "trapChecksFrom";
  if ( !uuid || (h.doc.getFlag(MODULE_ID, flag) === uuid) ) return;
  const actor = await fromUuid(uuid);
  if ( !actor ) return;
  const texts = actor.items.contents.flatMap(i => [i.system.description?.value ?? "",
    ...(i.system.activities?.contents ?? []).map(a => a.description?.chatFlavor ?? "")]);
  const found = trapChecks(texts);
  if ( found ) {
    await h.update({ "hidden.skill": found.hidden.skill, "hidden.dc": found.hidden.dc, disarmDc: found.disarmDc, failure: found.failure });
    log.info(`trap ${h.name || h.kind}: DCs read from ${actor.name} — detection ${found.hidden.skill} ${found.hidden.dc}, `
      + `disarm ${found.disarmDc} (${found.failure})`);
  }
  await h.doc.setFlag(MODULE_ID, flag, uuid);
}

/** Les pièges repérés d'une scène, désamorçables (pour la souris). */
export function knownTraps(scene) {
  return sceneTraps(scene).filter(b => trapKnown(b));
}

/** Les pièges de coffre et de porte repérés d'une scène (pour le dessin en rouge). */
export function knownTrapped(scene) {
  return trappedThings(scene).filter(handleKnown);
}

/* -------------------------------------------- */
/*  Portes piégées                              */
/* -------------------------------------------- */

const OPEN_OK = `${MODULE_ID}TrapOk`;
const openState = () => CONST.WALL_DOOR_STATES.OPEN;

/**
 * Celui qui ouvre une porte : le token le plus proche de la porte, à deux fois la portée, parmi ceux de cet utilisateur. Pour le MJ :
 * un personnage de joueur d'abord, sinon n'importe quelle créature (un PNJ qu'il fait passer, une table sans joueur). Null si
 * personne n'est près (le MJ qui ouvre une porte en préparant la carte).
 */
function openerOf(wall, user) {
  const reach = sceneSetting("reach", wall.parent) * 2;
  const nearest = tokens => {
    let best = null, bestDistance = Infinity;
    for ( const token of tokens ) {
      const d = handleDistance(token, { wall });
      if ( (d <= reach) && (d < bestDistance) ) { best = token; bestDistance = d; }
    }
    return best;
  };
  const withActor = wall.parent.tokens.filter(t => t.actor);
  if ( !user.isGM ) return nearest(withActor.filter(t => t.actor.testUserPermission(user, "OWNER")));
  return nearest(withActor.filter(t => t.actor.hasPlayerOwner)) ?? nearest(withActor);
}

/**
 * Chez le joueur qui ouvre une porte au piège **repéré** (clic du cœur sur l'icône de porte, ou « Ouvrir » du moteur — tous deux
 * écrivent `ds`) : l'ouverture est suspendue le temps de choisir (désamorcer, ouvrir quand même, renoncer), puis rejouée.
 */
function onPreUpdateWall(wall, changes, options) {
  if ( game.user.isGM || (changes.ds !== openState()) || options[OPEN_OK] ) return;
  const h = trapHandle(wall);
  if ( !h || !handleKnown(h) || !armedNow(h) || !triggersOn(h.trap, "open") ) return;
  (async () => {
    if ( !(await trapGate(h, openerOf(wall, game.user), ["open"])) ) return;
    if ( wall.ds === openState() ) return;
    await wall.update({ ds: openState() }, { [OPEN_OK]: true });
  })().catch(err => log.warn("trapped door:", err.message));
  return false;
}

/** Chez le MJ actif : une porte piégée vient de s'ouvrir — le piège part sur celui qui l'a ouverte. */
function onUpdateWall(wall, changes, options, userId) {
  if ( !isActiveGM() || (changes.ds !== openState()) || !isDoorWall(wall) ) return;
  const h = trapHandle(wall);
  if ( !h || !armedNow(h) || !triggersOn(h.trap, "open") ) return;
  const opener = openerOf(wall, game.users.get(userId) ?? game.user);
  if ( !opener ) { log.info(`trapped door ${wall.id}: opened with nobody near, the trap stays armed`); return; }
  springTrap(h, opener, "open");
}

/** Chez le MJ actif : un crochetage de porte raté par le moteur (hook public `lockAttempt`) fait partir un piège réglé pour. */
function onLockAttempt({ door, token, method, outcome }={}) {
  if ( !isActiveGM() || (method !== "pick") || (outcome !== "failure") ) return;
  const h = trapHandle(door?.document ?? door);
  if ( h ) springTrap(h, token?.document ?? token, "pick");
}

/** Le menu de la porte du moteur (hook public `doorMenu`) : « Désamorcer le piège » sur une porte au piège repéré. */
function onDoorMenu(entries, { token, wall }={}) {
  const h = trapHandle(wall?.document ?? wall);
  const looter = token?.document ?? token;
  if ( !h || !handleKnown(h) || !looter?.actor ) return;
  entries.push({ icon: "fa-solid fa-screwdriver-wrench", label: loc("TrappedTrap.Disarm"), run: () => requestDisarm(h, looter) });
}

/**
 * « DAS · Porte piégée », ajouté à la fenêtre de configuration d'un mur, chez le MJ (même geste que les réglages d'un mur caché,
 * runtime/hidden.mjs). Les champs s'écrivent dans `flags.darsh-loot.trap` ; un acteur se glisse sur son champ.
 */
function onRenderWallConfig(app, html) {
  if ( !game.user.isGM ) return;
  const root = (html instanceof HTMLElement) ? html : app.element;
  if ( !root || root.querySelector(".dlo-wall-trap") ) return;
  const raw = app.document?.getFlag(MODULE_ID, "trap") ?? {};
  const t = normalizeTrap(raw);
  const h = normalizeHidden({ enabled: true, ...(raw.hidden ?? {}) });
  const name = key => `flags.${MODULE_ID}.trap.${key}`;
  const L = key => loc(`TrappedTrap.Door.${key}`);
  const esc = text => foundry.utils.escapeHTML(String(text ?? ""));
  const row = (label, input) => `<div class="form-group"><label>${esc(label)}</label><div class="form-fields">${input}</div></div>`;
  const check = (key, on) => `<input type="checkbox" name="${name(key)}" ${on ? "checked" : ""}>`;
  const number = (key, value, min, step=1) => `<input type="number" min="${min}" step="${step}" name="${name(key)}" value="${value ?? ""}" data-dtype="Number">`;
  const text = (key, value, extra="") => `<input type="text" name="${name(key)}" value="${esc(value ?? "")}" ${extra}>`;
  const select = (key, value, options) => `<select name="${name(key)}">${Object.entries(options)
    .map(([v, label]) => `<option value="${v}" ${v === value ? "selected" : ""}>${esc(loc(label))}</option>`).join("")}</select>`;
  const fieldset = document.createElement("fieldset");
  fieldset.className = "dlo-wall-trap";
  fieldset.innerHTML = `
    <legend>${esc(L("Legend"))}</legend>
    <p class="hint">${esc(L("Hint"))}</p>
    ${row(L("Enabled"), check("enabled", t.enabled))}
    ${row(L("Actor"), text("actor", t.actor, `placeholder="Actor.…" data-dlo-drop="Actor"`))}
    ${row(L("Activity"), text("activity", t.activity))}
    ${row(L("EffectRegion"), text("effectRegion", t.effectRegion, `placeholder="Scene.….Region.…"`))}
    ${row(L("Trigger"), select("trigger", t.trigger, { open: "TrappedTrap.Trigger.Open", pick: "TrappedTrap.Trigger.Pick", both: "TrappedTrap.Trigger.Both" }))}
    ${row(L("Armed"), check("armed", t.armed))}
    ${row(L("Rearm"), select("rearm", t.rearm, { never: "TrapZone.Rearm.Never", gm: "TrapZone.Rearm.Gm", time: "TrapZone.Rearm.Time" }))}
    ${row(L("Delay"), number("delay", t.delay, 0))}
    ${row(L("DisarmDc"), number("disarmDc", t.disarmDc, 1))}
    ${row(L("Failure"), select("failure", t.failure, { nothing: "TrapZone.Failure.Nothing", trigger: "TrapZone.Failure.Trigger" }))}
    ${row(L("Disarmed"), check("disarmed", t.disarmed))}
    ${row(L("HiddenEnabled"), check("hidden.enabled", h.enabled))}
    ${row(loc("Hidden.Wall.Skill"), select("hidden.skill", h.skill, { prc: "DND5E.SkillPrc", inv: "DND5E.SkillInv" }))}
    ${row(loc("Hidden.Wall.Dc"), number("hidden.dc", h.dc, 1))}
    ${row(loc("Hidden.Wall.Passive"), number("hidden.passive", h.passive, 0, 5))}
    ${row(loc("Hidden.Wall.Radius"), number("hidden.radius", h.radius, 0, 5))}
    ${row(loc("Hidden.Wall.Found"), check("hidden.found", h.found))}
    ${row(loc("Hidden.Wall.Text"), text("hidden.text", h.text))}`;
  // Glisser un acteur (barre latérale, compendium) sur son champ y écrit son UUID.
  fieldset.querySelector("[data-dlo-drop]")?.addEventListener("drop", event => {
    const TextEditor = foundry.applications.ux.TextEditor.implementation;
    const data = TextEditor.getDragEventData(event);
    if ( (data?.type !== "Actor") || !data.uuid ) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.value = data.uuid;
  });
  const footer = root.querySelector(".form-footer");
  if ( footer ) footer.before(fieldset);
  else root.append(fieldset);
  app.setPosition?.({ height: "auto" });
}

/* -------------------------------------------- */
/*  Inscription                                 */
/* -------------------------------------------- */

export function registerTrapsInit() {
  registerTrapBehavior();
  TrapZoneType.onEnter = onEnter;
  CONFIG.queries[DISARM_QUERY] = handleDisarm;
  CONFIG.queries[TRIGGER_QUERY] = handleTrigger;
}

export function registerTraps() {
  const sync = behavior => {
    if ( !isActiveGM() || (behavior.type !== TRAP_ZONE) ) return;
    syncAvoid(behavior);
    applyTrapChecks(behavior).catch(err => log.warn("trap DCs:", err.message));
  };
  route("updateRegionBehavior", "spotted trap", sync);
  route("createRegionBehavior", "spotted trap", sync);
  route("createRegion", "spotted trap", region => { for ( const b of region.behaviors ) sync(b); });
  // 0.16.0 : coffres et portes piégés — DD lus dans l'acteur piège, ouverture, crochetage raté, menu de la porte.
  const syncTrapped = doc => {
    if ( !isActiveGM() || (doc.type === TRAP_ZONE) || !trapHandle(doc) ) return;
    applyTrapChecks(doc).catch(err => log.warn("trap DCs:", err.message));
  };
  route("updateRegionBehavior", "trapped container", syncTrapped);
  route("createRegionBehavior", "trapped container", syncTrapped);
  route("updateWall", "trapped door", syncTrapped);
  route("createWall", "trapped door", syncTrapped);
  route("updateWall", "trapped door", onUpdateWall);
  routeClaim("preUpdateWall", "trapped door", onPreUpdateWall);
  route(LOCK_ATTEMPT_HOOK, "trapped door", onLockAttempt);
  route(DOOR_MENU_HOOK, "menu: disarm a trapped door", onDoorMenu);
  route("renderWallConfig", "trapped door settings", onRenderWallConfig);
}
