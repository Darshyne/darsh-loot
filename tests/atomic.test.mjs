/**
 * Lot 0 — atomic operations (audit of 2026-11-26, defects 1–7): everything is checked before the first write, and a gesture made
 * of several writes puts back what it did when a later write fails, with a trace the GM can read. Played on the fake Foundry of
 * tests/fake-foundry.mjs, whose `faults` make a chosen write throw like a server error.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { installFakeFoundry, FakeActor, FakeCollection, documents, faults, chat, settings, tick } from "./fake-foundry.mjs";

installFakeFoundry();
const { operation, inTurn, setOperationSinks } = await import("../module/scripts/adapter/ledger.mjs");
const { transfer } = await import("../module/scripts/adapter/dnd5e.mjs");
const { moveItem } = await import("../module/scripts/adapter/drop.mjs");
const { rollTreasure, rollContainer } = await import("../module/scripts/adapter/treasure.mjs");
const { registerTake, askGM } = await import("../module/scripts/runtime/take.mjs");
const { registerTradeInit } = await import("../module/scripts/runtime/trade.mjs");
const { registerShopInit } = await import("../module/scripts/runtime/shop.mjs");
const { registerNecromancyInit } = await import("../module/scripts/runtime/necromancy.mjs");
const { registerOperations } = await import("../module/scripts/runtime/operations.mjs");

const GM = { id: "gm", isGM: true, name: "MJ", active: true, isSelf: true };
const sword = { _id: "epee", name: "Épée longue", type: "weapon", system: { quantity: 1, properties: ["gear"] } };
const arrows = quantity => ({ _id: "fleches", name: "Flèche", type: "consumable", system: { quantity },
  _stats: { compendiumSource: "Compendium.x.Item.fleche" } });
const gmTraces = () => chat.filter(m => m.flags?.["darsh-loot"]?.operation);

beforeAll(() => {
  registerTake();
  registerTradeInit();
  registerShopInit();
  registerNecromancyInit();
});
beforeEach(() => {
  documents.clear();
  faults.clear();
  chat.length = 0;
  game.users.splice(0, game.users.length, GM);
  game.users.activeGM = GM;
  registerOperations();
});

describe("operation: undo and trace", () => {
  it("a refusal before the first write passes through untouched, without a trace", async () => {
    await expect(operation({ label: "test" }, async () => { throw new Error("refused"); })).rejects.toThrow("refused");
    expect(gmTraces()).toHaveLength(0);
  });

  it("a failure after two writes undoes them in reverse order and tells the GM", async () => {
    const seen = [];
    const run = operation({ label: "Trade A ⇄ B" }, async op => {
      op.did("first", async () => { seen.push("undo first"); });
      op.did("second", async () => { seen.push("undo second"); });
      throw new Error("server down");
    });
    await expect(run).rejects.toThrow("DLO.Op.FailedUndone");
    expect(seen).toEqual(["undo second", "undo first"]);
    expect(gmTraces()).toHaveLength(1);
    expect(gmTraces()[0].whisper).toEqual(["gm"]);
  });

  it("an undo that fails is named in the trace, and the others still run", async () => {
    const seen = [];
    const run = operation({ label: "x" }, async op => {
      op.did("first", async () => { seen.push("undo first"); });
      op.did("second", async () => { throw new Error("gone"); });
      throw new Error("server down");
    });
    await expect(run).rejects.toThrow("DLO.Op.FailedPartly");
    expect(seen).toEqual(["undo first"]);
    expect(gmTraces()[0].content).toContain("second");
  });

  it("a journaled operation is noted before its first write and cleared at its end", async () => {
    let during = null;
    await operation({ label: "deal", plan: ["one thing"] }, async () => { during = Object.values(game.settings.get("darsh-loot", "operations")); });
    expect(during).toHaveLength(1);
    expect(during[0].label).toBe("deal");
    expect(Object.keys(game.settings.get("darsh-loot", "operations"))).toHaveLength(0);
  });

  it("defect 9 — a gesture that never ends does not freeze its actors for ever", async () => {
    const a = { uuid: "Actor.stuck" };
    inTurn([a], () => new Promise(() => {}), { patience: 10 });
    await expect(inTurn([a], async () => "next")).resolves.toBe("next");
  });
});

describe("defect 4 — a take whose removal at the source fails leaves no duplicate", () => {
  it("the created sword is removed from the looter, the corpse keeps it", async () => {
    const corpse = new FakeActor({ id: "mort", name: "Garde", type: "npc", currency: { gp: 30 }, items: [sword] });
    const pc = new FakeActor({ id: "pj", name: "Clerc", currency: { gp: 1 } });
    faults.fail("deleteEmbedded", doc => doc === corpse);
    await expect(transfer(corpse, pc, { itemIds: ["epee"], coins: true })).rejects.toThrow("DLO.Op.FailedUndone");
    expect([corpse.count(sword.name), pc.count(sword.name)]).toEqual([1, 0]);
    expect([corpse.system.currency.gp, pc.system.currency.gp]).toEqual([30, 1]);
    expect(gmTraces()).toHaveLength(1);
  });

  it("coins credited to the looter come back when the source cannot be emptied", async () => {
    const corpse = new FakeActor({ id: "mort", name: "Garde", type: "npc", currency: { gp: 30 }, items: [sword] });
    const pc = new FakeActor({ id: "pj", name: "Clerc", currency: { gp: 1 } });
    faults.fail("update", doc => doc === corpse);
    await expect(transfer(corpse, pc, { itemIds: ["epee"], coins: true })).rejects.toThrow("DLO.Op.FailedUndone");
    expect([corpse.count(sword.name), pc.count(sword.name)]).toEqual([1, 0]);
    expect([corpse.system.currency.gp, pc.system.currency.gp]).toEqual([30, 1]);
  });

  it("a partial stack move whose source update fails gives nothing", async () => {
    const giver = new FakeActor({ id: "a", name: "Alice", items: [arrows(20)] });
    const taker = new FakeActor({ id: "b", name: "Bob", items: [{ ...arrows(5), _id: "siennes" }] });
    faults.fail("update", doc => doc.id === "fleches");
    await expect(moveItem(giver, taker, "fleches", 8)).rejects.toThrow("DLO.Op.FailedUndone");
    expect([giver.count("Flèche"), taker.count("Flèche")]).toEqual([20, 5]);
  });
});

describe("defects 1 and 3 — a deal at a merchant", () => {
  const rope = { _id: "corde", name: "Corde", type: "loot", system: { quantity: 2, price: { value: 10, denomination: "gp" }, properties: ["gear"] } };
  const heirloom = { _id: "vieux", name: "Vieille dague", type: "weapon", system: { quantity: 1, price: { value: 2, denomination: "gp" } } };
  const gem = { _id: "gemme", name: "Gemme", type: "loot", system: { quantity: 1, price: { value: 50, denomination: "gp" } } };
  const shopOf = items => new FakeActor({ id: "m", name: "Marchand", type: "npc", currency: { gp: 100 }, items,
    flags: { "darsh-loot": { merchant: { enabled: true } } } });
  const deal = (merchant, buyer, cart) => CONFIG.queries["darsh-loot.shopDeal"]({ source: { kind: "merchant", uuid: merchant.uuid },
    looter: buyer.uuid, buy: [], sell: [], ...cart }, { user: GM });

  it("defect 1 — an item the merchant cannot hand over is never charged", async () => {
    const merchant = shopOf([rope, heirloom]);
    const buyer = new FakeActor({ id: "pj", name: "Clerc", currency: { gp: 100 } });
    await expect(deal(merchant, buyer, { buy: [{ id: "corde", quantity: 1 }, { id: "vieux", quantity: 1 }] })).rejects.toThrow();
    expect(buyer.system.currency.gp).toBe(100);
    expect([buyer.count("Corde"), buyer.count("Vieille dague"), merchant.count("Corde")]).toEqual([0, 0, 2]);
  });

  it("defect 3 — the purse write fails: goods go back on both sides, nothing is paid, the GM is told", async () => {
    const merchant = shopOf([rope]);
    const buyer = new FakeActor({ id: "pj", name: "Clerc", currency: { gp: 100 }, items: [gem] });
    faults.fail("update", doc => doc === buyer);
    await expect(deal(merchant, buyer, { buy: [{ id: "corde", quantity: 1 }], sell: [{ id: "gemme", quantity: 1 }] }))
      .rejects.toThrow("DLO.Op.FailedUndone");
    expect([buyer.count("Corde"), merchant.count("Corde")]).toEqual([0, 2]);
    expect([buyer.count("Gemme"), merchant.count("Gemme")]).toEqual([1, 0]);
    expect([buyer.system.currency.gp, merchant.system.currency.gp]).toEqual([100, 100]);
    expect(gmTraces()).toHaveLength(1);
  });

  it("defect 3 — the merchant's till write fails: the buyer's purse is put back", async () => {
    const merchant = shopOf([rope]);
    const buyer = new FakeActor({ id: "pj", name: "Clerc", currency: { gp: 100 } });
    faults.fail("update", doc => doc === merchant);
    await expect(deal(merchant, buyer, { buy: [{ id: "corde", quantity: 1 }] })).rejects.toThrow("DLO.Op.FailedUndone");
    expect([buyer.system.currency.gp, merchant.system.currency.gp]).toEqual([100, 100]);
    expect([buyer.count("Corde"), merchant.count("Corde")]).toEqual([0, 2]);
  });
});

describe("defects 2 and 3 — a trade between two characters", () => {
  const query = name => CONFIG.queries[`darsh-loot.trade${name}`];
  const alice = { id: "uA", isGM: false, name: "A", active: true, isSelf: false, query: async () => true };
  const bob = { id: "uB", isGM: false, name: "B", active: true, isSelf: false, query: async () => true };
  const bag = { _id: "sac", name: "Sac", type: "container", system: { quantity: 1 } };
  const inside = { _id: "potion", name: "Potion", type: "consumable", system: { quantity: 2, container: "sac" } };

  async function open(aItems, bItems=[]) {
    game.users.splice(0, game.users.length, GM, alice, bob);
    const a = new FakeActor({ id: "a", name: "Alice", type: "character", currency: { gp: 100 }, items: aItems, owners: ["uA"] });
    const b = new FakeActor({ id: "b", name: "Bob", type: "character", currency: { gp: 10 }, items: bItems, owners: ["uB"] });
    const { id } = await query("Open")({ from: a.uuid, to: b.uuid }, { user: alice });
    return { id, a, b };
  }
  async function bothAccept(id) {
    const rev = () => query("Peek")?.(id)?.rev;
    await query("Accept")({ id, value: true, rev: rev() }, { user: alice });
    return query("Accept")({ id, value: true, rev: rev() }, { user: bob });
  }

  it("defect 2 — a bag offered with an item stored in it: the bag goes with its contents, once", async () => {
    const { id, a, b } = await open([bag, inside]);
    await query("Update")({ id, offer: { items: [{ id: "sac", quantity: 1 }, { id: "potion", quantity: 2 }], coins: { gp: 20 } } }, { user: alice });
    await bothAccept(id);
    expect([a.count("Sac"), a.count("Potion")]).toEqual([0, 0]);
    expect([b.count("Sac"), b.count("Potion")]).toEqual([1, 2]);
    expect([a.system.currency.gp, b.system.currency.gp]).toEqual([80, 30]);
  });

  it("defect 3 — the last write fails: items and coins are back where they were, the GM is told", async () => {
    const { id, a, b } = await open([{ ...sword }], [{ ...arrows(3) }]);
    await query("Update")({ id, offer: { items: [{ id: "epee", quantity: 1 }], coins: { gp: 50 } } }, { user: alice });
    await query("Update")({ id, offer: { items: [{ id: "fleches", quantity: 3 }], coins: { gp: 5 } } }, { user: bob });
    // Bob's side is written last: his coins leave after everything else has moved.
    faults.fail("update", (doc, changes) => (doc === a) && (changes?.["system.currency"]?.gp === 55));
    await expect(bothAccept(id)).rejects.toThrow("DLO.Op.FailedUndone");
    expect([a.count(sword.name), b.count(sword.name)]).toEqual([1, 0]);
    expect([a.count("Flèche"), b.count("Flèche")]).toEqual([0, 3]);
    expect([a.system.currency.gp, b.system.currency.gp]).toEqual([100, 10]);
    expect(gmTraces()).toHaveLength(1);
  });
});

describe("defect 5 — a chest or a corpse is rolled once", () => {
  beforeEach(() => {
    const table = { roll: async () => { await tick(4); return { results: [{ type: "text", description: "Un rubis" }] }; } };
    documents.set("RollTable.t", table);
  });

  it("two rolls of the same corpse at the same time: one draw", async () => {
    const npc = new FakeActor({ id: "pnj", name: "Garde", type: "npc", flags: { "darsh-loot": { table: "RollTable.t" } } });
    npc.system.details = {};
    await Promise.allSettled([rollTreasure(npc, { pockets: false }), rollTreasure(npc, { pockets: false })]);
    expect(npc.items.size).toBe(1);
    expect(npc.getFlag("darsh-loot", "rolled")).toBe(true);
  });

  it("two rolls of the same chest at the same time (unlock while another player opens it): one draw", async () => {
    const store = new FakeActor({ id: "coffre", name: "Coffre", type: "group" });
    const behavior = { uuid: "Scene.s.Region.r.RegionBehavior.b", system: { table: "RollTable.t", draws: 1, hoard: "", theme: "", rolled: false },
      async update(changes) { await tick(); if ( "system.rolled" in changes ) this.system.rolled = changes["system.rolled"]; } };
    await Promise.allSettled([rollContainer(behavior, store), rollContainer(behavior, store)]);
    expect(store.items.size).toBe(1);
    expect(behavior.system.rolled).toBe(true);
  });

  it("the items cannot be created: the chest is not left marked as rolled and empty", async () => {
    const store = new FakeActor({ id: "coffre", name: "Coffre", type: "group" });
    const behavior = { uuid: "Scene.s.Region.r.RegionBehavior.b2", system: { table: "RollTable.t", draws: 1, hoard: "", theme: "", rolled: false },
      async update(changes) { await tick(); if ( "system.rolled" in changes ) this.system.rolled = changes["system.rolled"]; } };
    faults.fail("create", doc => doc === store);
    await expect(rollContainer(behavior, store)).rejects.toThrow();
    expect(behavior.system.rolled).toBe(false);
    await rollContainer(behavior, store);
    expect(store.items.size).toBe(1);
  });
});

describe("defects 3 and 6 — raising a corpse", () => {
  function stage() {
    settings.autoTreasure = false;
    const tokens = new FakeCollection();
    const created = [];
    const scene = { name: "Crypte", tokens, regions: new FakeCollection(), grid: { size: 100, distance: 5, units: "ft" },
      async createEmbeddedDocuments(type, data) {
        await tick();
        faults.check("create", scene, data);
        return data.map(d => { const t = { id: `tok${created.length}`, uuid: `Scene.s.Token.new${created.length}`, ...d,
          async delete() { tokens.delete(this.id); } }; created.push(t); tokens.set(t.id, t); return t; });
      } };
    const dead = new FakeActor({ id: "bandit", name: "Bandit", type: "npc" });
    dead.statuses.add("dead");
    dead.system.details = { type: { value: "humanoid" } };
    dead.system.traits = { size: "med" };
    const corpse = { id: "c1", uuid: "Scene.s.Token.c1", documentName: "Token", name: "Bandit", parent: scene, actor: dead,
      _source: { x: 0, y: 0, width: 1, height: 1, elevation: 0, level: null },
      async delete() { await tick(); faults.check("delete", corpse); tokens.delete("c1"); } };
    tokens.set("c1", corpse);
    documents.set(corpse.uuid, corpse);
    const undead = [];
    game.packs = { get: id => ((id === "dnd5e.actors24") ? { index: { has: () => true }, getDocument: async () => ({ name: "Squelette" }) } : null) };
    game.actors.fromCompendium = source => ({ name: source.name, type: "npc" });
    game.folders = Object.assign([{ type: "Actor", id: "f", getFlag: () => true }], {});
    globalThis.Actor.implementation = { create: async data => {
      await tick();
      const actor = new FakeActor({ id: `undead${undead.length}`, name: data.name, type: "npc" });
      actor.getTokenDocument = async extra => ({ toObject: () => ({ name: data.name, ...extra }) });
      undead.push(actor);
      return actor;
    } };
    return { scene, corpse, undead, created };
  }
  const animate = corpse => CONFIG.queries["darsh-loot.animate"]({ corpse: corpse.uuid, caster: null, kind: "skeleton" }, { user: GM });

  it("defect 6 — two requests on the same corpse: one undead, the second is refused", async () => {
    const { scene, corpse, undead } = stage();
    const results = await Promise.allSettled([animate(corpse), animate(corpse)]);
    expect(results.map(r => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(undead.filter(a => documents.has(a.uuid))).toHaveLength(1);
    expect(scene.tokens.size).toBe(1);
    expect(scene.tokens.has("c1")).toBe(false);
  });

  it("defect 3 — the undead's token cannot be placed: the corpse stays, the undead actor is removed", async () => {
    const { scene, corpse, undead } = stage();
    faults.fail("create", doc => doc === scene);
    await expect(animate(corpse)).rejects.toThrow("DLO.Op.FailedUndone");
    expect(scene.tokens.has("c1")).toBe(true);
    expect(undead.filter(a => documents.has(a.uuid))).toHaveLength(0);
    expect(gmTraces()).toHaveLength(1);
  });

  it("defect 3 — the corpse cannot be removed: no second creature stays on its square", async () => {
    const { scene, corpse, undead } = stage();
    faults.fail("delete", doc => doc === corpse);
    await expect(animate(corpse)).rejects.toThrow("DLO.Op.FailedUndone");
    expect([...scene.tokens.keys()]).toEqual(["c1"]);
    expect(undead.filter(a => documents.has(a.uuid))).toHaveLength(0);
  });
});

describe("defect 7 — a GM who does not answer in time is not a refusal", () => {
  const player = { id: "uA", isGM: false, name: "A" };

  it("a timed-out query says the GM has not answered, not « refused »", async () => {
    const said = [];
    ui.notifications.warn = text => said.push(text);
    game.user = player;
    game.users.activeGM = { id: "gm", isSelf: false, active: true, query: async () => { throw new Error("operation has timed out"); } };
    expect(await askGM("darsh-loot.take", () => {}, {})).toBeNull();
    expect(said).toEqual(["DLO.Notice.NoAnswer"]);
    game.user = { id: "gm", isGM: true, name: "MJ" };
  });

  it("a slow GM: the player is told to wait, and still gets the result", async () => {
    const said = [];
    ui.notifications.info = text => said.push(text);
    game.user = player;
    game.users.activeGM = { id: "gm", isSelf: false, active: true, query: async () => { await tick(40); return { ok: true }; } };
    expect(await askGM("darsh-loot.take", () => {}, {}, { timeout: 10 })).toEqual({ ok: true });
    expect(said).toEqual(["DLO.Notice.StillWaiting"]);
    ui.notifications.info = () => {};
    game.user = { id: "gm", isGM: true, name: "MJ" };
  });

  it("a real refusal is still shown as a refusal", async () => {
    const said = [];
    ui.notifications.warn = text => said.push(text);
    game.user = player;
    game.users.activeGM = { id: "gm", isSelf: false, active: true, query: async () => { throw new Error("too far"); } };
    expect(await askGM("darsh-loot.take", () => {}, {})).toBeNull();
    expect(said).toEqual(["DLO.Notice.Refused"]);
    game.user = { id: "gm", isGM: true, name: "MJ" };
    vi.restoreAllMocks();
  });
});
