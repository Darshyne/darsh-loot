/**
 * Lot 2 — XP rewards (2026-11-27). The pure rules (division, remainder, DMG challenge budgets, level-up), then the GM side on the
 * fake Foundry of tests/fake-foundry.mjs: the encounter record made at the end of a combat, each mode of `xpWhen`, an award that
 * breaks half-way gives every XP back, « already given » can be forced, a player cannot give XP, `noxp` keeps everything silent.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { installFakeFoundry, FakeActor, FakeCollection, documents, faults, chat, settings } from "./fake-foundry.mjs";
import {
  splitXP, levelSpan, challengeXP, isDefeated, pendingXP, pruneRecords, levelForXP, canLevelUp
} from "../module/scripts/core/xp.mjs";
import { isForceable } from "../module/scripts/core/force.mjs";

installFakeFoundry();
Object.assign(foundry.utils, { deepClone: value => structuredClone(value) });
const { registerRewardsInit, registerRewards, rewardsApi } = await import("../module/scripts/runtime/rewards.mjs");
const { registerOperations } = await import("../module/scripts/runtime/operations.mjs");
const { RewardsWindow } = await import("../module/scripts/apps/rewards-window.mjs");

const LEVELS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000,
  265000, 305000, 355000];
const BUDGET = [[0, 0, 0], [50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100]];

const GM = { id: "gm", isGM: true, name: "MJ", active: true, isSelf: true };
const alice = { id: "uA", isGM: false, name: "Alice", active: true };
const award = (payload, user=GM) => CONFIG.queries["darsh-loot.awardXP"](payload, { user });
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

describe("splitXP — equal shares (DMG)", () => {
  const three = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("100 XP between 3: 33 each, 1 to the party's pool", () => {
    expect(splitXP(100, three)).toEqual({ total: 100, shares: { a: 33, b: 33, c: 33 }, toParty: 1, lost: 0, allies: 0 });
  });
  it("the remainder is lost when asked", () => {
    expect(splitXP(100, three, { remainder: "lost" })).toMatchObject({ toParty: 0, lost: 1 });
  });
  it("an NPC ally counts as a share and receives nothing: its share is lost", () => {
    expect(splitXP(400, three, { allies: 1 })).toEqual({ total: 400, shares: { a: 100, b: 100, c: 100 }, toParty: 0, lost: 100, allies: 100 });
  });
  it("nothing is created or lost, whatever the mode", () => {
    const people = [{ id: "a", span: 600, weight: 1 }, { id: "b", span: 1800, weight: 0.5 }, { id: "c", span: 3800, weight: 2 }];
    for ( const mode of ["equal", "level", "weight"] ) for ( const allies of [0, 1, 2] ) for ( const remainder of ["party", "lost"] ) {
      for ( const total of [0, 1, 7, 100, 1234, 99999] ) {
        const s = splitXP(total, people, { mode, allies, remainder });
        const given = Object.values(s.shares).reduce((a, b) => a + b, 0);
        expect(given + s.toParty + s.lost, `${mode} ${allies} ${remainder} ${total}`).toBe(total);
      }
    }
  });
  it("garbage in: negative or fractional XP, nobody", () => {
    expect(splitXP(-50, three).total).toBe(0);
    expect(splitXP(10.9, [{ id: "a" }]).shares.a).toBe(10);
    expect(splitXP(100, [])).toMatchObject({ toParty: 0, lost: 100 });
  });
});

describe("splitXP — house options", () => {
  it("same progression: each share in proportion to the XP span of the current level", () => {
    // Level 2 (span 600) and level 4 (span 3800): 4400 XP → 600 and 3800, the same fraction of a level for both.
    const s = splitXP(4400, [{ id: "low", span: levelSpan(2, LEVELS) }, { id: "high", span: levelSpan(4, LEVELS) }], { mode: "level" });
    expect(s.shares).toEqual({ low: 600, high: 3800 });
  });
  it("coefficients: 0 receives nothing, 2 receives double", () => {
    const s = splitXP(300, [{ id: "a", weight: 1 }, { id: "b", weight: 2 }, { id: "c", weight: 0 }], { mode: "weight" });
    expect(s.shares).toEqual({ a: 100, b: 200, c: 0 });
  });
  it("every coefficient at 0: everything is lost, nothing crashes", () => {
    expect(splitXP(300, [{ id: "a", weight: 0 }], { mode: "weight" })).toMatchObject({ shares: { a: 0 }, lost: 300 });
  });
});

describe("DMG budgets, defeat, records, level-up", () => {
  it("a challenge is worth the XP budget per character of the party's level × the characters", () => {
    expect(challengeXP([3, 3, 3, 3], "moderate", BUDGET)).toBe(900);
    expect(challengeXP([1, 2], "high", BUDGET)).toBe(400);   // average 1.5 → level 2 → 200 × 2
    expect(challengeXP([], "low", BUDGET)).toBe(0);
  });
  it("defeated = dead, marked defeated, or out of hit points", () => {
    expect(isDefeated({ dead: true })).toBe(true);
    expect(isDefeated({ defeated: true })).toBe(true);
    expect(isDefeated({ hp: 0 })).toBe(true);
    expect(isDefeated({ hp: 3 })).toBe(false);
    expect(isDefeated({})).toBe(false);
  });
  it("pending XP: ticked and not yet given, plus the bonus; « per kill » takes one foe and no bonus", () => {
    const record = { bonus: 50, foes: [{ key: "a", xp: 100, include: true }, { key: "b", xp: 200, include: true, awarded: true },
      { key: "c", xp: 400, include: false }] };
    expect(pendingXP(record).xp).toBe(150);
    expect(pendingXP(record, { again: true }).xp).toBe(350);
    expect(pendingXP(record, { only: ["a"] })).toMatchObject({ xp: 100, bonus: 0 });
  });
  it("records: the pending ones are always kept, then the most recent", () => {
    const records = [{ id: "p", status: "pending", time: 0 }, ...Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, status: "awarded", time: i }))];
    const kept = pruneRecords(records, 5);
    expect(kept.map(r => r.id)).toEqual(["p", "d25", "d26", "d27", "d28", "d29"]);
  });
  it("level-up: only when a threshold is newly crossed above the current level", () => {
    expect(levelForXP(299, LEVELS)).toBe(1);
    expect(levelForXP(300, LEVELS)).toBe(2);
    expect(canLevelUp({ level: 1, before: 250, after: 320 }, LEVELS)).toBe(true);
    expect(canLevelUp({ level: 1, before: 320, after: 400 }, LEVELS)).toBe(false);
    expect(canLevelUp({ level: 3, before: 250, after: 320 }, LEVELS)).toBe(false);
  });
});

/* -------------------------------------------- */
/*  The GM side                                 */
/* -------------------------------------------- */

function character(id, name, level, xp, owners=[]) {
  const a = new FakeActor({ id, name, owners });
  a.hasPlayerOwner = !!owners.length;
  a.img = `${id}.webp`;
  a.system.details = { level, xp: { value: xp } };
  return a;
}
function npc(id, name, xp, { dead=false, hp=10 }={}) {
  const a = new FakeActor({ id, name, type: "npc" });
  a.img = `${id}.webp`;
  a.system.details = { xp: { value: xp }, cr: 1 };
  a.system.attributes.hp.value = hp;
  if ( dead ) a.statuses.add("dead");
  return a;
}
function tokenFor(scene, actor, disposition) {
  const token = { id: `t-${actor.id}`, uuid: `Scene.s.Token.t-${actor.id}`, documentName: "Token", name: actor.name, parent: scene,
    actor, actorId: actor.id, actorLink: true, disposition, flags: {}, getFlag: () => undefined };
  scene.tokens.set(token.id, token);
  documents.set(token.uuid, token);
  return token;
}

/** Three characters (one absent), a group with an XP pool, a combat against two goblins (one dead) and an orc (fled), an NPC ally. */
function table() {
  const scene = { id: "s", name: "Crypte", tokens: new FakeCollection() };
  game.scenes = new FakeCollection([["s", scene]]);
  const pcs = [character("pc0", "Clerc", 1, 250, ["uA"]), character("pc1", "Guerrier", 1, 0), character("pc2", "Mage", 1, 0)];
  const party = new FakeActor({ id: "party", name: "Groupe", type: "group" });
  party.system.details = { xp: { value: 0 } };
  party.system.playerCharacters = pcs;
  game.actors.party = party;
  game.actors.filter = fn => pcs.filter(fn);
  const goblins = [npc("g1", "Gobelin 1", 50, { dead: true, hp: 0 }), npc("g2", "Gobelin 2", 50, { hp: 0 })];
  const orc = npc("orc", "Orc", 100);
  const guard = npc("guard", "Garde allié", 25);
  const tokens = {
    pc0: tokenFor(scene, pcs[0], 1), pc1: tokenFor(scene, pcs[1], 1),
    g1: tokenFor(scene, goblins[0], -1), g2: tokenFor(scene, goblins[1], -1), orc: tokenFor(scene, orc, -1), guard: tokenFor(scene, guard, 1)
  };
  const combatant = (token, extra={}) => ({ actor: token.actor, token, tokenId: token.id, sceneId: "s", defeated: false, ...extra });
  const combat = { id: "c1", started: true, round: 3, scene, combatants: new FakeCollection(
    Object.entries(tokens).map(([k, t]) => [k, combatant(t)])) };
  return { scene, pcs, party, goblins, orc, guard, tokens, combat };
}

const xp = actors => actors.map(a => a.system.details.xp.value);
const opened = [];

beforeAll(() => {
  registerRewardsInit();
  registerRewards();
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
  globalThis.dnd5e = undefined;
  CONFIG.DND5E.CHARACTER_EXP_LEVELS = LEVELS;
  CONFIG.DND5E.ENCOUNTER_DIFFICULTY = BUDGET;
  Object.assign(settings, { xpManage: true, xpToolbar: true, xpWhen: "semi", xpSplit: "equal", xpRemainder: "party", xpRecipients: "present", levelingMode: "xp", operations: {} });
  await game.settings.set("darsh-loot", "rewards", { records: [] });
  registerOperations();
});

describe("end of combat — the encounter record", () => {
  it("semi-automatic (default): the record is kept and the window opens on it; nothing is given yet", async () => {
    const t = table();
    Hooks.callAll("deleteCombat", t.combat);
    await until(() => opened.length);
    const [record] = rewardsApi.records();
    expect(opened).toEqual([record.id]);
    expect(record.status).toBe("pending");
    expect(record.foes.map(f => [f.name, f.defeated, f.include])).toEqual([["Gobelin 1", true, true], ["Gobelin 2", true, true], ["Orc", false, false]]);
    expect(record.members.map(m => [m.name, m.present, m.include])).toEqual([["Clerc", true, true], ["Guerrier", true, true], ["Mage", false, false]]);
    expect(record.allies.map(a => [a.name, a.include])).toEqual([["Garde allié", true]]);
    expect(xp(t.pcs)).toEqual([250, 0, 0]);
  });

  it("the record survives a reload: it is a world setting, the window is only a view", async () => {
    const t = table();
    Hooks.callAll("deleteCombat", t.combat);
    await until(() => opened.length);
    const stored = game.settings.get("darsh-loot", "rewards");
    expect(stored.records).toHaveLength(1);
    expect(stored.records[0].combat).toBe("c1");
  });

  it("a combat with nobody hostile, or never begun, makes no record", async () => {
    const t = table();
    t.combat.combatants = new FakeCollection([["pc0", { actor: t.pcs[0], token: t.tokens.pc0 }]]);
    Hooks.callAll("deleteCombat", t.combat);
    Hooks.callAll("deleteCombat", { ...table().combat, started: false, round: 0 });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(rewardsApi.records()).toEqual([]);
  });

  it("automatic: given at once — 100 XP between the two who fought and the ally, the ally's share lost; a public card", async () => {
    const t = table();
    settings.xpWhen = "auto";
    Hooks.callAll("deleteCombat", t.combat);
    await until(() => chat.length);
    expect(xp(t.pcs)).toEqual([250 + 33, 33, 0]);
    expect(t.party.system.details.xp.value).toBe(1);
    const [record] = rewardsApi.records();
    expect(record.status).toBe("awarded");
    expect(record.foes.filter(f => f.awarded).map(f => f.name)).toEqual(["Gobelin 1", "Gobelin 2"]);
    expect(chat[0].content).toContain("Rewards.Card");
    expect(chat[0].flags["darsh-loot"].feedback.also).toHaveLength(1);   // floats over the two characters on the scene
  });

  it("manual: the record is kept, no window, nothing given", async () => {
    const t = table();
    settings.xpWhen = "manual";
    Hooks.callAll("deleteCombat", t.combat);
    await until(() => rewardsApi.records().length);
    expect(opened).toEqual([]);
    expect(xp(t.pcs)).toEqual([250, 0, 0]);
  });

  it("dnd5e levels up without XP: nothing happens", async () => {
    const t = table();
    settings.levelingMode = "noxp";
    settings.xpWhen = "auto";
    Hooks.callAll("deleteCombat", t.combat);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(rewardsApi.records()).toEqual([]);
    expect(xp(t.pcs)).toEqual([250, 0, 0]);
  });
});

describe("the switches (user's requests of 2026-11-27)", () => {
  it("DAS's XP is off by default: no record, no window, a request refused, nothing written", async () => {
    const t = table();
    settings.xpManage = false;
    settings.xpWhen = "auto";
    Hooks.callAll("deleteCombat", t.combat);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(rewardsApi.records()).toEqual([]);
    expect(rewardsApi.open()).toBe(null);
    expect(opened).toEqual([]);
    await expect(award({ id: "x" })).rejects.toThrow("Rewards.Off.das");
    expect(xp(t.pcs)).toEqual([250, 0, 0]);
  });
  it("the toolbar button follows its setting; the others stay", () => {
    const controls = () => { const c = { tokens: { tools: { select: {} } } }; Hooks.callAll("getSceneControlButtons", c); return c.tokens.tools; };
    expect(controls().dloRewards).toBeTruthy();
    settings.xpToolbar = false;
    expect(controls().dloRewards).toBeUndefined();
    settings.xpToolbar = true;
    settings.xpManage = false;
    expect(controls().dloRewards).toBeUndefined();
  });
});

describe("per kill", () => {
  it("each hostile creature's XP is given as it dies, never twice; the rest at the end of the combat", async () => {
    const t = table();
    settings.xpWhen = "kill";
    game.combats.set("c1", t.combat);
    // Gobelin 1 dies (the Core's `dead` status): 50 XP between Clerc, Guerrier and the ally → 16 each, 2 to the pool.
    Hooks.callAll("createActiveEffect", { statuses: new Set(["dead"]), parent: Object.assign(t.goblins[0], { token: t.tokens.g1 }) });
    await until(() => chat.length === 1);
    expect(xp(t.pcs)).toEqual([266, 16, 0]);
    // The same death seen again (raised then killed): nothing more.
    Hooks.callAll("updateCombatant", t.combat.combatants.get("g1"), { defeated: true });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(chat).toHaveLength(1);
    // End of combat: Gobelin 2 (0 hp, not marked) is given now.
    Hooks.callAll("deleteCombat", t.combat);
    await until(() => chat.length === 2);
    expect(xp(t.pcs)).toEqual([282, 32, 0]);
    expect(rewardsApi.records()[0].status).toBe("awarded");
  });
});

describe("giving from the window (the request)", () => {
  async function recorded() {
    const t = table();
    settings.xpWhen = "manual";
    Hooks.callAll("deleteCombat", t.combat);
    await until(() => rewardsApi.records().length);
    return { ...t, id: rewardsApi.records()[0].id };
  }

  it("the preview is what is given; dnd5e's Award writes the XP when it is there", async () => {
    const t = await recorded();
    const calls = [];
    globalThis.dnd5e = { applications: { Award: { awardXP: async (amount, [actor]) => { calls.push([actor.name, amount]);
      await actor.update({ "system.details.xp.value": actor.system.details.xp.value + amount }); } } } };
    const preview = rewardsApi.preview(t.id);
    const done = await award({ id: t.id });
    expect(done.shares.map(s => [s.name, s.xp])).toEqual(preview.shares.map(s => [s.name, s.xp]));
    expect(calls).toEqual([["Clerc", 33], ["Guerrier", 33], ["Groupe", 1]]);
  });

  it("Clerc crosses 300 XP: the card says he can level up", async () => {
    const t = await recorded();
    t.pcs[0].system.details.xp.value = 280;
    const done = await award({ id: t.id });
    expect(done.shares.find(s => s.name === "Clerc").levelUp).toBe(true);
    expect(done.shares.find(s => s.name === "Guerrier").levelUp).toBe(false);
    expect(chat[0].content).toContain("Rewards.CardLevelUp");
  });

  it("a bonus (noncombat challenge) is added once, then cleared", async () => {
    const t = await recorded();
    await rewardsApi.update(t.id, { bonus: 200, reason: "Négociation" });
    await award({ id: t.id });
    // 100 XP of goblins + 200 of bonus = 300, three shares (the ally takes one).
    expect(xp(t.pcs)).toEqual([350, 100, 0]);
    expect(rewardsApi.record(t.id).bonus).toBe(0);
  });

  it("« already given » is a refusal the GM may force; forced, it is given again", async () => {
    const t = await recorded();
    await award({ id: t.id });
    const again = await award({ id: t.id }).catch(err => err);
    expect(isForceable(again.message)).toBe(true);
    await award({ id: t.id, force: true });
    expect(xp(t.pcs)).toEqual([250 + 66, 66, 0]);
  });

  it("a write that fails half-way gives every XP back and keeps the record pending", async () => {
    const t = await recorded();
    faults.fail("update", doc => doc.name === "Guerrier");
    const err = await award({ id: t.id }).catch(e => e);
    expect(err?.name).toBe("OperationError");
    expect(xp(t.pcs)).toEqual([250, 0, 0]);
    expect(t.party.system.details.xp.value).toBe(0);
    expect(rewardsApi.record(t.id).status).toBe("pending");
  });

  it("nobody ticked, nothing ticked, a player asking, XP switched off: refused, nothing written", async () => {
    const t = await recorded();
    const record = rewardsApi.record(t.id);
    await rewardsApi.update(t.id, { members: record.members.map(m => ({ ...m, include: false })) });
    await expect(award({ id: t.id })).rejects.toThrow("Rewards.NoOne");
    await rewardsApi.update(t.id, { members: record.members, foes: record.foes.map(f => ({ ...f, include: false })) });
    await expect(award({ id: t.id })).rejects.toThrow("Rewards.Nothing");
    await rewardsApi.update(t.id, { foes: record.foes });
    await expect(award({ id: t.id }, alice)).rejects.toThrow("Rewards.GMOnly");
    settings.levelingMode = "noxp";
    await expect(award({ id: t.id })).rejects.toThrow("Rewards.Off.dnd5e");
    expect(xp(t.pcs)).toEqual([250, 0, 0]);
  });

  it("same progression and coefficients from the record; without a primary party the remainder is lost", async () => {
    const t = await recorded();
    t.pcs[1].system.details.level = 2;   // span 600 against 300
    await rewardsApi.update(t.id, { split: "level", allies: [] });
    expect(rewardsApi.preview(t.id).shares.map(s => s.xp)).toEqual([33, 66]);
    const record = rewardsApi.record(t.id);
    await rewardsApi.update(t.id, { split: "weight", members: record.members.map(m => ({ ...m, weight: m.name === "Clerc" ? 3 : 1 })) });
    expect(rewardsApi.preview(t.id).shares.map(s => s.xp)).toEqual([75, 25]);
    game.actors.party = null;
    await rewardsApi.update(t.id, { split: "equal" });
    expect(rewardsApi.preview(t.id)).toMatchObject({ remainder: "lost", toParty: 0 });
  });
});
