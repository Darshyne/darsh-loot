/**
 * Lot 1 — giving (2026-11-27): the pure rules, then the request a player sends to the active GM, played on the fake Foundry of
 * tests/fake-foundry.mjs. A gift is whole or undone, needs reach unless forced, and in « ask » mode nothing moves before the
 * receiver's player has agreed.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { installFakeFoundry, FakeActor, FakeCollection, documents, faults, chat, settings } from "./fake-foundry.mjs";
import { canReceive, needsConsent } from "../module/scripts/core/give.mjs";
import { isForceable, plainReason } from "../module/scripts/core/force.mjs";

installFakeFoundry();
const { registerGiveInit } = await import("../module/scripts/runtime/give.mjs");
const { registerOperations } = await import("../module/scripts/runtime/operations.mjs");

const GM = { id: "gm", isGM: true, name: "MJ", active: true, isSelf: true };
const offers = [];
let answer = true;
const alice = { id: "uA", isGM: false, name: "Alice", active: true };
const bob = { id: "uB", isGM: false, name: "Bob", active: true, isSelf: false,
  query: async (name, offer) => { offers.push({ name, offer }); if ( answer instanceof Error ) throw answer; return answer; } };
const give = (payload, user=alice) => CONFIG.queries["darsh-loot.give"](payload, { user });
const flagged = key => chat.filter(m => m.flags?.["darsh-loot"]?.[key]);

const potions = { _id: "potions", name: "Potion", type: "consumable", system: { quantity: 4 } };
const ring = { _id: "anneau", name: "Anneau", type: "equipment", system: { quantity: 1, equipped: true, attuned: true } };
const spell = { _id: "sort", name: "Lumière", type: "spell", system: {} };
const bite = { _id: "morsure", name: "Morsure", type: "weapon", system: { quantity: 1, properties: [] } };

function table({ gap=100, receiver={} }={}) {
  const where = { id: "s", name: "Scene", tokens: new FakeCollection(), regions: new FakeCollection(), grid: { size: 100, distance: 5 } };
  const from = new FakeActor({ id: "donneur", name: "Clerc", currency: { gp: 10, sp: 3 }, items: [potions, ring, spell], owners: ["uA"] });
  const to = new FakeActor({ id: "receveur", name: "Guerrier", currency: { gp: 1 }, owners: ["uB"], ...receiver });
  from.hasPlayerOwner = true;
  to.hasPlayerOwner = (receiver.owners ?? ["uB"]).length > 0;
  const token = (actor, x) => {
    const t = { id: `t-${actor.id}`, uuid: `Scene.s.Token.t-${actor.id}`, documentName: "Token", name: actor.name, parent: where, actor,
      flags: {}, getFlag: () => undefined, _source: { x, y: 0, width: 1, height: 1, elevation: 0, level: null } };
    where.tokens.set(t.id, t);
    documents.set(t.uuid, t);
    return t;
  };
  const giver = token(from, 0), taker = token(to, gap);
  return { from, to, giver, taker, payload: what => ({ giver: giver.uuid, receiver: taker.uuid, ...what }) };
}

beforeAll(() => registerGiveInit());
beforeEach(() => {
  documents.clear();
  faults.clear();
  chat.length = 0;
  offers.length = 0;
  answer = true;
  game.users.splice(0, game.users.length, GM, alice, bob);
  game.users.activeGM = GM;
  game.user = { id: "gm", isGM: true, name: "MJ" };
  globalThis.canvas = {};
  delete CONFIG.Canvas;
  Object.assign(settings, { giveMode: "direct", reach: 5 });
  registerOperations();
});

describe("who may receive, when consent is asked", () => {
  it("a player gives to a player character or a player-owned creature, never to an ordinary NPC or to itself", () => {
    expect(canReceive({ same: false, type: "character", playerOwned: false, byGM: false })).toBe(true);
    expect(canReceive({ same: false, type: "npc", playerOwned: true, byGM: false })).toBe(true);
    expect(canReceive({ same: false, type: "npc", playerOwned: false, byGM: false })).toBe(false);
    expect(canReceive({ same: true, type: "character", playerOwned: true, byGM: false })).toBe(false);
  });
  it("a GM gives to any character or NPC, not to a group", () => {
    expect(canReceive({ same: false, type: "npc", playerOwned: false, byGM: true })).toBe(true);
    expect(canReceive({ same: false, type: "group", playerOwned: false, byGM: true })).toBe(false);
  });
  it("consent only in « ask » mode, and not for one's own character or for the GM", () => {
    expect(needsConsent({ mode: "ask", byGM: false, ownsReceiver: false })).toBe(true);
    expect(needsConsent({ mode: "direct", byGM: false, ownsReceiver: false })).toBe(false);
    expect(needsConsent({ mode: "ask", byGM: true, ownsReceiver: false })).toBe(false);
    expect(needsConsent({ mode: "ask", byGM: false, ownsReceiver: true })).toBe(false);
  });
});

describe("give, direct mode", () => {
  it("2 of 4 potions: handed over at once, the rest stays", async () => {
    const t = table();
    const given = await give(t.payload({ item: "potions", quantity: 2 }));
    expect([t.from.count("Potion"), t.to.count("Potion")]).toEqual([2, 2]);
    expect(given.names).toEqual(["Potion (2)"]);
    expect(offers).toHaveLength(0);
  });

  it("coins: never more than the purse holds", async () => {
    const t = table();
    const given = await give(t.payload({ coins: { gp: 50, sp: 1 } }));
    expect(given.coins).toEqual({ gp: 10, sp: 1 });
    expect([t.from.system.currency.gp, t.to.system.currency.gp, t.to.system.currency.sp]).toEqual([0, 11, 1]);
  });

  it("a worn, attuned ring arrives unworn and unattuned", async () => {
    const t = table();
    await give(t.payload({ item: "anneau" }));
    const got = t.to.items.find(i => i.name === "Anneau");
    expect([got?.system.equipped, got?.system.attuned, t.from.count("Anneau")]).toEqual([false, false, 0]);
  });

  it("everyone sees it: one public card, floating texts on both, the thing flying to the receiver", async () => {
    const t = table();
    await give(t.payload({ item: "potions", quantity: 1 }));
    const cards = flagged("give");
    expect(cards).toHaveLength(1);
    expect(cards[0].whisper ?? []).toEqual([]);
    expect(cards[0].flags["darsh-loot"].feedback.also.map(o => o.token)).toEqual([t.taker.uuid]);
    expect(cards[0].flags["darsh-loot"].flyFx.to).toEqual([t.taker.uuid]);
  });

  it("an item and coins in one gift: if the purse cannot be written, the item goes back too", async () => {
    const t = table();
    faults.fail("update", doc => doc === t.from);
    await expect(give(t.payload({ item: "potions", quantity: 3, coins: { gp: 5 } }))).rejects.toThrow("DLO.Op.FailedUndone");
    expect([t.from.count("Potion"), t.to.count("Potion"), t.from.system.currency.gp, t.to.system.currency.gp]).toEqual([4, 0, 10, 1]);
    expect(flagged("operation")).toHaveLength(1);
    expect(flagged("give")).toHaveLength(0);
  });

  it("the same potion given twice at once: the second gift finds what is left", async () => {
    const t = table();
    await Promise.allSettled([give(t.payload({ item: "potions", quantity: 3 })), give(t.payload({ item: "potions", quantity: 3 }))]);
    expect([t.from.count("Potion"), t.to.count("Potion")]).toEqual([0, 4]);
  });
});

describe("what the GM client refuses", () => {
  it("too far: a refusal that can be forced; forced, it is done and the GM is told", async () => {
    const t = table({ gap: 900 });
    const err = await give(t.payload({ item: "potions", quantity: 1 })).catch(e => e);
    expect(isForceable(err.message)).toBe(true);
    expect(plainReason(err.message)).toBe("DLO.Give.Far");
    expect(t.to.count("Potion")).toBe(0);
    await give(t.payload({ item: "potions", quantity: 1, force: true }));
    expect(t.to.count("Potion")).toBe(1);
    expect(flagged("forced")).toHaveLength(1);
  });

  it("another V14 level: out of reach", async () => {
    const t = table();
    t.giver._source.level = "ground";
    t.taker._source.level = "upper";
    expect(isForceable((await give(t.payload({ item: "potions" })).catch(e => e)).message)).toBe(true);
  });

  it("a wall in between", async () => {
    const t = table();
    globalThis.canvas = { scene: t.giver.parent };
    CONFIG.Canvas = { polygonBackends: { sight: { testCollision: () => true } } };
    expect(plainReason((await give(t.payload({ item: "potions" })).catch(e => e)).message)).toBe("DLO.Refus.Mur");
  });

  it("a character that is not the player's, even forced", async () => {
    const t = table();
    await expect(give(t.payload({ item: "potions", force: true }), bob)).rejects.toThrow("DLO.Refus.PasAToi");
    expect(t.from.count("Potion")).toBe(4);
  });

  it("an ordinary NPC cannot receive from a player; a GM may give to it", async () => {
    const t = table({ receiver: { type: "npc", owners: [] } });
    await expect(give(t.payload({ item: "potions" }))).rejects.toThrow("DLO.Give.NotTo");
    await give(t.payload({ item: "potions", quantity: 1 }), GM);
    expect(t.to.count("Potion")).toBe(1);
  });

  it("a spell, a creature's attack, an item that does not exist, nothing at all", async () => {
    const t = table();
    await expect(give(t.payload({ item: "sort" }))).rejects.toThrow("DLO.Refus.Introuvable");
    await expect(give(t.payload({ item: "nope" }))).rejects.toThrow("DLO.Refus.Introuvable");
    await expect(give(t.payload({}))).rejects.toThrow("DLO.Give.Nothing");
    await expect(give(t.payload({ coins: { gp: -3 } }))).rejects.toThrow("DLO.Give.Nothing");
    const npc = new FakeActor({ id: "loup", name: "Loup", type: "npc", items: [bite], owners: ["uA"] });
    const wolf = { ...t.giver, id: "t-loup", uuid: "Scene.s.Token.t-loup", actor: npc, name: "Loup" };
    documents.set(wolf.uuid, wolf);
    await expect(give({ giver: wolf.uuid, receiver: t.taker.uuid, item: "morsure" })).rejects.toThrow("DLO.Drop.NotGear");
  });

  it("the gesture switched off: refused to players, not to the GM", async () => {
    settings.giveMode = "off";
    const t = table();
    await expect(give(t.payload({ item: "potions" }))).rejects.toThrow("DLO.Give.Off");
    await give(t.payload({ item: "potions", quantity: 1 }), GM);
    expect(t.to.count("Potion")).toBe(1);
  });
});

describe("give, « ask » mode", () => {
  beforeEach(() => { settings.giveMode = "ask"; });

  it("the receiver's player is asked, with what is offered; accepted: it moves", async () => {
    const t = table();
    await give(t.payload({ item: "potions", quantity: 2, coins: { gp: 3 } }));
    expect(offers).toHaveLength(1);
    expect(offers[0].name).toBe("darsh-loot.giveOffer");
    expect(offers[0].offer).toMatchObject({ giver: "Clerc", receiver: "Guerrier" });
    expect(offers[0].offer.what).toContain("Potion (2)");
    expect([t.to.count("Potion"), t.to.system.currency.gp]).toEqual([2, 4]);
  });

  it("refused: nothing moves, the giver is told", async () => {
    answer = false;
    const t = table();
    await expect(give(t.payload({ item: "potions" }))).rejects.toThrow("DLO.Give.Declined");
    expect([t.from.count("Potion"), t.to.count("Potion")]).toEqual([4, 0]);
  });

  it("no answer in time: nothing moves", async () => {
    answer = new Error("The query timed out");
    const t = table();
    await expect(give(t.payload({ item: "potions" }))).rejects.toThrow("DLO.Give.Declined");
    expect(t.to.count("Potion")).toBe(0);
  });

  it("the item was dropped while the receiver was thinking: refused after the agreement, nothing is created", async () => {
    const t = table();
    bob.query = async () => { t.from.items.delete("potions"); return true; };
    await expect(give(t.payload({ item: "potions" }))).rejects.toThrow("DLO.Refus.Introuvable");
    expect(t.to.count("Potion")).toBe(0);
    bob.query = async (name, offer) => { offers.push({ name, offer }); return answer; };
  });

  it("too far is refused before anyone is asked", async () => {
    const t = table({ gap: 900 });
    await expect(give(t.payload({ item: "potions" }))).rejects.toThrow("DLO.Give.Far");
    expect(offers).toHaveLength(0);
  });

  it("one's own second character, and the GM, are not asked", async () => {
    const t = table({ receiver: { owners: ["uA"] } });
    await give(t.payload({ item: "potions", quantity: 1 }));
    await give(t.payload({ item: "potions", quantity: 1 }), GM);
    expect(offers).toHaveLength(0);
    expect(t.to.count("Potion")).toBe(2);
  });

  it("only a GM client can make the acceptance window appear", async () => {
    expect(await CONFIG.queries["darsh-loot.giveOffer"]({ giver: "x", receiver: "y", what: "z" }, { user: alice })).toBe(false);
  });
});
