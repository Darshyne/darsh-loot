import { describe, it, expect } from "vitest";
import { tileRect, fitsTile, tileShift, shiftShapes, shiftElevation, sameLevels } from "../module/scripts/core/tile-link.mjs";

describe("lien zone ↔ tuile", () => {
  it("le rectangle d'une tuile part de son ancrage", () => {
    expect(tileRect({ x: 200, y: 300, width: 100, height: 50 })).toEqual({ x: 150, y: 275, width: 100, height: 50 });
    expect(tileRect({ x: 200, y: 300, width: 100, height: 50, anchorX: 0, anchorY: 0 })).toEqual({ x: 200, y: 300, width: 100, height: 50 });
  });

  const rect = { x: 100, y: 100, width: 200, height: 200 };
  it("un contour tracé dans l'image est la zone de la tuile", () => {
    expect(fitsTile({ x: 110, y: 105, width: 180, height: 190 }, rect)).toBe(true);
    expect(fitsTile({ x: 99, y: 99, width: 202, height: 202 }, rect)).toBe(true);
  });
  it("une région dessinée autour, ou bien plus petite, ne l'est pas", () => {
    expect(fitsTile({ x: 50, y: 50, width: 300, height: 300 }, rect)).toBe(false);
    expect(fitsTile({ x: 150, y: 150, width: 40, height: 40 }, rect)).toBe(false);
  });
});

describe("the zone follows its tile (2026-11-27)", () => {
  it("the shift of a tile: position and elevation; none when nothing moved", () => {
    expect(tileShift({ x: 100, y: 200, elevation: 0 }, { x: 300, y: 150, elevation: 20 })).toEqual({ dx: 200, dy: -50, dz: 20 });
    expect(tileShift({ x: 100, y: 200, elevation: 0 }, { x: 100, y: 200, elevation: 0 })).toBeNull();
    expect(tileShift({ x: 100, y: 200 }, { x: 100, y: 200, elevation: undefined })).toBeNull();
  });
  it("a rectangle, an ellipse and a polygon all move by the same amount, nothing else changes", () => {
    const shapes = [
      { type: "rectangle", x: 10, y: 20, width: 50, height: 50, hole: false },
      { type: "ellipse", x: 0, y: 0, radiusX: 5, radiusY: 8 },
      { type: "polygon", points: [0, 0, 10, 0, 10, 10] }];
    expect(shiftShapes(shapes, 100, -5)).toEqual([
      { type: "rectangle", x: 110, y: 15, width: 50, height: 50, hole: false },
      { type: "ellipse", x: 100, y: -5, radiusX: 5, radiusY: 8 },
      { type: "polygon", points: [100, -5, 110, -5, 110, 5] }]);
    expect(shapes[2].points).toEqual([0, 0, 10, 0, 10, 10]);
  });
  it("an elevation range moves with the tile; a side without a limit keeps none", () => {
    expect(shiftElevation({ bottom: 0, top: 10 }, 20)).toEqual({ bottom: 20, top: 30 });
    expect(shiftElevation({ bottom: null, top: null }, 20)).toEqual({ bottom: null, top: null });
    expect(shiftElevation(undefined, 20)).toEqual({ bottom: null, top: null });
  });
  it("the same levels, whatever their order", () => {
    expect(sameLevels(["a", "b"], new Set(["b", "a"]))).toBe(true);
    expect(sameLevels(["a"], ["b"])).toBe(false);
    expect(sameLevels([], undefined)).toBe(true);
  });
});
