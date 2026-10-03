import { describe, it, expect } from "vitest";
import {
  hasTreasure, individualRow, splitValue, shapeTreasure, toCoins, pickRange, POCKETS, shortName, linkedItemUuid
} from "../module/scripts/core/treasure.mjs";

describe("préférences de trésor", () => {
  it("aucune : ni Loup ni Vase", () => {
    expect(hasTreasure([])).toBe(false);
    expect(hasTreasure(undefined)).toBe(false);
  });
  it("Tous, Individuel ou un thème", () => {
    expect(hasTreasure(["any"])).toBe(true);
    expect(hasTreasure(new Set(["armaments", "individual"]))).toBe(true);
  });
});

describe("trésor individuel par FP (DMG 2024)", () => {
  it("les quatre lignes", () => {
    expect(individualRow(0.125)).toMatchObject({ dice: "3d6", mult: 1, denom: "gp" });
    expect(individualRow(4)).toMatchObject({ dice: "3d6" });
    expect(individualRow(5)).toMatchObject({ dice: "2d8", mult: 10, denom: "gp" });
    expect(individualRow(16)).toMatchObject({ dice: "2d10", mult: 10, denom: "pp" });
    expect(individualRow(30)).toMatchObject({ dice: "2d8", mult: 100, denom: "pp" });
  });
  it("un FP absent compte comme 0", () => expect(individualRow(undefined).dice).toBe("3d6"));
});

describe("forme du trésor", () => {
  it("découpe gloutonne", () => {
    expect(splitValue(73, [50, 10])).toEqual({ pieces: [{ value: 50, count: 1 }, { value: 10, count: 2 }], rest: 3 });
    expect(splitValue(7, [10])).toEqual({ pieces: [], rest: 7 });
  });
  it("Tous, Armement : des pièces", () => {
    expect(shapeTreasure(11, "gp", ["any"])).toEqual({ coins: { gp: 11 }, gems: [], art: [] });
    expect(shapeTreasure(11, "gp", ["armaments", "individual"])).toEqual({ coins: { gp: 11 }, gems: [], art: [] });
  });
  it("Arcanes : des gemmes, le reste en pièces", () => {
    expect(shapeTreasure(13, "gp", ["arcana"])).toEqual({ coins: { gp: 3 }, gems: [{ value: 10, count: 1 }], art: [] });
  });
  it("Reliques : un objet d'art dès 25 po", () => {
    expect(shapeTreasure(12, "gp", ["relics"]).art).toEqual([]);
    expect(shapeTreasure(90, "gp", ["individual", "relics"])).toEqual({ coins: { gp: 15 }, gems: [], art: [{ value: 25, count: 3 }] });
  });
  it("Arcanes et Reliques : moitié-moitié", () => {
    const s = shapeTreasure(60, "gp", ["arcana", "relics"]);
    expect(s.gems).toEqual([{ value: 10, count: 3 }]);
    expect(s.art).toEqual([{ value: 25, count: 1 }]);
    expect(s.coins).toEqual({ gp: 5 });
  });
  it("les lignes en pp restent en pp", () => {
    expect(shapeTreasure(110, "pp", ["any"])).toEqual({ coins: { pp: 110, gp: 0 }, gems: [], art: [] });
    expect(toCoins(1105, "pp")).toEqual({ pp: 110, gp: 5 });
  });
});

describe("poches", () => {
  it("4 chances sur 10 de rien, une babiole sur 10", () => {
    expect(pickRange(POCKETS, 3).items).toEqual([]);
    expect(pickRange(POCKETS, 7).items.map(i => i.id)).toEqual(["phbagTorch000000", "phbagTinderbox00"]);
    expect(pickRange(POCKETS, 10).trinket).toBe(true);
  });
  it("chaque valeur du d10 a sa ligne, et une seule", () => {
    for ( let n = 1; n <= 10; n++ ) expect(POCKETS.filter(r => n >= r.range[0] && n <= r.range[1]).length, String(n)).toBe(1);
  });
  it("identifiants de 16 caractères", () => {
    for ( const row of POCKETS ) for ( const i of row.items ) expect(i.id).toMatch(/^[A-Za-z0-9]{16}$/);
  });
});

describe("résultats de table en texte", () => {
  it("nom court", () => {
    expect(shortName("Hematite (gray black)")).toBe("Hematite");
    expect(shortName("<p>Silver ewer</p>")).toBe("Silver ewer");
    expect(shortName("(tout entre parenthèses)")).toBe("(tout entre parenthèses)");
  });
  it("lien vers un objet", () => {
    expect(linkedItemUuid("@UUID[Compendium.dnd-dungeon-masters-guide.equipment.Item.dmgPipeOfSmokeMo]{Pipe}"))
      .toBe("Compendium.dnd-dungeon-masters-guide.equipment.Item.dmgPipeOfSmokeMo");
    expect(linkedItemUuid("@UUID[Compendium.x.equipment.Item.dmgRingOfResista.Activity.abc]{Ring}")).toBeNull();
    expect(linkedItemUuid("Un simple texte")).toBeNull();
  });
});

import { HOARDS, RARITY, hoardBand, rarityFor, themeFor } from "../module/scripts/core/treasure.mjs";

describe("trésor de repaire (DMG 2024)", () => {
  it("tranches de FP", () => {
    expect(hoardBand(0.5)).toBe(0);
    expect(hoardBand(4)).toBe(0);
    expect(hoardBand(5)).toBe(5);
    expect(hoardBand(16)).toBe(11);
    expect(hoardBand(24)).toBe(17);
  });
  it("les quatre lignes", () => {
    expect(HOARDS[0]).toEqual({ dice: "2d4", mult: 100, magic: "1d4 - 1" });
    expect(HOARDS[17]).toEqual({ dice: "6d10", mult: 10000, magic: "1d6" });
  });
  it("rareté des objets magiques par d100", () => {
    expect(rarityFor(0, 54)).toBe("common");
    expect(rarityFor(0, 55)).toBe("uncommon");
    expect(rarityFor(0, 100)).toBe("rare");
    expect(rarityFor(5, 99)).toBe("veryRare");
    expect(rarityFor(11, 94)).toBe("legendary");
    expect(rarityFor(17, 1)).toBe("rare");
  });
  it("chaque tranche couvre le d100 jusqu'à 100", () => {
    for ( const rows of Object.values(RARITY) ) expect(rows.at(-1)[0]).toBe(100);
  });
  it("thème : celui du coffre, ou 1d4 pour « Tous »", () => {
    expect(themeFor("relics", 1)).toBe("relics");
    expect(themeFor("any", 1)).toBe("arcana");
    expect(themeFor("any", 4)).toBe("relics");
    expect(themeFor("individual", 2)).toBe("armaments");
  });
});
