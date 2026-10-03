import { describe, it, expect } from "vitest";
import { soundKind, clampDrop, outsideRect, flight, pileSpot } from "../module/scripts/core/drop.mjs";

describe("place du tas dans sa case", () => {
  it("quart haut-gauche : coin de la case + un quart de case", () => {
    expect(pileSpot({ x: 280, y: 140 }, 140)).toEqual({ x: 315, y: 175 });
  });
});

describe("son d'atterrissage", () => {
  it("par type d'objet", () => {
    expect(soundKind({ type: "weapon", subtype: "simpleM" })).toBe("metal");
    expect(soundKind({ type: "equipment", subtype: "heavy" })).toBe("metal");
    expect(soundKind({ type: "equipment", subtype: "shield" })).toBe("metal");
    expect(soundKind({ type: "equipment", subtype: "clothing" })).toBe("soft");
    expect(soundKind({ type: "consumable", subtype: "potion" })).toBe("glass");
    expect(soundKind({ type: "loot", subtype: "gem" })).toBe("coins");
    expect(soundKind({ type: "coins" })).toBe("coins");
    expect(soundKind({ type: "tool" })).toBe("soft");
  });
});

describe("où tombe le tas", () => {
  it("à portée : inchangé ; trop loin : ramené sur le cercle", () => {
    expect(clampDrop({ x: 0, y: 0 }, { x: 30, y: 40 }, 100)).toEqual({ x: 30, y: 40 });
    const p = clampDrop({ x: 0, y: 0 }, { x: 300, y: 400 }, 100);
    expect(p.x).toBeCloseTo(60);
    expect(p.y).toBeCloseTo(80);
  });
  it("jamais sous son propre token", () => {
    const rect = { x: 0, y: 0, w: 100, h: 100 };
    expect(outsideRect(rect, { x: 200, y: 50 }, 25)).toEqual({ x: 200, y: 50 });
    expect(outsideRect(rect, { x: 90, y: 50 }, 25)).toEqual({ x: 125, y: 50 });   // sort par la droite, la plus proche
    expect(outsideRect(rect, { x: 50, y: 5 }, 25)).toEqual({ x: 50, y: -25 });    // par le haut
    expect(outsideRect(rect, { x: 50, y: 50 }, 25)).toEqual({ x: 125, y: 50 });   // au centre : à droite
  });
});

describe("vol de l'objet", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 200, y: 0 };
  it("part du personnage, arrive au tas, droit et à sa taille", () => {
    expect(flight(from, to, 0)).toMatchObject({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    const end = flight(from, to, 1);
    expect(end.x).toBe(200);
    expect(end.y).toBeCloseTo(0);
    expect(end.rotation).toBeCloseTo(Math.PI * 2);
    expect(end.scaleX).toBeCloseTo(1);
    expect(end.scaleY).toBeCloseTo(1);
  });
  it("monte en arc au milieu", () => {
    expect(flight(from, to, 0.5).y).toBeLessThan(-100);
  });
  it("s'écrase à l'impact", () => {
    const hit = flight(from, to, 0.925);
    expect(hit.scaleY).toBeLessThan(0.8);
    expect(hit.scaleX).toBeGreaterThan(1.2);
  });
});
