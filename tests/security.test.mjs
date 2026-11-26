/**
 * Les requêtes au MJ ne font que ce que l'expéditeur a le droit de demander (journal, 2026-11-18) : chaque test l'envoie depuis un
 * joueur. Joués sur le faux Foundry de tests/fake-foundry.mjs.
 *
 * Lot 0 (audit of 2026-11-26, defects 10–19), second half of this file: the checks the GM client was missing. Every request is
 * sent as a player would send a crafted one; the GM client must refuse what the player's own interface would never have offered.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { installFakeFoundry, FakeActor, FakeCollection, documents, settings } from "./fake-foundry.mjs";

installFakeFoundry();
const { transfer, tokenDistance } = await import("../module/scripts/adapter/dnd5e.mjs");
const { moveItem } = await import("../module/scripts/adapter/drop.mjs");
const { livingNPC } = await import("../module/scripts/adapter/theft.mjs");
const { waresView } = await import("../module/scripts/adapter/shop.mjs");
const { merchantSource } = await import("../module/scripts/adapter/sources.mjs");
const { registerTake } = await import("../module/scripts/runtime/take.mjs");
const { registerTheft } = await import("../module/scripts/runtime/theft.mjs");
const { registerTradeInit } = await import("../module/scripts/runtime/trade.mjs");
const { registerShopInit, showShop } = await import("../module/scripts/runtime/shop.mjs");
const { registerMechanismsInit } = await import("../module/scripts/runtime/mechanisms.mjs");
const { registerHiddenInit } = await import("../module/scripts/runtime/hidden.mjs");

const GM = { id: "gm", isGM: true, name: "MJ", active: true, isSelf: true };
const PLAYER = { id: "joueur", isGM: false, name: "Joueur" };
// Two connected players; what the GM client sends them (trade states) is kept.
const states = { uA: [], uB: [] };
const player = id => ({ id, isGM: false, name: id, active: true, isSelf: false, query: async (_n, state) => { states[id]?.push(state); return true; } });
const alice = player("uA"), bob = player("uB");
const rope = { _id: "corde", name: "Corde", type: "loot", system: { quantity: 2, price: { value: 10, denomination: "gp" }, properties: ["gear"] } };
const sword = { _id: "epee", name: "Épée longue", type: "weapon", system: { quantity: 1, properties: ["gear"] } };
const take = (payload, user=PLAYER) => CONFIG.queries["darsh-loot.take"](payload, { user });

beforeAll(() => {
  registerTake();
  registerTheft();
  registerTradeInit();
  registerShopInit();
  try { registerMechanismsInit(); } catch { /* la feuille de réglages n'existe pas ici : seule la requête compte */ }
  try { registerHiddenInit(); } catch { /* idem */ }
});
beforeEach(() => {
  documents.clear();
  states.uA.length = 0;
  states.uB.length = 0;
  game.users.splice(0, game.users.length, GM, alice, bob);
  game.users.activeGM = GM;
  game.user = { id: "gm", isGM: true, name: "MJ" };
  globalThis.canvas = {};
  delete CONFIG.Canvas;
});

/** Une scène de 5 ft par case, et un token posé dessus pour `actor`. */
function scene() {
  return { name: "Scène", tokens: new FakeCollection(), regions: new FakeCollection(), grid: { size: 100, distance: 5 } };
}
function tokenOn(where, actor, x, { level=null, elevation=0 }={}) {
  const token = { id: `t-${actor.id}`, uuid: `Scene.s.Token.t-${actor.id}`, documentName: "Token", name: actor.name, parent: where,
    actor, flags: {}, getFlag: () => undefined, _source: { x, y: 0, width: 1, height: 1, elevation, level } };
  where.tokens.set(token.id, token);
  documents.set(token.uuid, token);
  return token;
}

describe("un id répété ne duplique pas l'objet", () => {
  it("[id, id, id] ne donne qu'un objet", async () => {
    const corpse = new FakeActor({ id: "mort", name: "Garde", type: "npc", items: [sword] });
    const pc = new FakeActor({ id: "pj", name: "Clerc" });
    const taken = await transfer(corpse, pc, { itemIds: ["epee", "epee", "epee"] });
    expect(pc.count(sword.name)).toBe(1);
    expect(corpse.items.size).toBe(0);
    expect(taken.names).toEqual([sword.name]);
  });
});

describe("on ne prend que dans un cadavre ou un conteneur", () => {
  it("la boutique d'un marchand (son acteur, sans portée) : refusée au joueur, rien ne bouge", async () => {
    const shop = new FakeActor({ id: "marchand", name: "Marchand", type: "npc", currency: { gp: 500 }, items: [sword],
      flags: { "darsh-loot": { merchant: { enabled: true } } } });
    const pc = new FakeActor({ id: "pj", name: "Roublard", owners: [PLAYER.id] });
    const looter = tokenOn(scene(), pc, 0);
    await expect(take({ source: { kind: "merchant", uuid: shop.uuid }, looter: looter.uuid, itemIds: ["epee"], coins: true }))
      .rejects.toThrow("DLO.Refus.Introuvable");
    expect(shop.items.size).toBe(1);
    expect(shop.system.currency.gp).toBe(500);
    expect(pc.count(sword.name)).toBe(0);
  });

  it("les poches d'un PNJ vivant à côté : refusées au joueur (le vol passe par `steal`)", async () => {
    const where = scene();
    const npc = new FakeActor({ id: "pnj", name: "Garde", type: "npc", currency: { gp: 50 }, items: [sword] });
    const pc = new FakeActor({ id: "pj", name: "Roublard", owners: [PLAYER.id] });
    const victim = tokenOn(where, npc, 100);
    const looter = tokenOn(where, pc, 0);
    await expect(take({ source: { kind: "pocket", uuid: victim.uuid }, looter: looter.uuid, itemIds: ["epee"], coins: true }))
      .rejects.toThrow("DLO.Refus.Introuvable");
    expect(npc.items.size).toBe(1);
    expect(npc.system.currency.gp).toBe(50);
  });
});

describe("seul un MJ fait lancer des macros chez un autre", () => {
  const macroQuery = () => CONFIG.queries["darsh-loot.mechanismMacros"];

  it("la requête existe sur ce client", () => expect(typeof macroQuery()).toBe("function"));

  it("envoyée par un joueur : refusée, la macro ne part pas", async () => {
    let ran = false;
    globalThis.__ranMacro = () => { ran = true; };
    documents.set("Macro.m", { uuid: "Macro.m", documentName: "Macro", name: "piège", type: "script", command: "globalThis.__ranMacro();" });
    expect(await macroQuery()({ macros: ["Macro.m"] }, { user: PLAYER })).toBe(false);
    expect(await macroQuery()({ macros: ["Macro.m"] }, {})).toBe(false);
    expect(ran).toBe(false);
  });
});

describe("seul un MJ arrête les déplacements des autres", () => {
  const halt = () => CONFIG.queries["darsh-loot.halt"];

  it("la requête existe sur ce client", () => expect(typeof halt()).toBe("function"));

  it("envoyée par un joueur : refusée, rien ne s'arrête", () => {
    const where = scene();
    documents.set("Scene.s", where);
    expect(halt()({ scene: "Scene.s" }, { user: PLAYER })).toBe(false);
  });
});

/* -------------------------------------------- */
/*  Lot 0 — checks the GM client was missing    */
/* -------------------------------------------- */

/** Walls of the viewed scene: vertical lines at these x; the core's collision test says whether a segment crosses one. */
function wallsAt(where, ...xs) {
  globalThis.canvas = { scene: where };
  CONFIG.Canvas = { polygonBackends: { sight: { testCollision: (a, b) => xs.some(x => (Math.min(a.x, b.x) < x) && (x < Math.max(a.x, b.x))) } } };
}
const merchantActor = (items=[rope]) => new FakeActor({ id: "m", name: "Marchand", type: "npc", currency: { gp: 100 }, items,
  flags: { "darsh-loot": { merchant: { enabled: true } } } });

describe("defect 10 — a merchant addressed by its actor", () => {
  const deal = (source, looter, user=alice) => CONFIG.queries["darsh-loot.shopDeal"](
    { source, looter, buy: [{ id: "corde", quantity: 1 }], sell: [] }, { user });

  it("a shop the GM has not shown: a player cannot trade with it from anywhere", async () => {
    const merchant = merchantActor();
    const pc = new FakeActor({ id: "pj", name: "Clerc", currency: { gp: 50 }, owners: ["uA"] });
    await expect(deal({ kind: "merchant", uuid: merchant.uuid }, pc.uuid)).rejects.toThrow("DLO.Shop.NotShown");
    expect([pc.system.currency.gp, pc.count("Corde"), merchant.count("Corde")]).toEqual([50, 0, 2]);
  });

  it("the merchant has a token on the scene: its actor is no way round the reach", async () => {
    const where = scene();
    const merchant = merchantActor();
    tokenOn(where, merchant, 2000);
    const pc = new FakeActor({ id: "pj", name: "Clerc", currency: { gp: 50 }, owners: ["uA"] });
    const looter = tokenOn(where, pc, 0);
    await expect(deal({ kind: "merchant", uuid: merchant.uuid }, looter.uuid)).rejects.toThrow("DLO.Shop.NotShown");
    expect(pc.system.currency.gp).toBe(50);
  });

  it("once the GM has shown the shop, the players it was shown to can trade", async () => {
    const merchant = merchantActor();
    const pc = new FakeActor({ id: "pj", name: "Clerc", currency: { gp: 50 }, owners: ["uA"] });
    await showShop(merchantSource(merchant));
    await deal({ kind: "merchant", uuid: merchant.uuid }, pc.uuid);
    expect([pc.system.currency.gp, pc.count("Corde")]).toEqual([40, 1]);
  });

  it("a merchant token with a character given without its token: refused, not a crash", async () => {
    const where = scene();
    const merchant = merchantActor();
    const stall = tokenOn(where, merchant, 100);
    const pc = new FakeActor({ id: "pj", name: "Clerc", currency: { gp: 50 }, owners: ["uA"] });
    await expect(deal({ kind: "merchant", uuid: stall.uuid }, pc.uuid)).rejects.toThrow("DLO.Shop.TooFar");
    expect(pc.system.currency.gp).toBe(50);
  });
});

describe("defects 11–13 — trades", () => {
  const query = name => CONFIG.queries[`darsh-loot.trade${name}`];
  const rev = () => states.uA.at(-1).rev;

  async function open(aItems=[], bItems=[]) {
    const a = new FakeActor({ id: "a", name: "Alice", type: "character", currency: { gp: 100 }, items: aItems, owners: ["uA"] });
    const b = new FakeActor({ id: "b", name: "Bob", type: "character", currency: { gp: 10 }, items: bItems, owners: ["uB"] });
    const { id } = await query("Open")({ from: a.uuid, to: b.uuid }, { user: alice });
    return { id, a, b };
  }

  it("defect 11 — agreeing to an offer that has changed since it was shown is refused", async () => {
    const { id, a, b } = await open();
    await query("Update")({ id, offer: { items: [], coins: { gp: 5 } } }, { user: alice });
    const seenByBob = rev();
    await query("Accept")({ id, value: true, rev: rev() }, { user: alice });
    // Alice raises her side to nothing at all just before Bob clicks: he would be agreeing to what he has not seen.
    await query("Update")({ id, offer: { items: [], coins: { gp: 1 } } }, { user: alice });
    await expect(query("Accept")({ id, value: true, rev: seenByBob }, { user: bob })).rejects.toThrow("DLO.Trade.Changed");
    await expect(query("Accept")({ id, value: true }, { user: bob })).rejects.toThrow("DLO.Trade.Changed");
    expect([a.system.currency.gp, b.system.currency.gp]).toEqual([100, 10]);
    await query("Accept")({ id, value: true, rev: rev() }, { user: bob });
    await query("Accept")({ id, value: true, rev: rev() }, { user: alice });
    expect([a.system.currency.gp, b.system.currency.gp]).toEqual([99, 11]);
  });

  it("defect 12 — only physical, unequipped items can be offered; the player is told what was left out", async () => {
    const spell = { _id: "sort", name: "Boule de feu", type: "spell", system: {} };
    const feat = { _id: "don", name: "Robuste", type: "feat", system: {} };
    const worn = { _id: "armure", name: "Cotte de mailles", type: "equipment", system: { quantity: 1, equipped: true } };
    const { id } = await open([sword, spell, feat, worn]);
    const answer = await query("Update")({ id, offer: { items: ["epee", "sort", "don", "armure"].map(i => ({ id: i, quantity: 1 })), coins: {} } },
      { user: alice });
    expect(states.uA.at(-1).a.items.map(i => i.id)).toEqual(["epee"]);
    expect(answer.left.sort()).toEqual(["Boule de feu", "Cotte de mailles", "Robuste"]);
  });

  it("defect 13 — the other side must be a player character", async () => {
    const a = new FakeActor({ id: "a", name: "Alice", type: "character", owners: ["uA"] });
    const npc = new FakeActor({ id: "pnj", name: "Marchand", type: "npc", currency: { gp: 500 } });
    await expect(query("Open")({ from: a.uuid, to: npc.uuid }, { user: alice })).rejects.toThrow("DLO.Trade.Impossible");
    await expect(query("Open")({ from: a.uuid, to: a.uuid }, { user: alice })).rejects.toThrow("DLO.Trade.Impossible");
  });
});

describe("defect 14 — an item that changes hands is no longer attuned", () => {
  const ring = { _id: "anneau", name: "Anneau", type: "equipment", system: { quantity: 1, equipped: true, attuned: true, attunement: "required" } };

  it("given from one character to another", async () => {
    const a = new FakeActor({ id: "a", name: "Alice", items: [ring] });
    const b = new FakeActor({ id: "b", name: "Bob" });
    await moveItem(a, b, "anneau", 1);
    const got = b.items.find(i => i.name === "Anneau");
    expect([got.system.attuned, got.system.equipped, got.system.attunement]).toEqual([false, false, "required"]);
  });

  it("taken from a chest", async () => {
    const chest = new FakeActor({ id: "coffre", name: "Coffre", type: "group", items: [ring] });
    const b = new FakeActor({ id: "b", name: "Bob" });
    await transfer(chest, b, { itemIds: ["anneau"] });
    expect(b.items.find(i => i.name === "Anneau").system.attuned).toBe(false);
  });
});

describe("defect 15 — stolen goods hidden in a bag", () => {
  const stolen = { from: "Marchand", fromUuid: "Actor.m" };
  const bag = { _id: "sac", name: "Sac", type: "container", system: { quantity: 1, price: { value: 1, denomination: "gp" } } };
  const loot = (flag, container="sac") => ({ _id: "calice", name: "Calice", type: "loot",
    system: { quantity: 1, container, price: { value: 100, denomination: "gp" } }, flags: flag ? { "darsh-loot": { stolen: flag } } : {} });
  const verdictOf = (merchant, items) => waresView(new FakeActor({ id: "pj", name: "Roublard", items }), merchant)
    .find(e => e.id === "sac").verdict;

  it("the one it was stolen from refuses the bag", () => {
    expect(verdictOf(merchantActor(), [bag, loot(stolen)])).toBe("refuse");
  });

  it("a merchant who refuses stolen goods refuses the bag", () => {
    const strict = new FakeActor({ id: "m2", name: "Honnête", type: "npc", flags: { "darsh-loot": { merchant: { enabled: true, stolen: "refuse" } } } });
    expect(verdictOf(strict, [bag, loot({ from: "Autre", fromUuid: "Actor.x" })])).toBe("refuse");
  });

  it("a fence buys the whole bag at the fence rate", () => {
    const fence = new FakeActor({ id: "m3", name: "Receleur", type: "npc", flags: { "darsh-loot": { merchant: { enabled: true, stolen: "fence" } } } });
    expect(verdictOf(fence, [bag, loot({ from: "Autre", fromUuid: "Actor.x" })])).toBe("fence");
  });

  it("a bag of honest goods is an honest bag", () => {
    expect(verdictOf(merchantActor(), [bag, loot(null)])).toBe("ok");
  });
});

describe("defects 16–17 — reach is not a straight distance", () => {
  const take = (corpse, looter) => CONFIG.queries["darsh-loot.take"](
    { source: { kind: "corpse", uuid: corpse.uuid }, looter: looter.uuid, itemIds: ["epee"], coins: false }, { user: alice });
  function corpseNextTo(where, options) {
    const dead = new FakeActor({ id: "mort", name: "Garde", type: "npc", items: [sword] });
    dead.statuses.add("dead");
    const pc = new FakeActor({ id: "pj", name: "Clerc", owners: ["uA"] });
    return { dead, pc, corpse: tokenOn(where, dead, 100, options), looter: tokenOn(where, pc, 0) };
  }

  it("defect 16 — a wall between the character and the corpse: refused, nothing moves", async () => {
    const where = scene();
    const { dead, pc, corpse, looter } = corpseNextTo(where);
    wallsAt(where, 100);
    await expect(take(corpse, looter)).rejects.toThrow("DLO.Refus.Mur");
    expect([dead.count(sword.name), pc.count(sword.name)]).toEqual([1, 0]);
  });

  it("defect 16 — no wall: taken; a wall that does not hide the whole corpse does not refuse", async () => {
    const where = scene();
    const { pc, corpse, looter } = corpseNextTo(where);
    wallsAt(where, 160);   // crosses the far part of the square of the corpse only
    await take(corpse, looter);
    expect(pc.count(sword.name)).toBe(1);
  });

  it("defect 17 — tokens on two V14 levels are out of reach of each other, whatever their elevation", () => {
    const where = scene();
    const a = tokenOn(where, new FakeActor({ id: "a", name: "A" }), 0, { level: "ground", elevation: 0 });
    const b = tokenOn(where, new FakeActor({ id: "b", name: "B" }), 100, { level: "upper", elevation: 0 });
    const c = tokenOn(where, new FakeActor({ id: "c", name: "C" }), 100, { level: "ground", elevation: 0 });
    const d = tokenOn(where, new FakeActor({ id: "d", name: "D" }), 100);
    expect(tokenDistance(a, b)).toBe(Infinity);
    expect(tokenDistance(a, c)).toBe(5);
    expect(tokenDistance(a, d)).toBe(5);
  });

  it("defect 17 — a corpse on the floor above is not searched from below", async () => {
    const where = scene();
    const { dead, corpse, looter } = corpseNextTo(where, { level: "upper" });
    looter._source.level = "ground";
    await expect(take(corpse, looter)).rejects.toThrow("DLO.Refus.Loin");
    expect(dead.count(sword.name)).toBe(1);
  });
});

describe("defects 18–19 — pickpocketing", () => {
  it("defect 18 — an NPC created without hit points (0 of 0) is alive and can be robbed; at 0 of 10 it is not", () => {
    const where = scene();
    const noHp = new FakeActor({ id: "n1", name: "Passant", type: "npc" });
    noHp.system.attributes.hp = { value: 0, max: 0 };
    const down = new FakeActor({ id: "n2", name: "Assommé", type: "npc" });
    down.system.attributes.hp = { value: 0, max: 10 };
    expect(livingNPC(tokenOn(where, noHp, 0))).toBe(true);
    expect(livingNPC(tokenOn(where, down, 100))).toBe(false);
  });

  it("defect 19 — two thieves on the same item: one gets it, the other is told it is gone", async () => {
    settings.pickpocket = "on";
    const where = scene();
    const npc = new FakeActor({ id: "pnj", name: "Garde", type: "npc", items: [sword] });
    const victim = tokenOn(where, npc, 100);
    const one = tokenOn(where, new FakeActor({ id: "v1", name: "Roublard", owners: ["uA"] }), 0);
    const two = tokenOn(where, new FakeActor({ id: "v2", name: "Barde", owners: ["uB"] }), 200);
    const steal = (thief, user) => CONFIG.queries["darsh-loot.steal"](
      { source: { kind: "pocket", uuid: victim.uuid }, looter: thief.uuid, itemId: "epee", total: 30 }, { user });
    const results = await Promise.allSettled([steal(one, alice), steal(two, bob)]);
    expect(results.map(r => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find(r => r.status === "rejected").reason.message).toBe("DLO.Steal.Gone");
    expect(one.actor.count(sword.name) + two.actor.count(sword.name)).toBe(1);
  });
});
