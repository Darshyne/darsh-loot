import { canLeaveOwner } from "../module/scripts/core/loot.mjs";
import { describe, it, expect } from "vitest";
import { isCorpse, gearEntries, coinsOf, addCoins, hasLoot, stackTarget, edgeDistance } from "../module/scripts/core/loot.mjs";

describe("isCorpse", () => {
  it("un PNJ mort", () => expect(isCorpse({ actorType: "npc", statuses: ["dead"] })).toBe(true));
  it("un PNJ vivant ou à 0 PV sans l'état", () => expect(isCorpse({ actorType: "npc", statuses: ["unconscious"] })).toBe(false));
  it("un PJ mort n'est pas fouillable", () => expect(isCorpse({ actorType: "character", statuses: ["dead"] })).toBe(false));
});

describe("gearEntries", () => {
  const items = [
    { id: "scim", type: "weapon", quantity: 1, properties: ["gear", "fin"] },
    { id: "bite", type: "weapon", quantity: 1, properties: [] },                  // arme naturelle : pas de gear
    { id: "multi", type: "feat", quantity: undefined, properties: [] },
    { id: "bag", type: "container", quantity: 1, properties: ["gear"] },
    { id: "coin", type: "loot", quantity: 3, properties: ["gear"], container: "bag" },
    { id: "rope", type: "loot", quantity: 1, properties: ["gear"], container: "bag" },
    { id: "used", type: "consumable", quantity: 0, properties: ["gear"] },       // épuisé
    { id: "stray", type: "loot", quantity: 1, properties: ["gear"], container: "gone" }
  ];
  const entries = gearEntries(items);

  it("garde l'équipement, pas les armes naturelles ni les capacités", () => {
    expect(entries.map(e => e.id)).toEqual(["scim", "bag", "stray"]);
  });
  it("le contenu d'un sac part avec lui et se compte", () => {
    expect(entries.find(e => e.id === "bag").contents).toBe(2);
  });
  it("un objet dont le contenant n'est pas pris reste visible", () => {
    expect(entries.some(e => e.id === "stray")).toBe(true);
  });
});

describe("pièces", () => {
  it("seulement les pièces présentes, des plus précieuses aux moins précieuses", () => {
    expect(coinsOf({ cp: 5, gp: 2, sp: 0 })).toEqual([{ key: "gp", value: 2 }, { key: "cp", value: 5 }]);
  });
  it("addition", () => {
    expect(addCoins({ gp: 1, sp: 2 }, { gp: 3 })).toEqual({ pp: 0, gp: 4, ep: 0, sp: 2, cp: 0 });
  });
  it("rien à prendre", () => {
    expect(hasLoot([], { gp: 0 })).toBe(false);
    expect(hasLoot([], { cp: 1 })).toBe(true);
  });
});

describe("stackTarget", () => {
  const owned = [
    { id: "a", type: "consumable", name: "Flèches", source: "Compendium.x.Item.arrows", container: null },
    { id: "b", type: "consumable", name: "Potion de soins", source: "Compendium.x.Item.pot", container: "sac" },
    { id: "c", type: "weapon", name: "Dague", source: "Compendium.x.Item.dagger", container: null }
  ];
  it("empile des consommables identiques", () => {
    expect(stackTarget(owned, { type: "consumable", name: "Flèches", source: "Compendium.x.Item.arrows" })).toBe("a");
  });
  it("pas dans un contenant", () => {
    expect(stackTarget(owned, { type: "consumable", name: "Potion de soins", source: "Compendium.x.Item.pot" })).toBeNull();
  });
  it("pas les armes, ni sans source", () => {
    expect(stackTarget(owned, { type: "weapon", name: "Dague", source: "Compendium.x.Item.dagger" })).toBeNull();
    expect(stackTarget(owned, { type: "consumable", name: "Flèches", source: null })).toBeNull();
  });
});

describe("edgeDistance", () => {
  const one = (col, row, elevation=0) => ({ col, row, w: 1, h: 1, elevation });
  it("côte à côte, en diagonale : 5 ft", () => {
    expect(edgeDistance(one(0, 0), one(1, 0), 5)).toBe(5);
    expect(edgeDistance(one(0, 0), one(1, 1), 5)).toBe(5);
  });
  it("une case d'écart : 10 ft", () => expect(edgeDistance(one(0, 0), one(2, 0), 5)).toBe(10));
  it("superposés : 0", () => expect(edgeDistance(one(3, 3), one(3, 3), 5)).toBe(0));
  it("une grande créature se mesure depuis son bord", () => {
    expect(edgeDistance(one(0, 0), { col: 1, row: 0, w: 2, h: 2 }, 5)).toBe(5);
    expect(edgeDistance(one(4, 0), { col: 1, row: 0, w: 2, h: 2 }, 5)).toBe(10);
  });
  it("l'élévation compte", () => expect(edgeDistance(one(0, 0, 0), one(1, 0, 20), 5)).toBe(20));
  it("un tas d'une demi-case dans la case voisine est à 5 ft", () => {
    const pile = (col, row) => ({ col, row, w: 0.5, h: 0.5 });
    expect(edgeDistance(one(0, 0), pile(1.25, 0.25), 5)).toBe(5);
    expect(edgeDistance(one(0, 0), pile(1.75, 0.25), 5)).toBe(5);
    expect(edgeDistance(one(0, 0), pile(2.25, 0.25), 5)).toBe(10);
  });
});

describe("gearEntries dans un coffre", () => {
  it("tout objet physique se prend, sans la propriété gear", () => {
    const items = [
      { id: "a", type: "weapon", quantity: 1, properties: [] },
      { id: "b", type: "feat", quantity: 1, properties: [] },
      { id: "c", type: "loot", quantity: 2, properties: [] }
    ];
    expect(gearEntries(items, false).map(e => e.id)).toEqual(["a", "c"]);
    expect(gearEntries(items).map(e => e.id)).toEqual([]);
  });
});

describe("0.15.1 : ce qui peut quitter son porteur", () => {
  it("un PNJ ne cède que son équipement ; un personnage, tout", () => {
    expect(canLeaveOwner({ fromNpc: true, properties: ["fin", "thr", "gear"] })).toBe(true);
    expect(canLeaveOwner({ fromNpc: true, properties: ["fin", "thr"] })).toBe(false);
    expect(canLeaveOwner({ fromNpc: true })).toBe(false);
    expect(canLeaveOwner({ fromNpc: false, properties: [] })).toBe(true);
  });
});
