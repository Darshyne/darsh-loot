import { describe, it, expect } from "vitest";
import { checksIn, trapChecks, tierRange, pickTier, targetsLevel, normalizeTrap, triggersOn, armedAt, TRAP_DEFAULTS,
  bigEnough, sizeOfSpan, normalizeInitiative, migrateZoneTrap, isTrapCreatureType }
  from "../module/scripts/core/traps.mjs";

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

describe("coffres et portes piégés : réglages", () => {
  it("vide : les défauts, pas piégé", () => {
    expect(normalizeTrap({})).toEqual({ ...TRAP_DEFAULTS });
    expect(normalizeTrap(undefined).enabled).toBe(false);
  });
  it("valeurs d'un formulaire de mur : textes vides, nombres en chaînes", () => {
    const t = normalizeTrap({ enabled: true, actor: " Actor.abc ", activity: "", effectRegion: "", trigger: "both", armed: false,
      rearm: "time", delay: "10", disarmDc: "18", failure: "nothing", triggeredAt: "" });
    expect(t).toMatchObject({ enabled: true, actor: "Actor.abc", effectRegion: null, trigger: "both", armed: false, rearm: "time",
      delay: 10, disarmDc: 18, failure: "nothing", triggeredAt: null });
  });
  it("valeurs invalides remplacées", () => {
    const t = normalizeTrap({ trigger: "kick", rearm: "soon", delay: -3, disarmDc: 99 });
    expect(t).toMatchObject({ trigger: "open", rearm: "never", delay: 60, disarmDc: 40 });
  });
  it("armé par défaut ; seul `false` le désarme", () => {
    expect(normalizeTrap({ armed: undefined }).armed).toBe(true);
    expect(normalizeTrap({ armed: false }).armed).toBe(false);
  });
});

describe("coffres et portes piégés : quand ça part", () => {
  it("à l'ouverture, au crochetage raté, ou les deux", () => {
    expect(triggersOn({ trigger: "open" }, "open")).toBe(true);
    expect(triggersOn({ trigger: "open" }, "pick")).toBe(false);
    expect(triggersOn({ trigger: "pick" }, "pick")).toBe(true);
    expect(triggersOn({ trigger: "pick" }, "open")).toBe(false);
    expect(triggersOn({ trigger: "both" }, "pick")).toBe(true);
    expect(triggersOn({ trigger: "both" }, "open")).toBe(true);
  });
  it("sans réglage : à l'ouverture", () => {
    expect(triggersOn({}, "open")).toBe(true);
    expect(triggersOn(null, "pick")).toBe(false);
  });
});

describe("armé maintenant", () => {
  const base = normalizeTrap({ enabled: true });
  it("armé, désamorcé", () => {
    expect(armedAt(base, 0)).toBe(true);
    expect(armedAt({ ...base, disarmed: true }, 0)).toBe(false);
    expect(armedAt(null, 0)).toBe(false);
  });
  it("réarmement par délai (minutes de temps du monde)", () => {
    const t = { ...base, armed: false, rearm: "time", delay: 10, triggeredAt: 1000 };
    expect(armedAt(t, 1000 + 599)).toBe(false);
    expect(armedAt(t, 1000 + 600)).toBe(true);
  });
  it("jamais, ou à la main : reste désarmé", () => {
    expect(armedAt({ ...base, armed: false, rearm: "never", triggeredAt: 0 }, 1e9)).toBe(false);
    expect(armedAt({ ...base, armed: false, rearm: "gm", triggeredAt: 0 }, 1e9)).toBe(false);
  });
  it("les réglages d'une zone « DAS · Piège » (sans `trigger`) se lisent pareil", () => {
    expect(armedAt({ armed: false, disarmed: false, rearm: "time", delay: 1, triggeredAt: 0 }, 60)).toBe(true);
  });
});

describe("pièges v2 : taille minimale", () => {
  it("Petite par défaut : un rat, un familier Très petit passent", () => {
    expect(bigEnough("tiny")).toBe(false);
    expect(bigEnough("sm")).toBe(true);
    expect(bigEnough("grg")).toBe(true);
  });
  it("réglable par piège : Très petite (tout déclenche), Moyenne (une dalle lourde)", () => {
    expect(bigEnough("tiny", "tiny")).toBe(true);
    expect(bigEnough("sm", "med")).toBe(false);
    expect(bigEnough("lg", "med")).toBe(true);
  });
  it("une taille inconnue déclenche", () => {
    expect(bigEnough(undefined, "med")).toBe(true);
    expect(bigEnough("med", "nope")).toBe(true);
  });
  it("un token sans acteur : la taille d'après sa largeur", () => {
    expect([0.5, 1, 2, 3, 4, 6].map(sizeOfSpan)).toEqual(["tiny", "med", "lg", "huge", "grg", "grg"]);
    expect(sizeOfSpan(undefined)).toBe("med");
  });
});

describe("pièges v2 : réglages", () => {
  it("initiative : 20 par défaut, un entier de 1 à 40", () => {
    expect([undefined, null, "", "x", 12.6, 0, 99].map(normalizeInitiative)).toEqual([20, 20, 20, 20, 13, 1, 40]);
  });
  it("un coffre ou une porte : taille, initiative et source normalisées", () => {
    const t = normalizeTrap({ minSize: "med", initiative: "10", source: { uuid: " Scene.a.Tile.b ", hidden: { dc: 18 } } });
    expect(t.minSize).toBe("med");
    expect(t.initiative).toBe(10);
    expect(t.source).toEqual({ uuid: "Scene.a.Tile.b", hidden: { dc: 18 } });
    expect(normalizeTrap({ minSize: "énorme" }).minSize).toBe("sm");
  });
});

describe("pièges v2 : reprise de la 0.16.0", () => {
  const plate = "Scene.s.Region.dalle";
  it("un piège posé sur sa dalle, la zone d'effet ailleurs : reposé sur la zone d'effet, la dalle en déclencheur", () => {
    const system = { actor: "Actor.a", effectRegion: "Scene.s.Region.couloir", triggerRegion: null, hidden: { dc: 15 } };
    expect(migrateZoneTrap(system, plate)).toEqual({ effectRegion: "Scene.s.Region.couloir",
      system: { actor: "Actor.a", effectRegion: null, triggerRegion: plate, hidden: { dc: 15 } } });
    expect(system.effectRegion).toBe("Scene.s.Region.couloir");
  });
  it("rien à reprendre : pas de zone d'effet à part, ou déjà repris", () => {
    expect(migrateZoneTrap({ effectRegion: null }, plate)).toBeNull();
    expect(migrateZoneTrap({ effectRegion: plate }, plate)).toBeNull();
    expect(migrateZoneTrap({ effectRegion: "Scene.s.Region.c", triggerRegion: plate }, plate)).toBeNull();
  });
});

describe("étape 11 bis : l'acteur piège", () => {
  it("un PNJ au type de créature libre « Trap » (DMG 2024) ou « Piège »", () => {
    expect(isTrapCreatureType({ value: "custom", custom: "Trap" })).toBe(true);
    expect(isTrapCreatureType({ value: "custom", custom: " piège " })).toBe(true);
    expect(isTrapCreatureType({ value: "custom", custom: "Pièges" })).toBe(true);
  });
  it("pas une créature ordinaire ni un autre type libre", () => {
    expect(isTrapCreatureType({ value: "construct", custom: "" })).toBe(false);
    expect(isTrapCreatureType({ value: "custom", custom: "Trapper" })).toBe(false);
    expect(isTrapCreatureType(undefined)).toBe(false);
  });
});
