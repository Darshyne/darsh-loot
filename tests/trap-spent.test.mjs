/**
 * Un piège qui part (runtime/traps.mjs `fireTrap`), sur le faux Foundry de tests/fake-foundry.mjs : ce qu'il écrit sur lui-même
 * selon son réarmement. Sans réarmement (« jamais »), il ne repartira plus : il est noté désamorcé — plus de surbrillance, plus
 * de désamorçage proposé aux joueurs (issue #6). Réarmé à la main ou après un délai, il reste à désamorcer.
 */
import { describe, it, expect } from "vitest";
import { installFakeFoundry } from "./fake-foundry.mjs";
import { firedUpdate, armedAt, normalizeTrap } from "../module/scripts/core/traps.mjs";

installFakeFoundry();
const { fireTrap } = await import("../module/scripts/runtime/traps.mjs");

/** Une poignée de piège de coffre, sans acteur (rien n'est joué) : seules ses écritures comptent ici. */
function handle(rearm) {
  const h = { kind: "container", doc: {}, uuid: `Scene.s.Region.r.RegionBehavior.${rearm}`, name: "Essai", scene: { tokens: [] },
    trap: normalizeTrap({ enabled: true, rearm }), hidden: { enabled: true, found: true }, source: { doc: null, hidden: {} },
    updates: [], async update(changes) { this.updates.push(changes); } };
  return h;
}

describe("un piège qui part", () => {
  it("jamais réarmé : noté désamorcé en partant", async () => {
    const h = handle("never");
    game.time.worldTime = 120;
    await fireTrap(h, null);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]).toMatchObject({ armed: false, triggeredAt: 120, disarmed: true });
  });

  it("réarmé à la main ou après un délai : pas désamorcé, il peut repartir", async () => {
    for ( const rearm of ["gm", "time"] ) {
      const h = handle(rearm);
      await fireTrap(h, null);
      expect(h.updates[0]).toMatchObject({ armed: false });
      expect(h.updates[0].disarmed).toBeUndefined();
    }
  });

  it("dans les trois cas il est repéré : tout le monde l'a vu partir", async () => {
    for ( const rearm of ["never", "gm", "time"] ) {
      const h = handle(rearm);
      await fireTrap(h, null);
      expect(h.updates[0]).toMatchObject({ "hidden.found": true, "source.hidden.found": true });
    }
  });
});

describe("ce qu'un piège parti écrit (core)", () => {
  it("jamais réarmé : désamorcé ; sinon, seulement désarmé, avec l'heure", () => {
    expect(firedUpdate({ rearm: "never" }, 60)).toEqual({ armed: false, triggeredAt: 60, disarmed: true });
    expect(firedUpdate({ rearm: "gm" }, 60)).toEqual({ armed: false, triggeredAt: 60 });
    expect(firedUpdate({ rearm: "time", delay: 1 }, 60)).toEqual({ armed: false, triggeredAt: 60 });
  });

  it("un réarmement par délai joue toujours après le départ", () => {
    const trap = { ...normalizeTrap({ rearm: "time", delay: 1 }), ...firedUpdate({ rearm: "time" }, 60) };
    expect(armedAt(trap, 119)).toBe(false);
    expect(armedAt(trap, 120)).toBe(true);
  });

  it("un réglage inconnu vaut « jamais », comme à la lecture des réglages", () => {
    expect(firedUpdate({}, 0).disarmed).toBe(true);
    expect(firedUpdate(null, 0).disarmed).toBe(true);
  });
});
