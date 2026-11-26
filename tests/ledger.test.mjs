/**
 * Les gestes du MJ qui déplacent objets et pièces, lancés **deux à la fois** : rien ne doit se créer ni se perdre.
 * Joués sur le faux Foundry de tests/fake-foundry.mjs, dont chaque écriture arrive après un délai.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { installFakeFoundry, FakeActor, FakeCollection, documents, tick } from "./fake-foundry.mjs";

installFakeFoundry();
const { inTurn } = await import("../module/scripts/adapter/ledger.mjs");
const { transfer } = await import("../module/scripts/adapter/dnd5e.mjs");
const { moveItem } = await import("../module/scripts/adapter/drop.mjs");
const { moveCoins } = await import("../module/scripts/adapter/theft.mjs");
const { CONTAINER_TYPE } = await import("../module/scripts/adapter/container-behavior.mjs");
const { registerTake } = await import("../module/scripts/runtime/take.mjs");
const { registerTradeInit } = await import("../module/scripts/runtime/trade.mjs");
const { registerShopInit } = await import("../module/scripts/runtime/shop.mjs");

const GM = { id: "gm", isGM: true, name: "MJ" };
const sword = { _id: "epee", name: "Épée longue", type: "weapon", system: { quantity: 1 } };
const potion = (id, quantity) => ({ _id: id, name: "Potion", type: "consumable", system: { quantity },
  _stats: { compendiumSource: "Compendium.x.Item.potion" } });
const statuses = results => results.map(r => r.status).sort();

beforeAll(() => {
  registerTake();
  registerTradeInit();
  registerShopInit();
});
beforeEach(() => documents.clear());

describe("inTurn : chacun son tour", () => {
  const a = { uuid: "Actor.a" }, b = { uuid: "Actor.b" }, c = { uuid: "Actor.c" };

  it("deux gestes sur le même acteur ne se chevauchent pas, dans l'ordre d'arrivée", async () => {
    const seen = [];
    const step = name => async () => { seen.push(`${name}>`); await tick(); seen.push(`<${name}`); return name; };
    const out = await Promise.all([inTurn([a, b], step("1")), inTurn([b, c], step("2")), inTurn([c, a], step("3"))]);
    expect(out).toEqual(["1", "2", "3"]);
    expect(seen).toEqual(["1>", "<1", "2>", "<2", "3>", "<3"]);
  });

  it("deux gestes sans acteur commun avancent ensemble", async () => {
    const seen = [];
    const step = name => async () => { seen.push(`${name}>`); await tick(); seen.push(`<${name}`); };
    await Promise.all([inTurn([a], step("1")), inTurn([b], step("2"))]);
    expect(seen).toEqual(["1>", "2>", "<1", "<2"]);
  });

  it("un geste qui échoue rend son erreur et ne bloque pas le suivant", async () => {
    const failed = inTurn([a], async () => { await tick(); throw new Error("raté"); });
    const next = inTurn([a, null], async () => "suivant");
    await expect(failed).rejects.toThrow("raté");
    await expect(next).resolves.toBe("suivant");
  });
});

describe("prise (transfer)", () => {
  it("deux « Tout prendre » sur le même cadavre : l'épée et les pièces ne partent qu'une fois", async () => {
    const corpse = new FakeActor({ id: "mort", name: "Garde", type: "npc", currency: { gp: 500 },
      items: [{ ...sword, system: { quantity: 1, properties: ["gear"] } }] });
    const one = new FakeActor({ id: "pj1", name: "Clerc" });
    const two = new FakeActor({ id: "pj2", name: "Roublard" });
    const what = { itemIds: ["epee"], coins: true };
    const [first, second] = await Promise.all([transfer(corpse, one, what), transfer(corpse, two, what)]);
    expect(one.count(sword.name) + two.count(sword.name)).toBe(1);
    expect(one.system.currency.gp + two.system.currency.gp + corpse.system.currency.gp).toBe(500);
    expect(corpse.items.size).toBe(0);
    expect(first).toEqual({ names: [sword.name], coins: [{ key: "gp", value: 500 }] });
    expect(second).toEqual({ names: [], coins: [] });
  });

  it("deux prises dans le même tas : la seconde est refusée, le tas vidé n'est supprimé qu'une fois", async () => {
    const store = new FakeActor({ id: "coffre", name: "Tas", type: "group", currency: { gp: 20 }, items: [sword] });
    let deletions = 0;
    const scene = { name: "Scène", regions: new FakeCollection(), tiles: new FakeCollection() };
    const region = { id: "r1", parent: scene, behaviors: new FakeCollection(),
      getFlag: (_scope, key) => ((key === "pile") ? { tile: null } : undefined),
      async delete() { deletions++; await tick(); scene.regions.delete("r1"); } };
    const behavior = { id: "b1", uuid: "Scene.s.Region.r1.RegionBehavior.b1", type: CONTAINER_TYPE, parent: region, region,
      disabled: false, system: { actor: store.uuid, owner: "", locked: false } };
    region.behaviors.set(behavior.id, behavior);
    scene.regions.set(region.id, region);
    documents.set(behavior.uuid, behavior);
    const looters = ["pj1", "pj2"].map(id => {
      const token = { uuid: `Scene.s.Token.${id}`, name: id, parent: scene, actor: new FakeActor({ id, name: id }) };
      documents.set(token.uuid, token);
      return token;
    });
    const take = looter => CONFIG.queries["darsh-loot.take"](
      { source: { kind: "container", uuid: behavior.uuid }, looter: looter.uuid, itemIds: ["epee"], coins: true }, { user: GM });
    const results = await Promise.allSettled(looters.map(take));
    expect(statuses(results)).toEqual(["fulfilled", "rejected"]);
    expect(results.find(r => r.status === "rejected").reason.message).toBe("DLO.Refus.Introuvable");
    expect(looters.reduce((sum, t) => sum + t.actor.count(sword.name), 0)).toBe(1);
    expect(looters.reduce((sum, t) => sum + t.actor.system.currency.gp, 0)).toBe(20);
    expect(deletions).toBe(1);
  });
});

describe("déplacement (moveItem, moveCoins)", () => {
  it("le même objet donné deux fois de suite : un seul arrive, le second geste est refusé", async () => {
    const giver = new FakeActor({ id: "a", name: "Alice", items: [sword] });
    const taker = new FakeActor({ id: "b", name: "Bob" });
    const results = await Promise.allSettled([moveItem(giver, taker, "epee", 1), moveItem(giver, taker, "epee", 1)]);
    expect(statuses(results)).toEqual(["fulfilled", "rejected"]);
    expect(giver.count(sword.name) + taker.count(sword.name)).toBe(1);
    expect(taker.count(sword.name)).toBe(1);
  });

  it("deux donneurs empilent sur la même pile : aucune quantité perdue", async () => {
    const a = new FakeActor({ id: "a", name: "Alice", items: [potion("p1", 3)] });
    const c = new FakeActor({ id: "c", name: "Chloé", items: [potion("p2", 2)] });
    const b = new FakeActor({ id: "b", name: "Bob", items: [potion("p3", 1)] });
    await Promise.all([moveItem(a, b, "p1", 3), moveItem(c, b, "p2", 2)]);
    expect(b.count("Potion")).toBe(6);
    expect(a.count("Potion") + c.count("Potion")).toBe(0);
  });

  it("deux poignées de pièces prises à la même bourse : le total ne change pas", async () => {
    const victim = new FakeActor({ id: "v", name: "Victime", currency: { gp: 10 } });
    const one = new FakeActor({ id: "n1", name: "Voleur" });
    const two = new FakeActor({ id: "n2", name: "Voleuse" });
    await Promise.all([moveCoins(victim, one, { gp: 8 }), moveCoins(victim, two, { gp: 8 })]);
    expect([one.system.currency.gp, two.system.currency.gp, victim.system.currency.gp]).toEqual([8, 2, 0]);
  });
});

describe("échange entre joueurs", () => {
  const query = name => CONFIG.queries[`darsh-loot.trade${name}`];
  // The last state each player was sent: an agreement names the revision of the offers it was given on (lot 0, defect 11).
  const shown = { rev: 0 };
  const see = async (_name, state) => { if ( Number.isFinite(state?.rev) ) shown.rev = state.rev; return true; };
  const alice = { id: "uA", isGM: false, name: "A", active: true, isSelf: false, query: see };
  const bob = { id: "uB", isGM: false, name: "B", active: true, isSelf: false, query: see };

  /** Un échange ouvert par Alice, son offre posée et validée : il ne manque que la validation de Bob. */
  async function tradeAwaitingBob(offer) {
    game.users.splice(0, game.users.length, alice, bob);
    const a = new FakeActor({ id: "a", name: "Alice", currency: { gp: 100 }, items: [sword], owners: ["uA"] });
    const b = new FakeActor({ id: "b", name: "Bob", owners: ["uB"] });
    const { id } = await query("Open")({ from: a.uuid, to: b.uuid }, { user: alice });
    await query("Update")({ id, offer }, { user: alice });
    await query("Accept")({ id, value: true, rev: shown.rev }, { user: alice });
    return { id, a, b };
  }

  it("double clic sur « Valider » : les pièces ne passent qu'une fois", async () => {
    const { id, a, b } = await tradeAwaitingBob({ items: [], coins: { gp: 50 } });
    const accept = () => query("Accept")({ id, value: true, rev: shown.rev }, { user: bob });
    const results = await Promise.allSettled([accept(), accept()]);
    expect(statuses(results)).toEqual(["fulfilled", "fulfilled"]);
    expect([a.system.currency.gp, b.system.currency.gp]).toEqual([50, 50]);
  });

  it("un second « Valider » au milieu des écritures : l'épée offerte n'arrive qu'une fois", async () => {
    const { id, a, b } = await tradeAwaitingBob({ items: [{ id: "epee", quantity: 1 }], coins: { gp: 50 } });
    const first = query("Accept")({ id, value: true, rev: shown.rev }, { user: bob });
    await tick(3);
    await Promise.allSettled([first, query("Accept")({ id, value: true, rev: shown.rev }, { user: bob })]);
    expect([a.count(sword.name), b.count(sword.name)]).toEqual([0, 1]);
    expect([a.system.currency.gp, b.system.currency.gp]).toEqual([50, 50]);
  });

  it("pendant l'exécution, ni modification ni annulation ; ensuite l'échange est clos", async () => {
    const { id, a, b } = await tradeAwaitingBob({ items: [], coins: { gp: 50 } });
    const running = query("Accept")({ id, value: true, rev: shown.rev }, { user: bob });
    const more = { items: [], coins: { gp: 100 } };
    await expect(query("Update")({ id, offer: more }, { user: alice })).rejects.toThrow("DLO.Trade.Over");
    await expect(query("Cancel")({ id }, { user: alice })).resolves.toBe(true);
    await running;
    expect([a.system.currency.gp, b.system.currency.gp]).toEqual([50, 50]);
    await expect(query("Accept")({ id, value: true, rev: shown.rev }, { user: bob })).rejects.toThrow("DLO.Trade.Over");
  });
});

describe("troc chez un marchand", () => {
  // `gear` : d'un PNJ, seul l'équipement change de mains (core/loot.mjs `canLeaveOwner`).
  const rope = { _id: "corde", name: "Corde", type: "loot",
    system: { quantity: 2, price: { value: 10, denomination: "gp" }, properties: ["gear"] } };
  const merchantOf = () => new FakeActor({ id: "m", name: "Marchand", type: "npc", items: [rope],
    flags: { "darsh-loot": { merchant: { enabled: true } } } });
  const deal = (merchant, buyer) => CONFIG.queries["darsh-loot.shopDeal"]({ source: { kind: "merchant", uuid: merchant.uuid },
    looter: buyer.uuid, buy: [{ id: "corde", quantity: 1 }], sell: [] }, { user: GM });

  it("la bourse du personnage bouge pendant le troc : rien n'est écrasé", async () => {
    const merchant = merchantOf();
    const buyer = new FakeActor({ id: "pj", name: "Clerc", currency: { gp: 100 } });
    const friend = new FakeActor({ id: "ami", name: "Roublard" });
    await Promise.all([deal(merchant, buyer), moveCoins(buyer, friend, { gp: 90 })]);
    expect([buyer.system.currency.gp, friend.system.currency.gp, merchant.system.currency.gp]).toEqual([0, 90, 10]);
    expect(buyer.count("Corde")).toBe(1);
  });

  it("un personnage conclut chez deux marchands à la fois : il ne paie pas plus qu'il n'a", async () => {
    const first = merchantOf();
    const second = new FakeActor({ id: "m2", name: "Marchande", type: "npc", items: [rope],
      flags: { "darsh-loot": { merchant: { enabled: true } } } });
    const buyer = new FakeActor({ id: "pj", name: "Clerc", currency: { gp: 15 } });
    const results = await Promise.allSettled([deal(first, buyer), deal(second, buyer)]);
    expect(statuses(results)).toEqual(["fulfilled", "rejected"]);
    expect(results.find(r => r.status === "rejected").reason.message).toBe("DLO.Shop.NoFunds");
    expect(buyer.count("Corde")).toBe(1);
    expect([buyer.system.currency.gp, first.system.currency.gp, second.system.currency.gp]).toEqual([5, 10, 0]);
  });
});
