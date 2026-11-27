/**
 * Two permanent visual cues (user's request, 2026-11-27). Pure.
 * - « Loot » status: a golden purse among the status icons of a corpse that still has something to take (runtime/loot-mark.mjs).
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

/**
 * Does a token deserve the « Loot » status? A corpse (dead NPC) that still has something to take, or a treasure not rolled yet.
 * @param {{ enabled: boolean, corpse: boolean, hasLoot: boolean, unrolled: boolean }} state
 */
export function lootMarkWanted({ enabled, corpse, hasLoot, unrolled }) {
  return !!(enabled && corpse && (hasLoot || unrolled));
}
