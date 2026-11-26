/**
 * Lot 0 — the store actor of a container (audit of 2026-11-26, defect 20). A container whose store was deleted or never imported
 * (adventure, compendium) opened an empty window and refused every take « not found », without a word; a duplicated scene made
 * both copies share one chest. The GM client now repairs it at the next opening and says so. Played on the fake Foundry of
 * tests/fake-foundry.mjs.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { installFakeFoundry, FakeActor, FakeCollection, documents, chat, tick } from "./fake-foundry.mjs";

installFakeFoundry();
const { ensureStore, ensureContainer, storeState } = await import("../module/scripts/runtime/containers.mjs");
const { CONTAINER_TYPE } = await import("../module/scripts/adapter/container-behavior.mjs");

const GM = { id: "gm", isGM: true, name: "MJ", active: true, isSelf: true };
const sword = { _id: "epee", name: "Épée longue", type: "weapon", system: { quantity: 1 } };
let created = 0;

beforeEach(() => {
  documents.clear();
  chat.length = 0;
  created = 0;
  game.users.splice(0, game.users.length, GM);
  game.users.activeGM = GM;
  game.user = { id: "gm", isGM: true, name: "MJ" };
  game.folders = [{ type: "Actor", id: "dossier", getFlag: () => true }];
  globalThis.Actor.implementation = { create: async data => {
    await tick();
    return new FakeActor({ id: `coffre${++created}`, name: data.name, type: data.type, flags: structuredClone(data.flags ?? {}) });
  } };
});

/** A container behavior on its own region and scene. */
function container(id, system={}) {
  const where = { name: `Scène ${id}`, regions: new FakeCollection() };
  const region = { id: `r${id}`, name: "Coffre", parent: where, behaviors: new FakeCollection() };
  const behavior = { id: `b${id}`, uuid: `Scene.${id}.Region.r${id}.RegionBehavior.b${id}`, type: CONTAINER_TYPE, parent: region, region,
    disabled: false, system: { actor: null, displayName: "Coffre", rolled: true, locked: false, ...system },
    async update(changes) { await tick(); for ( const [k, v] of Object.entries(changes) ) this.system[k.replace("system.", "")] = v; } };
  region.behaviors.set(behavior.id, behavior);
  where.regions.set(region.id, region);
  documents.set(behavior.uuid, behavior);
  return behavior;
}
const storeOf = behavior => documents.get(behavior.system.actor);
const gmNotes = () => chat.filter(m => m.flags?.["darsh-loot"]?.storeRepair);

describe("defect 20 — a container whose store is missing", () => {
  it("is recognised: none, missing, ok", async () => {
    const chest = container("1");
    expect(storeState(chest)).toBe("none");
    chest.system.actor = "Actor.parti";
    expect(storeState(chest)).toBe("missing");
    chest.system.actor = null;
    await ensureStore(chest);
    expect(storeState(chest)).toBe("ok");
  });

  it("gets a new, empty store at the next opening, and the GM is told", async () => {
    const chest = container("1", { actor: "Actor.parti" });
    await ensureContainer(chest);
    expect(storeState(chest)).toBe("ok");
    expect(storeOf(chest).items.size).toBe(0);
    expect(storeOf(chest).getFlag("darsh-loot", "containerOf")).toBe(chest.uuid);
    expect(gmNotes()).toHaveLength(1);
    expect(gmNotes()[0].whisper).toEqual(["gm"]);
  });

  it("a sound store is left alone: no new actor, no message", async () => {
    const chest = container("1");
    const store = await ensureStore(chest);
    await ensureContainer(chest);
    expect(storeOf(chest)).toBe(store);
    expect(created).toBe(1);
    expect(gmNotes()).toHaveLength(0);
  });
});

describe("defect 20 — a duplicated scene shares one chest", () => {
  it("the copy gets its own store with a copy of the contents; the original keeps its own", async () => {
    const original = container("1");
    const store = await ensureStore(original);
    await CONFIG.Item.documentClass.createDocuments([sword], { parent: store });
    await store.update({ "system.currency": { gp: 12 } });
    const copy = container("2", { actor: store.uuid });
    expect(storeState(copy)).toBe("shared");
    await ensureContainer(copy);
    expect(storeOf(copy)).not.toBe(store);
    expect(storeOf(original)).toBe(store);
    expect([storeOf(copy).count(sword.name), store.count(sword.name)]).toEqual([1, 1]);
    expect(storeOf(copy).system.currency.gp).toBe(12);
    expect(gmNotes()).toHaveLength(1);
  });

  it("a container moved with its scene (the first one no longer exists) simply adopts the store", async () => {
    const original = container("1");
    const store = await ensureStore(original);
    documents.delete(original.uuid);
    const moved = container("2", { actor: store.uuid });
    expect(storeState(moved)).toBe("adopt");
    await ensureContainer(moved);
    expect(storeOf(moved)).toBe(store);
    expect(store.getFlag("darsh-loot", "containerOf")).toBe(moved.uuid);
    expect(gmNotes()).toHaveLength(0);
  });
});
