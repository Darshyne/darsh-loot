/**
 * Outil « tuile → zone » (SPEC §3.12) : un bouton du HUD de tuile (MJ) crée une région de la forme de l'image de la
 * tuile, portant une zone « DAS · … » (Conteneur, Macro au clic, Vers une scène, Ouvrir un document). Repris de
 * `coc7-dialogues` (scripts/tile-to-region.js). La région épouse la tuile : la tuile « dans la région » d'une zone
 * cachée et le liseré de surbrillance tombent sur la zone cliquable.
 */
import { MODULE_ID, loc, log } from "../shared.mjs";
import { route } from "./router.mjs";
import { CONTAINER_TYPE } from "../adapter/container-behavior.mjs";
import { MACRO_ZONE, SCENE_ZONE, DOCUMENT_ZONE } from "../adapter/zone-behaviors.mjs";
import { TRAP_ZONE } from "../adapter/trap-behavior.mjs";
import { tileShape } from "../adapter/tile-outline.mjs";
import { prettyName } from "../core/outline.mjs";
import { tileRect, fitsTile } from "../core/tile-link.mjs";
import { promptTileZone } from "../apps/tile-zone-dialog.mjs";

/** Les zones que l'outil sait créer, dans l'ordre de la liste. */
const TYPES = [
  { kind: "container", id: CONTAINER_TYPE },
  { kind: "macro", id: MACRO_ZONE },
  { kind: "scene", id: SCENE_ZONE },
  { kind: "document", id: DOCUMENT_ZONE },
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
  if ( isActiveGM() ) linkOldZones().catch(err => log.warn("linking zones to their tiles:", err.message));
}
