/**
 * Outil « tuile → zone » (SPEC §3.12) : un bouton du HUD de tuile (MJ) crée une région de la forme de l'image de la
 * tuile, portant une zone « DAS · … » (Conteneur, Macro au clic, Vers une scène, Ouvrir un document). Repris de
 * `coc7-dialogues` (scripts/tile-to-region.js). La région épouse la tuile : la tuile « dans la région » d'une zone
 * cachée et le liseré de surbrillance tombent sur la zone cliquable.
 */
import { loc, log } from "../shared.mjs";
import { route } from "./router.mjs";
import { CONTAINER_TYPE } from "../adapter/container-behavior.mjs";
import { MACRO_ZONE, SCENE_ZONE, DOCUMENT_ZONE } from "../adapter/zone-behaviors.mjs";
import { TRAP_ZONE } from "../adapter/trap-behavior.mjs";
import { tileShape } from "../adapter/tile-outline.mjs";
import { prettyName } from "../core/outline.mjs";
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
  if ( !type ) throw new Error(`type de zone inconnu : ${kind}`);
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
    behaviors: [{ name: typeName, type: type.id, system: { label: name, ...system } }]
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
    log.warn("tuile → zone :", err.message);
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

export function registerTileZone() {
  route("renderTileHUD", "bouton tuile → zone", onRenderTileHUD);
}
