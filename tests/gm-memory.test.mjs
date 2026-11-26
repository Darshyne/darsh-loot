/**
 * Lot 0 — what lives only in the memory of the GM client (audit of 2026-11-26, defects 8–9): trades and theft agreements. A trade
 * lost by a GM reload, or by another GM becoming the active one, is cancelled cleanly at both players, with a message; abandoned
 * trades are purged; a theft agreement is checked again before the dice roll. Played on the fake Foundry of tests/fake-foundry.mjs.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { installFakeFoundry, FakeActor, FakeCollection, documents, settings } from "./fake-foundry.mjs";

installFakeFoundry();
const { staleTrades, TRADE_MAX_IDLE_MS, TRADE_MAX_OPEN } = await import("../module/scripts/core/trade.mjs");
const { registerTradeInit, registerTrade } = await import("../module/scripts/runtime/trade.mjs");
const { TradeWindow } = await import("../module/scripts/apps/trade-window.mjs");
const { registerTheft, requestSteal } = await import("../module/scripts/runtime/theft.mjs");
const { pocketSource } = await import("../module/scripts/adapter/sources.mjs");

const GM = { id: "gm", isGM: true, name: "MJ", active: true, isSelf: true };
const OTHER_GM = { id: "gm2", isGM: true, name: "MJ 2", active: true, isSelf: false };
const query = name => CONFIG.queries[`darsh-loot.trade${name}`];
const states = { uA: [], uB: [] };
const player = id => ({ id, isGM: false, name: id, active: true, isSelf: false, query: async (_name, state) => { states[id].push(state); return true; } });
const alice = player("uA"), bob = player("uB");
const said = [];

/** A trade window as far as these tests go: what `TradeWindow.open` holds. */
function fakeWindow(trade) {
  const app = { trade, closed: false, close() { this.closed = true; TradeWindow.open.delete(this.trade.id); } };
  TradeWindow.open.set(trade.id, app);
  return app;
}

beforeAll(() => {
  registerTradeInit();
  registerTheft();
  game.users.splice(0, game.users.length, GM, alice, bob);
  game.users.activeGM = GM;
  registerTrade();
});
beforeEach(() => {
  documents.clear();
  TradeWindow.open.clear();
  said.length = 0;
  states.uA.length = 0;
  states.uB.length = 0;
  ui.notifications.info = text => said.push(text);
  ui.notifications.warn = text => said.push(text);
  game.users.splice(0, game.users.length, GM, alice, bob);
  game.users.activeGM = GM;
  game.user = { id: "gm", isGM: true, name: "MJ" };
});
afterEach(() => vi.restoreAllMocks());

function pair(suffix="") {
  const a = new FakeActor({ id: `a${suffix}`, name: "Alice", type: "character", currency: { gp: 10 }, owners: ["uA"] });
  const b = new FakeActor({ id: `b${suffix}`, name: "Bob", type: "character", owners: ["uB"] });
  return { a, b };
}

describe("defect 8 — a trade lost by the GM client is cancelled cleanly on both sides", () => {
  it("each state says which GM client holds the trade", async () => {
    const { a, b } = pair();
    await query("Open")({ from: a.uuid, to: b.uuid }, { user: alice });
    expect(states.uA.at(-1).gm).toBe("gm");
    expect(states.uB.at(-1).gm).toBe("gm");
  });

  it("the GM holding my trade disconnects: my window closes with the reason, no cancellation is sent back", () => {
    const app = fakeWindow({ id: "t1", gm: "gm", a: { user: "uA" }, b: { user: "uB" } });
    game.users.activeGM = null;
    Hooks.callAll("userConnected", { ...GM, active: false }, false);
    expect(app.closed).toBe(true);
    expect(app.trade.cancelled).toBe(true);
    expect(said).toEqual(["DLO.Trade.GMLeft"]);
  });

  it("another GM becomes the active one: the trade held by the first is cancelled too", () => {
    const app = fakeWindow({ id: "t1", gm: "gm", a: { user: "uA" }, b: { user: "uB" } });
    game.users.activeGM = OTHER_GM;
    Hooks.callAll("userConnected", OTHER_GM, true);
    expect(app.closed).toBe(true);
  });

  it("a player connecting or leaving changes nothing", () => {
    const app = fakeWindow({ id: "t1", gm: "gm", a: { user: "uA" }, b: { user: "uB" } });
    Hooks.callAll("userConnected", { ...bob, active: false }, false);
    expect(app.closed).toBe(false);
  });

  it("a GM client that has just loaded says it holds no trade: open windows close; a player cannot send that", () => {
    const app = fakeWindow({ id: "t1", gm: "gm", a: { user: "uA" }, b: { user: "uB" } });
    expect(query("Reset")({}, { user: alice })).toBe(false);
    expect(app.closed).toBe(false);
    expect(query("Reset")({}, { user: GM })).toBe(true);
    expect(app.closed).toBe(true);
    expect(said).toEqual(["DLO.Trade.GMLeft"]);
  });
});

describe("defect 9 — abandoned trades do not pile up", () => {
  it("staleTrades: only those nobody touched for too long", () => {
    const now = 10 * TRADE_MAX_IDLE_MS;
    expect(staleTrades([{ id: "old", touched: now - TRADE_MAX_IDLE_MS - 1 }, { id: "fresh", touched: now - 1000 }, { id: "new" }], now)).toEqual(["old"]);
  });

  it("an abandoned trade is cancelled, with a message to both sides, when the next one opens", async () => {
    const first = pair("1");
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    const { id } = await query("Open")({ from: first.a.uuid, to: first.b.uuid }, { user: alice });
    clock.mockReturnValue(1000 + TRADE_MAX_IDLE_MS + 1);
    const second = pair("2");
    await query("Open")({ from: second.a.uuid, to: second.b.uuid }, { user: alice });
    const cancelled = states.uB.find(s => (s.id === id) && s.cancelled);
    expect(cancelled?.reason).toBe("DLO.Trade.Expired");
    await expect(query("Update")({ id, offer: { items: [], coins: { gp: 1 } } }, { user: alice })).rejects.toThrow("DLO.Trade.Over");
  });

  it("the same two characters asking again get their trade back, not a second one", async () => {
    const { a, b } = pair("3");
    const one = await query("Open")({ from: a.uuid, to: b.uuid }, { user: alice });
    const two = await query("Open")({ from: a.uuid, to: b.uuid }, { user: alice });
    expect(two.id).toBe(one.id);
  });

  it("a player cannot leave more than a few proposals open", async () => {
    const b = new FakeActor({ id: "cible", name: "Bob", type: "character", owners: ["uB"] });
    const mine = n => new FakeActor({ id: `perso${n}`, name: `Perso ${n}`, type: "character", owners: ["uC"] });
    const carol = { ...player("uA"), id: "uC" };
    for ( let n = 0; n < TRADE_MAX_OPEN; n++ ) await query("Open")({ from: mine(n).uuid, to: b.uuid }, { user: carol });
    await expect(query("Open")({ from: mine(99).uuid, to: b.uuid }, { user: carol })).rejects.toThrow("DLO.Trade.TooMany");
  });
});

describe("defect 8 — a theft agreement lost by the GM client is asked again before the dice", () => {
  function scene() {
    return { name: "Scène", tokens: new FakeCollection(), regions: new FakeCollection(), grid: { size: 100, distance: 5 } };
  }
  function tokenOn(where, actor, x) {
    const token = { id: `t-${actor.id}`, uuid: `Scene.s.Token.t-${actor.id}`, documentName: "Token", name: actor.name, parent: where,
      actor, flags: {}, getFlag: () => undefined, _source: { x, y: 0, width: 1, height: 1, elevation: 0 } };
    where.tokens.set(token.id, token);
    documents.set(token.uuid, token);
    return token;
  }

  it("the GM no longer agrees: the theft stops before the roll", async () => {
    settings.pickpocket = "approval";
    const where = scene();
    const npc = tokenOn(where, new FakeActor({ id: "pnj", name: "Garde", type: "npc" }), 100);
    const rogue = new FakeActor({ id: "pj", name: "Roublard", owners: ["uA"] });
    let rolled = 0;
    rogue.rollSkill = async () => { rolled++; return [{ total: 20 }]; };
    const thief = tokenOn(where, rogue, 0);
    const asked = [];
    game.user = { id: "uA", isGM: false, name: "A" };
    game.users.activeGM = { id: "gm", isSelf: false, active: true, query: async name => { asked.push(name); return { ok: false }; } };
    expect(await requestSteal(pocketSource(npc), thief, "coins")).toBeNull();
    expect(asked).toEqual(["darsh-loot.stealApproval"]);
    expect(rolled).toBe(0);
    settings.pickpocket = "on";
  });
});
