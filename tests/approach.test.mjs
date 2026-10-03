import { describe, it, expect } from "vitest";
import { goalCells } from "../module/scripts/core/approach.mjs";
import { edgeDistance } from "../module/scripts/core/loot.mjs";

const mover = { col: 0, row: 0, w: 1, h: 1 };

describe("cases d'où l'on atteint une cible", () => {
  it("autour d'un cadavre d'une case, à 5 ft : les 8 voisines", () => {
    const target = { col: 5, row: 5, w: 1, h: 1 };
    const cells = goalCells(target, mover, 5, 5);
    expect(cells.length).toBe(8);
    for ( const { i, j } of cells ) {
      expect(edgeDistance({ col: j, row: i, w: 1, h: 1 }, target, 5)).toBeLessThanOrEqual(5);
      expect((i === 5) && (j === 5)).toBe(false);
    }
  });
  it("les plus proches du personnage d'abord", () => {
    const cells = goalCells({ col: 5, row: 5, w: 1, h: 1 }, mover, 5, 5);
    expect(cells[0]).toEqual({ i: 4, j: 4 });
  });
  it("un tas d'une demi-case posé en travers : les cases qui le touchent, pas celle qui le porte", () => {
    const pile = { col: 5.25, row: 5.25, w: 0.5, h: 0.5 };
    const cells = goalCells(pile, mover, 5, 5);
    expect(cells.some(c => (c.i === 5) && (c.j === 5))).toBe(false);
    expect(cells.length).toBe(8);
  });
  it("un grand personnage (2×2) se place en entier à portée", () => {
    const cells = goalCells({ col: 5, row: 5, w: 1, h: 1 }, { col: 0, row: 0, w: 2, h: 2 }, 5, 5);
    for ( const { i, j } of cells ) {
      expect(edgeDistance({ col: j, row: i, w: 2, h: 2 }, { col: 5, row: 5, w: 1, h: 1 }, 5)).toBeLessThanOrEqual(5);
    }
    expect(cells.length).toBe(12);
  });
});
