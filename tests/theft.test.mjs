import { describe, it, expect } from "vitest";
import { valueBonus, weightBonus, theftDC, difficultyOf, priceInGp, purseInGp, stolenFlag } from "../module/scripts/core/theft.mjs";

describe("majorations", () => {
  it("valeur", () => {
    expect(valueBonus(0)).toBe(0);
    expect(valueBonus(9.99)).toBe(0);
    expect(valueBonus(10)).toBe(2);
    expect(valueBonus(100)).toBe(5);
    expect(valueBonus(1000)).toBe(10);
  });
  it("poids : au-delà de 15 lb, impossible", () => {
    expect(weightBonus(1)).toBe(0);
    expect(weightBonus(3)).toBe(2);
    expect(weightBonus(15)).toBe(5);
    expect(weightBonus(15.5)).toBeNull();
  });
});

describe("DD du vol", () => {
  it("Perception passive, au moins 10, plus valeur et poids", () => {
    expect(theftDC({ perception: 12, value: 5, weight: 0.5 })).toBe(12);
    expect(theftDC({ perception: 8, value: 5, weight: 0.5 })).toBe(10);
    expect(theftDC({ perception: 13, value: 150, weight: 3 })).toBe(20);
  });
  it("porté ou trop lourd : impossible", () => {
    expect(theftDC({ perception: 10, value: 10, weight: 1, equipped: true })).toBeNull();
    expect(theftDC({ perception: 10, value: 10, weight: 20 })).toBeNull();
  });
});

describe("difficulté montrée", () => {
  it("d'après ce que l'objet ajoute, plus la vigilance", () => {
    expect(difficultyOf({ value: 1, weight: 0.1 })).toBe("easy");
    expect(difficultyOf({ value: 20, weight: 3 })).toBe("medium");
    expect(difficultyOf({ value: 200, weight: 3 })).toBe("hard");
    expect(difficultyOf({ value: 5000, weight: 1 })).toBe("veryHard");
    expect(difficultyOf({ value: 1, weight: 0.1, alert: true })).toBe("hard");
  });
});

describe("valeurs", () => {
  const conv = { pp: 0.1, gp: 1, ep: 2, sp: 10, cp: 100 };
  it("prix en po", () => {
    expect(priceInGp(5, conv.sp)).toBe(0.5);
    expect(priceInGp(2, conv.pp)).toBe(20);
  });
  it("bourse en po", () => {
    expect(purseInGp({ gp: 3, sp: 5, cp: 50, pp: 1 }, conv)).toBeCloseTo(14);
  });
  it("drapeau d'objet volé", () => {
    expect(stolenFlag({ from: "Bandit", place: "Keep", time: 5 })).toEqual({ from: "Bandit", fromUuid: null, place: "Keep", time: 5 });
  });
});
