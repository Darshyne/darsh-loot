import { describe, it, expect } from "vitest";
import { tileRect, fitsTile } from "../module/scripts/core/tile-link.mjs";

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
