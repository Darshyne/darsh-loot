/**
 * Lot 0 (audit of 2026-11-26) — the four parts added to the module's own end-to-end pass (`api.mcp.selftest`,
 * module/scripts/runtime/selftest.mjs), played GM-side on a dedicated empty scene:
 *  - `shop`: a deal moves goods and coins and creates none; an NPC item without the gear property is hidden from players and never
 *    charged; a purse write that fails puts the goods back and whispers a trace to the GM; a shop addressed by its actor is refused;
 *  - `trade`: an NPC cannot be the other side; a bag leaves with its contents, once; worn items and spells are left out; an
 *    agreement to an offer that changed is refused; an exchange that breaks at its last write is undone; attunement does not follow;
 *    « this GM client holds no trade » closes the window of a lost trade;
 *  - `necromancy`: a raising that breaks leaves the corpse and no undead, belongings stay in their pile; two requests at once give
 *    one undead;
 *  - `thrown`: a thrown weapon read from the Core's resolution lands beyond the target on a miss, in the target or at its feet on a
 *    hit, and a returning weapon comes back.
 * Each part creates its own test documents and removes them. Restored: the viewed scene; the test scene is deleted.
 *
 * Run with the Core's runner: `node tools/scenario.mjs "../Foundry dnd5e butin et commerce/tools/scenarios/lot0-passe-interne.mjs"`
 * (on the bench: `npm run banc:passe -- "<that path>"`).
 */
const MODULE = "darsh-loot";
const PARTS = ["shop", "trade", "necromancy", "thrown"];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "loot — lot 0: shop, trade, necromancy and thrown weapons (selftest parts)",

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
      const scene = await Scene.create({ name: "DAS Loot — lot 0 (test)", width: 3000, height: 2000, padding: 0,
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
    if ( !ctx.expect(!missing.length, `the module has the lot 0 parts (${missing.length ? `missing: ${missing.join(", ")}` : PARTS.join(", ")})`) ) return;

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
