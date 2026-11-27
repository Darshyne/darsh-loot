/**
 * The icon of a ground pile drawn as a card (2026-11-27): rounded corners, a dark backing for icons with transparency, and
 * optionally a thin gold rim. Display only — a new texture built on each client from the tile's own, never written anywhere.
 * Sizes: core/loot-visuals.mjs `frameSpec`.
 */
import { frameSpec, PILE_FRAME } from "../core/loot-visuals.mjs";

const BACKING = "#1c1813";
const cache = new Map();   // key (image, style) → PIXI.Texture

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * The framed version of `texture`, or null when its image cannot be read (video, image from another domain without CORS).
 * @param {PIXI.Texture} texture
 * @param {string} style  PILE_FRAME.rounded or PILE_FRAME.gold
 * @param {string} key    what identifies the image (its path)
 * @returns {PIXI.Texture|null}
 */
export function framedTexture(texture, style, key) {
  const id = `${key}|${style}`;
  const known = cache.get(id);
  if ( known && !known.baseTexture?.destroyed ) return known;
  const source = texture?.baseTexture?.resource?.source;
  if ( !texture?.valid || !source || (source instanceof HTMLVideoElement) ) return null;
  const width = texture.orig?.width ?? texture.width, height = texture.orig?.height ?? texture.height;
  const { w, h, r, rim } = frameSpec(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const gold = style === PILE_FRAME.gold;
  const inset = gold ? rim / 2 : 0;
  // Card: dark backing, then the icon, both clipped to the rounded shape.
  ctx.save();
  roundedRect(ctx, inset, inset, w - (2 * inset), h - (2 * inset), r);
  ctx.clip();
  ctx.fillStyle = BACKING;
  ctx.fillRect(0, 0, w, h);
  try {
    const f = texture.frame;
    ctx.drawImage(source, f.x, f.y, f.width, f.height, 0, 0, w, h);
  } catch(err) {
    ctx.restore();
    return null;
  }
  ctx.restore();
  if ( gold ) {
    // A thin dark line under the rim keeps it readable on a light map, then the rim, lighter at the top.
    roundedRect(ctx, inset, inset, w - (2 * inset), h - (2 * inset), r);
    ctx.lineWidth = rim + 2;
    ctx.strokeStyle = "rgba(20, 14, 6, 0.55)";
    ctx.stroke();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#f4dd96");
    grad.addColorStop(0.5, "#d2a54a");
    grad.addColorStop(1, "#a97a2c");
    ctx.lineWidth = rim;
    ctx.strokeStyle = grad;
    ctx.stroke();
  }
  const framed = PIXI.Texture.from(canvas);
  cache.set(id, framed);
  return framed;
}

/** Forget every framed texture (scene torn down). */
export function clearFramedTextures() {
  for ( const t of cache.values() ) t.destroy(true);
  cache.clear();
}
