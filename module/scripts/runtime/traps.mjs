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
import { MODULE_ID, loc, log, setting, sceneSetting } from "../shared.mjs";
import { route, routeClaim } from "./router.mjs";
import { askGM } from "./take.mjs";
import { channel, feedbackCard, SOUNDS } from "./feedback.mjs";
import { waitForDice, newRollMessage } from "../adapter/dice.mjs";
import { haltScene } from "./hidden.mjs";
import { TRAP_ZONE, TRAP_RELAY, TrapZoneType, TrapRelayType, registerTrapBehavior, sceneTraps, relaysOf } from "../adapter/trap-behavior.mjs";
import { trapLevelOf, creatureSize } from "../adapter/dnd5e.mjs";
import { trapHandle, handleKnown, sourceKnown, anyKnown, handleDistance, trapDistance, trappedThings, allTraps, isDoorWall,
  isTrapActor, isTrapToken, sceneTrapTokens, autoRegionOf } from "../adapter/trapped.mjs";
import { trapChecks, pickTier, targetsLevel, armedAt, triggersOn, normalizeTrap, bigEnough, migrateZoneTrap, SIZES }
  from "../core/traps.mjs";
import { normalizeHidden, concealed } from "../core/hidden.mjs";
import { addPickButtons, DOOR_PICKS } from "./pick.mjs";
import { askTrapResolution } from "../apps/trap-window.mjs";
import { engineUsageConfig, engineGivenTargetsMessage, setEngineAvoid, engineCombatEvents, engineObjectToken, engineObjectFlags,
  LOCK_ATTEMPT_HOOK,
  DOOR_MENU_HOOK, EVENT_TURN_HOOK } from "../adapter/engine.mjs";

const DISARM_QUERY = `${MODULE_ID}.disarm`;
const TRIGGER_QUERY = `${MODULE_ID}.trapTrigger`;
/** Émis chez le MJ actif quand un piège part : `{ behavior, region (déclencheur), effectRegion, source (0.17.0), actor, activity, triggerer, targets, kind, wall }`. */
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
function lowEnough(h, token) {
  return (token._source.elevation ?? 0) <= groundOf(h.triggerRegion, token) + (Number(h.trap.height) || 0);
}

/** 0.17.0 : la créature est-elle assez grande pour faire partir ce piège (Petite par défaut : un rat passe) ? */
const heavyEnough = (h, token) => bigEnough(creatureSize(token), h.trap.minSize);

/**
 * La zone d'effet (adapter/trapped.mjs) : une zone « DAS · Piège », sa région ; un coffre ou une porte, la région désignée ou aucune
 * (le piège ne touche que celui qui ouvre).
 */
const effectRegionOf = h => h.effectRegion ?? null;

/** Les créatures dans la zone d'effet (centre dans un de ses polygones, même niveau). */
function tokensIn(region) {
  return region.parent.tokens.filter(t => {
    // Pas un objet : le token piège lui-même (0.17.0, il est dans sa propre région), une arme spirituelle.
    if ( isTrapToken(t) || engineObjectToken(t) ) return false;
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
 * s'arrête. En mode simple, l'acteur piège utilise aussitôt son activité sur les cibles, par le moteur. En mode avancé (0.17.0,
 * réglage `advancedTraps`) : hors combat, pause, combat avec la scène, le piège à son initiative ; en combat, la fenêtre du MJ tout
 * de suite. Rend true si le piège est parti (ou attend son tour).
 */
export async function fireTrap(target, triggerer=null) {
  const h = asHandle(target);
  if ( !h || firing.has(h.uuid) ) return false;
  firing.add(h.uuid);
  try {
    haltScene(h.scene);
    // Une zone : le déclencheur y a mis le pied, on le recale sur sa case. Un coffre, une porte : il est déjà arrêté devant.
    if ( triggerer && ["zone", "token"].includes(h.kind) ) snapToCell(triggerer);
    const known = anyKnown(h);
    await h.update({ armed: false, triggeredAt: game.time.worldTime, "hidden.found": true, "source.hidden.found": true });
    if ( setting("advancedTraps") && engineCombatEvents() ) return await springAdvanced(h, triggerer, { surprise: !known });
    return await resolveTrap(h, triggerer);
  } catch(err) {
    log.warn("trap:", err.message);
    return false;
  } finally {
    firing.delete(h.uuid);
  }
}

/**
 * Le piège frappe : l'acteur piège utilise son activité sur les cibles. Sans choix du MJ (mode simple) : les cibles de la zone d'effet
 * et la tranche selon leur niveau. `choice` (mode avancé) : `{ targets, modes, activity }` de la fenêtre du MJ.
 */
async function resolveTrap(h, triggerer, choice=null) {
  const scene = h.scene;
  const targets = choice ? choice.targets : targetsOf(h, triggerer);
  const activity = choice?.activity ?? await activityOf(h, targets);
  if ( !activity ) { log.warn(`trap ${h.uuid}: no actor or activity`); return false; }
  const modes = choice?.modes ?? {};
  const favours = Object.entries(modes).map(([uuid, mode]) => `${fromUuidSync(uuid, { strict: false })?.name}: ${mode}`);
  log.info(`trap ${h.name || h.kind}: ${activity.name || activity.item.name} on ${targets.map(t => t.name).join(", ") || "nobody"}`
    + (triggerer ? ` (triggered by ${triggerer.name})` : "") + (favours.length ? ` — ${favours.join(", ")}` : ""));
  // Hook public : un module d'animation peut jouer le piège (BLFX ne joue rien sans token source, et l'acteur piège n'en a
  // pas). On ne connaît pas qui l'écoute. `behavior` : le comportement (zone ou conteneur), null pour une porte (`wall`).
  Hooks.callAll(TRAP_FIRED_HOOK, { behavior: h.wall ? null : h.doc, region: h.triggerRegion ?? h.region, effectRegion: effectRegionOf(h),
    source: h.source.doc,
    actor: activity.actor, activity, triggerer, targets, kind: h.kind, wall: h.wall, token: h.token ?? null });
  // Un jet d'attaque vaut pour toutes ses cibles : des faveurs différentes font une attaque par groupe (le moteur, son §249, n'inverse
  // le mode sur le jet que si ses cibles s'accordent). Une sauvegarde est demandée à chacune avec son mode : une seule utilisation.
  if ( (activity.type === "attack") && (new Set(targets.map(t => modes[t.uuid] ?? "")).size > 1) ) {
    for ( const group of Object.values(Object.groupBy(targets, t => modes[t.uuid] ?? "")) ) await useOnTargets(activity, scene, group, modes);
  } else await useOnTargets(activity, scene, targets, modes);
  return true;
}

/**
 * L'activité utilisée par le MJ sur ces cibles : dnd5e lit les cibles de l'utilisateur au moment de l'utilisation, il faut
 * donc les désigner, sur la scène affichée par le MJ. Ses cibles d'avant lui sont rendues. `modes` : la faveur donnée par cible.
 */
async function useOnTargets(activity, scene, targets, modes={}) {
  if ( canvas.scene !== scene ) log.warn("trap: the GM is not viewing the trap's scene, the activity goes off without targets");
  const before = [...game.user.targets].map(t => t.id);
  const viewed = canvas.scene === scene;
  if ( viewed ) canvas.tokens.setTargets(targets.map(t => t.id), { mode: "replace" });
  const given = Object.fromEntries(targets.filter(t => modes[t.uuid]).map(t => [t.uuid, modes[t.uuid]]));
  try {
    // Sans gabarit : la zone d'effet est la nôtre. Un piège du DMG 2024 en déclare un (la Statue au souffle de feu : un cône
    // de 15 ft) que dnd5e ferait poser à la souris (activity/mixin.mjs:449-451, `create.measuredTemplate`).
    await activity.use({ ...engineUsageConfig(), consume: false, create: { measuredTemplate: false } }, { configure: false },
      engineGivenTargetsMessage(given));
  } finally {
    if ( viewed ) canvas.tokens.setTargets(before.filter(id => canvas.tokens.get(id)), { mode: "replace" });
  }
}

/* -------------------------------------------- */
/*  Mode piège avancé (0.17.0)                  */
/* -------------------------------------------- */

/** La clé de l'évènement d'initiative d'un piège. */
const eventKey = h => `${MODULE_ID}.trap:${h.uuid}`;

/** Le combat commencé de cette scène, s'il y en a un. */
const combatOf = scene => game.combats.find(c => c.started && (c.scene?.id === scene.id)) ?? null;

/**
 * Chez le MJ actif, en mode avancé. **En combat** : on ne relance pas l'initiative, la fenêtre du MJ s'ouvre tout de suite. **Hors
 * combat** : le jeu se met en pause, un combat est créé avec les créatures de la scène, ceux qui n'avaient repéré ni le déclencheur
 * ni la source sont **Surpris** (dnd5e : Désavantage à l'initiative ; le moteur retire l'état une fois l'initiative lancée), le piège
 * entre dans l'initiative comme **évènement temporaire** du moteur (son §250), à son initiative, pour le round 1, et l'initiative est
 * tirée. La fenêtre s'ouvre à son tour (`onEventTurn`).
 */
async function springAdvanced(h, triggerer, { surprise }) {
  const scene = h.scene;
  if ( combatOf(scene) ) {
    judgeTrap(h, triggerer, null);
    return true;
  }
  if ( !game.paused ) game.togglePause(true, { broadcast: true });
  const combat = await foundry.documents.Combat.implementation.create({ scene: scene.id, active: true });
  const tokens = scene.tokens.filter(t => t.actor && !t.actor.statuses?.has("dead") && !engineObjectToken(t));
  await combat.createEmbeddedDocuments("Combatant", tokens.map(t => ({ tokenId: t.id, sceneId: scene.id, actorId: t.actorId, hidden: t.hidden })));
  // Surpris : les personnages des joueurs, quand personne n'avait repéré le piège (la découverte est commune à la table).
  if ( surprise ) {
    for ( const t of tokens.filter(t => t.actor.hasPlayerOwner) ) {
      try { await t.actor.toggleStatusEffect("surprised", { active: true }); }
      catch(err) { log.warn(`trap: ${t.name} not Surprised`, err.message); }
    }
  }
  const actor = h.trap.actor ? await fromUuid(h.trap.actor) : null;
  await engineCombatEvents().addEvent({ combat, name: h.name || actor?.name || loc("TrapZone.ThisTrap"), img: actor?.img ?? null,
    initiative: h.trap.initiative, rounds: 1, key: eventKey(h), data: { trap: h.uuid, triggerer: triggerer?.uuid ?? null } });
  await combat.rollAll();
  await combat.startCombat();
  log.info(`trap ${h.name || h.kind}: combat started, trap at initiative ${h.trap.initiative}${surprise ? ", characters Surprised" : ""}`);
  return true;
}

/** Le tour d'un évènement d'initiative (moteur, son §250), chez le MJ actif : celui d'un piège ouvre la fenêtre du MJ. */
function onEventTurn({ combat, combatant, data }={}) {
  if ( !isActiveGM() || !data?.trap ) return;
  const h = trapHandle(fromUuidSync(data.trap, { strict: false }));
  if ( !h ) { log.warn(`trap ${data.trap}: gone, its turn is skipped`); combat?.nextTurn(); return; }
  const triggerer = data.triggerer ? fromUuidSync(data.triggerer, { strict: false }) : null;
  judgeTrap(h, triggerer, { combat, combatant });
}

const judging = new Set();

/**
 * La fenêtre du MJ (apps/trap-window.mjs) sur les créatures **à ce moment** dans la zone d'effet (elles ont pu en sortir avant le tour
 * du piège), puis le piège frappe, ou non. À son tour, le tour passe ensuite.
 */
async function judgeTrap(h, triggerer, turn) {
  if ( judging.has(h.uuid) ) return;
  judging.add(h.uuid);
  try {
    const targets = targetsOf(h, triggerer);
    const proposed = await activityOf(h, targets);
    const answer = await askTrapResolution({
      name: h.name || proposed?.item?.name || loc("TrapZone.ThisTrap"),
      targets: targets.map(t => ({ uuid: t.uuid, name: t.name, img: t.texture?.src ?? t.actor?.img ?? null })),
      activities: (proposed?.item.system.activities.contents ?? []).map(a => ({ id: a.id, name: a.name || a.item.name })),
      activity: proposed?.id ?? null,
      attack: proposed?.type === "attack"
    });
    if ( !answer.fire ) log.info(`trap ${h.name || h.kind}: cancelled by the GM`);
    else {
      const chosen = proposed?.item.system.activities.get(answer.activity) ?? proposed;
      const picked = answer.targets.map(uuid => targets.find(t => t.uuid === uuid)).filter(Boolean);
      await resolveTrap(h, triggerer, { targets: picked, modes: answer.modes, activity: chosen });
    }
  } catch(err) {
    log.warn("trap:", err.message);
  } finally {
    judging.delete(h.uuid);
    if ( turn?.combat && (turn.combat.combatant?.id === turn.combatant?.id) ) await turn.combat.nextTurn();
  }
}

/**
 * L'évènement du cœur : un token entre dans la zone de déclenchement. Son client l'arrête (seul le client qui déplace le
 * peut, documents/token.mjs:762) ; le MJ actif juge et déclenche.
 */
function onEnter(behavior, event) {
  // 0.17.0 : la région du piège n'est son déclencheur que si aucun autre n'est désigné (sinon c'est le relais qui prévient).
  const h = trapHandle(behavior);
  if ( h && (h.triggerRegion === behavior.region) ) entered(h, event);
}

/** L'évènement du cœur sur un relais (0.17.0) : un token entre dans le déclencheur désigné d'un piège posé ailleurs. */
function onRelayEnter(relay, event) {
  const h = trapHandle(relay);
  if ( h && ["zone", "token"].includes(h.kind) && (h.triggerRegion === relay.region) ) entered(h, event);
}

function entered(h, event) {
  const token = event.data?.token;
  // Un objet (un token piège, une arme spirituelle) ne déclenche rien.
  if ( !token || isTrapToken(token) || engineObjectToken(token) ) return;
  if ( !armedNow(h) || !lowEnough(h, token) || !heavyEnough(h, token) ) return;
  if ( event.user?.isSelf ) { try { token.stopMovement(); } catch(err) { /* déjà arrêté */ } }
  if ( isActiveGM() ) fireTrap(h, token);
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
  // 0.17.0 : une créature trop petite (un familier Très petit qui soulève le couvercle) ne le fait pas partir.
  if ( looter && !heavyEnough(h, looter) ) return false;
  return fireTrap(h, looter);
}

/** Demander au MJ de faire partir le piège de ce coffre ou de cette porte, ouvert par ce token. */
export function requestSpring(target, looter, moment) {
  const h = asHandle(target);
  if ( !h || !looter || !armedNow(h) || !triggersOn(h.trap, moment) || !heavyEnough(h, looter) ) return Promise.resolve(null);
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
  if ( !h || !anyKnown(h) || !armedNow(h) || !moments.some(m => triggersOn(h.trap, m)) ) return true;
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
 * Chez le MJ : le déclencheur d'un piège repéré (et pas désamorcé) est à éviter par le chemin du moteur ; sinon, plus. Seulement les
 * zones « DAS · Piège » : un coffre ou une porte piégé ne part pas quand on passe à côté. 0.17.0 : le déclencheur peut être une autre
 * région que celle du piège ; on note sur la région que c'est nous qui l'avons marquée (`avoidByTrap`), pour ne retirer que nos marques
 * (darsh-npc et d'autres posent aussi des régions à éviter).
 */
async function syncAvoid(scene) {
  if ( !scene ) return;
  const wanted = new Set([...sceneTraps(scene), ...sceneTrapTokens(scene)].map(trapHandle).filter(h => h?.triggerRegion && handleKnown(h))
    .map(h => h.triggerRegion));
  for ( const region of scene.regions ) {
    const ours = region.getFlag(MODULE_ID, "avoidByTrap") === true;
    if ( wanted.has(region) && !ours ) {
      await setEngineAvoid(region, true);
      await region.setFlag(MODULE_ID, "avoidByTrap", true);
    } else if ( !wanted.has(region) && ours ) {
      await setEngineAvoid(region, false);
      await region.unsetFlag(MODULE_ID, "avoidByTrap");
    }
  }
}

/* -------------------------------------------- */
/*  Relais et reprise de la 0.16.0              */
/* -------------------------------------------- */

/**
 * Chez le MJ : chaque piège dont le déclencheur est une autre région y a un relais, et un seul ; un relais dont le piège n'existe
 * plus, ou désigne une autre région, est retiré.
 */
async function syncRelays(scene) {
  if ( !scene ) return;
  const wanted = new Map();   // région du déclencheur → UUID des pièges
  // 0.17.0 (étape 11 bis) : un token piège a toujours son relais, sur son déclencheur ou sur la région posée sous lui.
  for ( const h of [...sceneTraps(scene).map(trapHandle).filter(Boolean), ...sceneTrapTokens(scene).map(trapHandle)] ) {
    if ( !h.triggerRegion || ((h.kind === "zone") && (h.triggerRegion === h.region)) ) continue;
    if ( !wanted.has(h.triggerRegion) ) wanted.set(h.triggerRegion, new Set());
    wanted.get(h.triggerRegion).add(h.uuid);
  }
  for ( const region of scene.regions ) {
    const want = wanted.get(region) ?? new Set();
    const have = relaysOf(region);
    const stale = have.filter(r => !want.has(r.system.trap)).map(r => r.id);
    const missing = [...want].filter(uuid => !have.some(r => r.system.trap === uuid));
    try {
      if ( stale.length ) await region.deleteEmbeddedDocuments("RegionBehavior", stale);
      if ( missing.length ) await region.createEmbeddedDocuments("RegionBehavior", missing.map(uuid => ({
        type: TRAP_RELAY, name: loc("TrapRelay.Name"), system: { trap: uuid }
      })));
    } catch(err) {
      log.warn(`trap relays of ${region.name}:`, err.message);
    }
  }
}

/**
 * Chez le MJ actif, une fois par monde : les pièges de zone de la 0.16.0 posés sur leur dalle avec une zone d'effet à part sont reposés
 * sur leur zone d'effet, la dalle désignée comme déclencheur (core/traps.mjs `migrateZoneTrap`). Le nouveau comportement est créé
 * avant que l'ancien soit retiré, pour que la dalle reste cachée tout du long. Rend le nombre de pièges repris.
 */
export async function migrateTraps() {
  let moved = 0;
  for ( const scene of game.scenes ) {
    for ( const behavior of sceneTraps(scene) ) {
      const region = behavior.region;
      const m = migrateZoneTrap(behavior.system.toObject(), region.uuid);
      if ( !m ) continue;
      const effect = fromUuidSync(m.effectRegion, { strict: false });
      if ( (effect?.documentName !== "Region") || (effect.parent !== scene) ) {
        log.warn(`trap ${behavior.uuid}: effect area ${m.effectRegion} not found, left as it is`);
        continue;
      }
      try {
        await effect.createEmbeddedDocuments("RegionBehavior", [{ type: TRAP_ZONE, name: behavior.name, disabled: behavior.disabled,
          system: m.system, flags: foundry.utils.deepClone(behavior.flags ?? {}) }]);
        await behavior.delete();
        moved++;
        log.info(`trap ${behavior.system.displayName || region.name}: moved onto its effect area ${effect.name}, triggered by ${region.name}`);
      } catch(err) {
        log.warn(`trap ${behavior.uuid} not migrated:`, err.message);
      }
    }
  }
  return moved;
}

/* -------------------------------------------- */
/*  Tokens pièges (0.17.0, étape 11 bis)        */
/* -------------------------------------------- */

/**
 * À la pose d'un token piège, sur le client qui le pose : un **objet** pour le moteur (ni créature, ni obstacle, ni cible), disposition
 * secrète (ni ami ni ennemi), et caché aux joueurs tant que le piège l'est (`trapShown` retient ce que le module a montré).
 */
function onPreCreateToken(token) {
  if ( !isTrapToken(token) ) return;
  const raw = token.getFlag(MODULE_ID, "trap") ?? {};
  const shown = raw.hidden?.enabled === false;
  token.updateSource({ ...engineObjectFlags(), disposition: CONST.TOKEN_DISPOSITIONS.SECRET, hidden: !shown,
    [`flags.${MODULE_ID}.trap.enabled`]: true, [`flags.${MODULE_ID}.trapShown`]: shown, [`flags.${MODULE_ID}.trapObject`]: true });
}

/**
 * Chez le MJ actif : un token déjà posé qu'on coche « Piège » devient un objet pour le moteur, de disposition secrète ; décoché, il
 * redevient une créature à la disposition de son prototype (seulement si c'est nous qui l'avions fait objet, `trapObject`).
 */
async function syncTrapObject(token) {
  const ours = token.getFlag(MODULE_ID, "trapObject") === true;
  if ( isTrapToken(token) && !engineObjectToken(token) ) {
    await token.update({ ...engineObjectFlags(), disposition: CONST.TOKEN_DISPOSITIONS.SECRET, [`flags.${MODULE_ID}.trapObject`]: true });
  } else if ( !isTrapToken(token) && ours ) {
    await token.update({ ...engineObjectFlags(false), disposition: token.actor?.prototypeToken?.disposition ?? CONST.TOKEN_DISPOSITIONS.HOSTILE,
      [`flags.${MODULE_ID}.-=trapObject`]: null });
  }
}

/** Les cases d'un token, en forme de région. */
function cellsShape(token) {
  const grid = token.parent.grid;
  return { type: "rectangle", x: token._source.x, y: token._source.y,
    width: token._source.width * grid.sizeX, height: token._source.height * grid.sizeY };
}

/**
 * Chez le MJ actif : la région posée sous un token piège (ses cases, son niveau) — son déclencheur et sa zone d'effet par défaut. Elle
 * suit le token (déplacé, agrandi, changé de niveau) et part avec lui.
 */
async function syncAutoRegion(token) {
  const region = autoRegionOf(token);
  if ( !isTrapToken(token) ) { if ( region ) await region.delete(); return; }
  const shape = cellsShape(token);
  const levels = token._source.level ? [token._source.level] : [];
  if ( !region ) {
    await token.parent.createEmbeddedDocuments("Region", [{ name: loc("TrappedTrap.Token.Region", { name: token.name }),
      color: "#e0312b", shapes: [shape], levels, flags: { [MODULE_ID]: { trapToken: token.id } } }]);
    return;
  }
  const now = region.shapes?.[0];
  const same = now && ["x", "y", "width", "height"].every(k => now[k] === shape[k]) && (region.shapes.length === 1)
    && (JSON.stringify([...(region.levels ?? [])]) === JSON.stringify(levels));
  if ( !same ) await region.update({ shapes: [shape], levels });
}

/**
 * Chez le MJ actif : un token piège se montre aux joueurs quand ce qu'il représente est repéré — le déclencheur (le token sur ses
 * cases), ou la source (le token, quand le déclencheur est une dalle ailleurs). On n'écrit que quand cet état change, pour laisser le
 * MJ le montrer ou le cacher à la main entre-temps.
 */
async function syncTokenShown(token) {
  const h = trapHandle(token);
  if ( !h ) return;
  const shown = !concealed((h.source.doc === token) ? h.source.hidden : h.hidden);
  if ( token.getFlag(MODULE_ID, "trapShown") === shown ) return;
  await token.update({ hidden: !shown, [`flags.${MODULE_ID}.trapShown`]: shown });
}

/** Au démarrage, chez le MJ actif : la reprise des pièges, une fois par monde (réglage caché `trapsVersion`). */
async function migrateOnce() {
  if ( !isActiveGM() || (setting("trapsVersion") >= 2) ) return;
  const moved = await migrateTraps();
  for ( const scene of game.scenes ) { await syncRelays(scene); await syncAvoid(scene); }
  await game.settings.set(MODULE_ID, "trapsVersion", 2);
  if ( moved ) log.info(`traps: ${moved} trap(s) moved onto their effect area (0.17.0)`);
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
  // 0.17.1 (règles DAS du 2026-10-27) : le désamorçage prend du temps — annonce publique, barre de progression, ping et bruit
  // d'outils pendant `disarmDuration` secondes ; bouger l'interrompt. Puis le jet, et rien n'est jugé avant la fin des dés 3D.
  const names = { name: looter.name ?? "", trap: h.name || loc("TrapZone.ThisTrap") };
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ token: looter, actor: looter.actor }),
    content: `<p><i class="fa-solid fa-screwdriver-wrench"></i> ${foundry.utils.escapeHTML(loc("TrapZone.DisarmStart", names))}</p>`
  });
  if ( !(await channel(looter, { seconds: Number(setting("disarmDuration")) || 0, label: loc("TrapZone.Disarming", names) })) ) {
    ui.notifications.info(loc("TrapZone.DisarmInterrupted", names));
    return null;
  }
  const known = new Set(game.messages.keys());
  const rolls = await looter.actor.rollToolCheck({ tool: "thief", target: h.trap.disarmDc }, { configure: false });
  const total = rolls?.[0]?.total;
  if ( total === undefined ) return null;
  await waitForDice(newRollMessage(known));
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
  // 0.17.0 : il se désamorce de ce qui en est repéré, son déclencheur ou sa source.
  if ( !user.isGM && !anyKnown(h) ) throw new Error(loc("Refus.Introuvable"));
  if ( !user.isGM && (trapDistance(looter, h) > sceneSetting("reach", looter.parent)) ) throw new Error(loc("Refus.Loin"));
  if ( h.trap.disarmed ) return { ok: true };
  // 0.17.1 : l'issue se voit et s'entend chez tous — carte publique, texte flottant au-dessus du token, son (runtime/feedback.mjs).
  const names = { name: looter.name ?? "", trap: h.name || loc("TrapZone.ThisTrap") };
  if ( Number(total) >= h.trap.disarmDc ) {
    await h.update({ disarmed: true, armed: false });
    log.info(`trap ${h.name || h.kind}: disarmed by ${looter.name} (${total})`);
    await feedbackCard(looter, loc("TrapZone.DisarmCard", names), { kind: "gain", sound: SOUNDS.success, float: loc("TrapZone.FloatDisarmed") });
    return { ok: true };
  }
  if ( (h.trap.failure === "trigger") && armedNow(h) ) {
    await feedbackCard(looter, loc("TrapZone.DisarmFireCard", names), { kind: "refused", sound: SOUNDS.failure, float: loc("TrapZone.FloatFired") });
    await fireTrap(h, looter);
    return { ok: false, fired: true };
  }
  await feedbackCard(looter, loc("TrapZone.DisarmFailCard", names), { kind: "refused", sound: SOUNDS.failure, float: loc("TrapZone.FloatFailed") });
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

/**
 * Les endroits repérés des pièges d'une scène, à désamorcer d'un clic (pour la souris) : `{ h, place }`, où `place` est le déclencheur
 * d'une zone « DAS · Piège » (une région) ou la source d'un piège (une région ou une tuile). Un coffre et une porte se désamorcent
 * aussi par leur menu.
 */
export function knownTrapPlaces(scene) {
  const out = [];
  for ( const h of allTraps(scene) ) {
    if ( h.trap.disarmed ) continue;
    if ( (h.kind === "zone") && h.triggerRegion && handleKnown(h) ) out.push({ h, place: h.triggerRegion });
    if ( h.source.doc && sourceKnown(h) ) out.push({ h, place: h.source.doc });
  }
  return out;
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
  if ( !h || !anyKnown(h) || !armedNow(h) || !triggersOn(h.trap, "open") ) return;
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
  if ( !h || !anyKnown(h) || !looter?.actor ) return;
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
  const fieldset = trapFieldset(app.document?.getFlag(MODULE_ID, "trap") ?? {}, "door");
  fieldset.classList.add("dlo-wall-trap");
  const footer = root.querySelector(".form-footer");
  if ( footer ) footer.before(fieldset);
  else root.append(fieldset);
  addPickButtons(fieldset, DOOR_PICKS, app);
  app.setPosition?.({ height: "auto" });
}

/**
 * 0.17.0 (étape 11 bis) : « DAS · Piège » dans l'onglet Identité de la fenêtre d'un token piège, ou du token prototype d'un acteur piège
 * (PNJ « Trap » du DMG, ou n'importe quel PNJ pour en faire un piège). Le prototype porte le modèle, recopié à chaque pose ; le token
 * posé garde ses propres réglages et son état. Les régions et la source ne se choisissent que sur un token posé (elles sont dans sa scène).
 */
function onRenderTokenConfig(app, html) {
  if ( !game.user.isGM ) return;
  const root = (html instanceof HTMLElement) ? html : app.element;
  const tab = root?.querySelector('.tab[data-tab="identity"]');
  if ( !tab || tab.querySelector(".dlo-token-trap") ) return;
  const prototype = !(app.document?.documentName === "Token");
  const actor = prototype ? (app.actor ?? app.document?.actor ?? app.token?.actor) : app.document.actor;
  if ( actor?.type !== "npc" ) return;
  const raw = (prototype ? actor.prototypeToken?.flags?.[MODULE_ID]?.trap : app.document.getFlag(MODULE_ID, "trap")) ?? {};
  const enabled = (typeof raw.enabled === "boolean") ? raw.enabled : (prototype ? isTrapActor(actor) : isTrapToken(app.document));
  const fieldset = trapFieldset({ ...raw, enabled }, prototype ? "prototype" : "token");
  fieldset.classList.add("dlo-token-trap");
  // Un PNJ qui n'est pas un piège : seule la case « Piège » se voit, le reste se déplie quand on la coche.
  const toggle = fieldset.querySelector(`[name="flags.${MODULE_ID}.trap.enabled"]`);
  const fold = () => {
    for ( const group of fieldset.querySelectorAll(".form-group") ) {
      if ( !group.contains(toggle) ) group.hidden = !toggle.checked;
    }
  };
  toggle?.addEventListener("change", fold);
  fold();
  tab.append(fieldset);
  if ( !prototype ) addPickButtons(fieldset, TOKEN_PICKS, app);
}

/** Les champs d'un token piège qui désignent un endroit (runtime/pick.mjs). */
const TOKEN_PICKS = {
  [`flags.${MODULE_ID}.trap.triggerRegion`]: ["Region"],
  [`flags.${MODULE_ID}.trap.effectRegion`]: ["Region"],
  [`flags.${MODULE_ID}.trap.source.uuid`]: ["Region", "Tile"]
};

/**
 * Les réglages d'un piège (porte, token, token prototype) en champs de formulaire, écrits dans `flags.darsh-loot.trap`. Une porte nomme
 * son acteur piège et le moment où il part ; un token est son acteur, part quand on entre dans ses cases (ou son déclencheur), et peut
 * voler au-dessus (hauteur).
 */
function trapFieldset(raw, kind) {
  const t = normalizeTrap(raw);
  const h = normalizeHidden({ enabled: true, ...(raw.hidden ?? {}) });
  const sh = normalizeHidden({ enabled: true, ...(raw.source?.hidden ?? {}) });
  const name = key => `flags.${MODULE_ID}.trap.${key}`;
  const TOKEN_KEYS = new Set(["Legend", "Hint", "EffectRegion", "Source", "HiddenEnabled", "SourceHidden"]);
  const L = key => loc(((kind !== "door") && TOKEN_KEYS.has(key)) ? `TrappedTrap.Token.${key}` : `TrappedTrap.Door.${key}`);
  const door = kind === "door";
  const placedToken = kind === "token";
  const esc = text => foundry.utils.escapeHTML(String(text ?? ""));
  const sizes = SIZES.map(k => `<option value="${k}" ${k === t.minSize ? "selected" : ""}>${esc(game.i18n.localize(CONFIG.DND5E?.actorSizes?.[k]?.label ?? k))}</option>`).join("");
  const row = (label, input) => `<div class="form-group"><label>${esc(label)}</label><div class="form-fields">${input}</div></div>`;
  const check = (key, on) => `<input type="checkbox" name="${name(key)}" ${on ? "checked" : ""}>`;
  const number = (key, value, min, step=1) => `<input type="number" min="${min}" step="${step}" name="${name(key)}" value="${value ?? ""}" data-dtype="Number">`;
  const text = (key, value, extra="") => `<input type="text" name="${name(key)}" value="${esc(value ?? "")}" ${extra}>`;
  const select = (key, value, options) => `<select name="${name(key)}">${Object.entries(options)
    .map(([v, label]) => `<option value="${v}" ${v === value ? "selected" : ""}>${esc(label.startsWith("DND5E.") ? game.i18n.localize(label) : loc(label))}</option>`).join("")}</select>`;
  const fieldset = document.createElement("fieldset");
  fieldset.innerHTML = `
    <legend>${esc(L("Legend"))}</legend>
    <p class="hint">${esc(L("Hint"))}</p>
    ${row(L("Enabled"), check("enabled", t.enabled))}
    ${door ? row(L("Actor"), text("actor", t.actor, `placeholder="Actor.…" data-dlo-drop="Actor"`)) : ""}
    ${row(L("Activity"), text("activity", t.activity))}
    ${placedToken ? row(loc("TrappedTrap.Token.TriggerRegion"), text("triggerRegion", t.triggerRegion, `placeholder="Scene.….Region.…"`)) : ""}
    ${(door || placedToken) ? row(L("EffectRegion"), text("effectRegion", t.effectRegion, `placeholder="Scene.….Region.…"`)) : ""}
    ${door ? row(L("Trigger"), select("trigger", t.trigger, { open: "TrappedTrap.Trigger.Open", pick: "TrappedTrap.Trigger.Pick", both: "TrappedTrap.Trigger.Both" })) : ""}
    ${door ? "" : row(loc("TrappedTrap.Token.Height"), number("height", Number(raw.height) || 0, 0, 1))}
    ${row(L("MinSize"), `<select name="${name("minSize")}">${sizes}</select>`)}
    ${row(L("Initiative"), number("initiative", t.initiative, 1))}
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
    ${row(loc("Hidden.Wall.Text"), text("hidden.text", h.text))}
    ${(door || placedToken) ? row(L("Source"), text("source.uuid", t.source.uuid, `placeholder="Scene.….Region.… / Tile.…"`)) : ""}
    ${row(L("SourceHidden"), check("source.hidden.enabled", sh.enabled))}
    ${row(loc("Hidden.Wall.Skill"), select("source.hidden.skill", sh.skill, { prc: "DND5E.SkillPrc", inv: "DND5E.SkillInv" }))}
    ${row(loc("Hidden.Wall.Dc"), number("source.hidden.dc", sh.dc, 1))}
    ${row(loc("Hidden.Wall.Passive"), number("source.hidden.passive", sh.passive, 0, 5))}
    ${row(loc("Hidden.Wall.Radius"), number("source.hidden.radius", sh.radius, 0, 5))}
    ${row(loc("Hidden.Wall.Found"), check("source.hidden.found", sh.found))}
    ${row(loc("Hidden.Wall.Text"), text("source.hidden.text", sh.text))}`;
  // Glisser un acteur (barre latérale, compendium) sur son champ y écrit son UUID.
  fieldset.querySelector("[data-dlo-drop]")?.addEventListener("drop", event => {
    const TextEditor = foundry.applications.ux.TextEditor.implementation;
    const data = TextEditor.getDragEventData(event);
    if ( (data?.type !== "Actor") || !data.uuid ) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.value = data.uuid;
  });
  return fieldset;
}

/* -------------------------------------------- */
/*  Inscription                                 */
/* -------------------------------------------- */

export function registerTrapsInit() {
  registerTrapBehavior();
  TrapZoneType.onEnter = onEnter;
  TrapRelayType.onEnter = onRelayEnter;
  game.settings.register(MODULE_ID, "trapsVersion", { scope: "world", config: false, type: Number, default: 1 });
  CONFIG.queries[DISARM_QUERY] = handleDisarm;
  CONFIG.queries[TRIGGER_QUERY] = handleTrigger;
}

export function registerTraps() {
  // 0.17.0 : relais des déclencheurs posés ailleurs, régions à éviter. Une fois à la fois par scène : les écritures d'un passage
  // (relais créés) déclenchent les mêmes hooks.
  const pending = new Map();
  const syncScene = scene => {
    if ( !isActiveGM() || !scene || pending.has(scene.id) ) return;
    pending.set(scene.id, (async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      try { await syncRelays(scene); await syncAvoid(scene); }
      catch(err) { log.warn("trap sync:", err.message); }
      finally { pending.delete(scene.id); }
    })());
  };
  const sync = behavior => {
    if ( !isActiveGM() || (behavior.type !== TRAP_ZONE) ) return;
    syncScene(behavior.parent?.parent);
    applyTrapChecks(behavior).catch(err => log.warn("trap DCs:", err.message));
  };
  route("updateRegionBehavior", "spotted trap", sync);
  route("createRegionBehavior", "spotted trap", sync);
  route("deleteRegionBehavior", "spotted trap", behavior => { if ( behavior.type === TRAP_ZONE ) syncScene(behavior.parent?.parent); });
  route("createRegion", "spotted trap", region => { for ( const b of region.behaviors ) sync(b); });
  route("deleteRegion", "spotted trap", region => syncScene(region.parent));
  migrateOnce().catch(err => log.warn("trap migration:", err.message));
  // 0.16.0 : coffres et portes piégés — DD lus dans l'acteur piège, ouverture, crochetage raté, menu de la porte.
  const syncTrapped = doc => {
    if ( !isActiveGM() || [TRAP_ZONE, TRAP_RELAY].includes(doc.type) || !trapHandle(doc) ) return;
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
  // 0.17.0 (étape 11 bis) : tokens pièges.
  route("preCreateToken", "trap token", onPreCreateToken);
  route("createToken", "trap token", token => {
    if ( !isActiveGM() || !isTrapToken(token) ) return;
    syncAutoRegion(token).then(() => syncScene(token.parent)).catch(err => log.warn("trap token:", err.message));
    applyTrapChecks(token).catch(err => log.warn("trap DCs:", err.message));
  });
  route("updateToken", "trap token", (token, changes) => {
    if ( !isActiveGM() ) return;
    const moved = ["x", "y", "width", "height", "level"].some(k => k in changes);
    const trapChanged = foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.trap`);
    if ( !moved && !trapChanged ) return;
    if ( !isTrapToken(token) && !autoRegionOf(token) ) return;
    syncAutoRegion(token).then(() => { syncScene(token.parent); return syncTrapObject(token); }).then(() => syncTokenShown(token))
      .catch(err => log.warn("trap token:", err.message));
    if ( trapChanged ) applyTrapChecks(token).catch(err => log.warn("trap DCs:", err.message));
  });
  route("deleteToken", "trap token", token => {
    if ( !isActiveGM() ) return;
    const region = autoRegionOf(token);
    if ( region ) region.delete().then(() => syncScene(token.parent)).catch(err => log.warn("trap token:", err.message));
  });
  route("renderTokenConfig", "trap token settings", onRenderTokenConfig);
  route("renderPrototypeTokenConfig", "trap token settings", onRenderTokenConfig);
  route(EVENT_TURN_HOOK, "advanced trap: its turn", onEventTurn);
  route("renderWallConfig", "trapped door settings", onRenderWallConfig);
}
