import { describe, it, expect } from "vitest";
import { newTrade, setOffer, accept, unaccept, ready, cleanCoins, clampOffer, other } from "../module/scripts/core/trade.mjs";

const fresh = () => newTrade({ id: "t1", a: { actor: "Actor.a", name: "Clerc", user: "u1" }, b: { actor: "Actor.b", name: "Roublard", user: "u2" } });

describe("échange", () => {
  it("naît vide, sans validation", () => {
    const t = fresh();
    expect(t.a).toMatchObject({ items: [], coins: {}, accepted: false });
    expect(ready(t)).toBe(false);
    expect(other("a")).toBe("b");
  });
  it("les deux valident : prêt", () => {
    let t = setOffer(fresh(), "a", { items: [{ id: "dague", quantity: 1 }] });
    t = accept(accept(t, "a"), "b");
    expect(ready(t)).toBe(true);
  });
  it("une modification retire les deux validations", () => {
    let t = setOffer(fresh(), "a", { items: [{ id: "dague", quantity: 1 }] });
    t = accept(accept(t, "a"), "b");
    t = setOffer(t, "b", { coins: { gp: 5 } });
    expect(t.a.accepted).toBe(false);
    expect(t.b.accepted).toBe(false);
    expect(ready(t)).toBe(false);
  });
  it("rien à échanger : jamais prêt", () => {
    const t = accept(accept(fresh(), "a"), "b");
    expect(ready(t)).toBe(false);
  });
  it("retirer sa validation", () => {
    let t = setOffer(fresh(), "a", { coins: { gp: 1 } });
    t = unaccept(accept(accept(t, "a"), "b"), "b");
    expect(ready(t)).toBe(false);
  });
  it("offre : doublons fusionnés, quantités nulles retirées, pièces propres", () => {
    const t = setOffer(fresh(), "a", { items: [{ id: "f", quantity: 2 }, { id: "f", quantity: 3 }, { id: "x", quantity: 0 }], coins: { gp: "4", sp: -2, zz: 9 } });
    expect(t.a.items).toEqual([{ id: "f", quantity: 5 }]);
    expect(t.a.coins).toEqual({ gp: 4 });
    expect(cleanCoins({ pp: 1.7, cp: 3 })).toEqual({ pp: 1, cp: 3 });
  });
  it("confrontée à ce qu'on possède", () => {
    const offer = { items: [{ id: "f", quantity: 5 }, { id: "gone", quantity: 1 }], coins: { gp: 10 } };
    expect(clampOffer(offer, { f: 3 }, { gp: 4 })).toEqual({ items: [{ id: "f", quantity: 3 }], coins: { gp: 4 }, changed: true });
    expect(clampOffer({ items: [{ id: "f", quantity: 2 }], coins: {} }, { f: 3 }, {}).changed).toBe(false);
  });
});
