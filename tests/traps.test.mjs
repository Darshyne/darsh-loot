import { describe, it, expect } from "vitest";
import { checksIn, trapChecks, tierRange, pickTier, targetsLevel } from "../module/scripts/core/traps.mjs";

describe("tests d'un texte", () => {
  it("les trois formes du lien de jet", () => {
    expect(checksIn("test de [[/check prc 15]] puis [[/check DC prc 10]] et [[/check skill=inv dc=12]]"))
      .toEqual([{ skill: "prc", dc: 15 }, { skill: "prc", dc: 10 }, { skill: "inv", dc: 12 }]);
  });
  it("ignore les autres jets et les tests sans DD", () => {
    expect(checksIn("[[/r 1d3]] fléchettes, [[/check prc]] ")).toEqual([]);
  });
});

describe("réglages d'un piège du DMG", () => {
  it("fléchettes : Perception 15, rien à désamorcer au test", () => {
    const text = "<p>examiner les murs : [[/check prc 15]]</p><p>la dalle : [[/check prc 15]]</p>";
    expect(trapChecks([text])).toEqual({ hidden: { skill: "prc", dc: 15 }, disarmDc: 1, failure: "nothing" });
  });
  it("statue : le plus petit DD de détection (le glyphe), l'Arcanes ne compte pas", () => {
    const text = "[[/check DC prc 10]] … [[/check arc 15]] … [[/check prc 15]]";
    expect(trapChecks([text]).hidden).toEqual({ skill: "prc", dc: 10 });
  });
  it("fosse : Investigation", () => {
    expect(trapChecks(["[[/check inv 15]]"]).hidden).toEqual({ skill: "inv", dc: 15 });
  });
  it("aiguille : Escamotage 15, un échec déclenche", () => {
    expect(trapChecks(["[[/check prc 15]] puis [[/check slt 15]]"])).toEqual({ hidden: { skill: "prc", dc: 15 }, disarmDc: 15, failure: "trigger" });
  });
  it("acteur fait main, sans test : rien", () => {
    expect(trapChecks(["<p>Un jet de flammes.</p>", ""])).toBeNull();
  });
});

describe("tranche d'un piège selon le niveau des cibles", () => {
  const darts = [
    { id: "a", name: "Déclenchement (niveaux 1 à 4)" }, { id: "b", name: "Déclenchement (niveaux 5 à 10)" },
    { id: "c", name: "Déclenchement (niveaux 11 à 16)" }, { id: "d", name: "Déclenchement (niveaux 17 à 20)" }
  ];
  it("lit la tranche en français et en anglais", () => {
    expect(tierRange("Déclenchement (niveaux 11 à 16)")).toEqual({ min: 11, max: 16 });
    expect(tierRange("Trigger (Levels 5–10)")).toEqual({ min: 5, max: 10 });
    expect(tierRange("Trigger (Levels 1-4)")).toEqual({ min: 1, max: 4 });
    expect(tierRange("Déclencher le piège")).toBeNull();
  });
  it("prend la tranche qui contient le niveau", () => {
    expect(pickTier(darts, 1)).toBe("a");
    expect(pickTier(darts, 8)).toBe("b");
    expect(pickTier(darts, 16)).toBe("c");
    expect(pickTier(darts, 20)).toBe("d");
  });
  it("hors des tranches : la plus proche ; sans tranche ou sans niveau : rien", () => {
    expect(pickTier(darts.slice(0, 2), 14)).toBe("b");
    expect(pickTier(darts, 0)).toBe("a");
    expect(pickTier([{ id: "x", name: "Jet de flammes" }], 5)).toBeNull();
    expect(pickTier(darts, null)).toBeNull();
  });
  it("niveau des cibles : le plus haut personnage, sinon le plus haut FP", () => {
    expect(targetsLevel([{ character: true, level: 3 }, { character: true, level: 8 }, { character: false, level: 12 }])).toBe(8);
    expect(targetsLevel([{ character: false, level: 0.25 }, { character: false, level: 6 }])).toBe(6);
    expect(targetsLevel([{ character: false, level: 0.5 }])).toBe(1);
    expect(targetsLevel([])).toBeNull();
  });
});
