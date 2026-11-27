/**
 * Lot 1 — coins dropped on the ground (2026-11-27): what can leave a purse, the move with its undo, the icon of the pile, and
 * what the GM client refuses before anything is created. The whole gesture (pile, tile, flight) is played in game: selftest
 * part `drop-coins` and bench scenario `lot1-pieces-sol-joueur`.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { installFakeFoundry, FakeActor, FakeCollection, documents, faults, chat, settings } from "./fake-foundry.mjs";
import { clampCoins } from "../module/scripts/core/loot.mjs";

installFakeFoundry();
const { moveCoinsNow, pileImage, COIN_PILE_IMG, MIXED_PILE_IMG } = await import("../module/scripts/adapter/drop.mjs");
const { inTurn } = await import("../module/scripts/adapter/ledger.mjs");
const { registerDropInit } = await import("../module/scripts/runtime/drop.mjs");
const { registerOperations } = await import("../module/scripts/runtime/operations.mjs");

const GM = { id: "gm", isGM: true, name: "MJ", active: true, isSelf: true };
const alice = { id: "uA", isGM: false, name: "Alice", active: true };
const dropCoins = (payload, user=alice) => CONFIG.queries["darsh-loot.dropCoins"](payload, { user });

beforeAll(() => registerDropInit());
beforeEach(() => {
  documents.clear();
  faults.clear();
  chat.length = 0;
  game.users.splice(0, game.users.length, GM, alice);
  game.users.activeGM = GM;
  settings.dropMode = "on";
  registerOperations();
});

describe("clampCoins — what can really leave a purse", () => {
  it("never more than what is there, whole numbers, nothing negative", () => {
    expect(clampCoins({ gp: 50, sp: 2.9, cp: -4, pp: 0 }, { gp: 12, sp: 10, cp: 9 })).toEqual({ coins: { gp: 12, sp: 2 }, any: true });
  });
  it("unknown coins and garbage are ignored", () => {
    expect(clampCoins({ zz: 5, gp: "x" }, { gp: 3 })).toEqual({ coins: {}, any: false });
    expect(clampCoins("all", { gp: 3 }).any).toBe(false);
    expect(clampCoins(null, { gp: 3 }).any).toBe(false);
  });
});

describe("moveCoinsNow", () => {
  it("moves what is asked, capped to the purse; nothing is created", async () => {
    const pc = new FakeActor({ id: "pj", name: "Clerc", currency: { gp: 10, sp: 4 } });
    const store = new FakeActor({ id: "tas", name: "Tas", type: "group", currency: { gp: 1 } });
    const moved = await inTurn([pc, store], () => moveCoinsNow(pc, store, { gp: 7, sp: 9 }));
    expect(moved).toEqual({ gp: 7, sp: 4 });
    expect([pc.system.currency.gp, pc.system.currency.sp, store.system.currency.gp, store.system.currency.sp]).toEqual([3, 0, 8, 4]);
  });

  it("the purse cannot be written: the pile gives the coins back, the GM gets a trace", async () => {
    const pc = new FakeActor({ id: "pj", name: "Clerc", currency: { gp: 10 } });
    const store = new FakeActor({ id: "tas", name: "Tas", type: "group" });
    faults.fail("update", doc => doc === pc);
    await expect(moveCoinsNow(pc, store, { gp: 7 })).rejects.toThrow("DLO.Op.FailedUndone");
    expect([pc.system.currency.gp, store.system.currency.gp]).toEqual([10, 0]);
    expect(chat.filter(m => m.flags?.["darsh-loot"]?.operation)).toHaveLength(1);
  });

  it("nothing to move: no write, no operation", async () => {
    const pc = new FakeActor({ id: "pj", name: "Clerc" });
    const store = new FakeActor({ id: "tas", name: "Tas", type: "group" });
    faults.fail("update", () => true);
    expect(await moveCoinsNow(pc, store, { gp: 5 })).toEqual({});
  });

  it("two drops of the same 10 gp at once: 10 gp reach the ground, not 20", async () => {
    const pc = new FakeActor({ id: "pj", name: "Clerc", currency: { gp: 10 } });
    const store = new FakeActor({ id: "tas", name: "Tas", type: "group" });
    await Promise.all([1, 2].map(() => inTurn([pc, store], () => moveCoinsNow(pc, store, { gp: 10 }))));
    expect([pc.system.currency.gp, store.system.currency.gp]).toEqual([0, 10]);
  });
});

describe("pileImage", () => {
  const sword = { _id: "e", name: "Épée", type: "weapon", img: "sword.webp", system: { quantity: 1 } };
  it("coins only: the coin icon", () => expect(pileImage(new FakeActor({ id: "a", name: "T", currency: { gp: 2 } }))).toBe(COIN_PILE_IMG));
  it("one item alone: its own icon", () => expect(pileImage(new FakeActor({ id: "b", name: "T", items: [sword] }))).toBe("sword.webp"));
  it("an item and coins: the sack", () => expect(pileImage(new FakeActor({ id: "c", name: "T", currency: { gp: 2 }, items: [sword] }))).toBe(MIXED_PILE_IMG));
});

describe("what the GM client refuses before creating anything", () => {
  function table({ purse={ gp: 10 }, owners=["uA"] }={}) {
    const where = { id: "s", name: "Scene", tokens: new FakeCollection(), regions: new FakeCollection(), grid: { size: 100, distance: 5 },
      createEmbeddedDocuments() { throw new Error("a pile was created"); } };
    const pc = new FakeActor({ id: "pj", name: "Clerc", currency: purse, owners });
    const token = { id: "t", uuid: "Scene.s.Token.t", documentName: "Token", name: "Clerc", parent: where, actor: pc,
      _source: { x: 0, y: 0, width: 1, height: 1, elevation: 0, level: null } };
    documents.set(token.uuid, token);
    return { pc, payload: { dropper: token.uuid, x: 150, y: 50, coins: { gp: 4 } } };
  }

  it("a character that is not the player's", async () => {
    const t = table({ owners: [] });
    await expect(dropCoins(t.payload)).rejects.toThrow("DLO.Refus.PasAToi");
    expect(t.pc.system.currency.gp).toBe(10);
  });
  it("a purse without the coins asked", async () => {
    const t = table({ purse: { sp: 3 } });
    await expect(dropCoins(t.payload)).rejects.toThrow("DLO.Drop.NoCoins");
  });
  it("garbage instead of coins", async () => {
    const t = table();
    await expect(dropCoins({ ...t.payload, coins: { gp: -5 } })).rejects.toThrow("DLO.Drop.NoCoins");
    await expect(dropCoins({ ...t.payload, coins: "everything" })).rejects.toThrow("DLO.Drop.NoCoins");
  });
  it("the gesture switched off by the GM", async () => {
    settings.dropMode = "off";
    const t = table();
    await expect(dropCoins(t.payload)).rejects.toThrow("DLO.Drop.Off");
  });
  it("no token named", async () => {
    await expect(dropCoins({ dropper: "Scene.s.Token.nobody", x: 0, y: 0, coins: { gp: 1 } })).rejects.toThrow("DLO.Drop.NotOnScene");
  });
});
