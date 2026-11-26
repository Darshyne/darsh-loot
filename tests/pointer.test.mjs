/**
 * Le curseur de fouille (runtime/pointer.mjs), sur le faux Foundry de tests/fake-foundry.mjs : en combat ou pendant la visée du
 * moteur, il n'y a jamais de curseur — et l'on ne cherche plus ce qui est sous la souris pour le savoir.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { installFakeFoundry, FakeActor, FakeCollection, settings } from "./fake-foundry.mjs";

installFakeFoundry();
const VIEW = { name: "la vue du canevas" };
const listeners = {};
const hooks = {};
/** Ce que le balayage coûte : lectures de l'emprise des tokens, conversions de coordonnées. */
const scans = { bounds: 0, coordinates: 0 };
let engine = { targeting: null };

globalThis.document = { body: { dataset: {} }, addEventListener: (type, fn) => { listeners[type] = fn; } };
globalThis.Hooks = { on: (hook, fn) => { hooks[hook] = fn; } };
globalThis.PIXI = {
  Container: class { children = []; removeChildren() { return this.children.splice(0); } addChild(c) { this.children.push(c); } },
  Graphics: class { lineStyle() {} beginFill() {} endFill() {} drawCircle() {} drawPolygon() {} destroy() {} },
  LINE_JOIN: {}
};

const { registerPointer } = await import("../module/scripts/runtime/pointer.mjs");

const cursor = () => document.body.dataset.darshLootCursor ?? null;
/** A mouse move event, as the browser sends it. */
const moveEvent = () => listeners.pointermove({ target: VIEW, clientX: 150, clientY: 150 });
/** A mouse move, then the time for its scan: the scan under the mouse is paced (lot 0, defect 22 — core/pace.mjs). */
const move = () => { moveEvent(); vi.advanceTimersByTime(50); };

afterAll(() => vi.useRealTimers());

beforeAll(() => {
  vi.useFakeTimers();
  Object.assign(settings, { clickToLoot: "off", autoTreasure: false });
  game.user = { id: "joueur", isGM: false, character: null };
  game.modules.get = id => ((id === "dnd5e-combat") ? { active: true, api: { ui: { targeting: () => engine.targeting } } } : null);
  const scene = { grid: { size: 100, distance: 5, units: "ft" },
    regions: new FakeCollection(), walls: new FakeCollection(), tokens: new FakeCollection(), tiles: new FakeCollection() };
  const corpse = new FakeActor({ id: "mort", name: "Garde", type: "npc",
    items: [{ _id: "epee", name: "Épée longue", type: "weapon", system: { quantity: 1, properties: ["gear"] } }] });
  corpse.statuses.add("dead");
  const token = { id: "t1", uuid: "Scene.s.Token.t1", documentName: "Token", name: "Garde", parent: scene, actor: corpse,
    isOwner: false, getFlag: () => undefined, _source: { x: 100, y: 100, width: 1, height: 1, elevation: 0 } };
  scene.tokens.set(token.id, token);
  const placeable = { document: token, visible: true, center: { x: 150, y: 150 }, w: 100, h: 100,
    get bounds() { scans.bounds++; return { contains: (x, y) => (x >= 100) && (x < 200) && (y >= 100) && (y < 200) }; } };
  token.object = placeable;
  const tokens = { placeables: [placeable], controlled: [] };
  globalThis.canvas = { ready: true, app: { view: VIEW }, scene, tokens, activeLayer: tokens,
    interface: { addChild() {} },
    canvasCoordinatesFromClient: ({ x, y }) => { scans.coordinates++; return { x, y }; } };
  registerPointer();
});

beforeEach(() => {
  game.combat = null;
  engine = { targeting: null };
  move();
  scans.bounds = scans.coordinates = 0;
});

describe("curseur de fouille au survol", () => {
  it("hors combat : le cadavre sous la souris a son curseur (trop loin, sans personnage en main)", () => {
    expect(cursor()).toBe("far");
    move();
    expect(scans).toEqual({ bounds: 1, coordinates: 1 });
  });

  it("lot 0, defect 22 — thirty mouse moves in a row scan twice (the first and the last), not thirty times", () => {
    for ( let i = 0; i < 30; i++ ) moveEvent();
    vi.advanceTimersByTime(50);
    expect(cursor()).toBe("far");
    expect(scans).toEqual({ bounds: 2, coordinates: 2 });
  });

  it("en combat : aucun curseur, comme avant — et sans chercher ce qui est sous la souris", () => {
    game.combat = { started: true };
    move();
    expect(cursor()).toBe(null);
    expect(scans).toEqual({ bounds: 0, coordinates: 0 });
    game.combat = null;
    move();
    expect(cursor()).toBe("far");
  });

  it("pendant la visée du moteur : pareil", () => {
    engine.targeting = { activity: "un sort" };
    move();
    expect(cursor()).toBe(null);
    expect(scans).toEqual({ bounds: 0, coordinates: 0 });
  });

  it("un hook qui recalcule le curseur (PV d'un acteur, tour de combat) ne balaie pas non plus en combat", () => {
    hooks.updateActor(canvas.scene.tokens.get("t1").actor, {});
    expect(cursor()).toBe("far");
    expect(scans).toEqual({ bounds: 1, coordinates: 1 });
    game.combat = { started: true };
    scans.bounds = scans.coordinates = 0;
    hooks.updateCombat(game.combat, {});
    hooks.updateActor(canvas.scene.tokens.get("t1").actor, {});
    expect(cursor()).toBe(null);
    expect(scans).toEqual({ bounds: 0, coordinates: 0 });
  });
});
