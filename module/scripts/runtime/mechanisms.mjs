/**
 * Mécanismes (étape 13, SPEC §3.13 ; issue darsh-loot#4) : leviers, boutons, dalles.
 *
 * - **Actionner** une région, c'est faire partir d'un même geste ce qu'elle porte : ses « DAS · Mécanisme » réglés pour le clic, et les
 *   « DAS · Piège » dont elle est le déclencheur au clic (un levier piégé). Chez le joueur d'abord : un piège **repéré** demande
 *   « Désamorcer / Actionner quand même / Renoncer » (`trapGate`) ; puis la requête au MJ actif, qui refait les contrôles (personnage à
 *   lui, à portée, zone pas cachée ; en combat, l'action Utiliser décomptée par le moteur), donne le retour à toute la table (son, texte
 *   flottant, carte) et fait les actions.
 * - Une **dalle** (mécanisme réglé pour l'entrée) part quand un token y entre, comme un piège : assez grand, pas en vol au-dessus.
 * - Les **actions** sont faites par le MJ actif, le joueur n'obtient aucun droit de plus : porte (ouvrir, fermer, basculer, verrouiller,
 *   déverrouiller), lumière (allumer, éteindre, basculer), tuile (montrer, cacher, basculer), son (joué pour tous), piège (le faire
 *   partir), macro (chez le MJ, ou chez celui qui actionne). À bascule, le retour inverse chaque action ; un piège ne repart pas.
 */
import { MODULE_ID, loc, log, sceneSetting } from "../shared.mjs";
import { askGM } from "./take.mjs";
import { feedbackCard, playForAll, SOUNDS } from "./feedback.mjs";
import { fireTrap, trapGate, trapArmed } from "./traps.mjs";
import { executeMacro } from "./zones.mjs";
import { pickOnMap } from "./pick.mjs";
import { MechanismConfig } from "../apps/mechanism-config.mjs";
import { MECHANISM_ZONE, MechanismZoneType } from "../adapter/zone-behaviors.mjs";
import { behaviorConcealed, tilesIn } from "../adapter/hidden.mjs";
import { clickTrapsOn, trapHandle, isTrapToken, anyKnown } from "../adapter/trapped.mjs";
import { regionDistance, creatureSize } from "../adapter/dnd5e.mjs";
import { engineBudgetIssues, engineSpend, engineObjectToken } from "../adapter/engine.mjs";
import { activatesOn, actuation, actionMode, runsOnReverse, normalizeAction, actionReady, doorChange, visibilityChange, imageFor }
  from "../core/mechanisms.mjs";
import { bigEnough } from "../core/traps.mjs";

const ACTUATE_QUERY = `${MODULE_ID}.actuate`;
const MACRO_QUERY = `${MODULE_ID}.mechanismMacros`;
/** Émis chez le MJ actif après un actionnement : `{ region, mechanisms, traps, looter, via }`, pour un module d'animation. */
const ACTUATED_HOOK = `${MODULE_ID}.mechanismActuated`;

const isActiveGM = () => game.users.activeGM?.isSelf === true;

/** Les mécanismes actifs de cette région qui partent de cette façon (« click » ou « enter »). */
export function mechanismsOn(region, how="click") {
  return (region?.behaviors ?? []).filter(b => (b.type === MECHANISM_ZONE) && !b.disabled && activatesOn(b.system.activation, how));
}

/** La région s'actionne-t-elle d'un clic (un mécanisme réglé pour le clic, ou un levier piégé) ? */
export function clickable(region) {
  return !!region && (mechanismsOn(region, "click").length > 0 || clickTrapsOn(region).length > 0);
}

/** Le nom montré d'une région qu'on actionne : son mécanisme, son piège, sinon la région. */
export function actuatedName(region) {
  const m = mechanismsOn(region, "click")[0] ?? mechanismsOn(region, "enter")[0];
  return m?.system.displayName || clickTrapsOn(region)[0]?.name || region?.name || loc("Mechanism.ThisLever");
}

/** Les pièges que les mécanismes de cette région feront partir à l'aller (action « piège »). */
function targetedTraps(mechanisms) {
  const out = [];
  for ( const b of mechanisms ) {
    const plan = actuation(b.system);
    if ( !plan.run || plan.reverse ) continue;
    for ( const action of (b.system.actions ?? []).map(normalizeAction) ) {
      if ( (action.type !== "trap") || !action.target ) continue;
      const h = trapHandle(fromUuidSync(action.target, { strict: false }));
      if ( h ) out.push(h);
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  Actionner (chez le joueur)                  */
/* -------------------------------------------- */

/**
 * Actionner cette région pour ce personnage (null : le MJ sans token). Un piège repéré demande d'abord ; rend le résultat du MJ, ou
 * null (renoncé, refusé).
 * @param {RegionDocument} region
 * @param {TokenDocument|null} looter
 */
export async function actuate(region, looter=null) {
  if ( !region ) return null;
  const mechanisms = mechanismsOn(region, "click").filter(b => game.user.isGM || !behaviorConcealed(b));
  const traps = clickTrapsOn(region);
  if ( !mechanisms.length && !traps.length ) return null;
  if ( !looter && !game.user.isGM ) { ui.notifications.warn(loc("Window.NoLooter")); return null; }
  // Un piège repéré et armé : désamorcer, actionner quand même, ou renoncer. Désamorcé à l'instant, il ne part plus.
  if ( looter ) {
    for ( const h of [...traps, ...targetedTraps(mechanisms)] ) {
      if ( !anyKnown(h) || !trapArmed(h) ) continue;
      if ( !(await trapGate(h, looter, [h.trap.trigger ?? "open"], { use: true })) ) return null;
    }
  }
  const result = await askGM(ACTUATE_QUERY, handleActuate, { region: region.uuid, looter: looter?.uuid ?? null, via: "click" });
  if ( result?.macros?.length ) await runUserMacros(result.macros, looter);
  return result;
}

/* -------------------------------------------- */
/*  Chez le MJ                                  */
/* -------------------------------------------- */

/** Le token est-il dans le combat en cours ? */
const fighting = token => (game.combat?.started === true) && game.combat.combatants.some(c => c.tokenId === token?.id);

async function handleActuate({ region: regionUuid, looter: looterUuid }, { user }) {
  // Une requête ne vient que d'un clic (ou du menu) : l'entrée d'un token est jugée par le MJ lui-même (`onEnter`).
  const via = "click";
  const region = fromUuidSync(regionUuid ?? "", { strict: false });
  if ( region?.documentName !== "Region" ) throw new Error(loc("Refus.Introuvable"));
  const looter = looterUuid ? fromUuidSync(looterUuid, { strict: false }) : null;
  if ( looter && !looter.actor?.testUserPermission(user, "OWNER") ) throw new Error(loc("Refus.PasAToi"));
  if ( !looter && !user.isGM ) throw new Error(loc("Refus.PasAToi"));
  const mechanisms = mechanismsOn(region, via).filter(b => user.isGM || !behaviorConcealed(b));
  const traps = (via === "click") ? clickTrapsOn(region) : [];
  if ( !mechanisms.length && !traps.length ) throw new Error(loc("Refus.Introuvable"));
  if ( !user.isGM ) {
    if ( region.hidden ) throw new Error(loc("Refus.Introuvable"));
    const needsReach = traps.length || mechanisms.some(b => b.system.reach);
    if ( needsReach && (regionDistance(looter, region) > sceneSetting("reach", looter.parent)) ) throw new Error(loc("Refus.Loin"));
  }
  // En combat, actionner un levier est l'action Utiliser (PHB 2024) : le moteur dit si elle est possible et la décompte.
  const combat = looter && fighting(looter);
  if ( combat ) {
    const issues = engineBudgetIssues(looter.actor, "action");
    if ( issues.length ) throw new Error(loc(`Hidden.Budget.${issues[0]}`, { name: looter.actor.name }));
  }
  const outcome = await actuateHere(region, looter, { mechanisms, traps, via });
  if ( combat && outcome.did ) await engineSpend(looter.actor, "action");
  return outcome;
}

/**
 * Chez le MJ actif : le retour (son, texte flottant, carte) puis les mécanismes et les pièges. Rend `{ did, fired, macros }` — `macros` :
 * celles à lancer chez celui qui actionne.
 */
async function actuateHere(region, looter, { mechanisms, traps, via }) {
  const plans = mechanisms.map(b => ({ b, plan: actuation(b.system) }));
  const armed = traps.filter(h => trapArmed(h));
  const did = plans.some(p => p.plan.run) || (armed.length > 0);
  // Règle DAS : un retour visible et audible de tous, avant ce qui suit.
  const sound = plans.find(p => p.b.system.sound)?.b.system.sound || (did ? SOUNDS.lever : SOUNDS.nothing);
  const names = { name: looter?.name ?? "", thing: actuatedName(region) };
  if ( looter ) {
    const enter = via === "enter";
    const card = !did ? "Mechanism.NothingCard" : enter ? "Mechanism.EnterCard" : "Mechanism.UseCard";
    const float = !did ? "Mechanism.FloatNothing" : enter ? "Mechanism.FloatEnter" : "Mechanism.FloatUse";
    await feedbackCard(looter, loc(card, names), {
      kind: did ? "gain" : "ended", icon: enter ? "fa-solid fa-shoe-prints" : "fa-solid fa-hand", sound, float: loc(float) });
  } else playForAll(sound);
  const macros = [];
  for ( const { b, plan } of plans ) {
    if ( !plan.run ) continue;
    const ran = await runMechanism(b, plan, looter);
    macros.push(...ran.macros);
  }
  let fired = 0;
  for ( const h of armed ) if ( await fireTrap(h, looter) ) fired++;
  log.info(`mechanism ${names.thing}: ${did ? "actuated" : "nothing happens"}${looter ? ` by ${looter.name}` : ""}`
    + (fired ? `, ${fired} trap(s) fired` : ""));
  Hooks.callAll(ACTUATED_HOOK, { region, mechanisms, traps: armed, looter, via });
  return { did, fired, macros };
}

/**
 * 2026-11-06 (demande de l'utilisateur : deux visuels pour un levier) : la tuile du mécanisme — celle qui est choisie, sinon celle de
 * l'outil « tuile → zone » (`flags.darsh-loot.tile` de la région), sinon la première tuile posée dans la région.
 */
export function mechanismTile(behavior) {
  const chosen = behavior.system.tile ? fromUuidSync(behavior.system.tile, { strict: false }) : null;
  if ( chosen?.documentName === "Tile" ) return chosen;
  const region = behavior.region;
  const linked = region?.parent?.tiles.get(region.getFlag(MODULE_ID, "tile") ?? "");
  return linked ?? (region ? tilesIn(region)[0] : null) ?? null;
}

/** Les deux images du levier : celles réglées ; sans image au repos, celle que la tuile avait avant le premier actionnement. */
function leverImages(behavior) {
  return { imageOn: behavior.system.imageOn || "", imageOff: behavior.system.imageOff || behavior.getFlag(MODULE_ID, "imageOff") || "" };
}

/** Mettre la tuile du levier à l'image de cette position (rien sans image pour elle). */
async function showLever(behavior, active) {
  const tile = mechanismTile(behavior);
  if ( !tile ) return;
  // Pas d'image au repos réglée : l'image de départ de la tuile est gardée, pour y revenir.
  if ( !behavior.system.imageOff && behavior.system.imageOn && !behavior.getFlag(MODULE_ID, "imageOff") && tile.texture?.src ) {
    await behavior.setFlag(MODULE_ID, "imageOff", tile.texture.src);
  }
  const src = imageFor(active, leverImages(behavior));
  if ( src && (tile.texture?.src !== src) ) await tile.update({ "texture.src": src });
}

/**
 * Un mécanisme : son nouvel état, l'image de sa tuile, puis ses actions (à rebours au retour d'une bascule). Rend les macros à lancer
 * chez celui qui actionne. Une action qui échoue (cible supprimée) n'arrête pas les autres.
 */
async function runMechanism(behavior, plan, looter) {
  const system = behavior.system;
  await behavior.update(Object.fromEntries(Object.entries(plan.next).map(([k, v]) => [`system.${k}`, v])));
  const active = plan.next.active ?? system.active;
  await showLever(behavior, active);
  const macros = [];
  const scope = { behavior, region: behavior.region, looter, reverse: plan.reverse, active };
  for ( const action of (system.actions ?? []).map(normalizeAction).filter(actionReady) ) {
    if ( plan.reverse && !runsOnReverse(action) ) continue;
    const mode = actionMode(action, plan.reverse);
    try {
      const done = await runAction(action, mode, looter, scope);
      if ( done?.macro ) macros.push(done.macro);
    } catch(err) {
      log.warn(`mechanism ${system.displayName || behavior.id}: ${action.type} action failed —`, err.message);
    }
  }
  return { macros };
}

/** Une action, chez le MJ actif. Rend `{ macro }` pour une macro à lancer chez celui qui actionne. */
async function runAction(action, mode, looter, scope) {
  const target = action.target ? await fromUuid(action.target) : null;
  switch ( action.type ) {
    case "door": {
      if ( (target?.documentName !== "Wall") || !(Number(target.door) > 0) ) throw new Error(`no door ${action.target}`);
      const change = doorChange(mode, target.ds, CONST.WALL_DOOR_STATES);
      // Une porte sans son du cœur : le cliquetis de la serrure (règle DAS : toute action s'entend).
      if ( change && !target.doorSound ) playForAll(SOUNDS.use, 0.6);
      if ( change ) await target.update(change);
      return null;
    }
    case "light":
    case "tile": {
      const type = (action.type === "light") ? "AmbientLight" : "Tile";
      if ( target?.documentName !== type ) throw new Error(`no ${type} ${action.target}`);
      const change = visibilityChange(mode, !!target.hidden);
      if ( change ) {
        playForAll(SOUNDS.click, 0.5);
        await target.update(change);
      }
      return null;
    }
    case "sound":
      playForAll(action.src, action.volume);
      return null;
    case "trap": {
      const h = trapHandle(target);
      if ( !h ) throw new Error(`no trap ${action.target}`);
      if ( trapArmed(h) ) await fireTrap(h, looter);
      return null;
    }
    case "macro": {
      if ( target?.documentName !== "Macro" ) throw new Error(`no macro ${action.target}`);
      if ( mode === "user" ) return { macro: target.uuid };
      await executeMacro(target, looter, scope);
      return null;
    }
  }
  return null;
}

/** Chez celui qui actionne : les macros réglées « chez celui qui actionne ». */
async function runUserMacros(uuids, looter) {
  for ( const uuid of uuids ) {
    const macro = await fromUuid(uuid);
    if ( macro?.documentName !== "Macro" ) continue;
    try { await executeMacro(macro, looter, { looter }); }
    catch(err) { log.warn(`mechanism macro ${macro.name}:`, err.message); }
  }
}

function handleMacros({ macros=[], looter: looterUuid=null }) {
  const looter = looterUuid ? fromUuidSync(looterUuid, { strict: false }) : null;
  return runUserMacros(macros, looter).then(() => true);
}

/* -------------------------------------------- */
/*  Dalles : l'entrée d'un token                */
/* -------------------------------------------- */

/** Le sol de la région sous ce token (comme pour un piège) : une créature qui vole au-dessus d'une dalle ne l'enfonce pas. */
function grounded(region, token) {
  const bottom = region.elevation?.bottom;
  const floor = Number.isFinite(bottom) ? bottom : (region.parent.levels?.get?.(token._source.level)?.elevation?.base ?? 0);
  return (token._source.elevation ?? 0) <= floor;
}

const entering = new Set();

/** L'évènement du cœur : un token entre dans la région d'un mécanisme. Le MJ actif juge et actionne. */
function onEnter(behavior, event) {
  const token = event.data?.token;
  if ( !token || isTrapToken(token) || engineObjectToken(token) ) return;
  if ( behavior.disabled || !activatesOn(behavior.system.activation, "enter") ) return;
  if ( !bigEnough(creatureSize(token), behavior.system.minSize) || !grounded(behavior.region, token) ) return;
  if ( !isActiveGM() || entering.has(behavior.uuid) ) return;
  entering.add(behavior.uuid);
  (async () => {
    // Une dalle cachée qu'on enfonce se trouve.
    if ( behavior.system.hidden?.enabled && !behavior.system.hidden.found ) await behavior.update({ "system.hidden.found": true });
    const outcome = await actuateHere(behavior.region, token, { mechanisms: [behavior], traps: [], via: "enter" });
    const user = event.user;
    // Les macros « chez celui qui actionne » : chez celui qui a fait entrer le token.
    if ( outcome.macros.length && user && !user.isSelf && user.active ) {
      await user.query(MACRO_QUERY, { macros: outcome.macros, looter: token.uuid }, { timeout: 15000 });
    } else if ( outcome.macros.length ) await runUserMacros(outcome.macros, token);
  })().catch(err => log.warn("mechanism:", err.message)).finally(() => entering.delete(behavior.uuid));
}

/* -------------------------------------------- */
/*  Gestes du MJ                                */
/* -------------------------------------------- */

/** Remettre un mécanisme dans sa première position (pas servi, levier relevé, image d'origine), sans faire ses actions. */
export async function resetMechanism(behavior) {
  await behavior.update({ "system.active": false, "system.used": false });
  await showLever(behavior, false);
  ui.notifications.info(loc("Mechanism.ResetDone", { name: behavior.system.displayName || loc("Mechanism.ThisLever") }));
}

/** Les entrées du MJ sur les mécanismes d'une région : réinitialiser, réglages. */
export function gmMechanismEntries(region) {
  if ( !game.user.isGM ) return [];
  const out = [];
  for ( const b of (region?.behaviors ?? []).filter(x => (x.type === MECHANISM_ZONE) && !x.disabled) ) {
    const name = b.system.displayName || loc("Mechanism.ThisLever");
    out.push({ icon: "fa-solid fa-rotate-left", label: loc("Mechanism.Reset", { name }), run: () => resetMechanism(b) });
    out.push({ icon: "fa-solid fa-gear", label: loc("Mechanism.Configure", { name }), run: () => b.sheet?.render(true) });
  }
  return out;
}

export function registerMechanismsInit() {
  MechanismZoneType.onEnter = onEnter;
  MechanismConfig.pick = pickOnMap;
  foundry.applications.apps.DocumentSheetConfig.registerSheet(foundry.documents.RegionBehavior, MODULE_ID, MechanismConfig,
    { types: [MECHANISM_ZONE], makeDefault: true, label: "DLO.MechanismZone.Sheet" });
  CONFIG.queries[ACTUATE_QUERY] = handleActuate;
  CONFIG.queries[MACRO_QUERY] = handleMacros;
}

/** Pour les tests (runtime/testing.mjs) : actionner chez le MJ, sans fenêtre ni retour au joueur. */
export const testActuate = (region, looter, via="click") => actuateHere(region, looter,
  { mechanisms: mechanismsOn(region, via), traps: (via === "click") ? clickTrapsOn(region) : [], via });
