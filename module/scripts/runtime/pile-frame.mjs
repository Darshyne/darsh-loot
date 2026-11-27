/**
 * Ground piles drawn as cards (user's request, 2026-11-27: « les images carrées c'est pas très beau »): rounded corners and,
 * by default, a thin gold rim. On each client, display only: the tile document keeps its image, so turning the setting off
 * gives the plain icon back. Only pile tiles (`flags.darsh-loot.pileTile`) — never a chest converted from a token or a map tile.
 *
 * The core loads the tile's texture in `_draw` and resizes the mesh from the texture's aspect ratio (canvas/placeables/tile.mjs
 * `_draw`, `_refreshSize`): the framed texture keeps that ratio, so `objectSize` (runtime/object-size.mjs) still applies.
 */
import { MODULE_ID, setting } from "../shared.mjs";
import { route } from "./router.mjs";
import { framedTexture, clearFramedTextures } from "../adapter/pile-frame.mjs";
import { PILE_FRAME } from "../core/loot-visuals.mjs";

const isPileTile = doc => !!doc?.getFlag(MODULE_ID, "pileTile");

function style() {
  const v = setting("pileFrame");
  return Object.values(PILE_FRAME).includes(v) ? v : PILE_FRAME.gold;
}

/** A pile tile was drawn: give its mesh the framed texture. */
function onDrawTile(tile) {
  if ( !isPileTile(tile.document) || !tile.mesh || tile.mesh.destroyed || !tile.texture ) return;
  const s = style();
  if ( s === PILE_FRAME.off ) return;
  const framed = framedTexture(tile.texture, s, tile.document.texture.src);
  if ( !framed ) return;
  tile.mesh.texture = framed;
  tile.renderFlags.set({ refreshSize: true, refreshMesh: true });
}

/** The setting changed: every pile tile is drawn again. */
function redrawPiles() {
  if ( !canvas.ready ) return;
  for ( const t of canvas.tiles?.placeables ?? [] ) if ( isPileTile(t.document) ) t.renderFlags.set({ redraw: true });
}

/** For the in-game self-test: is this tile showing a framed texture? */
export function pileFramed(tile) {
  const mesh = tile?.object?.mesh;
  return !!mesh && !!tile.object.texture && (mesh.texture !== tile.object.texture);
}

export function registerPileFrame() {
  route("drawTile", "pile frame", onDrawTile);
  route("canvasTearDown", "pile frame", () => clearFramedTextures());
  route(`${MODULE_ID}.pileFrame`, "pile frame", redrawPiles);
}
