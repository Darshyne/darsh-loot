/**
 * La forme d'une tuile sur la scène (outil « tuile → zone », SPEC §3.12) : contour de son image, ou son rectangle si
 * l'image ne se lit pas. Repris de `coc7-dialogues` (scripts/tile-to-region.js) ; le calcul pur est dans core/outline.mjs.
 */
import { alphaMask, largestContour, simplify, footprint } from "../core/outline.mjs";

const MASK_MAX = 256;        // plus grand côté du masque alpha
const ALPHA_THRESHOLD = 48;  // 0-255 : au-dessus, le pixel compte
const SIMPLIFY_EPS = 1.25;   // tolérance de Douglas-Peucker, en pixels du masque

/** Le rectangle de la tuile (rotation autour de son point d'ancrage). */
export function tileFootprint(tile) {
  return footprint({ x: tile.x, y: tile.y, width: tile.width, height: tile.height, rotation: tile.rotation ?? 0,
    anchorX: tile.texture?.anchorX ?? 0, anchorY: tile.texture?.anchorY ?? 0 });
}

/**
 * Le contour visible de l'image de la tuile, en coordonnées de la scène (`[x, y, …]`), ou null s'il ne se lit pas
 * (vidéo, image d'un autre domaine sans CORS : le canevas est « tainted » et `getImageData` lève).
 */
export function traceTileOutline(tile) {
  const mesh = tile.object?.mesh;
  // Position, échelle et rotation du mesh sont posées par les drapeaux de rendu, vidés sur le ticker : une tuile tout
  // juste créée a encore un mesh à l'origine (vu dans coc7-dialogues le 2026-08-22).
  tile.object?.applyRenderFlags?.();
  const texture = mesh?.texture;
  const source = texture?.baseTexture?.resource?.source;
  if ( !mesh || !texture?.valid || !source || (source instanceof HTMLVideoElement) ) return null;

  const texW = texture.orig?.width ?? texture.width, texH = texture.orig?.height ?? texture.height;
  const scale = Math.min(1, MASK_MAX / Math.max(texW, texH));
  const w = Math.max(2, Math.round(texW * scale)), h = Math.max(2, Math.round(texH * scale));
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const { mask, W, H, count } = alphaMask(ctx.getImageData(0, 0, w, h).data, w, h, ALPHA_THRESHOLD);
  if ( count < 4 ) return null;
  const contour = largestContour(mask, W, H);
  if ( !contour || (contour.length < 3) ) return null;
  const points = simplify(contour, SIMPLIFY_EPS);
  if ( points.length < 3 ) return null;

  // Pixel du masque → pixel de la texture → repère du sprite → scène, par la transformation **locale** du mesh : le
  // groupe primaire est à l'origine, et elle est à jour même sans image rendue (onglet masqué), contrairement à
  // `worldTransform`.
  const ax = mesh.anchor?.x ?? (tile.texture?.anchorX ?? 0), ay = mesh.anchor?.y ?? (tile.texture?.anchorY ?? 0);
  mesh.transform.updateLocalTransform();
  const matrix = mesh.transform.localTransform;
  const out = [];
  const tmp = new PIXI.Point();
  for ( const [mx, my] of points ) {
    tmp.set(((mx - 1) / scale) - (ax * texW), ((my - 1) / scale) - (ay * texH));
    matrix.apply(tmp, tmp);
    out.push(Math.round(tmp.x), Math.round(tmp.y));
  }
  return out;
}

/** La forme de la tuile : son contour, sinon son rectangle. `traced` dit lequel. */
export function tileShape(tile) {
  let points = null;
  try { points = traceTileOutline(tile); }
  catch(err) { points = null; }
  return points ? { points, traced: true } : { points: tileFootprint(tile), traced: false };
}
