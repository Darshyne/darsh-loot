import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MACROS } from "../tools/macros/index.mjs";
import { macroDocuments, stableId } from "../tools/packs.mjs";

const DIR = path.resolve(import.meta.dirname, "..", "tools", "macros");

describe("compendium « Outils du MJ » (SPEC §3.11)", () => {
  it("chaque macro de tools/macros/ y figure, une seule fois", () => {
    const files = fs.readdirSync(DIR).filter(f => f.endsWith(".js")).sort();
    expect(MACROS.map(m => m.file).sort()).toEqual(files);
  });

  it("chaque macro se compile (corps de fonction asynchrone, comme une macro de script)", () => {
    const AsyncFunction = (async () => {}).constructor;
    for ( const doc of macroDocuments() ) expect(() => new AsyncFunction(doc.command), doc.name).not.toThrow();
  });

  it("ids stables, au format Foundry, et distincts", () => {
    const ids = macroDocuments().map(d => d._id);
    for ( const id of ids ) expect(id).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(new Set(ids).size).toBe(ids.length);
    expect(stableId("x")).toBe(stableId("x"));
  });

  it("le module déclare le compendium", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "..", "module", "module.json"), "utf8"));
    expect(manifest.packs?.find(p => p.name === "outils")).toMatchObject({ type: "Macro", path: "packs/outils" });
  });
});
