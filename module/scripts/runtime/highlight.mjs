/**
 * Surbrillance façon BG3 (SPEC §3.12) : tant qu'on tient la touche de surbrillance **de Foundry** (Alt par défaut, raccourci
 * du cœur `core.highlight`), tout ce qui est interactif brille — zones DAS (cachettes trouvées en or), cadavres
 * fouillables, tas au sol. On écoute le hook public `highlightObjects` (client/canvas/board.mjs:1856) : la touche suit le
 * réglage de chacun, pas de raccourci à nous.
 *
 * - **Hors combat seulement** : en combat, Alt est la touche d'avantage que lit le moteur ; on n'y ajoute rien (le moteur
 *   reste prioritaire).
 * - **Exception : un piège repéré** (pas désamorcé) est dessiné **en rouge en permanence**, sans touche et en combat.
 * - Forme : la zone qui contient une tuile visible prend le **contour de l'image** de la tuile (adapter/tile-outline.mjs,
 *   gardé en cache) ; sinon les polygones de la région ; un cadavre, un anneau sous son token.
 * - Tout est dessiné dans un conteneur de `canvas.interface` qui **ne prend aucun évènement** (`eventMode = "none"`) : leçon
 *   de `coc7-dialogues` 0.13.1, où des dessins interactifs empêchaient le MJ d'attraper ce qui était dessous.
 */
import { setting } from "../shared.mjs";
import { route } from "./router.mjs";
import { sceneContainers, CONTAINER_TYPE } from "../adapter/container-behavior.mjs";
import { sceneZones } from "../adapter/zone-behaviors.mjs";
import { behaviorConcealed, tilesIn } from "../adapter/hidden.mjs";
import { tileShape } from "../adapter/tile-outline.mjs";
import { corpseToken, lootView } from "../adapter/dnd5e.mjs";
import { mayHaveTreasure } from "../adapter/treasure.mjs";
import { sceneTraps, trapKnown } from "../adapter/trap-behavior.mjs";

/** Couleurs : neutre pour une zone ou un cadavre, or pour une cachette trouvée, mauve (MJ seulement) pour ce qui est encore caché. */
const COLORS = { zone: 0xf2e3b3, found: 0xf0b429, concealed: 0x9d8cd6, trap: 0xe0312b };

let layer = null;
let active = false;
const shapes = new Map();   // contour d'une tuile, par clé (id, image, position, taille, rotation)

const inCombat = () => game.combat?.started === true;

/* ---- ce qui brille ---- */

/** Un coffre tiré, ouvert et vide ne brille plus (même règle que son curseur). */
function containerWorthIt(behavior) {
  if ( behavior.type !== CONTAINER_TYPE ) return true;
  const actor = behavior.system.actor ? fromUuidSync(behavior.system.actor, { strict: false }) : null;
  return !(behavior.system.rolled && !behavior.system.locked && actor && lootView(actor).empty);
}

/** Les zones DAS visibles pour ce client sur le niveau affiché, avec leur couleur. */
function zonesToDraw(scene) {
  const out = [];
  for ( const behavior of [...sceneContainers(scene), ...sceneZones(scene)] ) {
    const region = behavior.region;
    if ( !region?.viewed || !containerWorthIt(behavior) ) continue;
    const hidden = behavior.system.hidden;
    const color = behaviorConcealed(behavior) ? COLORS.concealed : (hidden?.enabled ? COLORS.found : COLORS.zone);
    out.push({ region, color });
  }
  return out;
}

/** Les zones de déclenchement des pièges repérés et pas désamorcés, sur le niveau affiché. */
function trapsToDraw() {
  return sceneTraps(canvas.scene).filter(b => trapKnown(b) && b.region?.viewed).map(b => b.region);
}

/** Les cadavres qu'on peut fouiller, visibles pour ce client. */
function corpsesToDraw() {
  if ( !game.user.isGM && (setting("whoLoots") === "gm") ) return [];
  return (canvas.tokens?.placeables ?? []).filter(t => t.visible && corpseToken(t.document) && t.actor
    && (!lootView(t.actor).empty || (setting("autoTreasure") && mayHaveTreasure(t.actor))));
}

/** Le contour de l'image d'une tuile, en cache tant qu'elle ne bouge ni ne change d'image. */
function tileOutline(tile) {
  const key = [tile.id, tile.texture?.src, tile.x, tile.y, tile.width, tile.height, tile.rotation].join("|");
  if ( !shapes.has(key) ) shapes.set(key, tileShape(tile).points);
  return shapes.get(key);
}

/** Les polygones à dessiner pour une région : le contour de sa tuile visible s'il y en a une, sinon ses propres polygones. */
function regionPolygons(region) {
  const tile = tilesIn(region).find(t => t.object?.visible);
  if ( tile ) return [tileOutline(tile)];
  return (region.polygons ?? []).map(p => p.points);
}

/* ---- dessin ---- */

function ensureLayer() {
  if ( layer && !layer.destroyed && layer.parent ) return layer;
  layer = new PIXI.Container();
  layer.eventMode = "none";
  layer.interactiveChildren = false;
  canvas.interface.addChild(layer);
  return layer;
}

/** Un liseré lumineux : un trait large et pâle, un trait fin et franc, un voile très léger. */
function drawOutline(g, points, color) {
  if ( !points || (points.length < 6) ) return;
  g.lineStyle({ width: 10, color, alpha: 0.18, join: PIXI.LINE_JOIN.ROUND });
  g.drawPolygon(points);
  g.lineStyle({ width: 3, color, alpha: 0.95, join: PIXI.LINE_JOIN.ROUND });
  g.beginFill(color, 0.1);
  g.drawPolygon(points);
  g.endFill();
}

function drawCorpse(g, token) {
  const { x, y } = token.center;
  const r = Math.max(token.w, token.h) / 2;
  g.lineStyle({ width: 10, color: COLORS.zone, alpha: 0.18 });
  g.drawCircle(x, y, r);
  g.lineStyle({ width: 3, color: COLORS.zone, alpha: 0.95 });
  g.drawCircle(x, y, r);
}

/** Redessine (ou efface) la surbrillance. */
export function redraw() {
  if ( !canvas.ready ) return;
  const container = ensureLayer();
  for ( const child of container.removeChildren() ) child.destroy();
  const g = new PIXI.Graphics();
  g.eventMode = "none";
  // Toujours : les pièges repérés, en rouge (le MJ voit aussi, en mauve avec la touche, ceux qui sont encore cachés).
  for ( const region of trapsToDraw() ) {
    for ( const points of regionPolygons(region) ) drawOutline(g, points, COLORS.trap);
  }
  if ( active && !inCombat() ) {
    for ( const { region, color } of zonesToDraw(canvas.scene) ) {
      for ( const points of regionPolygons(region) ) drawOutline(g, points, color);
    }
    for ( const behavior of sceneTraps(canvas.scene) ) {
      if ( game.user.isGM && !trapKnown(behavior) && !behavior.system.disarmed && behavior.region?.viewed ) {
        for ( const points of regionPolygons(behavior.region) ) drawOutline(g, points, COLORS.concealed);
      }
    }
    for ( const token of corpsesToDraw() ) drawCorpse(g, token);
  }
  container.addChild(g);
}

function onHighlight(on) {
  active = !!on;
  redraw();
}

/** Ce qui est dessiné, pour les tests : nombre de zones et de cadavres. */
export function highlightState() {
  return { active, combat: inCombat(), traps: trapsToDraw().length, zones: active ? zonesToDraw(canvas.scene).length : 0,
    corpses: active ? corpsesToDraw().length : 0, drawn: layer?.children?.[0]?.geometry?.graphicsData?.length ?? 0 };
}

export function registerHighlight() {
  route("highlightObjects", "highlight", onHighlight);
  route("canvasReady", "highlight", () => { layer = null; active = false; shapes.clear(); redraw(); });
  route("canvasTearDown", "highlight", () => { layer = null; active = false; });
  // Tant que la touche est tenue : ce qui change sous les yeux (coffre vidé, cachette trouvée, mort, combat).
  for ( const hook of ["updateRegionBehavior", "createRegionBehavior", "deleteRegionBehavior", "createRegion", "deleteRegion", "updateRegion", "updateTile", "updateToken",
    "updateActor", "createActiveEffect", "deleteActiveEffect", "updateCombat", "deleteCombat", "createCombat"] ) {
    // Les pièges repérés sont dessinés en permanence : on redessine toujours (ce n'est qu'un trait par zone).
    route(hook, "highlight", () => redraw());
  }
}
