/**
 * The module's own end-to-end pass (`api.mcp.selftest`, module/scripts/runtime/selftest.mjs), the twelve parts that existed
 * before lot 0, played GM-side on a dedicated empty scene: secret doors, zone trap, advanced trap, token trap, trapped chest and
 * door, loot, sounds, search, group → container, left click, mechanism, NPC theft. Until 2026-11-26 they could only be played
 * through `tools/selftest.mjs` on the user's own Foundry (scene « Arène de test »); this scenario lets the bench play them alone.
 * The four lot 0 parts are in `lot0-passe-interne.mjs`.
 * Each part creates its own test documents and removes them. Restored: the viewed scene; the test scene is deleted.
 *
 * Run with the Core's runner: `node tools/scenario.mjs "../Foundry dnd5e butin et commerce/tools/scenarios/passe-interne.mjs"`
 * (on the bench: `npm run banc:passe -- "<that path>"`). `PARTS=butin,vol` in the environment plays only those.
 */
const MODULE = "darsh-loot";
const LOT0 = ["shop", "trade", "necromancy", "thrown"];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "loot — the module's end-to-end pass, the twelve older parts (selftest)",

  async run(ctx) {
    const gm = async (code, args) => (await ctx.call("run-script", { code, ...(args ? { args } : {}), waitMs: 20000 }))?.result;
    /** A module test function that may take minutes: asked, then polled until it has settled. */
    async function api(fn, args, timeoutMs=420000) {
      const until = Date.now() + timeoutMs;
      let r = await ctx.call("call-module-api", { moduleId: MODULE, fn, args, waitMs: 8000 });
      while ( r && (r.settled === false) ) {
        if ( Date.now() > until ) throw new Error(`${fn}: no answer after ${timeoutMs} ms`);
        r = await ctx.call("call-module-api", { callId: r.callId, waitMs: 8000 });
      }
      return r?.result;
    }

    const setup = await gm(`
      const previous = { scene: canvas.scene?.id ?? null, level: canvas.level?.id ?? null };
      const scene = await Scene.create({ name: "DAS Loot — selftest (test)", width: 4000, height: 3000, padding: 0,
        grid: { size: 100, distance: 5 }, tokenVision: true, environment: { darknessLevel: 0, globalLight: { enabled: true } },
        flags: { "darsh-loot": { test: true } } });
      await scene.view();
      for ( let i = 0; i < 40 && ((canvas.scene?.id !== scene.id) || !canvas.ready); i++ ) await new Promise(r => setTimeout(r, 250));
      return { previous, scene: scene.id, viewed: canvas.scene?.id === scene.id };`);
    if ( !ctx.expect(setup?.viewed, `test scene created and viewed (${JSON.stringify(setup)})`) ) return;
    ctx.restore(() => gm(`
      for ( const combat of game.combats.filter(c => c.scene?.id === args.scene) ) await combat.delete().catch(() => {});
      if ( args.previous.scene ) await game.scenes.get(args.previous.scene)?.view(args.previous.level ? { level: args.previous.level } : {});
      await game.scenes.get(args.scene)?.delete();
      const left = game.actors.filter(a => a.getFlag("darsh-loot", "test"));
      if ( left.length ) await Actor.implementation.deleteDocuments(left.map(a => a.id));
      if ( game.paused ) game.togglePause(false, { broadcast: true });
      return true;`, setup).catch(err => ctx.log(`cleanup: ${err.message}`)));
    await pause(1500);

    const listed = (await api("selftest", {}))?.parts ?? [];
    const wanted = (process.env.PARTS ?? "").split(",").map(s => s.trim()).filter(Boolean);
    const parts = listed.filter(p => !LOT0.includes(p) && (!wanted.length || wanted.includes(p)));
    if ( !ctx.expect(parts.length > 0, `parts to play: ${parts.join(", ")}`) ) return;

    for ( const part of parts ) {
      const started = Date.now();
      const r = await api("selftest", { part });
      ctx.log(`▶ ${part} (${Math.round((Date.now() - started) / 1000)} s)`);
      for ( const check of r?.checks ?? [] ) {
        if ( check.note ) ctx.log(`  · ${check.label}`);
        else ctx.expect(check.ok, `${part}: ${check.label}`);
      }
      ctx.expect(!r?.error, `${part}: no error (${r?.error ?? "none"})`);
      await pause(500);
    }
  }
};
