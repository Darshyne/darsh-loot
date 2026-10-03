import { describe, it, expect } from "vitest";
import { lodges, missLanding, stopBefore } from "../module/scripts/core/throw.mjs";

describe("armes de jet", () => {
  it("plantée une fois sur deux", () => {
    expect(lodges(1)).toBe(true);
    expect(lodges(2)).toBe(false);
  });
  it("ratée : au-delà de la cible, dans l'axe", () => {
    const p = missLanding({ x: 0, y: 0 }, { x: 280, y: 0 }, 2, 0, 140);
    expect(p).toEqual({ x: 560, y: 0 });
  });
  it("ratée : décalée sur le côté", () => {
    const p = missLanding({ x: 0, y: 0 }, { x: 280, y: 0 }, 1, 1, 140);
    expect(p.x).toBeCloseTo(420);
    expect(p.y).toBeCloseTo(140);
  });
  it("lanceur sur la cible : une direction par défaut", () => {
    expect(missLanding({ x: 10, y: 10 }, { x: 10, y: 10 }, 1, 0, 100)).toEqual({ x: 110, y: 10 });
  });
  it("arrêtée une demi-case devant le mur", () => {
    const p = stopBefore({ x: 0, y: 0 }, { x: 300, y: 0 }, 140);
    expect(p.x).toBeCloseTo(230);
    expect(p.y).toBeCloseTo(0);
    expect(stopBefore({ x: 0, y: 0 }, { x: 50, y: 0 }, 140)).toEqual({ x: 0, y: 0 });
  });
});
