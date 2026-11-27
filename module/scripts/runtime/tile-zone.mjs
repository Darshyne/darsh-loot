/**
 * Outil « tuile → zone » (SPEC §3.12) : un bouton du HUD de tuile (MJ) crée une région de la forme de l'image de la
 * tuile, portant une zone « DAS · … » (Conteneur, Macro au clic, Vers une scène, Ouvrir un document). Repris de
 * `coc7-dialogues` (scripts/tile-to-region.js). La région épouse la tuile : la tuile « dans la région » d'une zone
 * cachée et le liseré de surbrillance tombent sur la zone cliquable.
 */
import { MODULE_ID, loc, log } from "../shared.mjs";
import { route } from "./router.mjs";
import { CONTAINER_TYPE } from "../adapter/container-behavior.mjs";
import { MACRO_ZONE, SCENE_ZONE, DOCUMENT_ZONE, MECHANISM_ZONE } from "../adapter/zone-behaviors.mjs";
import { TRAP_ZONE } from "../adapter/trap-behavior.mjs";
import { tileShape } from "../adapter/tile-outline.mjs";
import { prettyName } from "../core/outline.mjs";
import { tileRect, fitsTile, tileShift, shiftShapes, shiftElevation, sameLevels } from "../core/tile-link.mjs";
import { promptTileZone } from "../apps/tile-zone-dialog.mjs";

/** Les zones que l'outil sait créer, dans l'ordre de la liste. */
const TYPES = [
  { kind: "container", id: CONTAINER_TYPE },
  { kind: "macro", id: MACRO_ZONE },
  { kind: "scene", id: SCENE_ZONE },
  { kind: "document", id: DOCUMENT_ZONE },
  // Étape 13 : un levier, un bouton — la tuile est la sienne, son image de départ est celle de la position « relevé ».
  { kind: "mechanism", id: MECHANISM_ZONE },
  // La zone de déclenchement d'un piège (une dalle) ; sa zone d'effet se dessine à la main.
  { kind: "trap", id: TRAP_ZONE }
];

/**
 * Crée la zone d'une tuile. `kind` : container | macro | scene | document ; `system` : champs du comportement.
 * @param {TileDocument} tile
 * @returns {Promise<RegionDocument|null>}
 */
export async function tileToZone(tile, { kind="container", name="", system={}, openSheet=true }={}) {
  if ( !game.user.isGM ) return null;
  if ( !tile?.object || (tile.parent !== canvas.scene) ) {
    ui.notifications.warn(loc("TileZone.NotOnCanvas"));
    return null;
  }
  const type = TYPES.find(t => t.kind === kind);
  if ( !type ) throw new Error(`unknown zone type: ${kind}`);
  if ( kind === "mechanism" ) system = { tile: tile.uuid, imageOff: tile.texture?.src || null, ...system };
  const { points, traced } = tileShape(tile);
  name ||= prettyName(tile.texture?.src) || loc("TileZone.DefaultName");
  const typeName = game.i18n.localize(`TYPES.RegionBehavior.${type.id}`);
  const [region] = await canvas.scene.createEmbeddedDocuments("Region", [{
    name,
    color: "#d6ba80",
    // Visible du MJ sur la couche des régions seulement : les joueurs ne voient que la tuile.
    visibility: CONST.REGION_VISIBILITY.LAYER,
    shapes: [{ type: "polygon", points }],
    // Comportement créé avec sa région : le coffre d'un conteneur naît par le hook `createRegion` (runtime/containers.mjs).
    behaviors: [{ name: typeName, type: type.id, system: { label: name, ...system } }],
    // 0.15.5 : la zone et sa tuile vont ensemble — supprimer l'une supprime l'autre.
    flags: { [MODULE_ID]: { tile: tile.id } }
  }]);
  ui.notifications.info(loc(traced ? "TileZone.Traced" : "TileZone.Rectangle", { name, type: typeName }));
  if ( openSheet ) region.behaviors.contents[0]?.sheet.render({ force: true });
  return region;
}

async function promptAndCreate(tile) {
  const choice = await promptTileZone({ types: TYPES, name: prettyName(tile.texture?.src) });
  if ( !choice ) return null;
  try { return await tileToZone(tile, choice); }
  catch(err) {
    log.warn("tile → zone:", err.message);
    ui.notifications.warn(loc("Notice.Refused", { reason: err.message }));
    return null;
  }
}

/** Bouton du HUD de tuile (MJ). En V14, `html` est un HTMLElement. */
function onRenderTileHUD(hud, html) {
  if ( !game.user.isGM ) return;
  const column = html.querySelector(".col.right");
  if ( !column || column.querySelector(".dlo-hud") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon dlo-hud";
  button.dataset.tooltip = loc("TileZone.HudTooltip");
  button.setAttribute("aria-label", button.dataset.tooltip);
  button.innerHTML = `<i class="fa-solid fa-draw-polygon" inert></i>`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    promptAndCreate(hud.document);
  });
  column.append(button);
}

/* -------------------------------------------- */
/*  Zone et tuile liées (0.15.5)                */
/* -------------------------------------------- */

const isActiveGM = () => game.users.activeGM?.isSelf === true;

/** L'id de la tuile liée à une région : celle d'un tas au sol (§3.8) ou celle d'où la zone a été faite. */
const linkedTileId = region => region.getFlag(MODULE_ID, "pile")?.tile ?? region.getFlag(MODULE_ID, "tile") ?? null;

/** Une région qui porte une zone DAS (conteneur, macro, scène, document, piège, objet caché…). */
const hasDasZone = region => region.behaviors.some(b => b.type?.startsWith(`${MODULE_ID}.`));

/** Chez le MJ : une région supprimée emporte sa tuile. Le coffre d'un conteneur suit sa propre règle (runtime/containers.mjs). */
async function onDeleteRegion(region) {
  if ( !isActiveGM() ) return;
  const id = linkedTileId(region);
  if ( id && region.parent?.tiles.has(id) ) await region.parent.deleteEmbeddedDocuments("Tile", [id]);
}

/** Chez le MJ : une tuile supprimée emporte la zone qui lui est liée. */
async function onDeleteTile(tile) {
  if ( !isActiveGM() ) return;
  const ids = tile.parent?.regions.filter(r => linkedTileId(r) === tile.id).map(r => r.id) ?? [];
  if ( ids.length ) await tile.parent.deleteEmbeddedDocuments("Region", ids);
}

/**
 * 2026-11-27 (reported by the user): the zone follows its tile. Deleting one already deleted the other, but a GM who moved the
 * tile of a container — or sent it to another V14 level — left the region where it was: the image was in one place, the click
 * and the reach in another.
 *
 * Where the tile was is only known before the update, on the client that moves it: `preUpdateTile` notes the shift in the
 * update's options, which reach every client; the active GM then moves the linked regions by the same amount (`updateTile`).
 * The levels are copied from the tile as they are. A move the module makes itself (pile realignment) says `dloNoFollow`.
 */
const FOLLOW = `${MODULE_ID}Follow`;

function onPreUpdateTile(tile, changes, options) {
  if ( options?.dloNoFollow ) return;
  if ( !["x", "y", "elevation"].some(k => k in changes) ) return;
  const src = tile._source;
  const shift = tileShift(src, { x: changes.x ?? src.x, y: changes.y ?? src.y, elevation: changes.elevation ?? src.elevation });
  if ( shift ) options[FOLLOW] = shift;
}

async function onUpdateTile(tile, changes, options) {
  if ( !isActiveGM() || options?.dloNoFollow ) return;
  const shift = options?.[FOLLOW] ?? null;
  const levelsChanged = "levels" in changes;
  if ( !shift && !levelsChanged ) return;
  const scene = tile.parent;
  const tileLevels = [...(tile._source.levels ?? [])];
  const updates = [];
  for ( const region of scene?.regions ?? [] ) {
    if ( linkedTileId(region) !== tile.id ) continue;
    const src = region._source;
    const update = { _id: region.id };
    if ( shift && (shift.dx || shift.dy) ) update.shapes = shiftShapes(src.shapes.map(s => ({ ...s })), shift.dx, shift.dy);
    if ( shift?.dz && (Number.isFinite(src.elevation?.bottom) || Number.isFinite(src.elevation?.top)) ) update.elevation = shiftElevation(src.elevation, shift.dz);
    if ( levelsChanged && !sameLevels(src.levels, tileLevels) ) update.levels = tileLevels;
    if ( Object.keys(update).length > 1 ) updates.push(update);
  }
  if ( updates.length ) await scene.updateEmbeddedDocuments("Region", updates);
}

/**
 * Chez le MJ, au chargement : les zones faites d'une tuile avant la 0.15.5 n'avaient pas de lien. Une région DAS sans lien reçoit
 * celui de la seule tuile dont elle épouse l'image (core/tile-link.mjs `fitsTile`) ; ambigu ou rien : elle reste sans lien.
 */
async function linkOldZones() {
  for ( const scene of game.scenes ) {
    const linked = new Set(scene.regions.map(linkedTileId).filter(Boolean));
    const updates = [];
    for ( const region of scene.regions ) {
      if ( linkedTileId(region) || !hasDasZone(region) ) continue;
      const bounds = region.bounds;
      const fits = scene.tiles.filter(t => !linked.has(t.id) && fitsTile(bounds, tileRect({ x: t.x, y: t.y, width: t.width,
        height: t.height, anchorX: t.texture.anchorX, anchorY: t.texture.anchorY })));
      if ( fits.length !== 1 ) continue;
      linked.add(fits[0].id);
      updates.push({ _id: region.id, [`flags.${MODULE_ID}.tile`]: fits[0].id });
    }
    if ( updates.length ) await scene.updateEmbeddedDocuments("Region", updates);
  }
}

export function registerTileZone() {
  route("renderTileHUD", "tile → zone button", onRenderTileHUD);
  route("deleteRegion", "zone and its tile", region => onDeleteRegion(region));
  route("deleteTile", "zone and its tile", tile => onDeleteTile(tile));
  route("preUpdateTile", "zone follows its tile", onPreUpdateTile);
  route("updateTile", "zone follows its tile", (tile, changes, options) => { onUpdateTile(tile, changes, options).catch(err => log.warn("zone not moved with its tile:", err.message)); });
  if ( isActiveGM() ) linkOldZones().catch(err => log.warn("linking zones to their tiles:", err.message));
}
