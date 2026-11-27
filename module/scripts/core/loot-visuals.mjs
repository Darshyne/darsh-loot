/**
 * Two permanent visual cues (user's request, 2026-11-27). Pure.
 * - Corpse glint: a few golden motes rising from a corpse that still has something to take (runtime/glint.mjs draws them).
 * - Pile frame: the icon of a ground pile drawn as a card, with rounded corners and a thin gold rim (adapter/pile-frame.mjs).
 */

/** Longest side of a framed pile texture, in pixels: large enough for a smooth rim, small enough to stay cheap. */
export const FRAME_PX = 256;
/** Corner radius and rim width, as a share of the icon's shorter side. */
export const FRAME_RADIUS = 0.16;
export const FRAME_RIM = 0.035;

/**
 * The framed texture's size and the corner and rim sizes, in texture pixels, for an icon of `width` × `height`.
 * The aspect ratio is kept, so the core resizes the framed texture exactly as it did the original.
 * @returns {{ w: number, h: number, r: number, rim: number }}
 */
export function frameSpec(width, height, { radius=FRAME_RADIUS, rim=FRAME_RIM, size=FRAME_PX }={}) {
  const W = Math.max(1, Number(width) || 1), H = Math.max(1, Number(height) || 1);
  const k = size / Math.max(W, H);
  const w = Math.max(2, Math.round(W * k)), h = Math.max(2, Math.round(H * k));
  const short = Math.min(w, h);
  return { w, h, r: Math.round(short * radius), rim: Math.max(1, Math.round(short * rim)) };
}

/** Pile frame setting values. */
export const PILE_FRAME = Object.freeze({ off: "off", rounded: "rounded", gold: "gold" });

/** Corpse glint setting values: never, outside combat only, always. */
export const GLINT = Object.freeze({ off: "off", peace: "peace", always: "always" });

/** Is the glint drawn now? */
export function glintShown(mode, inCombat) {
  if ( mode === GLINT.always ) return true;
  if ( mode === GLINT.peace ) return !inCombat;
  return false;
}

/** Number of motes around one corpse. */
export const MOTES = 10;

/** The soft glow at the corpse's feet: its opacity at time `t` (ms), a slow pulse between 0.25 and 0.45. */
export function pulse(t) {
  return 0.35 + (Math.sin((t / 1400) * Math.PI) * 0.1);
}

/** A stable pseudo-random number in [0, 1) for an integer seed. */
export function hash01(n) {
  const x = Math.sin((n + 1) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * One mote at time `t` (ms): its offset from the token's center and its size, as shares of the token's radius, and its opacity.
 * Each mote rises from the lower half of the token, sways a little, fades in then out, and starts again — each on its own
 * period and phase, so the motes never move together.
 * @returns {{ x: number, y: number, size: number, alpha: number }}
 */
export function mote(i, t) {
  const a = hash01(i * 3), b = hash01((i * 3) + 1), c = hash01((i * 3) + 2);
  const period = 2400 + (a * 1600);
  const u = (((t / period) + b) % 1 + 1) % 1;
  const sway = Math.sin((u * Math.PI * 2) + (c * 6.28)) * 0.08;
  return {
    x: ((b - 0.5) * 1.1) + sway,
    y: 0.45 - (u * 1.15),
    size: 0.06 + (c * 0.05),
    alpha: Math.pow(Math.sin(Math.PI * u), 1.2) * 0.95
  };
}
