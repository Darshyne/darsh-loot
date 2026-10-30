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
import { setting, sceneSetting, loc } from "../shared.mjs";
import { corpseToken, actingToken, lootView } from "../adapter/dnd5e.mjs";
import { mayHaveTreasure } from "../adapter/treasure.mjs";
import { corpseSource, containerSource, merchantSource, zoneSource, trapSource } from "../adapter/sources.mjs";
import { knownTrapPlaces, requestDisarm, gmTrapEntries } from "./traps.mjs";
import { trapHandle, anyKnown, allTraps, isTrapToken } from "../adapter/trapped.mjs";
import { merchantToken } from "../adapter/shop.mjs";
import { canApproach, approachSource } from "./approach.mjs";
import { CLAIM_CLICK_HOOK, TOKEN_MENU_HOOK, GROUND_MENU_HOOK, TARGETING_HOOK, engineTargeting } from "../adapter/engine.mjs";
import { sceneContainers } from "../adapter/container-behavior.mjs";
import { sceneZones } from "../adapter/zone-behaviors.mjs";
import { runZone } from "./zones.mjs";
import { pointSeen, regionFloor } from "../adapter/sight.mjs";

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
    // 0.17.0 : un joueur ne trouve pas un coffre à travers le brouillard, un mur ou un toit (adapter/sight.mjs).
    if ( region.viewed && region.polygonTree.testPoint(point) && pointSeen(point, regionFloor(region)) ) return behavior;
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
  // Un piège repéré se désamorce d'un clic (SPEC §3.12) : son déclencheur, ou (0.17.0) sa source.
  const trap = trapPlaceAt(point);
  return trap ? trapSource(trap.h.doc, trap.place) : null;
}

/** L'endroit repéré d'un piège sous ce point (une région du niveau affiché, ou une tuile visible). */
function trapPlaceAt(point) {
  for ( const entry of knownTrapPlaces(canvas.scene) ) {
    const place = entry.place;
    if ( ["Tile", "Token"].includes(place.documentName) ) {
      if ( place.object?.visible && place.object.bounds.contains(point.x, point.y)
        && pointSeen(point, place.elevation ?? 0) ) return entry;
    } else if ( place.viewed && place.polygonTree.testPoint(point) && pointSeen(point, regionFloor(place)) ) return entry;
  }
  return null;
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
  // La visée du moteur passe avant la fouille (§3.4, 2026-10-09) : *Animation des morts* vise le cadavre qu'on fouillerait.
  if ( !source || inCombat() || engineTargeting() ) return null;
  const actor = source.actor;
  if ( source.kind === "zone" ) return zoneCursor(source);
  if ( source.kind === "trap" ) return trapCursor(source);
  if ( source.kind === "merchant" ) {
    const me = actingToken();
    if ( me && (source.distance(me) <= sceneSetting("reach", me.parent)) ) return "shop";
    return tooFar(me);
  }
  if ( source.kind === "corpse" ) {
    if ( !game.user.isGM && (setting("whoLoots") === "gm") ) return null;
    if ( lootView(actor).empty && !(setting("autoTreasure") && mayHaveTreasure(actor)) ) return null;
  } else if ( source.doc.system.rolled && !source.locked() && actor && lootView(actor).empty ) return null;
  if ( !game.user.isGM ) {
    const me = actingToken();
    if ( !me || (source.distance(me) > sceneSetting("reach", me.parent)) ) return tooFar(me);
  }
  // Le MJ n'a pas de limite de portée ; mais avec un token sélectionné hors de portée, il y marche comme un joueur
  // (décision utilisateur 2026-09-30) — sans sélection, il ouvre de loin (préparation).
  else if ( gmToken() && canApproach() && (source.distance(gmToken()) > sceneSetting("reach", gmToken().parent)) ) return "go";
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
    return (me && (source.distance(me) <= sceneSetting("reach", me.parent))) ? "use" : tooFar(me);
  }
  if ( gmToken() && canApproach() && (source.distance(gmToken()) > sceneSetting("reach", gmToken().parent)) ) return "go";
  return "use";
}

/** Le curseur d'un piège repéré : « disarm » à portée, « go » / « far » sinon (le MJ : comme pour une zone). */
function trapCursor(source) {
  const cursor = zoneCursor({ ...source, doc: { system: { reach: true } } });
  return (cursor === "use") ? "disarm" : cursor;
}

/**
 * 2026-10-28 (demande de l'utilisateur, comme le clic-déplacement et le clic-attaque du moteur) : réglage par poste `clickToLoot` —
 * « jamais » (par défaut : le clic droit propose « Fouiller »), « à portée » (le clic ouvre ce qui est à portée, sans marcher) ou
 * « y aller » (le clic fait marcher jusqu'à portée puis ouvre). Le **survol reste** dans tous les cas (le curseur montre ce qu'on
 * peut fouiller — retour de l'utilisateur) ; seul le clic suit le réglage, sinon il reste au cœur (sélection, glisser). Hors « y
 * aller », un objet hors de portée montre « trop loin » plutôt que « y aller ». Les zones « DAS · … » (macro, scène, document) se
 * cliquent toujours : c'est leur geste. Le MJ sans token sélectionné ouvre encore de loin (préparation), même à « jamais ».
 */
function clickMode() {
  const mode = setting("clickToLoot");
  return ["off", "reach", "walk"].includes(mode) ? mode : "off";
}

/** Le curseur au survol. */
export function shownCursor(source) {
  const cursor = cursorFor(source);
  if ( !cursor || (source.kind === "zone") ) return cursor;
  return ((cursor === "go") && (clickMode() !== "walk")) ? "far" : cursor;
}

/** Ce que le clic gauche fera sur cette source : le curseur du survol si le réglage le permet, sinon null (clic laissé au cœur). */
export function clickCursor(source) {
  const cursor = shownCursor(source);
  if ( !cursor || (source.kind === "zone") ) return cursor;
  const mode = clickMode();
  if ( (mode === "walk") || (mode === "reach") ) return cursor;
  return (game.user.isGM && !gmToken()) ? cursor : null;
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
  setCursor(shownCursor(sourceAt(event)));
}

/** Survol d'un token : le curseur change aussi sans bouger la souris (token qui meurt sous le pointeur). */
function onHoverToken(token, hovered) {
  if ( !hovered ) return setCursor(null);
  setCursor(shownCursor(corpseToken(token.document) ? corpseSource(token.document) : null));
}

/* ---- clic ---- */

let down = null;

/**
 * Appui gauche simple sur une source, hors combat : on le garde pour nous (ni sélection ni glisser du token par le
 * cœur ; le MJ déplace un cadavre avec Maj).
 */
/** La source que ce clic gauche ouvrirait (hors combat, geste simple ou Alt pour les poches), ou null. */
function clickedSource(event) {
  if ( !onBoard(event) || (event.button !== 0) || !plain(event) || inCombat() || engineTargeting() ) return null;
  const source = sourceAt(event);
  if ( !source ) return null;
  return clickCursor(source) ? source : null;
}

function onPointerDown(event) {
  down = null;
  const source = clickedSource(event);
  if ( !source ) return;
  down = { x: event.clientX, y: event.clientY, at: Date.now(), source, looter: actingToken(), cursor: clickCursor(source) };
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
  if ( lastMove && canvas.ready ) setCursor(onBoard(lastMove) ? shownCursor(sourceAt(lastMove)) : null);
}

/** « Fouiller le corps » au menu contextuel d'un cadavre (menu du moteur), hors combat, pour le personnage en main. */
function onTokenMenu(entries, { token, target }) {
  // 0.17.0 : un token piège — le désamorcer (repéré, pour le personnage en main), les gestes du MJ.
  if ( target && isTrapToken(target) ) {
    const h = trapHandle(target);
    const looter = (token && (token !== target)) ? token : null;
    if ( h && looter?.actor && anyKnown(h) && !h.trap.disarmed ) entries.push(disarmEntry(h, looter));
    entries.push(...gmTrapEntries(h));
    return;
  }
  if ( !token?.actor || !target || (target === token) || inCombat() || !corpseToken(target) ) return;
  entries.push({ icon: "fa-solid fa-sack", label: loc("Window.SearchCorpse"), run: () => visitSource(corpseSource(target), token) });
}

/** 0.15.5 : « Fouiller » au menu contextuel d'une case où est un conteneur ou un tas (menu du moteur, hook `groundMenu`), hors combat. */
function onGroundMenu(entries, { token, point }) {
  if ( !token?.actor || !point ) return;
  // 0.17.0 : un piège sur cette case (en combat aussi) — le désamorcer s'il est repéré et vu, les gestes du MJ.
  trapGroundEntries(entries, token, point);
  if ( inCombat() ) return;
  const behavior = containerAt(point);
  if ( !behavior ) return;
  // 0.16.0 : un coffre au piège repéré se désamorce d'ici (on y va d'abord).
  const trap = trapHandle(behavior);
  if ( trap && anyKnown(trap) ) entries.push({ icon: "fa-solid fa-screwdriver-wrench", label: loc("TrappedTrap.Disarm"),
    run: async () => {
      const source = containerSource(behavior);
      const looter = token.document ?? token;
      if ( canApproach() && (source.distance(looter) > sceneSetting("reach", looter.parent)) ) await approachSource(source, looter);
      await requestDisarm(trap, looter);
    } });
  if ( trap ) entries.push(...gmTrapEntries(trap));   // 0.17.0
  entries.push({ icon: "fa-solid fa-box-open", label: loc("Window.SearchContainer"),
    run: () => visitSource(containerSource(behavior), token) });
}

/** « Désamorcer le piège » : on y va d'abord s'il est hors de portée (moteur), puis le test d'outils de voleur. */
function disarmEntry(h, looter) {
  return { icon: "fa-solid fa-screwdriver-wrench", label: loc("TrappedTrap.Disarm"), run: async () => {
    const source = trapSource(h.doc, h.token ?? h.source.doc ?? h.triggerRegion);
    if ( canApproach() && (source.distance(looter) > sceneSetting("reach", looter.parent)) && !(await approachSource(source, looter)) ) return;
    await requestDisarm(h, looter);
  } };
}

/** Les pièges d'une case : repéré et vu pour un joueur ; tous pour le MJ (token, déclencheur, source, zone d'effet). */
function trapGroundEntries(entries, token, point) {
  const looter = token.document ?? token;
  const done = new Set();
  const known = trapPlaceAt(point);
  if ( known && !known.h.trap.disarmed ) {
    done.add(known.h.uuid);
    entries.push(disarmEntry(known.h, looter));
    entries.push(...gmTrapEntries(known.h));
  }
  if ( !game.user.isGM ) return;
  for ( const h of allTraps(canvas.scene) ) {
    if ( done.has(h.uuid) || (h.kind === "door") || (h.kind === "container") ) continue;
    const places = [h.token, h.triggerRegion, h.source.doc, h.effectRegion].filter(Boolean);
    const under = places.some(place => (["Tile", "Token"].includes(place.documentName)
      ? !!place.object?.bounds?.contains(point.x, point.y) : (place.viewed && place.polygonTree?.testPoint(point))));
    if ( !under ) continue;
    done.add(h.uuid);
    entries.push(...gmTrapEntries(h));
  }
}

export function registerPointer() {
  routeClaim(CLAIM_CLICK_HOOK, "search click", onClaimClick);
  route(TOKEN_MENU_HOOK, "menu: Search the body", onTokenMenu);
  route(GROUND_MENU_HOOK, "menu: Search a container", onGroundMenu);
  route("hoverToken", "search cursor", onHoverToken);
  route("canvasTearDown", "search cursor", () => setCursor(null));
  // La visée du moteur qui s'ouvre ou se ferme sous la souris : le curseur de fouille s'efface ou revient.
  route(TARGETING_HOOK, "search cursor", () => recheck());
  // Tout ce qui change ce qu'un clic ferait sans que la souris bouge : un tas qui apparaît sous elle, un autre
  // personnage sélectionné (la portée change), une créature qui meurt, un coffre vidé ou ouvert, un combat.
  for ( const hook of ["updateRegionBehavior", "createRegionBehavior", "deleteRegionBehavior", "createRegion", "updateRegion", "deleteRegion", "createTile", "deleteTile", "updateActor",
    "createItem", "updateItem", "deleteItem", "createActiveEffect", "deleteActiveEffect", "updateToken", "controlToken",
    "updateCombat", "deleteCombat"] ) {
    route(hook, "search cursor", () => recheck());
  }
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
}
