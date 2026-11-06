import { describe, it, expect } from "vitest";
import { activatesOn, actuation, actionMode, runsOnReverse, normalizeAction, actionReady, doorChange, visibilityChange, imageFor,
  ACTION_TYPES, ACTION_MODES, ACTION_TARGETS } from "../module/scripts/core/mechanisms.mjs";

const STATES = { CLOSED: 0, OPEN: 1, LOCKED: 2 };

describe("mécanismes (étape 13)", () => {
  it("déclenchement : clic, entrée, les deux ; une valeur inconnue vaut l'entrée (pièges d'avant)", () => {
    expect(activatesOn("click", "click")).toBe(true);
    expect(activatesOn("click", "enter")).toBe(false);
    expect(activatesOn("enter", "enter")).toBe(true);
    expect(activatesOn("both", "click")).toBe(true);
    expect(activatesOn("both", "enter")).toBe(true);
    expect(activatesOn(undefined, "enter")).toBe(true);
    expect(activatesOn(undefined, "click")).toBe(false);
  });

  it("à bascule : aller puis retour, à rebours", () => {
    expect(actuation({ mode: "toggle", active: false })).toEqual({ run: true, reverse: false, next: { active: true } });
    expect(actuation({ mode: "toggle", active: true })).toEqual({ run: true, reverse: true, next: { active: false } });
  });

  it("une fois : sert puis plus rien ; à chaque fois : toujours l'aller", () => {
    expect(actuation({ mode: "once", used: false })).toEqual({ run: true, reverse: false, next: { used: true, active: true } });
    expect(actuation({ mode: "once", used: true }).run).toBe(false);
    expect(actuation({ mode: "always", active: true })).toEqual({ run: true, reverse: false, next: {} });
  });

  it("le retour inverse chaque effet ; un piège ne repart pas", () => {
    const of = (type, mode) => normalizeAction({ type, mode, target: "x" });
    expect(actionMode(of("door", "open"), true)).toBe("close");
    expect(actionMode(of("door", "lock"), true)).toBe("unlock");
    expect(actionMode(of("door", "toggle"), true)).toBe("toggle");
    expect(actionMode(of("light", "on"), true)).toBe("off");
    expect(actionMode(of("tile", "show"), true)).toBe("hide");
    expect(actionMode(of("tile", "show"), false)).toBe("show");
    expect(runsOnReverse(of("trap", "fire"))).toBe(false);
    expect(runsOnReverse(of("sound", "play"))).toBe(true);
    expect(runsOnReverse(of("macro", "gm"))).toBe(true);
  });

  it("une action brute devient complète ; un effet d'un autre type revient au premier du sien", () => {
    expect(normalizeAction({})).toEqual({ type: "door", target: null, mode: "open", src: "", volume: 0.8 });
    expect(normalizeAction({ type: "light", mode: "open", target: " Scene.a.AmbientLight.b " }))
      .toEqual({ type: "light", target: "Scene.a.AmbientLight.b", mode: "on", src: "", volume: 0.8 });
    expect(normalizeAction({ type: "sound", src: "a.ogg", volume: "3" }).volume).toBe(1);
    expect(normalizeAction({ type: "nope" }).type).toBe("door");
    expect(actionReady(normalizeAction({ type: "sound", src: "a.ogg" }))).toBe(true);
    expect(actionReady(normalizeAction({ type: "sound" }))).toBe(false);
    expect(actionReady(normalizeAction({ type: "door" }))).toBe(false);
  });

  it("chaque type a ses effets et ses cibles", () => {
    for ( const type of ACTION_TYPES ) {
      expect(ACTION_MODES[type].length).toBeGreaterThan(0);
      expect(Array.isArray(ACTION_TARGETS[type])).toBe(true);
    }
    expect(ACTION_TARGETS.sound).toEqual([]);
  });

  it("porte : ouvrir (même verrouillée), fermer, basculer, verrouiller, déverrouiller", () => {
    expect(doorChange("open", STATES.CLOSED, STATES)).toEqual({ ds: 1 });
    expect(doorChange("open", STATES.LOCKED, STATES)).toEqual({ ds: 1 });
    expect(doorChange("open", STATES.OPEN, STATES)).toBe(null);
    expect(doorChange("close", STATES.OPEN, STATES)).toEqual({ ds: 0 });
    expect(doorChange("close", STATES.LOCKED, STATES)).toBe(null);
    expect(doorChange("toggle", STATES.OPEN, STATES)).toEqual({ ds: 0 });
    expect(doorChange("toggle", STATES.LOCKED, STATES)).toEqual({ ds: 1 });
    expect(doorChange("lock", STATES.OPEN, STATES)).toEqual({ ds: 2 });
    expect(doorChange("unlock", STATES.LOCKED, STATES)).toEqual({ ds: 0 });
    expect(doorChange("unlock", STATES.OPEN, STATES)).toBe(null);
  });

  it("lumière et tuile : allumer / montrer, éteindre / cacher, basculer", () => {
    expect(visibilityChange("on", true)).toEqual({ hidden: false });
    expect(visibilityChange("on", false)).toBe(null);
    expect(visibilityChange("hide", false)).toEqual({ hidden: true });
    expect(visibilityChange("toggle", false)).toEqual({ hidden: true });
    expect(visibilityChange("toggle", true)).toEqual({ hidden: false });
  });

  it("image de la tuile selon la position, rien si le MJ n'en a pas donné", () => {
    const images = { imageOn: "down.webp", imageOff: "up.webp" };
    expect(imageFor(true, images)).toBe("down.webp");
    expect(imageFor(false, images)).toBe("up.webp");
    expect(imageFor(true, { imageOff: "up.webp" })).toBe(null);
  });
});
