import { describe, it, expect } from "vitest";
import { UNDEAD, RAISING_SPELLS, canAnimate, undeadKindOf, feetToSceneUnits, SPELL_RANGE_FT } from "../module/scripts/core/necromancy.mjs";

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

describe("nécromancie par le sort (moteur §118)", () => {
  it("Animation des morts : humanoïde Petit ou Moyen ; Doigt de mort : humanoïde de toute taille", () => {
    expect(canAnimate({ type: "humanoid", size: "med" }, "animate-dead")).toBe(true);
    expect(canAnimate({ type: "humanoid", size: "lg" }, "animate-dead")).toBe(false);
    expect(canAnimate({ type: "humanoid", size: "lg" }, "finger-of-death")).toBe(true);
    expect(canAnimate({ type: "beast", size: "med" }, "finger-of-death")).toBe(false);
    expect(canAnimate({ type: "humanoid", size: "med" }, "fireball")).toBe(false);
  });
  it("portées : 10 ft, et aucune limite pour Doigt de mort", () => {
    expect(RAISING_SPELLS["animate-dead"].rangeFt).toBe(SPELL_RANGE_FT);
    expect(RAISING_SPELLS["finger-of-death"].rangeFt).toBeNull();
  });
  it("le mort-vivant se lit dans le profil d'invocation choisi", () => {
    expect(undeadKindOf("animate-dead", { name: "Skeleton (bones)", uuid: "Compendium.dnd-players-handbook.actors.Actor.phbmobSkeleton00" })).toBe("skeleton");
    expect(undeadKindOf("animate-dead", { name: "Zombi (cadavre)", uuid: "Compendium.dnd-players-handbook.actors.Actor.phbmobZombie0000" })).toBe("zombie");
    // Nom traduit et acteur inconnu : le nom anglais seul ne suffit plus — rien.
    expect(undeadKindOf("animate-dead", { name: "Squelette", uuid: "Actor.abc" })).toBeNull();
    expect(undeadKindOf("finger-of-death", null)).toBe("zombie");
    expect(undeadKindOf("fireball", { name: "Zombie" })).toBeNull();
  });
});
