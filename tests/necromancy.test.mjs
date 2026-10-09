import { describe, it, expect } from "vitest";
import { UNDEAD, canAnimate, feetToSceneUnits, SPELL_RANGE_FT } from "../module/scripts/core/necromancy.mjs";

describe("nécromancie", () => {
  it("un humanoïde Petit ou Moyen", () => {
    expect(canAnimate({ type: "humanoid", size: "med" })).toBe(true);
    expect(canAnimate({ type: "humanoid", size: "sm" })).toBe(true);
  });
  it("ni un grand humanoïde, ni une bête", () => {
    expect(canAnimate({ type: "humanoid", size: "lg" })).toBe(false);
    expect(canAnimate({ type: "beast", size: "med" })).toBe(false);
    expect(canAnimate({ type: undefined, size: "med" })).toBe(false);
  });
  it("identifiants du Monster Manual", () => {
    for ( const id of Object.values(UNDEAD) ) expect(id).toMatch(/^[A-Za-z0-9]{16}$/);
  });
  it("portée en unités de scène", () => {
    expect(feetToSceneUnits(SPELL_RANGE_FT, "ft")).toBe(10);
    expect(feetToSceneUnits(SPELL_RANGE_FT, undefined)).toBe(10);
    expect(feetToSceneUnits(SPELL_RANGE_FT, "m")).toBeCloseTo(3);
    // Ce que le MJ a tapé, sans casse ni accents (« mètres » d'une scène française).
    expect(feetToSceneUnits(SPELL_RANGE_FT, "Mètres")).toBeCloseTo(3);
    expect(feetToSceneUnits(SPELL_RANGE_FT, " Meters ")).toBeCloseTo(3);
  });
});
