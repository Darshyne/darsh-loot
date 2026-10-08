/**
 * Souris sur la carte (SPEC §3.1, §3.2, §3.12) : curseur au survol d'un cadavre, d'un conteneur ou d'une zone « DAS · … »,
 * clic pour fouiller ou pour se servir de la zone.
 *
 * Hors combat seulement : en combat, le clic gauche appartient au moteur (attaque de base sur un ennemi,
 * déplacement au sol — dnd5e-combat ui/pointer.mjs) ; voir SPEC §4. Écouteurs en capture sur le document, avant le
 * canevas, comme le moteur. Un token sous la souris passe avant une région.
 */
import { route, routeClaim } from "./router.mjs";
import { openSource, visitSource } from "./open.mjs";
import { setting, loc } from "../shared.mjs";
import { corpseToken, actingToken, lootView } from "../adapter/dnd5e.mjs";
import { mayHaveTreasure } from "../adapter/treasure.mjs";
import { corpseSource, containerSource, merchantSource, zoneSource, trapSource } from "../adapter/sources.mjs";
import { knownTraps, requestDisarm } from "./traps.mjs";
import { merchantToken } from "../adapter/shop.mjs";
import { canApproach, approachSource } from "./approach.mjs";
import { CLAIM_CLICK_HOOK, TOKEN_MENU_HOOK } from "../adapter/engine.mjs";
import { sceneContainers } from "../adapter/container-behavior.mjs";
import { sceneZones } from "../adapter/zone-behaviors.mjs";
import { runZone } from "./zones.mjs";

const inCombat = () => game.combat?.started === true;
const onBoard = event => !!canvas.ready && (event.target === canvas.app?.view);
const plain = event => !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
/** Le MJ n'ouvre un conteneur que depuis la couche des tokens : les outils d'édition gardent leurs clics. */
const tokenLayer = () => canvas.activeLayer === canvas.tokens;
const LONG_PRESS_MS = 350;

/* ---- ce qui est sous la souris ---- */

/**
 * Le token visible sous ce point de la scène (le cadavre d'abord s'il y en a plusieurs). On teste le point plutôt que
 * de lire `canvas.tokens.hover`, qui peut rester accroché sur un token quitté (vu dans le navigateur intégré).
 */
function tokenAt(point) {
  const under = (canvas.tokens?.placeables ?? []).filter(t => t.visible && t.bounds.contains(point.x, point.y));
  return under.find(t => corpseToken(t.document)) ?? under[0] ?? null;
}

/**
 * Le conteneur sous ce point de la scène. Seulement les régions du niveau affiché (V14 : `viewed`,
 * client/documents/abstract/canvas-document.mjs:86) ; test en plan, l'élévation compte dans la portée.
 */
function containerAt(point) {
  return regionAt(sceneContainers(canvas.scene), point);
}

/** La zone « DAS · … » sous ce point (SPEC §3.12), mêmes règles qu'un conteneur. */
function zoneAt(point) {
  return regionAt(sceneZones(canvas.scene), point);
}

function regionAt(behaviors, point) {
  for ( const behavior of behaviors ) {
    const region = behavior.region;
    if ( region.viewed && region.polygonTree.testPoint(point) ) return behavior;
  }
  return null;
}

/**
 * La source sous la souris : un cadavre, un marchand ; sinon, s'il n'y a pas de token dessus, un conteneur ou une zone ;
 * sinon null. Le vol à la tire n'est plus un geste de souris (« Voler » au menu contextuel, SPEC §3.3).
 */
function sourceAt(event) {
  const point = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
  const token = tokenAt(point);
  if ( token ) {
    // 0.14.2 (retour de séance) : chez le MJ, le clic gauche sur un token reste celui du cœur — sélection, HUD. Fouiller un corps :
    // « Fouiller le corps » au clic droit (menu du moteur).
    if ( game.user.isGM ) return null;
    if ( corpseToken(token.document) ) return corpseSource(token.document);
    // Un marchand qu'on ne tient pas : sa boutique (§3.7). Le MJ, qui tient tout, passe par le HUD ou le menu.
    if ( plain(event) && merchantToken(token.document) && !token.document.isOwner ) return merchantSource(token.document);
    // Un token à soi garde son clic (le sélectionner) ; un token qu'on ne contrôle pas laisse voir le conteneur dessous
    // (un mort-vivant debout sur les affaires qu'il vient de laisser tomber, §3.4).
    if ( token.document.isOwner ) return null;
  }
  if ( !tokenLayer() ) return null;
  const behavior = containerAt(point);
  if ( behavior ) return containerSource(behavior);
  const zone = zoneAt(point);
  if ( zone ) return zoneSource(zone);
  // Un piège repéré se désamorce d'un clic (SPEC §3.12).
  const trap = regionAt(knownTraps(canvas.scene), point);
  return trap ? trapSource(trap) : null;
}

/* ---- curseur ---- */

function setCursor(kind) {
  if ( (document.body.dataset.darshLootCursor ?? null) === kind ) return;
  if ( kind ) document.body.dataset.darshLootCursor = kind;
  else delete document.body.dataset.darshLootCursor;
}

/**
 * Le curseur d'une source : « loot » à portée, « locked » verrouillée, « shop » un marchand, « far » trop loin ; rien si elle est vide et
 * n'a plus rien à tirer, en combat, ou sans droit de fouille.
 */
function cursorFor(source) {
  if ( !source || inCombat() ) return null;
  const actor = source.actor;
  if ( source.kind === "zone" ) return zoneCursor(source);
  if ( source.kind === "trap" ) return trapCursor(source);
  if ( source.kind === "merchant" ) {
    const me = actingToken();
    if ( me && (source.distance(me) <= setting("reach")) ) return "shop";
    return tooFar(me);
  }
  if ( source.kind === "corpse" ) {
    if ( !game.user.isGM && (setting("whoLoots") === "gm") ) return null;
    if ( lootView(actor).empty && !(setting("autoTreasure") && mayHaveTreasure(actor)) ) return null;
  } else if ( source.doc.system.rolled && !source.locked() && actor && lootView(actor).empty ) return null;
  if ( !game.user.isGM ) {
    const me = actingToken();
    if ( !me || (source.distance(me) > setting("reach")) ) return tooFar(me);
  }
  // Le MJ n'a pas de limite de portée ; mais avec un token sélectionné hors de portée, il y marche comme un joueur
  // (décision utilisateur 2026-09-30) — sans sélection, il ouvre de loin (préparation).
  else if ( gmToken() && canApproach() && (source.distance(gmToken()) > setting("reach")) ) return "go";
  return source.locked() ? "locked" : "loot";
}

/**
 * Le curseur d'une zone « DAS · … » : « use » à portée (ou si la zone n'exige pas de portée), « go » / « far » sinon. Le
 * MJ a les mêmes règles qu'un conteneur : pas de limite, sauf s'il a sélectionné un token hors de portée.
 */
function zoneCursor(source) {
  if ( !source.doc.system.reach ) return "use";
  if ( !game.user.isGM ) {
    const me = actingToken();
    return (me && (source.distance(me) <= setting("reach"))) ? "use" : tooFar(me);
  }
  if ( gmToken() && canApproach() && (source.distance(gmToken()) > setting("reach")) ) return "go";
  return "use";
}

/** Le curseur d'un piège repéré : « disarm » à portée, « go » / « far » sinon (le MJ : comme pour une zone). */
function trapCursor(source) {
  const cursor = zoneCursor({ ...source, doc: { system: { reach: true } } });
  return (cursor === "use") ? "disarm" : cursor;
}

/** Le token que le MJ a sélectionné (un seul), ou null. */
function gmToken() {
  const controlled = canvas.tokens?.controlled ?? [];
  return (controlled.length === 1) ? controlled[0].document : null;
}

/**
 * Hors de portée : « go » si le personnage peut y aller en marchant (moteur, §3.9), « far » sinon (pas de personnage,
 * ou le moteur n'expose pas encore sa marche).
 */
function tooFar(me) {
  return (me && canApproach()) ? "go" : "far";
}

let lastMove = null;

function onPointerMove(event) {
  lastMove = event;
  if ( !onBoard(event) ) return setCursor(null);
  setCursor(cursorFor(sourceAt(event)));
}

/** Survol d'un token : le curseur change aussi sans bouger la souris (token qui meurt sous le pointeur). */
function onHoverToken(token, hovered) {
  if ( !hovered ) return setCursor(null);
  setCursor(cursorFor(corpseToken(token.document) ? corpseSource(token.document) : null));
}

/* ---- clic ---- */

let down = null;

/**
 * Appui gauche simple sur une source, hors combat : on le garde pour nous (ni sélection ni glisser du token par le
 * cœur ; le MJ déplace un cadavre avec Maj).
 */
/** La source que ce clic gauche ouvrirait (hors combat, geste simple ou Alt pour les poches), ou null. */
function clickedSource(event) {
  if ( !onBoard(event) || (event.button !== 0) || !plain(event) || inCombat() ) return null;
  const source = sourceAt(event);
  if ( !source ) return null;
  return cursorFor(source) ? source : null;
}

function onPointerDown(event) {
  down = null;
  const source = clickedSource(event);
  if ( !source ) return;
  down = { x: event.clientX, y: event.clientY, at: Date.now(), source, looter: actingToken(), cursor: cursorFor(source) };
  event.stopImmediatePropagation();
  event.preventDefault();
}

/**
 * Le moteur demande s'il peut prendre ce clic (son SPEC §39.3) : non, s'il ouvre une source de butin — sinon le moteur
 * ferait aussi marcher le personnage au point cliqué (clic-déplacement hors combat), quel que soit l'ordre des écouteurs.
 */
function onClaimClick(event) {
  return clickedSource(event) ? false : undefined;
}

function onPointerUp(event) {
  const start = down;
  down = null;
  if ( !start || (event.button !== 0) || !onBoard(event) ) return;
  if ( Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6 ) return;
  if ( (Date.now() - start.at) > LONG_PRESS_MS ) return;   // appui long : le ping du cœur
  if ( start.cursor === "go" ) return goThenOpen(start.source, start.looter);
  activate(start.source, start.looter);
}

/** Ouvrir la fenêtre d'une source, ou se servir d'une zone. */
function activate(source, looter) {
  if ( source.kind === "zone" ) return runZone(source.doc, looter);
  if ( source.kind === "trap" ) return requestDisarm(source.doc, looter);
  return openSource(source, looter);
}

/** Marcher jusqu'à portée (moteur), puis ouvrir la fenêtre (ou se servir de la zone) si l'on y est arrivé. */
let walking = false;
async function goThenOpen(source, looter) {
  if ( walking ) return;
  walking = true;
  try { if ( await approachSource(source, looter) ) await activate(source, looter); }
  finally { walking = false; }
}

/** Recalcule le curseur sous la souris après un changement (coffre vidé, serrure ouverte, combat commencé). */
function recheck() {
  if ( lastMove && canvas.ready ) setCursor(onBoard(lastMove) ? cursorFor(sourceAt(lastMove)) : null);
}

/** « Fouiller le corps » au menu contextuel d'un cadavre (menu du moteur), hors combat, pour le personnage en main. */
function onTokenMenu(entries, { token, target }) {
  if ( !token?.actor || !target || (target === token) || inCombat() || !corpseToken(target) ) return;
  entries.push({ icon: "fa-solid fa-sack", label: loc("Window.SearchCorpse"), run: () => visitSource(corpseSource(target), token) });
}

export function registerPointer() {
  routeClaim(CLAIM_CLICK_HOOK, "clic de fouille", onClaimClick);
  route(TOKEN_MENU_HOOK, "menu : Fouiller le corps", onTokenMenu);
  route("hoverToken", "curseur de fouille", onHoverToken);
  route("canvasTearDown", "curseur de fouille", () => setCursor(null));
  // Tout ce qui change ce qu'un clic ferait sans que la souris bouge : un tas qui apparaît sous elle, un autre
  // personnage sélectionné (la portée change), une créature qui meurt, un coffre vidé ou ouvert, un combat.
  for ( const hook of ["updateRegionBehavior", "createRegionBehavior", "deleteRegionBehavior", "createRegion", "updateRegion", "deleteRegion", "createTile", "deleteTile", "updateActor",
    "createItem", "updateItem", "deleteItem", "createActiveEffect", "deleteActiveEffect", "updateToken", "controlToken",
    "updateCombat", "deleteCombat"] ) {
    route(hook, "curseur de fouille", () => recheck());
  }
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
}
