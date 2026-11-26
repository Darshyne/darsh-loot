/**
 * #286 (dnd5e-combat): the wait for 3D dice follows Dice So Nice's API (`game.dice3d`), not the `dice-so-nice` module id, so that Dicer,
 * which provides the same API and cannot run beside Dice So Nice, is waited for too.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { waitForDice, showDiceLocally, diceShown } from "../module/scripts/adapter/dice.mjs";

const saved = {};
const message = { id: "msg0000000000001" };

/** A world with no `dice-so-nice` module at all: only `game.dice3d`, as Dicer leaves it. */
function world(dice3d) {
  globalThis.game = { modules: new Map(), dice3d, user: { id: "user000000000001" } };
}

beforeEach(() => {
  saved.game = globalThis.game;
  saved.document = globalThis.document;
  globalThis.document = { hidden: false };
});
afterEach(() => {
  globalThis.game = saved.game;
  globalThis.document = saved.document;
});

describe("3D dice from any module that provides game.dice3d", () => {
  it("waits for the animation of the message without the dice-so-nice module (Dicer)", async () => {
    let finish;
    const asked = [];
    world({ waitFor3DAnimationByMessageID: id => { asked.push(id); return new Promise(resolve => { finish = resolve; }); } });
    let done = false;
    const waiting = waitForDice(message).then(() => { done = true; });
    await Promise.resolve();
    expect(asked).toEqual(["msg0000000000001"]);
    expect(done).toBe(false);
    finish();
    await waiting;
    expect(done).toBe(true);
  });

  it("rolls secret dice locally through showForRoll without the dice-so-nice module", async () => {
    const shown = [];
    world({ showForRoll: (roll, user, sync) => { shown.push([roll.total, user.id, sync]); return Promise.resolve(true); } });
    await showDiceLocally({ total: 12 });
    expect(shown).toEqual([[12, "user000000000001", false]]);
  });

  it("knows dice are shown when the API is there and the window visible", () => {
    world({ waitFor3DAnimationByMessageID: () => Promise.resolve() });
    expect(diceShown()).toBe(true);
    globalThis.document.hidden = true;
    expect(diceShown()).toBe(false);
  });

  it("returns at once with no 3D dice at all", async () => {
    world(undefined);
    expect(diceShown()).toBe(false);
    await expect(waitForDice(message)).resolves.toBeUndefined();
    await expect(showDiceLocally({ total: 3 })).resolves.toBeUndefined();
  });
});
