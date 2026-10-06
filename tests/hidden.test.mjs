import { describe, it, expect } from "vitest";
import { normalizeHidden, concealed, passiveFinds, searchReach, alreadyTried, withTry, wallKind, revealWall, discoveryKey,
  pointSegmentDistance, closestOnSegment, stepToward, DOOR, SENSE } from "../module/scripts/core/hidden.mjs";

describe("réglages d'un objet caché", () => {
  it("défauts et valeurs invalides", () => {
    expect(normalizeHidden()).toEqual({ enabled: false, skill: "prc", dc: 15, passive: 10, radius: 15, found: false, text: "" });
    expect(normalizeHidden({ enabled: true, skill: "inv", dc: "18", passive: -3, radius: "x" }))
      .toMatchObject({ enabled: true, skill: "inv", dc: 18, passive: 10, radius: 15 });
  });

  it("caché tant que coché et pas trouvé", () => {
    expect(concealed({ enabled: true, found: false })).toBe(true);
    expect(concealed({ enabled: true, found: true })).toBe(false);
    expect(concealed({ enabled: false })).toBe(false);
    expect(concealed(null)).toBe(false);
  });
});

describe("Perception passive", () => {
  const h = { enabled: true, dc: 14, passive: 10 };
  it("à distance et au DD", () => {
    expect(passiveFinds(h, 10, 14)).toBe(true);
    expect(passiveFinds(h, 15, 20)).toBe(false);
    expect(passiveFinds(h, 5, 13)).toBe(false);
  });
  it("distance 0 : pas de détection passive", () => {
    expect(passiveFinds({ ...h, passive: 0 }, 0, 30)).toBe(false);
  });
});

describe("fouille active", () => {
  it("rayon du monde, ou moins si l'objet le demande", () => {
    expect(searchReach({ radius: 5 }, 15)).toBe(5);
    expect(searchReach({ radius: 30 }, 15)).toBe(15);
    expect(searchReach({ radius: 0 }, 15)).toBe(15);
  });
  it("un essai par personnage", () => {
    expect(alreadyTried(["a"], "a")).toBe(true);
    expect(alreadyTried(undefined, "a")).toBe(false);
    expect(withTry(["a"], "a")).toEqual(["a"]);
    expect(withTry(null, "b")).toEqual(["b"]);
  });
});

describe("murs cachés", () => {
  it("porte secrète et mur éthéré", () => {
    expect(wallKind({ door: DOOR.SECRET, sight: SENSE.NORMAL, move: SENSE.NORMAL })).toBe("secret");
    expect(wallKind({ door: DOOR.NONE, sight: SENSE.NORMAL, move: SENSE.NONE })).toBe("ethereal");
    expect(wallKind({ door: DOOR.NONE, sight: SENSE.NORMAL, move: SENSE.NORMAL })).toBeNull();
    expect(wallKind({ door: DOOR.DOOR, sight: SENSE.NORMAL, move: SENSE.NORMAL })).toBeNull();
  });
  it("révéler retient de quoi recacher", () => {
    expect(revealWall({ door: DOOR.SECRET, sight: 20, light: 20, move: 20 }))
      .toEqual({ update: { door: DOOR.DOOR }, original: { door: DOOR.SECRET } });
    expect(revealWall({ door: 0, sight: 20, light: 10, move: 0 }))
      .toEqual({ update: { sight: 0, light: 0 }, original: { sight: 20, light: 10 } });
    expect(revealWall({ door: 0, sight: 20, light: 20, move: 20 })).toBeNull();
  });
});

describe("texte et géométrie", () => {
  it("texte générique par genre", () => {
    expect(discoveryKey("container")).toBe("Cache");
    expect(discoveryKey("secret")).toBe("SecretDoor");
    expect(discoveryKey("?")).toBe("Something");
  });
  it("distance à un segment", () => {
    const a = { x: 0, y: 0 }, b = { x: 10, y: 0 };
    expect(pointSegmentDistance({ x: 5, y: 3 }, a, b)).toBe(3);
    expect(pointSegmentDistance({ x: 13, y: 4 }, a, b)).toBe(5);
    expect(closestOnSegment({ x: -2, y: 1 }, a, b)).toEqual({ x: 0, y: 0 });
    expect(stepToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 2)).toEqual({ x: 2, y: 0 });
  });
});
