import { describe, it, expect } from "vitest";
import { GENERIC_TABLES, dieFaces } from "../module/scripts/core/tables.mjs";

describe("tables génériques de conteneurs", () => {
  it("des clés uniques", () => {
    const keys = GENERIC_TABLES.map(t => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  for ( const table of GENERIC_TABLES ) {
    it(`${table.key} : chaque valeur du dé a exactement une case`, () => {
      const faces = dieFaces(table.formula);
      expect(faces).toBeGreaterThan(0);
      for ( let n = 1; n <= faces; n++ ) {
        expect(table.results.filter(([a, b]) => (n >= a) && (n <= b)).length, `${table.key} ${n}`).toBe(1);
      }
    });
    it(`${table.key} : identifiants d'objets de 16 caractères, au moins une case vide`, () => {
      for ( const [, , id] of table.results ) if ( id ) expect(id).toMatch(/^[A-Za-z0-9]{16}$/);
      expect(table.results.some(r => !r[2])).toBe(true);
    });
  }
  it("dieFaces", () => {
    expect(dieFaces("1d20")).toBe(20);
    expect(dieFaces("2d6")).toBeNull();
  });
});
