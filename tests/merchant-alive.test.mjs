/**
 * Discord, 2026-11-19 : « Ouvrir la boutique » ne faisait rien pour un PNJ créé sans points de vie (dnd5e lui met 0 PV, le module le
 * croyait mort). Un marchand est fermé s'il porte l'état « mort », ou s'il a des PV maximum et que ses PV sont à 0.
 */
import { describe, it, expect } from "vitest";
import { installFakeFoundry } from "./fake-foundry.mjs";

installFakeFoundry();
const { merchantAlive } = await import("../module/scripts/adapter/shop.mjs");

const merchant = ({ type="npc", enabled=true, dead=false, hp={} }={}) => ({
  type, statuses: new Set(dead ? ["dead"] : []), system: { attributes: { hp } },
  getFlag: (scope, key) => ((key === "merchant") ? { enabled } : undefined)
});

describe("marchand vivant", () => {
  it("PNJ sans PV maximum (0 / 0, ou rien) : ouvert", () => {
    expect(merchantAlive(merchant({ hp: { value: 0, max: 0 } }))).toBe(true);
    expect(merchantAlive(merchant({ hp: { value: null, max: null } }))).toBe(true);
    expect(merchantAlive(merchant())).toBe(true);
  });
  it("des PV maximum : fermé à 0 PV, ouvert au-dessus", () => {
    expect(merchantAlive(merchant({ hp: { value: 0, max: 10 } }))).toBe(false);
    expect(merchantAlive(merchant({ hp: { value: 4, max: 10 } }))).toBe(true);
  });
  it("l'état « mort » ferme toujours ; un acteur qui n'est pas marchand non plus", () => {
    expect(merchantAlive(merchant({ dead: true, hp: { value: 0, max: 0 } }))).toBe(false);
    expect(merchantAlive(merchant({ enabled: false, hp: { value: 5, max: 5 } }))).toBe(false);
    expect(merchantAlive(merchant({ type: "character", hp: { value: 5, max: 5 } }))).toBe(false);
  });
});
