/**
 * Lot 3 — end-of-combat loot (2026-11-27). The pure rules (the loot part of a record, which corpse is held, where the chest goes,
 * custom table rules), then the GM side on the fake Foundry of tests/fake-foundry.mjs: the end of a combat gives the record a loot
 * part and opens the window (even with DAS's XP off), a player cannot take from a held corpse, a forced search releases it and the GM
 * is told, « Distribute » in individual mode rolls each corpse and frees it, « auto » distributes at once, « set aside » frees them.
 * The grouped mode (a chest on the canvas) is played on the bench (tools/scenarios/lot3-butin-fin-combat.mjs).
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { installFakeFoundry, FakeActor, FakeCollection, documents, faults, chat, settings } from "./fake-foundry.mjs";
import {
  lootPart, mergeLoot, isLive, holdingRecord, corpsesToLoot, chestSpot, cleanRule, ruleMatches, matchRule, titleKey
} from "../module/scripts/core/end-loot.mjs";
import { pruneRecords } from "../module/scripts/core/xp.mjs";

installFakeFoundry();
const { registerRewardsInit, registerRewards, rewardsApi } = await import("../module/scripts/runtime/rewards.mjs");
const { registerEndLootInit, endLootApi } = await import("../module/scripts/runtime/end-loot.mjs");
const { registerTake } = await import("../module/scripts/runtime/take.mjs");
const { registerOperations } = await import("../module/scripts/runtime/operations.mjs");
const { RewardsWindow } = await import("../module/scripts/apps/rewards-window.mjs");

const GM = { id: "gm", isGM: true, name: "MJ", active: true, isSelf: true };
const alice = { id: "uA", isGM: false, name: "Alice", active: true };
const until = async (test, ms=1500) => {
  const end = Date.now() + ms;
  while ( !test() ) {
    if ( Date.now() > end ) throw new Error("timed out");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

/* -------------------------------------------- */
/*  The pure rules                              */
/* -------------------------------------------- */

describe("the loot part of a record", () => {
  const foes = [{ key: "a", name: "Gobelin", img: "g.webp", defeated: true }, { key: "b", name: "Orc", defeated: false },
    { key: "c", name: "Loup", defeated: true }];
  it("every defeated foe is a corpse, ticked; the others are not listed", () => {
    const loot = lootPart(foes, { mode: "grouped", keepSpecial: 1 });
    expect(loot).toMatchObject({ status: "pending", mode: "grouped", keepSpecial: true, chest: null });
    expect(loot.corpses.map(c => [c.key, c.include])).toEqual([["a", true], ["c", true]]);
  });
  it("an unknown mode falls back to individual", () => {
    expect(lootPart(foes, { mode: "wow" }).mode).toBe("individual");
  });
  it("merging adds the newly defeated, keeps the GM's ticks, and never touches a distributed loot", () => {
    const loot = lootPart(foes);
    loot.corpses[0].include = false;
    mergeLoot(loot, [...foes, { key: "b", name: "Orc", defeated: true }]);
    expect(loot.corpses.map(c => [c.key, c.include])).toEqual([["a", false], ["c", true], ["b", true]]);
    const done = { ...lootPart(foes), status: "done" };
    mergeLoot(done, [{ key: "z", defeated: true }]);
    expect(done.corpses.map(c => c.key)).toEqual(["a", "c"]);
  });
  it("a record is live while its XP or its loot waits", () => {
    expect(isLive({ status: "awarded", loot: { status: "pending" } })).toBe(true);
    expect(isLive({ status: "none", loot: { status: "done" } })).toBe(false);
    expect(isLive({ status: "pending" })).toBe(true);
  });
  it("records whose loot waits are never pruned", () => {
    const records = [{ id: "l", status: "none", time: 0, loot: { status: "pending" } },
      ...Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, status: "awarded", time: i + 1 }))];
    expect(pruneRecords(records, 2).map(r => r.id)).toEqual(["l", "d8", "d9"]);
  });
  it("a corpse is held by a pending loot that ticks it, nothing else", () => {
    const records = [{ id: "r1", loot: { status: "done", corpses: [{ key: "a", include: true }] } },
      { id: "r2", loot: { status: "pending", corpses: [{ key: "a", include: false }, { key: "c", include: true }] } }];
    expect(holdingRecord(records, "a")).toBeNull();
    expect(holdingRecord(records, "c")?.id).toBe("r2");
    expect(holdingRecord(records, undefined)).toBeNull();
    expect(corpsesToLoot(records[1].loot).map(c => c.key)).toEqual(["c"]);
  });
  it("the chest goes on the square in the middle of the corpses", () => {
    expect(chestSpot([{ x: 150, y: 150 }, { x: 550, y: 150 }], 100)).toEqual({ x: 350, y: 150 });
    expect(chestSpot([{ x: 120, y: 480 }], 100)).toEqual({ x: 150, y: 450 });
    expect(chestSpot([], 100)).toBeNull();
    expect(chestSpot([{ x: NaN, y: 1 }], 100)).toBeNull();
  });
  it("the window's name follows what is on", () => {
    expect(titleKey(true, false)).toBe("DLO.Rewards.Title");
    expect(titleKey(false, true)).toBe("DLO.EndLoot.Title.loot");
    expect(titleKey(true, true)).toBe("DLO.EndLoot.Title.both");
  });
});

describe("custom table rules (by CR, type, size)", () => {
  it("a rule is cleaned: empty bounds, draws between 1 and 20, a known effect", () => {
    expect(cleanRule({ crMin: "", crMax: "4", draws: "99", effect: "x", table: "T" }))
      .toEqual({ id: "", crMin: null, crMax: 4, type: "", size: "", table: "T", draws: 20, effect: "add" });
    expect(cleanRule({ draws: 0 }).draws).toBe(1);
  });
  it("a rule matches on CR range, type and size; an empty field matches anything; no table, no match", () => {
    const rule = { crMin: 1, crMax: 4, type: "humanoid", size: "med", table: "T" };
    expect(ruleMatches(rule, { cr: 2, type: "humanoid", size: "med" })).toBe(true);
    expect(ruleMatches(rule, { cr: 0.5, type: "humanoid", size: "med" })).toBe(false);
    expect(ruleMatches(rule, { cr: 5, type: "humanoid", size: "med" })).toBe(false);
    expect(ruleMatches(rule, { cr: 2, type: "beast", size: "med" })).toBe(false);
    expect(ruleMatches(rule, { cr: 2, type: "humanoid", size: "lg" })).toBe(false);
    expect(ruleMatches({ table: "T" }, { cr: 30, type: "dragon", size: "grg" })).toBe(true);
    expect(ruleMatches({ crMin: 0 }, { cr: 1 })).toBe(false);
  });
  it("the first rule that matches wins", () => {
    const rules = [{ type: "undead", table: "U" }, { crMax: 4, table: "Low", effect: "replace" }, { table: "All" }];
    expect(matchRule(rules, { cr: 1, type: "undead" }).table).toBe("U");
    expect(matchRule(rules, { cr: 1, type: "beast" })).toMatchObject({ table: "Low", effect: "replace" });
    expect(matchRule(rules, { cr: 9, type: "beast" }).table).toBe("All");
    expect(matchRule([], { cr: 1 })).toBeNull();
  });
});

/* -------------------------------------------- */
/*  The GM side                                 */
/* -------------------------------------------- */

function npc(id, name, { dead=false, hp=10 }={}) {
  const a = new FakeActor({ id, name, type: "npc" });
  a.img = `${id}.webp`;
  a.system.details = { xp: { value: 50 }, cr: 1 };
  a.system.attributes.hp.value = hp;
  if ( dead ) a.statuses.add("dead");
  return a;
}
function tokenFor(scene, actor, disposition, x=0) {
  const token = { id: `t-${actor.id}`, uuid: `Scene.s.Token.t-${actor.id}`, documentName: "Token", name: actor.name, parent: scene,
    actor, actorId: actor.id, actorLink: false, disposition, flags: {}, getFlag: () => undefined,
    _source: { x, y: 0, width: 1, height: 1, elevation: 0, level: null } };
  scene.tokens.set(token.id, token);
  documents.set(token.uuid, token);
  return token;
}

/** A character next to two dead goblins and an orc that fled. */
function table() {
  const scene = { id: "s", name: "Crypte", tokens: new FakeCollection(), regions: new FakeCollection(), grid: { size: 100, distance: 5 } };
  game.scenes = new FakeCollection([["s", scene]]);
  const pc = new FakeActor({ id: "pc", name: "Clerc", owners: ["uA"] });
  pc.hasPlayerOwner = true;
  pc.system.details = { level: 1, xp: { value: 0 } };
  game.actors.party = null;
  game.actors.filter = fn => [pc].filter(fn);
  const g1 = npc("g1", "Gobelin 1", { dead: true, hp: 0 });
  const g2 = npc("g2", "Gobelin 2", { dead: true, hp: 0 });
  const orc = npc("orc", "Orc");
  const tokens = { pc: tokenFor(scene, pc, 1, 0), g1: tokenFor(scene, g1, -1, 100), g2: tokenFor(scene, g2, -1, 100), orc: tokenFor(scene, orc, -1, 300) };
  const combatant = token => ({ actor: token.actor, token, tokenId: token.id, sceneId: "s", defeated: false });
  const combat = { id: "c1", started: true, round: 2, scene, combatants: new FakeCollection(Object.entries(tokens).map(([k, t]) => [k, combatant(t)])) };
  return { scene, pc, g1, g2, orc, tokens, combat };
}
const ended = t => Hooks.callAll("dnd5e-combat.combatEnded", { combat: t.combat, scene: t.scene, round: 2, combatants: [],
  defeated: [t.tokens.g1, t.tokens.g2] });
const take = (t, corpse) => CONFIG.queries["darsh-loot.take"](
  { source: { kind: "corpse", uuid: corpse.uuid }, looter: t.tokens.pc.uuid, itemIds: [], coins: true }, { user: alice });
const opened = [];

beforeAll(() => {
  registerRewardsInit();
  registerRewards();
  registerEndLootInit();
  registerTake();
  RewardsWindow.show = id => { opened.push(id); return null; };
});
beforeEach(async () => {
  documents.clear();
  faults.clear();
  chat.length = 0;
  opened.length = 0;
  game.users.splice(0, game.users.length, GM, alice);
  game.users.activeGM = GM;
  game.user = { id: "gm", isGM: true, name: "MJ" };
  game.combats = new FakeCollection();
  globalThis.canvas = {};
  Object.assign(settings, { xpManage: false, xpWhen: "semi", levelingMode: "xp", operations: {}, lootWhen: "semi", lootMode: "individual",
    keepSpecial: false, pockets: true, autoTreasure: true, reach: 50, lootRules: { rules: [] } });
  await game.settings.set("darsh-loot", "rewards", { records: [] });
  registerOperations();
});

describe("end of combat — the loot part", () => {
  it("with DAS's XP off, the end of a combat still makes a record with the corpses, and opens the window", async () => {
    const t = table();
    ended(t);
    await until(() => opened.length === 1);
    const [record] = rewardsApi.records();
    expect(record.status).toBe("none");
    expect(record.loot.status).toBe("pending");
    expect(record.loot.corpses.map(c => c.key)).toEqual([t.tokens.g1.uuid, t.tokens.g2.uuid]);
    expect(opened[0]).toBe(record.id);
    expect(endLootApi.heldBy(t.tokens.g1)?.id).toBe(record.id);
    expect(endLootApi.heldBy(t.tokens.orc)).toBeNull();
  });

  it("XP and loot on: one window only, at the end of the combat", async () => {
    settings.xpManage = true;
    const t = table();
    ended(t);
    await until(() => opened.length >= 1);
    await new Promise(r => setTimeout(r, 30));
    expect(opened.length).toBe(1);
    expect(rewardsApi.records()[0]).toMatchObject({ status: "pending", loot: { status: "pending" } });
  });

  it("« first »: no loot part, nothing held, no window when XP is off", async () => {
    settings.lootWhen = "first";
    const t = table();
    ended(t);
    await new Promise(r => setTimeout(r, 30));
    expect(rewardsApi.records()).toEqual([]);
    expect(opened).toEqual([]);
    expect(endLootApi.heldBy(t.tokens.g1)).toBeNull();
  });

  it("a player cannot take from a held corpse before the GM distributes", async () => {
    const t = table();
    t.g1.system.currency = { gp: 7 };
    ended(t);
    await until(() => opened.length === 1);
    await expect(take(t, t.tokens.g1)).rejects.toThrow("DLO.EndLoot.Held");
    expect(t.pc.system.currency?.gp ?? 0).toBe(0);
  });

  it("a forced search releases the corpse: it leaves the encounter's loot, is rolled, and the GM is told", async () => {
    const t = table();
    ended(t);
    await until(() => opened.length === 1);
    const ok = await CONFIG.queries["darsh-loot.releaseCorpse"]({ key: t.tokens.g1.uuid, force: true }, { user: alice });
    expect(ok).toBe(true);
    const corpse = rewardsApi.records()[0].loot.corpses.find(c => c.key === t.tokens.g1.uuid);
    expect(corpse).toMatchObject({ include: false, released: "Alice" });
    expect(endLootApi.heldBy(t.tokens.g1)).toBeNull();
    expect(t.g1.getFlag("darsh-loot", "rolled")).toBe(true);
    expect(chat.some(m => m.flags?.["darsh-loot"]?.forced)).toBe(true);
  });

  it("a release not forced is refused, and a player with nothing on the scene cannot release", async () => {
    const t = table();
    ended(t);
    await until(() => opened.length === 1);
    await expect(CONFIG.queries["darsh-loot.releaseCorpse"]({ key: t.tokens.g1.uuid }, { user: alice })).rejects.toThrow("DLO.EndLoot.Held");
    t.scene.tokens.delete(t.tokens.pc.id);
    await expect(CONFIG.queries["darsh-loot.releaseCorpse"]({ key: t.tokens.g1.uuid, force: true }, { user: alice })).rejects.toThrow("DLO.Refus.PasAToi");
  });

  it("« Distribute » (individual): each ticked corpse is rolled, freed, the record marked; a second time is refused", async () => {
    const t = table();
    ended(t);
    await until(() => opened.length === 1);
    const id = rewardsApi.records()[0].id;
    const record = rewardsApi.record(id);
    record.loot.corpses[1].include = false;
    await rewardsApi.update(id, { loot: record.loot });
    const done = await endLootApi.distribute(id);
    expect(done).toMatchObject({ mode: "individual", corpses: 1, chest: null });
    expect(t.g1.getFlag("darsh-loot", "rolled")).toBe(true);
    expect(t.g2.getFlag("darsh-loot", "rolled")).toBeFalsy();
    expect(rewardsApi.record(id).loot).toMatchObject({ status: "done", mode: "individual", done: { by: "MJ", corpses: [t.tokens.g1.uuid] } });
    expect(endLootApi.heldBy(t.tokens.g1)).toBeNull();
    expect(chat.some(m => m.flags?.["darsh-loot"]?.endLoot === id)).toBe(true);
    await expect(CONFIG.queries["darsh-loot.endLoot"]({ id }, { user: GM })).rejects.toThrow("DLO.EndLoot.Already");
  });

  it("a player cannot distribute", async () => {
    const t = table();
    ended(t);
    await until(() => opened.length === 1);
    const id = rewardsApi.records()[0].id;
    await expect(CONFIG.queries["darsh-loot.endLoot"]({ id }, { user: alice })).rejects.toThrow();
    expect(rewardsApi.record(id).loot.status).toBe("pending");
  });

  it("« keep the special weapon »: the NPC's gear weapons are marked to leave as they are", async () => {
    const t = table();
    t.g1.items.set("cim", { id: "cim", type: "weapon", system: { properties: new Set(["gear"]) }, getFlag: () => undefined });
    let marked = null;
    t.g1.updateEmbeddedDocuments = async (type, updates) => { marked = updates; return []; };
    ended(t);
    await until(() => opened.length === 1);
    const id = rewardsApi.records()[0].id;
    await endLootApi.distribute(id, { keepSpecial: true });
    expect(marked).toEqual([{ _id: "cim", "flags.dnd5e.gear.preserve": true }]);
  });

  it("« auto »: distributed at the end of the combat, no window", async () => {
    settings.lootWhen = "auto";
    const t = table();
    ended(t);
    await until(() => rewardsApi.records()[0]?.loot?.status === "done");
    expect(opened).toEqual([]);
    expect(t.g1.getFlag("darsh-loot", "rolled")).toBe(true);
  });

  it("« set aside »: the corpses are free again", async () => {
    const t = table();
    ended(t);
    await until(() => opened.length === 1);
    const id = rewardsApi.records()[0].id;
    expect(endLootApi.heldBy(t.tokens.g1)).not.toBeNull();
    await rewardsHandlers().dismiss(id);
    expect(endLootApi.heldBy(t.tokens.g1)).toBeNull();
  });
});

/** The window's handlers, as runtime/rewards.mjs gives them to `RewardsWindow.show`. */
function rewardsHandlers() {
  let captured = null;
  const show = RewardsWindow.show;
  RewardsWindow.show = (id, handlers) => { captured = handlers; return null; };
  rewardsApi.open();
  RewardsWindow.show = show;
  return captured;
}
