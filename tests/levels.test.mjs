import { describe, it, expect, afterEach } from "vitest";
import { regionFloor, levelBase } from "../module/scripts/adapter/sight.mjs";
import { pileLevelFix } from "../module/scripts/core/drop.mjs";

// A scene with two V14 levels: the ground floor (-40 to 0) and an upper floor (base 20).
const levelMap = new Map([["ground", { id: "ground", elevation: { base: -40 } }], ["upper", { id: "upper", elevation: { base: 20 } }]]);
const scene = { levels: levelMap, tiles: new Map([["pileTile", { elevation: 20 }], ["oldTile", { elevation: 0 }]]) };
const region = ({ bottom = -Infinity, levels = [], flags = {} } = {}) =>
  ({ parent: scene, elevation: { bottom, top: Infinity }, levels: new Set(levels), flags });

afterEach(() => { delete globalThis.canvas; });

describe("floor of a region on V14 levels (Gack, piles on an upper floor)", () => {
  it("a region with a finite bottom keeps it", () => {
    expect(regionFloor(region({ bottom: 5, levels: ["upper"] }))).toBe(5);
  });
  it("an open region on the upper floor stands on that floor, not at 0", () => {
    globalThis.canvas = { level: levelMap.get("upper") };
    expect(regionFloor(region({ levels: ["upper"] }))).toBe(20);
  });
  it("seen from another level, it is the region's own level that counts", () => {
    globalThis.canvas = { level: levelMap.get("ground") };
    expect(regionFloor(region({ levels: ["upper"] }))).toBe(20);
  });
  it("a region in several levels takes the viewed one", () => {
    globalThis.canvas = { level: levelMap.get("upper") };
    expect(regionFloor(region({ levels: ["ground", "upper"] }))).toBe(20);
  });
  it("a region without levels takes the viewed level", () => {
    globalThis.canvas = { level: levelMap.get("upper") };
    expect(regionFloor(region())).toBe(20);
  });
  it("a pile or a placed container stands where its tile is", () => {
    globalThis.canvas = { level: levelMap.get("ground") };
    expect(regionFloor(region({ levels: ["ground"], flags: { "darsh-loot": { pile: { tile: "oldTile" } } } }))).toBe(0);
    expect(regionFloor(region({ levels: ["upper"], flags: { "darsh-loot": { tile: "pileTile" } } }))).toBe(20);
  });
  it("without levels nor canvas: 0, as before", () => {
    expect(regionFloor({ elevation: { bottom: null } })).toBe(0);
    expect(levelBase(scene, "nope")).toBe(null);
  });
});

describe("piles left by an older version on an upper floor", () => {
  it("a tile dropped at 0 on the upper floor is raised onto it", () => {
    expect(pileLevelFix({ tileLevels: ["upper"], regionLevels: ["upper"], elevation: 0, base: 20 })).toEqual({ elevation: 20 });
  });
  it("the region follows a tile the GM moved to another level", () => {
    expect(pileLevelFix({ tileLevels: ["upper"], regionLevels: ["ground"], elevation: 20, base: 20 })).toEqual({ levels: ["upper"] });
  });
  it("a pile in order, or above its floor, is left alone", () => {
    expect(pileLevelFix({ tileLevels: ["upper"], regionLevels: ["upper"], elevation: 25, base: 20 })).toEqual({});
    expect(pileLevelFix({ tileLevels: [], regionLevels: [], elevation: 0, base: null })).toEqual({});
  });
});
