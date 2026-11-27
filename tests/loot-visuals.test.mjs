import { describe, it, expect } from "vitest";
import { frameSpec, FRAME_PX, lootMarkWanted } from "../module/scripts/core/loot-visuals.mjs";

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

describe("« Loot » status", () => {
  const base = { enabled: true, corpse: true, hasLoot: false, unrolled: false };
  it("marks a corpse with something to take, or a treasure not rolled yet", () => {
    expect(lootMarkWanted({ ...base, hasLoot: true })).toBe(true);
    expect(lootMarkWanted({ ...base, unrolled: true })).toBe(true);
  });
  it("never an empty corpse, a living creature, or with the setting off", () => {
    expect(lootMarkWanted(base)).toBe(false);
    expect(lootMarkWanted({ ...base, corpse: false, hasLoot: true })).toBe(false);
    expect(lootMarkWanted({ ...base, enabled: false, hasLoot: true })).toBe(false);
  });
});
