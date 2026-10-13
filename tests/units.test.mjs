import { describe, it, expect } from "vitest";
import { feetToSceneUnits } from "../module/scripts/core/units.mjs";
import { HIDDEN_DEFAULTS } from "../module/scripts/core/hidden.mjs";

// darsh-loot#1 : les distances du module (portée et rayon de fouille, objets cachés) sont en pieds, converties à l'usage.
describe("distances en pieds dans l'unité de la scène", () => {
  it("garde les pieds tels quels", () => {
    expect(feetToSceneUnits(5, "ft")).toBe(5);
    expect(feetToSceneUnits(15, "pi")).toBe(15);
  });
  it("convertit en mètres : 5 ft = 1,5 m", () => {
    expect(feetToSceneUnits(5, "m")).toBeCloseTo(1.5);
    expect(feetToSceneUnits(HIDDEN_DEFAULTS.radius, "mètres")).toBeCloseTo(4.5);
    expect(feetToSceneUnits(HIDDEN_DEFAULTS.passive, "m")).toBeCloseTo(3);
  });
});
