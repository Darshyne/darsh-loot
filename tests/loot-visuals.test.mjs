import { describe, it, expect } from "vitest";
import { frameSpec, FRAME_PX, glintShown, GLINT, mote, hash01 } from "../module/scripts/core/loot-visuals.mjs";

describe("pile frame size", () => {
  it("keeps the icon's aspect ratio, longest side at FRAME_PX", () => {
    const s = frameSpec(512, 256);
    expect(s.w).toBe(FRAME_PX);
    expect(s.h).toBe(FRAME_PX / 2);
  });
  it("scales small icons up and measures corners and rim on the shorter side", () => {
    const s = frameSpec(64, 64);
    expect(s.w).toBe(FRAME_PX);
    expect(s.r).toBeGreaterThan(30);
    expect(s.r).toBeLessThan(50);
    expect(s.rim).toBeGreaterThanOrEqual(1);
    expect(s.rim).toBeLessThan(s.r);
  });
  it("survives a texture of no size", () => {
    const s = frameSpec(0, undefined);
    expect(s.w).toBeGreaterThanOrEqual(2);
    expect(s.h).toBeGreaterThanOrEqual(2);
  });
});

describe("corpse glint", () => {
  it("follows the setting and combat", () => {
    expect(glintShown(GLINT.off, false)).toBe(false);
    expect(glintShown(GLINT.peace, false)).toBe(true);
    expect(glintShown(GLINT.peace, true)).toBe(false);
    expect(glintShown(GLINT.always, true)).toBe(true);
    expect(glintShown("nonsense", false)).toBe(false);
  });
  it("motes stay near the token, fade in and out, and do not move together", () => {
    for ( let i = 0; i < 20; i++ ) {
      for ( let t = 0; t < 10000; t += 137 ) {
        const m = mote(i, t);
        expect(Math.abs(m.x)).toBeLessThan(0.75);
        expect(m.y).toBeLessThanOrEqual(0.45);
        expect(m.y).toBeGreaterThanOrEqual(-0.71);
        expect(m.alpha).toBeGreaterThanOrEqual(0);
        expect(m.alpha).toBeLessThanOrEqual(0.95);
      }
    }
    expect(mote(0, 1000).y).not.toBeCloseTo(mote(1, 1000).y, 3);
  });
  it("hash01 is stable and in [0, 1)", () => {
    expect(hash01(5)).toBe(hash01(5));
    for ( let n = 0; n < 100; n++ ) { const h = hash01(n); expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThan(1); }
  });
});
