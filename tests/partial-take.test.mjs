/**
 * Lot 1 — partial quantities (audit of 2026-11-26, defect 21): taking N from a stack leaves the rest at the source. Played on
 * the fake Foundry of tests/fake-foundry.mjs, through the request a player sends to the active GM.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { installFakeFoundry, FakeActor, FakeCollection, documents, faults, chat } from "./fake-foundry.mjs";
import { takenQuantity } from "../module/scripts/core/loot.mjs";

installFakeFoundry();
const { transfer } = await import("../module/scripts/adapter/dnd5e.mjs");
const { registerTake } = await import("../module/scripts/runtime/take.mjs");
const { registerOperations } = await import("../module/scripts/runtime/operations.mjs");

const GM = { id: "gm", isGM: true, name: "MJ", active: true, isSelf: true };
const alice = { id: "uA", isGM: false, name: "Alice", active: true };
const arrows = (quantity, id="fleches") => ({ _id: id, name: "Flèche", type: "consumable", system: { quantity, properties: ["gear"] },
  _stats: { compendiumSource: "Compendium.x.Item.fleche" } });
const sword = { _id: "epee", name: "Épée", type: "weapon", system: { quantity: 3, properties: ["gear"] } };
const sack = { _id: "sac", name: "Sac", type: "container", system: { quantity: 2, properties: ["gear"] } };

function pair(items=[arrows(20)], mine=[]) {
  const where = { name: "Scene", tokens: new FakeCollection(), regions: new FakeCollection(), grid: { size: 100, distance: 5 } };
  const dead = new FakeActor({ id: "mort", name: "Archer", type: "npc", items });
  dead.statuses.add("dead");
  const pc = new FakeActor({ id: "pj", name: "Clerc", owners: ["uA"], items: mine });
  const token = (actor, x) => {
    const t = { id: `t-${actor.id}`, uuid: `Scene.s.Token.t-${actor.id}`, documentName: "Token", name: actor.name, parent: where, actor,
      flags: {}, getFlag: () => undefined, _source: { x, y: 0, width: 1, height: 1, elevation: 0, level: null } };
    where.tokens.set(t.id, t);
    documents.set(t.uuid, t);
    return t;
  };
  const corpse = token(dead, 100), looter = token(pc, 0);
  const take = (itemIds, quantities) => CONFIG.queries["darsh-loot.take"](
    { source: { kind: "corpse", uuid: corpse.uuid }, looter: looter.uuid, itemIds, coins: false, quantities }, { user: alice });
  return { dead, pc, take };
}

beforeAll(() => registerTake());
beforeEach(() => {
  documents.clear();
  faults.clear();
  chat.length = 0;
  game.users.splice(0, game.users.length, GM, alice);
  game.users.activeGM = GM;
  globalThis.canvas = {};
  delete CONFIG.Canvas;
  registerOperations();
});

describe("takenQuantity", () => {
  it("a whole number between 1 and the stack", () => {
    expect([takenQuantity(20, 5), takenQuantity(20, 5.9), takenQuantity(20, 99), takenQuantity(20, 20)]).toEqual([5, 5, 20, 20]);
  });
  it("nothing usable asked: the whole stack", () => {
    expect([undefined, null, 0, -3, "x", NaN].map(v => takenQuantity(20, v))).toEqual([20, 20, 20, 20, 20, 20]);
  });
});

describe("take N from a stack", () => {
  it("5 of 20 arrows: 15 stay on the corpse, 5 arrive as a new stack", async () => {
    const { dead, pc, take } = pair();
    const taken = await take(["fleches"], { fleches: 5 });
    expect([dead.count("Flèche"), pc.count("Flèche")]).toEqual([15, 5]);
    expect(dead.items.has("fleches")).toBe(true);
    expect(taken.names).toEqual(["Flèche (5)"]);
  });

  it("they join the looter's own stack of the same item", async () => {
    const { dead, pc, take } = pair([arrows(20)], [arrows(7, "miennes")]);
    await take(["fleches"], { fleches: 4 });
    expect([dead.count("Flèche"), pc.count("Flèche"), pc.items.size]).toEqual([16, 11, 1]);
  });

  it("a weapon stack is split too; one of three is named « Épée (1) »", async () => {
    const { dead, pc, take } = pair([sword]);
    const taken = await take(["epee"], { epee: 1 });
    expect([dead.count("Épée"), pc.count("Épée")]).toEqual([2, 1]);
    expect(taken.names).toEqual(["Épée (1)"]);
  });

  it("no quantity, or more than there is: the whole stack, as before", async () => {
    const a = pair();
    await a.take(["fleches"]);
    expect([a.dead.count("Flèche"), a.pc.count("Flèche")]).toEqual([0, 20]);
    const b = pair();
    await b.take(["fleches"], { fleches: 500 });
    expect([b.dead.count("Flèche"), b.pc.count("Flèche")]).toEqual([0, 20]);
  });

  it("crafted quantities (negative, fraction, text, another id) never create or lose anything", async () => {
    for ( const q of [{ fleches: -5 }, { fleches: 2.7 }, { fleches: "all" }, { autre: 3 }, "nonsense"] ) {
      const { dead, pc, take } = pair();
      await take(["fleches"], q);
      expect(dead.count("Flèche") + pc.count("Flèche")).toBe(20);
      expect(pc.count("Flèche")).toBeGreaterThanOrEqual(1);
    }
  });

  it("a bag always leaves whole", async () => {
    const { dead, pc, take } = pair([sack]);
    await take(["sac"], { sac: 1 });
    expect(dead.items.has("sac")).toBe(false);
    expect(pc.items.find(i => i.name === "Sac")?.system.quantity).toBe(2);
  });

  it("part of one stack and the whole of another in one gesture", async () => {
    const { dead, pc, take } = pair([arrows(20), sword]);
    await take(["fleches", "epee"], { fleches: 3 });
    expect([dead.count("Flèche"), pc.count("Flèche"), dead.count("Épée"), pc.count("Épée")]).toEqual([17, 3, 0, 3]);
  });

  it("the source cannot be reduced: what arrived is taken back, the GM gets a trace", async () => {
    const { dead, pc, take } = pair();
    faults.fail("updateEmbedded", doc => doc === dead);
    await expect(take(["fleches"], { fleches: 5 })).rejects.toThrow("DLO.Op.FailedUndone");
    expect([dead.count("Flèche"), pc.count("Flèche")]).toEqual([20, 0]);
    expect(chat.filter(m => m.flags?.["darsh-loot"]?.operation)).toHaveLength(1);
  });

  it("two players each take 15 of 20: the second gets the 5 that are left", async () => {
    const { dead, pc, take } = pair();
    await Promise.all([take(["fleches"], { fleches: 15 }), take(["fleches"], { fleches: 15 })]);
    expect([dead.count("Flèche"), pc.count("Flèche")]).toEqual([0, 20]);
  });

  it("`transfer` keeps its behaviour without quantities", async () => {
    const dead = new FakeActor({ id: "m", name: "Archer", type: "npc", items: [arrows(20)] });
    const pc = new FakeActor({ id: "p", name: "Clerc" });
    await transfer(dead, pc, { itemIds: ["fleches"] });
    expect([dead.count("Flèche"), pc.count("Flèche")]).toEqual([0, 20]);
  });
});
