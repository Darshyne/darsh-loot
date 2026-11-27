/**
 * Lot 1 — sharing (2026-11-27, issue darsh-loot#19). The pure rules (who is the party, how coins split), then the request a
 * player sends to the active GM, played on the fake Foundry of tests/fake-foundry.mjs: a share is whole or undone, « too far »
 * can be forced and the GM is told, and what the player's interface never offers is refused.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { installFakeFoundry, FakeActor, FakeCollection, documents, faults, chat, settings } from "./fake-foundry.mjs";
import { splitCoins, pickMembers, coinsText } from "../module/scripts/core/share.mjs";
import { forceableRefusal, isForceable, plainReason } from "../module/scripts/core/force.mjs";

installFakeFoundry();
const { registerShareInit } = await import("../module/scripts/runtime/share.mjs");
const { registerOperations } = await import("../module/scripts/runtime/operations.mjs");

const GM = { id: "gm", isGM: true, name: "MJ", active: true, isSelf: true };
const alice = { id: "uA", isGM: false, name: "Alice", active: true };
const shareCoins = (payload, user=alice) => CONFIG.queries["darsh-loot.shareCoins"](payload, { user });
const flagged = key => chat.filter(m => m.flags?.["darsh-loot"]?.[key]);

function scene() {
  return { id: "s", name: "Scene", tokens: new FakeCollection(), regions: new FakeCollection(), grid: { size: 100, distance: 5 } };
}
function tokenOn(where, actor, x, { level=null }={}) {
  const token = { id: `t-${actor.id}`, uuid: `Scene.s.Token.t-${actor.id}`, documentName: "Token", name: actor.name, parent: where,
    actor, actorId: actor.id, actorLink: true, flags: {}, getFlag: () => undefined, _source: { x, y: 0, width: 1, height: 1, elevation: 0, level } };
  where.tokens.set(token.id, token);
  documents.set(token.uuid, token);
  return token;
}
/** A dead guard with a purse next to three characters; Cleric (Alice's) is the one who shares. */
function table({ purse={ gp: 10, sp: 7 }, corpseAt=100, party=true, absent=false }={}) {
  const where = scene();
  const dead = new FakeActor({ id: "mort", name: "Garde", type: "npc", currency: purse });
  dead.statuses.add("dead");
  const pcs = ["Clerc", "Guerrier", "Mage"].map((name, i) => new FakeActor({ id: `pj${i}`, name, currency: { gp: 1 }, owners: i ? [] : ["uA"] }));
  for ( const pc of pcs ) pc.hasPlayerOwner = true;
  const corpse = tokenOn(where, dead, corpseAt);
  const tokens = pcs.map((pc, i) => ((absent && (i === 2)) ? null : tokenOn(where, pc, -100 * i)));
  game.actors.party = party ? { system: { playerCharacters: pcs } } : null;
  game.actors.filter = fn => pcs.filter(fn);
  return { where, dead, pcs, corpse, looter: tokens[0], payload: { source: { kind: "corpse", uuid: corpse.uuid }, looter: tokens[0].uuid } };
}
const gold = actors => actors.map(a => a.system.currency.gp);

beforeAll(() => registerShareInit());
beforeEach(() => {
  documents.clear();
  faults.clear();
  chat.length = 0;
  game.users.splice(0, game.users.length, GM, alice);
  game.users.activeGM = GM;
  game.user = { id: "gm", isGM: true, name: "MJ" };
  globalThis.canvas = {};
  delete CONFIG.Canvas;
  Object.assign(settings, { shareWith: "party", shareRemainder: "source" });
  registerOperations();
});

describe("splitCoins — coin by coin, no conversion", () => {
  it("10 gp and 7 sp between 3: 3 gp 2 sp each, 1 gp 1 sp left", () => {
    expect(splitCoins({ gp: 10, sp: 7 }, 3)).toEqual({ each: { gp: 3, sp: 2 }, bonus: {}, left: { gp: 1, sp: 1 }, any: true });
  });
  it("the remainder goes to the sharer when asked", () => {
    expect(splitCoins({ gp: 10 }, 3, { remainder: "sharer" })).toEqual({ each: { gp: 3 }, bonus: { gp: 1 }, left: {}, any: true });
  });
  it("fewer coins than members: nothing to hand to everyone", () => {
    expect(splitCoins({ pp: 1, cp: 2 }, 4)).toEqual({ each: {}, bonus: {}, left: { pp: 1, cp: 2 }, any: false });
  });
  it("nothing is created or lost", () => {
    const purse = { pp: 5, gp: 101, ep: 3, sp: 44, cp: 9 };
    for ( const n of [2, 3, 4, 5, 7] ) for ( const remainder of ["source", "sharer"] ) {
      const s = splitCoins(purse, n, { remainder });
      for ( const k of Object.keys(purse) ) expect(((s.each[k] ?? 0) * n) + (s.bonus[k] ?? 0) + (s.left[k] ?? 0)).toBe(purse[k]);
    }
  });
  it("garbage in: no member, negative or fractional amounts", () => {
    expect(splitCoins({ gp: 10 }, 0).any).toBe(false);
    expect(splitCoins({ gp: -4, sp: 2.9 }, 2)).toEqual({ each: { sp: 1 }, bonus: {}, left: {}, any: true });
  });
});

describe("pickMembers — who is the party", () => {
  it("a primary party: all its characters, absent included", () => {
    expect(pickMembers({ party: ["a", "b", "c"], present: ["a"], mode: "party" })).toEqual(["a", "b", "c"]);
  });
  it("« scene »: only those with a token on the scene", () => {
    expect(pickMembers({ party: ["a", "b", "c"], present: ["a", "c", "x"], mode: "scene" })).toEqual(["a", "c"]);
  });
  it("no primary party: the player-owned characters on the scene", () => {
    expect(pickMembers({ party: [], present: ["a", "b"], owned: ["a", "b", "z"], mode: "party" })).toEqual(["a", "b"]);
  });
  it("the sharer is always in, once", () => {
    expect(pickMembers({ party: ["a", "b"], present: [], mode: "scene", sharer: "n" })).toEqual(["n"]);
    expect(pickMembers({ party: ["a", "b"], sharer: "a" })).toEqual(["a", "b"]);
  });
});

describe("texts and marks", () => {
  it("coins in the order of value", () => expect(coinsText({ sp: 2, gp: 3, cp: 0 }, { gp: "po", sp: "pa" })).toBe("3 po, 2 pa"));
  it("a forceable refusal carries an invisible mark, removed for display", () => {
    const err = forceableRefusal("Too far");
    expect(isForceable(err.message)).toBe(true);
    expect(plainReason(err.message)).toBe("Too far");
    expect(isForceable("Too far")).toBe(false);
  });
});

describe("share the coins of a corpse (request to the GM)", () => {
  it("split between the three characters of the party; the remainder stays on the corpse", async () => {
    const t = table();
    const answer = await shareCoins(t.payload);
    expect(gold(t.pcs)).toEqual([4, 4, 4]);
    expect(t.pcs.map(a => a.system.currency.sp)).toEqual([2, 2, 2]);
    expect([t.dead.system.currency.gp, t.dead.system.currency.sp]).toEqual([1, 1]);
    expect(answer).toMatchObject({ each: { gp: 3, sp: 2 }, left: { gp: 1, sp: 1 }, names: ["Clerc", "Guerrier", "Mage"] });
  });

  it("everyone sees it: one public card with the floating text of each member on the scene", async () => {
    const t = table();
    await shareCoins(t.payload);
    const cards = flagged("share");
    expect(cards).toHaveLength(1);
    expect(cards[0].whisper ?? []).toEqual([]);
    const fb = cards[0].flags["darsh-loot"].feedback;
    expect([fb.token, ...fb.also.map(o => o.token)]).toHaveLength(3);
    expect(cards[0].flags["darsh-loot"].shareFx.to).toHaveLength(3);
    expect(cards[0].content).not.toContain("Garde");
  });

  it("setting « remainder to the sharer »: the corpse is emptied, the sharer gets the extra", async () => {
    settings.shareRemainder = "sharer";
    const t = table();
    await shareCoins(t.payload);
    expect(gold(t.pcs)).toEqual([5, 4, 4]);
    expect(t.dead.system.currency.gp).toBe(0);
  });

  it("setting « scene »: a character without a token on the scene gets nothing", async () => {
    settings.shareWith = "scene";
    const t = table({ absent: true });
    await shareCoins(t.payload);
    expect(gold(t.pcs)).toEqual([6, 6, 1]);
    expect(t.dead.system.currency.gp).toBe(0);
  });

  it("no primary party: the player-owned characters on the scene share", async () => {
    const t = table({ party: false, absent: true });
    await shareCoins(t.payload);
    expect(gold(t.pcs)).toEqual([6, 6, 1]);
  });

  it("a write that fails half-way: every coin goes back, the GM gets a trace", async () => {
    const t = table();
    faults.fail("update", doc => doc === t.pcs[2]);
    await expect(shareCoins(t.payload)).rejects.toThrow("DLO.Op.FailedUndone");
    expect(gold(t.pcs)).toEqual([1, 1, 1]);
    expect(t.dead.system.currency.gp).toBe(10);
    expect(flagged("operation")).toHaveLength(1);
    expect(flagged("share")).toHaveLength(0);
  });

  it("the corpse cannot be written: what the members received is taken back", async () => {
    const t = table();
    faults.fail("update", doc => doc === t.dead);
    await expect(shareCoins(t.payload)).rejects.toThrow("DLO.Op.FailedUndone");
    expect(gold(t.pcs)).toEqual([1, 1, 1]);
    expect(t.dead.system.currency.gp).toBe(10);
  });

  it("two shares at once: the second one finds what the first one left", async () => {
    const t = table({ purse: { gp: 7 } });
    const [first, second] = await Promise.allSettled([shareCoins(t.payload), shareCoins(t.payload)]);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("rejected");
    expect(gold(t.pcs)).toEqual([3, 3, 3]);
    expect(t.dead.system.currency.gp).toBe(1);
  });

  it("fewer coins than characters: refused before any write", async () => {
    const t = table({ purse: { pp: 1 } });
    await expect(shareCoins(t.payload)).rejects.toThrow("DLO.Share.TooFew");
    expect(t.dead.system.currency.pp).toBe(1);
    expect(flagged("operation")).toHaveLength(0);
  });

  it("alone: refused", async () => {
    const t = table({ party: false });
    game.actors.filter = () => [];
    await expect(shareCoins(t.payload)).rejects.toThrow("DLO.Share.Alone");
  });
});

describe("what the GM client refuses, and what the player may force", () => {
  it("too far: a refusal that can be forced, nothing moves", async () => {
    const t = table({ corpseAt: 900 });
    const err = await shareCoins(t.payload).catch(e => e);
    expect(isForceable(err.message)).toBe(true);
    expect(plainReason(err.message)).toBe("DLO.Refus.Loin");
    expect(t.dead.system.currency.gp).toBe(10);
  });

  it("forced: done, and the GM is told who overrode what", async () => {
    const t = table({ corpseAt: 900 });
    await shareCoins({ ...t.payload, force: true });
    expect(gold(t.pcs)).toEqual([4, 4, 4]);
    const told = flagged("forced");
    expect(told).toHaveLength(1);
    expect(told[0].whisper).toEqual(["gm"]);
  });

  it("another V14 level: out of reach (forceable like any distance)", async () => {
    const t = table();
    t.corpse._source.level = "upper";
    t.looter._source.level = "ground";
    expect(isForceable((await shareCoins(t.payload).catch(e => e)).message)).toBe(true);
  });

  it("a character that is not the player's: refused, and never forceable", async () => {
    const t = table();
    t.pcs[0].owners = [];
    const err = await shareCoins({ ...t.payload, force: true }).catch(e => e);
    expect(err.message).toBe("DLO.Refus.PasAToi");
    expect(t.dead.system.currency.gp).toBe(10);
  });

  it("« only the GM searches corpses »: refused even forced", async () => {
    settings.whoLoots = "gm";
    const t = table();
    await expect(shareCoins({ ...t.payload, force: true })).rejects.toThrow("DLO.Refus.MJSeul");
    settings.whoLoots = "all";
  });

  it("the pockets of a living NPC are not shared", async () => {
    const t = table();
    t.dead.statuses.delete("dead");
    await expect(shareCoins({ source: { kind: "pocket", uuid: t.corpse.uuid }, looter: t.looter.uuid })).rejects.toThrow("DLO.Refus.Introuvable");
    expect(t.dead.system.currency.gp).toBe(10);
  });

  it("a player cannot share without a character; a GM can", async () => {
    const t = table();
    await expect(shareCoins({ source: t.payload.source, looter: null })).rejects.toThrow("DLO.Refus.Introuvable");
    await shareCoins({ source: t.payload.source, looter: null }, GM);
    expect(gold(t.pcs)).toEqual([4, 4, 4]);
  });
});
