import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TABS } from "../module/scripts/core/settings-tabs.mjs";

/** Les réglages visibles déclarés (config: true), relevés dans le code. */
function visibleKeys() {
  const src = readFileSync(new URL("../module/scripts/runtime/settings.mjs", import.meta.url), "utf8");
  return [...src.matchAll(/register\(MODULE_ID, "(\w+)", \{[^}]*?config: true/gs)].map(m => m[1]);
}

describe("fenêtre de réglages", () => {
  it("chaque réglage visible est rangé une fois, et rien d'autre", () => {
    const placed = TABS.flatMap(t => t.keys);
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual(visibleKeys().sort());
  });
  it("les onglets ont un id unique ; le seul outil est celui des tables", () => {
    expect(new Set(TABS.map(t => t.id)).size).toBe(TABS.length);
    expect(TABS.flatMap(t => t.tools ?? []).map(t => t.id)).toEqual(["tables"]);
  });
  it("chaque onglet et outil a son texte en français et en anglais", () => {
    for ( const lang of ["fr", "en"] ) {
      const w = JSON.parse(readFileSync(new URL(`../module/lang/${lang}.json`, import.meta.url), "utf8")).DLO.SettingsWindow;
      for ( const t of TABS ) expect(w.Tab[t.id], `${lang} ${t.id}`).toBeTruthy();
      for ( const tool of TABS.flatMap(t => t.tools ?? []) ) {
        for ( const k of ["Name", "Hint", "Button"] ) expect(w.Tool[tool.id][k], `${lang} ${tool.id}.${k}`).toBeTruthy();
      }
    }
  });
});
