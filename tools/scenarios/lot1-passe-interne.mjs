/**
 * Lot 1 « sharing » (2026-11-27) — the parts added to the module's own end-to-end pass (`api.mcp.selftest`,
 * module/scripts/runtime/selftest.mjs), played GM-side on a dedicated empty scene:
 *  - `share-coins`: the coins of a corpse are split between the primary party (absent members included, or only those on the
 *    scene), what does not divide stays or goes to the sharer, everyone sees and hears it, a write that fails gives every coin
 *    back with a trace for the GM, and « too far » is refused to a player with a reason he may force — the GM is then told.
 *  - `partial-take`: N of a stack are taken and the rest stays; a source that cannot be reduced takes back what arrived; in the
 *    window a click on a stack asks how many and Shift+click takes it whole.
 *  - `drop-coins`: coins dropped become a pile showing coins, more coins on the same square join it, never more than the purse
 *    held; a write that fails gives them back and leaves no empty pile; a drop asked far away lands next to the character; an
 *    emptied pile disappears.
 * Each part creates its own test documents and removes them. Restored: the viewed scene, the world's primary party and the
 * sharing settings; the test scene is deleted.
 *
 * Run with the Core's runner: `node tools/scenario.mjs "../Foundry dnd5e butin et commerce/tools/scenarios/lot1-passe-interne.mjs"`
 * (on the bench: `npm run banc:passe -- "<that path>"`). `PARTS=share-coins` in the environment plays only those.
 */
const MODULE = "darsh-loot";
const ALL = ["share-coins", "partial-take", "drop-coins"];
const PARTS = process.env.PARTS ? process.env.PARTS.split(",").filter(p => ALL.includes(p)) : ALL;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "loot — lot 1: sharing (selftest parts)",

  async run(ctx) {
    const gm = async (code, args) => (await ctx.call("run-script", { code, ...(args ? { args } : {}), waitMs: 20000 }))?.result;
    /** A module test function that may take minutes: asked, then polled until it has settled. */
    async function api(fn, args, timeoutMs=300000) {
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
      const scene = await Scene.create({ name: "DAS Loot — lot 1 (test)", width: 3000, height: 2000, padding: 0,
        grid: { size: 100, distance: 5 }, tokenVision: false, environment: { darknessLevel: 0, globalLight: { enabled: true } },
        flags: { "darsh-loot": { test: true } } });
      await scene.view();
      for ( let i = 0; i < 40 && ((canvas.scene?.id !== scene.id) || !canvas.ready); i++ ) await new Promise(r => setTimeout(r, 250));
      return { previous, scene: scene.id, viewed: canvas.scene?.id === scene.id, operations: Object.keys(game.settings.get("darsh-loot", "operations") ?? {}).length };`);
    if ( !ctx.expect(setup?.viewed, `test scene created and viewed (${JSON.stringify(setup)})`) ) return;
    ctx.restore(() => gm(`
      if ( args.previous.scene ) await game.scenes.get(args.previous.scene)?.view(args.previous.level ? { level: args.previous.level } : {});
      await game.scenes.get(args.scene)?.delete();
      const left = game.actors.filter(a => a.getFlag("darsh-loot", "test") || (a.getFlag("darsh-loot", "raised")?.from ?? "").startsWith("Test corpse"));
      if ( left.length ) await Actor.implementation.deleteDocuments(left.map(a => a.id));
      return true;`, setup).catch(err => ctx.log(`cleanup: ${err.message}`)));
    await pause(1500);

    const listed = await api("selftest", {});
    const missing = PARTS.filter(p => !(listed?.parts ?? []).includes(p));
    if ( !ctx.expect(!missing.length, `the module has the lot 1 parts (${missing.length ? `missing: ${missing.join(", ")}` : PARTS.join(", ")})`) ) return;

    for ( const part of PARTS ) {
      const started = Date.now();
      const r = await api("selftest", { part });
      ctx.log(`▶ ${part} (${Math.round((Date.now() - started) / 1000)} s)`);
      for ( const check of r?.checks ?? [] ) {
        if ( check.note ) ctx.log(`  · ${check.label}`);
        else ctx.expect(check.ok, `${part}: ${check.label}`);
      }
      ctx.expect(!r?.error, `${part}: no error (${r?.error ?? "none"})`);
      ctx.expect((r?.checks ?? []).some(c => !c.note), `${part}: something was checked`);
    }

    const journal = await gm(`return Object.keys(game.settings.get("darsh-loot", "operations") ?? {}).length;`);
    ctx.expect(journal === 0, `no operation left in the journal (${journal})`);
  }
};
