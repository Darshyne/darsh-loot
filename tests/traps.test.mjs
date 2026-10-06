import { describe, it, expect } from "vitest";
import { checksIn, trapChecks } from "../module/scripts/core/traps.mjs";

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
