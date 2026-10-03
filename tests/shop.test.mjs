import { describe, it, expect } from "vitest";
import {
  normalizeMerchant, toCp, modifiersFor, buyPrice, sellPrice, goodsOf, wares, stolenVerdict,
  purseValue, coinsFor, receive, pay, settle, cleanCart, restockPlan, fromItemPiles, DEFAULT_MERCHANT
} from "../module/scripts/core/shop.mjs";
import { stackTarget } from "../module/scripts/core/loot.mjs";

const merchant = flag => normalizeMerchant({ enabled: true, ...flag });

describe("marchand — configuration", () => {
  it("les défauts : vend au prix, rachète à moitié", () => {
    const m = normalizeMerchant({ enabled: true });
    expect(m).toMatchObject({ enabled: true, buy: 1, sell: 0.5, attitude: "indifferent", stolen: "own", infiniteCoins: false });
    expect(normalizeMerchant(undefined)).toEqual({ ...DEFAULT_MERCHANT });
  });

  it("valeurs fausses ramenées aux défauts", () => {
    const m = normalizeMerchant({ enabled: "oui", buy: -2, sell: "x", attitude: "amoureux", stolen: "?", tables: [{ rolls: "1d4" }, { uuid: "RollTable.a", rolls: "" }],
      characters: { abc: { attitude: "friendly", discount: 250 }, def: null } });
    expect(m).toMatchObject({ enabled: false, buy: 1, sell: 0.5, attitude: "indifferent", stolen: "own" });
    expect(m.tables).toEqual([{ uuid: "RollTable.a", rolls: "1" }]);
    expect(m.characters).toEqual({ abc: { attitude: "friendly", discount: 100 } });
  });
});

describe("marchand — prix", () => {
  it("un prix dnd5e en pièces de cuivre", () => {
    expect(toCp(15, "gp")).toBe(1500);
    expect(toCp(2, "sp")).toBe(20);
    expect(toCp(1, "pp")).toBe(1000);
    expect(toCp(0.1, "cp")).toBeCloseTo(0.1);
    expect(toCp(5)).toBe(500);
  });

  it("marchand × type × attitude × remise du personnage", () => {
    const m = merchant({ buy: 1.2, sell: 0.4, attitude: "friendly", types: { weapon: { buy: 1.5, sell: 0.5 } },
      characters: { hero: { attitude: "hostile", discount: 10 } } });
    const plain = modifiersFor(m, { type: "loot" });
    expect(plain.buy).toBeCloseTo(1.2 * 0.9);
    expect(plain.sell).toBeCloseTo(0.4 * 1.1);
    const weapon = modifiersFor(m, { type: "weapon" });
    expect(weapon.buy).toBeCloseTo(1.2 * 1.5 * 0.9);
    const hero = modifiersFor(m, { type: "loot", characterId: "hero" });
    expect(hero.buy).toBeCloseTo(1.2 * 1.2 * 0.9);    // hostile pour lui, 10 % de remise
    expect(hero.sell).toBeCloseTo(0.4 * 0.8 * 1.1);
  });

  it("achat arrondi au cuivre supérieur sur la ligne, jamais gratuit", () => {
    const m = modifiersFor(merchant({}), {});
    expect(buyPrice(1500, 1, m)).toBe(1500);
    expect(buyPrice(0.1, 10, m)).toBe(1);      // dix billes à 0,1 pc
    expect(buyPrice(0.1, 1, m)).toBe(1);       // une bille : un cuivre quand même
    expect(buyPrice(0.2, 7, m)).toBe(2);       // 1,4 pc → 2
    expect(buyPrice(0, 5, m)).toBe(0);
  });

  it("vente arrondie au cuivre inférieur, jamais au-dessus du prix d'achat", () => {
    const m = modifiersFor(merchant({}), {});
    expect(sellPrice(1500, 1, m)).toBe(750);
    expect(sellPrice(5, 1, m)).toBe(2);        // 2,5 pc → 2
    expect(sellPrice(0.1, 1, m)).toBe(0);
    const generous = modifiersFor(merchant({ buy: 1, sell: 3 }), {});
    expect(sellPrice(1000, 2, generous)).toBe(2000);   // plafonné à ce qu'il en demanderait
    expect(sellPrice(1000, 1, m, 0.5)).toBe(250);       // receleur : moitié de la moitié
  });
});

describe("marchand — marchandises", () => {
  const items = [
    { id: "sword", type: "weapon", quantity: 10, baseCp: 1500 },
    { id: "string", type: "loot", quantity: 10, baseCp: 0 },
    { id: "oil", type: "consumable", quantity: 1, baseCp: 100, hidden: true },
    { id: "lamp", type: "equipment", quantity: 1, baseCp: 40000, notForSale: true },
    { id: "sold", type: "loot", quantity: 0, baseCp: 100 },
    { id: "bag", type: "container", quantity: 1, baseCp: 200 },
    { id: "inside", type: "loot", quantity: 3, baseCp: 10, container: "bag" },
    { id: "dodge", type: "feat", quantity: 1, baseCp: 0 }
  ];

  it("un joueur voit ce qui a un prix, en stock, non caché, au premier niveau", () => {
    const seen = goodsOf(items);
    expect(seen.map(i => i.id)).toEqual(["sword", "lamp", "bag"]);
    expect(seen.find(i => i.id === "bag").contents).toBe(1);
  });

  it("le MJ voit tout ce qui est physique ; un stock infini montre aussi l'épuisé", () => {
    expect(goodsOf(items, { gm: true }).map(i => i.id)).toEqual(["sword", "string", "oil", "lamp", "sold", "bag"]);
    expect(goodsOf(items, { infiniteStock: true }).map(i => i.id)).toEqual(["sword", "lamp", "sold", "bag"]);
  });

  it("ce qu'un personnage peut vendre : pas ce qu'il porte, pas le contenu d'un sac", () => {
    const mine = [
      { id: "a", type: "weapon", quantity: 1, baseCp: 200, equipped: true },
      { id: "b", type: "weapon", quantity: 1, baseCp: 200 },
      { id: "c", type: "container", quantity: 1, baseCp: 100 },
      { id: "d", type: "loot", quantity: 2, baseCp: 50, container: "c" },
      { id: "e", type: "spell", quantity: 1, baseCp: 0 },
      { id: "f", type: "weapon", quantity: 1, baseCp: 0 }   // attaque à mains nues : sans prix
    ];
    expect(wares(mine).map(i => i.id)).toEqual(["b", "c"]);
  });

  it("l'étal empile les armes identiques, jamais un contenant", () => {
    const owned = [{ id: "x", type: "weapon", name: "Dague", source: "Compendium.a" }, { id: "y", type: "container", name: "Sac", source: "Compendium.b" }];
    expect(stackTarget(owned, { type: "weapon", name: "Dague", source: "Compendium.a" })).toBeNull();
    expect(stackTarget(owned, { type: "weapon", name: "Dague", source: "Compendium.a" }, { anyType: true })).toBe("x");
    expect(stackTarget(owned, { type: "container", name: "Sac", source: "Compendium.b" }, { anyType: true })).toBeNull();
  });

  it("l'étal empile aussi, sans source commune, ce qui porte le même nom au même prix", () => {
    const owned = [{ id: "x", type: "weapon", name: "Dague", source: null, price: 200 }, { id: "y", type: "weapon", name: "Dague +1", source: null, price: 40000 }];
    expect(stackTarget(owned, { type: "weapon", name: "Dague", source: "Compendium.a", price: 200 }, { anyType: true })).toBe("x");
    expect(stackTarget(owned, { type: "weapon", name: "Dague", source: null, price: 500 }, { anyType: true })).toBeNull();
    // chez un personnage (pas d'étal), jamais sans source
    expect(stackTarget([{ id: "p", type: "consumable", name: "Potion", source: null, price: 5000 }], { type: "consumable", name: "Potion", source: null, price: 5000 })).toBeNull();
    // deux sources différentes ne s'empilent pas, même au même prix
    expect(stackTarget([{ id: "q", type: "weapon", name: "Dague", source: "Compendium.b", price: 200 }], { type: "weapon", name: "Dague", source: "Compendium.a", price: 200 }, { anyType: true })).toBeNull();
  });
});

describe("marchand — objets volés", () => {
  const stolen = { from: "Yonvich", fromUuid: "Scene.s.Token.t" };

  it("par défaut, seul celui qu'on a volé refuse", () => {
    const m = merchant({});
    expect(stolenVerdict(m, null)).toBe("ok");
    expect(stolenVerdict(m, stolen, { names: ["Luvash"], uuids: [] })).toBe("ok");
    expect(stolenVerdict(m, stolen, { names: ["yonvich "], uuids: [] })).toBe("refuse");
    expect(stolenVerdict(m, stolen, { names: [], uuids: ["Scene.s.Token.t"] })).toBe("refuse");
    expect(stolenVerdict(merchant({ owner: "Yonvich" }), stolen, { names: ["Yonvich et fils"] })).toBe("refuse");
  });

  it("un marchand honnête refuse tout, un receleur rachète — sauf ce qu'on lui a volé", () => {
    expect(stolenVerdict(merchant({ stolen: "refuse" }), stolen, { names: ["Luvash"] })).toBe("refuse");
    expect(stolenVerdict(merchant({ stolen: "fence" }), stolen, { names: ["Luvash"] })).toBe("fence");
    expect(stolenVerdict(merchant({ stolen: "fence" }), stolen, { names: ["Yonvich"] })).toBe("refuse");
  });
});

describe("marchand — monnaie", () => {
  it("valeur d'une bourse, montant en pièces", () => {
    expect(purseValue({ pp: 1, gp: 2, ep: 1, sp: 3, cp: 4 })).toBe(1000 + 200 + 50 + 30 + 4);
    expect(coinsFor(1234)).toEqual({ gp: 12, sp: 3, cp: 4 });
    expect(coinsFor(0)).toEqual({});
    expect(receive({ gp: 1 }, 250)).toEqual({ pp: 0, gp: 3, ep: 0, sp: 5, cp: 0 });
  });

  it("payer l'appoint sans rafler les petites pièces", () => {
    expect(pay({ gp: 10, sp: 30, cp: 100 }, 500)).toEqual({ pp: 0, gp: 5, ep: 0, sp: 30, cp: 100 });
    expect(pay({ gp: 10, sp: 3, cp: 5 }, 125)).toEqual({ pp: 0, gp: 9, ep: 0, sp: 1, cp: 0 });
  });

  it("casser une seule pièce plus grosse, monnaie rendue", () => {
    expect(pay({ gp: 2 }, 30)).toEqual({ pp: 0, gp: 1, ep: 0, sp: 7, cp: 0 });
    expect(pay({ pp: 1 }, 1)).toEqual({ pp: 0, gp: 9, ep: 0, sp: 9, cp: 9 });
    expect(pay({ gp: 1, ep: 1 }, 60)).toEqual({ pp: 0, gp: 0, ep: 0, sp: 9, cp: 0 });
    // la valeur est conservée
    for ( const [purse, amount] of [[{ pp: 2, gp: 3, ep: 1, sp: 7, cp: 9 }, 1287], [{ gp: 250, sp: 50, cp: 100 }, 7777]] ) {
      expect(purseValue(pay(purse, amount))).toBe(purseValue(purse) - amount);
    }
  });

  it("bourse insuffisante : rien", () => {
    expect(pay({ gp: 1 }, 101)).toBeNull();
    expect(pay({}, 1)).toBeNull();
    expect(pay({ gp: 1 }, 0)).toEqual({ pp: 0, gp: 1, ep: 0, sp: 0, cp: 0 });
  });
});

describe("marchand — troc", () => {
  const playerPurse = { gp: 20 };
  const merchantPurse = { gp: 250, sp: 50, cp: 100 };

  it("le joueur paie l'écart", () => {
    const r = settle({ buyTotal: 1500, sellTotal: 500, playerPurse, merchantPurse });
    expect(r).toMatchObject({ ok: true, net: 1000 });
    expect(purseValue(r.player)).toBe(1000);
    expect(purseValue(r.merchant)).toBe(purseValue(merchantPurse) + 1000);
  });

  it("le marchand paie l'écart, s'il a de quoi", () => {
    const r = settle({ buyTotal: 0, sellTotal: 3000, playerPurse, merchantPurse });
    expect(r).toMatchObject({ ok: true, net: -3000 });
    expect(purseValue(r.player)).toBe(5000);
    const poor = settle({ buyTotal: 0, sellTotal: 50000, playerPurse, merchantPurse });
    expect(poor).toMatchObject({ ok: false, reason: "merchantFunds" });
    expect(poor.merchant).toBe(merchantPurse);
    const endless = settle({ buyTotal: 0, sellTotal: 50000, playerPurse, merchantPurse, infiniteCoins: true });
    expect(endless.ok).toBe(true);
    expect(endless.merchant).toBe(merchantPurse);
  });

  it("le joueur n'a pas de quoi", () => {
    expect(settle({ buyTotal: 5000, sellTotal: 0, playerPurse, merchantPurse })).toMatchObject({ ok: false, reason: "playerFunds", net: 5000 });
  });

  it("troc équilibré : aucune pièce ne bouge", () => {
    const r = settle({ buyTotal: 700, sellTotal: 700, playerPurse, merchantPurse });
    expect(r).toMatchObject({ ok: true, net: 0, player: playerPurse, merchant: merchantPurse });
  });

  it("panier nettoyé : fusion, plafond, objets disparus", () => {
    expect(cleanCart([{ id: "a", quantity: 2 }, { id: "a", quantity: 3 }, { id: "b", quantity: 0 }, { id: "c", quantity: 1 }, { id: "d", quantity: 4 }],
      { a: 4, b: 9, d: Infinity })).toEqual([{ id: "a", quantity: 4 }, { id: "d", quantity: 4 }]);
  });
});

describe("marchand — réassort", () => {
  it("le tiré et le racheté partent, le stock fixe revient à sa référence", () => {
    const plan = restockPlan([
      { id: "fixed", quantity: 3, base: 10 },
      { id: "full", quantity: 10, base: 10 },
      { id: "rolled", quantity: 1, rolled: true },
      { id: "bought", quantity: 2, bought: true },
      { id: "loose", quantity: 5 }
    ]);
    expect(plan).toEqual({ remove: ["rolled", "bought"], restore: [{ id: "fixed", quantity: 10 }] });
  });
});

describe("marchand — reprise d'Item Piles", () => {
  it("un marchand de la campagne : bourse finie, table de réassort", () => {
    const flag = fromItemPiles({ type: "merchant", enabled: true, hideItemsWithZeroCost: true, infiniteCurrencies: false,
      description: "<p>Parchemins</p>", tablesForPopulate: [{ uuid: "RollTable.rb3", addAll: false, items: {}, timesToRoll: "1d10", customCategory: "" }] });
    expect(normalizeMerchant(flag)).toMatchObject({ enabled: true, buy: 1, sell: 0.5, infiniteCoins: false, infiniteStock: false,
      description: "<p>Parchemins</p>", tables: [{ uuid: "RollTable.rb3", rolls: "1d10" }] });
  });

  it("coefficients par type (relatifs ou absolus) et par acteur", () => {
    const flag = fromItemPiles({ type: "merchant", enabled: true, buyPriceModifier: 1.2, sellPriceModifier: 0.4, infiniteQuantity: true,
      itemTypePriceModifiers: [{ type: "weapon", override: false, buyPriceModifier: 1.5, sellPriceModifier: 0.5 },
        { type: "consumable", override: true, buyPriceModifier: 0.6, sellPriceModifier: 0.2 }],
      actorPriceModifiers: [{ actorUuid: "Actor.hero", override: false, buyPriceModifier: 0.9, sellPriceModifier: 1 }] });
    expect(flag.types.weapon).toEqual({ buy: 1.5, sell: 0.5 });
    expect(flag.types.consumable.buy).toBeCloseTo(0.5);
    expect(flag.types.consumable.sell).toBeCloseTo(0.5);
    expect(flag.characters.hero).toEqual({ attitude: null, discount: 10 });
    expect(flag).toMatchObject({ infiniteStock: true, infiniteCoins: true });
  });

  it("un tas ou un acteur ordinaire n'est pas un marchand", () => {
    expect(fromItemPiles({ type: "pile", enabled: true })).toBeNull();
    expect(fromItemPiles({ type: "merchant", enabled: false })).toBeNull();
    expect(fromItemPiles(undefined)).toBeNull();
  });
});
