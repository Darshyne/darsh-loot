/**
 * 0.23.0 (2026-11-28) — the end-of-combat loot (lot 3) is withdrawn (user's decision after a test at the table: confusing, and it
 * doubled loot already on corpses). Played on the bench: GM client, and the real player client when there is one. On a temporary
 * ACTIVE scene, the character of « claude player » and two goblins (a scimitar each, 5 gp), DAS's XP off, « end-of-combat loot » left
 * ON in the world settings (an earlier version's default):
 *  1. its settings are hidden and the settings window has no « End-of-combat loot » tab; the API says it is off;
 *  2. a real combat ends with both goblins dead: no window, no record, no corpse held, no treasure rolled, nothing added to them;
 *  3. a record an earlier version left pending (holding goblin A) holds nothing;
 *  4. the player searches goblin A (its treasure rolled once, as before lot 3) and takes everything: one scimitar and the coins reach
 *     the character, the corpse is empty, nothing is doubled.
 * Restored: the active and viewed scenes, the settings, the records, the test actors.
 *
 * Run with the Core's runner (on the bench: `npm run banc:passe -- "<this path>"`).
 */
export default {
  name: "loot — end-of-combat loot withdrawn (0.23.0): nothing at the end of a combat, corpses searched as before",
  players: true,

  async run(ctx) {
    const gm = async (code, args) => (await ctx.call("run-script", { code, ...(args ? { args } : {}), waitMs: 30000 }))?.result;

    const setup = await gm(`
      const S = (k, v) => game.settings.set("darsh-loot", k, v);
      const player = game.users.find(u => u.name === "claude player");
      let actor = game.actors.find(a => (a.type === "character") && player && a.testUserPermission(player, "OWNER"));
      const TEST = { "darsh-loot": { test: true } };
      const KEYS = ["corpseLoot", "xpManage", "lootManage", "lootWhen", "rewards", "reach", "autoTreasure", "whoLoots", "pockets"];
      const previous = { scene: canvas.scene?.id ?? null, level: canvas.level?.id ?? null, active: game.scenes.active?.id ?? null,
        settings: Object.fromEntries(KEYS.map(k => [k, game.settings.get("darsh-loot", k)])),
        purse: actor ? { ...actor.system.currency } : null, items: actor ? actor.items.map(i => i.id) : [] };
      let own = false;
      if ( !actor ) { actor = await Actor.implementation.create({ name: "DAS test hero", type: "character", img: "icons/svg/mystery-man.svg", flags: TEST }); own = true; }
      const goblin = name => Actor.implementation.create({ name, type: "npc", img: "icons/svg/skull.svg", flags: TEST,
        system: { attributes: { hp: { value: 7, max: 7 } }, currency: { gp: 5 },
          details: { cr: 0.25, type: { value: "humanoid" }, treasure: { value: ["individual"] } } },
        items: [{ name: "DAS test scimitar", type: "weapon", system: { quantity: 1, properties: ["gear", "fin"] } }] });
      const [g1, g2] = [await goblin("DAS goblin A"), await goblin("DAS goblin B")];
      const scene = await Scene.create({ name: "DAS Loot — end-of-combat loot withdrawn (test)", width: 1500, height: 1000, padding: 0,
        grid: { size: 100, distance: 5 }, tokenVision: false, environment: { darknessLevel: 0, globalLight: { enabled: true } },
        ownership: { default: 2 }, flags: TEST });
      const H = CONST.TOKEN_DISPOSITIONS.HOSTILE, F = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
      const at = (a, x, y, extra={}) => ({ name: a.name, actorId: a.id, x, y, elevation: 0, ...extra });
      const tokens = await scene.createEmbeddedDocuments("Token", [
        at(actor, 400, 300, { actorLink: true, disposition: F }), at(g1, 500, 300, { disposition: H }), at(g2, 500, 400, { disposition: H })]);
      await S("xpManage", false); await S("lootManage", true); await S("lootWhen", "semi"); await S("corpseLoot", true);
      await S("reach", 10); await S("autoTreasure", true); await S("whoLoots", "all"); await S("pockets", false);
      await S("rewards", { records: [] });
      await scene.activate();
      await scene.view();
      for ( let i = 0; i < 40 && ((canvas.scene?.id !== scene.id) || !canvas.ready); i++ ) await new Promise(r => setTimeout(r, 250));
      await new Promise(r => setTimeout(r, 1000));
      const of = a => tokens.find(t => t.actorId === a.id);
      const map = { actor: of(actor), g1: of(g1), g2: of(g2) };
      return { previous, own, scene: scene.id, viewed: canvas.scene?.id === scene.id, actor: actor.id,
        ownedByPlayer: !!player && actor.testUserPermission(player, "OWNER"),
        tokens: Object.fromEntries(Object.entries(map).map(([k, t]) => [k, t.id])),
        uuids: Object.fromEntries(Object.entries(map).map(([k, t]) => [k, t.uuid])) };`);
    if ( !ctx.expect(setup?.viewed, `test scene and goblins ready, viewed by the GM (${JSON.stringify({ viewed: setup?.viewed })})`) ) return;
    ctx.restore(() => gm(`
      const p = args.previous;
      for ( const c of game.combats.filter(c => c.scene?.id === args.scene) ) await c.delete();
      for ( const app of foundry.applications.instances.values() ) if ( app.id?.startsWith("darsh-loot-") ) await app.close().catch(() => {});
      if ( p.active ) await game.scenes.get(p.active)?.activate();
      if ( p.scene ) await game.scenes.get(p.scene)?.view(p.level ? { level: p.level } : {});
      const sceneUuid = game.scenes.get(args.scene)?.uuid ?? "Scene." + args.scene;
      await game.scenes.get(args.scene)?.delete();
      for ( const [k, v] of Object.entries(p.settings) ) await game.settings.set("darsh-loot", k, v);
      const actor = game.actors.get(args.actor);
      if ( actor && !args.own ) {
        if ( p.purse ) await actor.update({ "system.currency": p.purse });
        const extra = actor.items.filter(i => !p.items.includes(i.id)).map(i => i.id);
        if ( extra.length ) await actor.deleteEmbeddedDocuments("Item", extra);
      }
      const left = game.actors.filter(a => a.getFlag("darsh-loot", "test") || String(a.getFlag("darsh-loot", "containerOf") ?? "").startsWith(sceneUuid));
      if ( left.length ) await Actor.implementation.deleteDocuments(left.map(a => a.id));
      return true;`, setup).catch(err => ctx.log(`cleanup: ${err.message}`)));

    // 1. Hidden settings, no tab, the API says off.
    const shown = await gm(`
      const conf = k => game.settings.settings.get("darsh-loot." + k)?.config;
      const { TABS } = await import("/modules/darsh-loot/scripts/core/settings-tabs.mjs");
      const listed = k => TABS.some(t => t.keys.includes(k));
      return { config: ["lootManage", "lootWhen", "lootMode"].map(conf), listed: ["lootManage", "lootWhen", "lootMode"].some(listed),
        tab: TABS.some(t => t.id === "endLoot"), keepSpecial: listed("keepSpecial"), enabled: game.modules.get("darsh-loot").api.endLoot.enabled() };`);
    ctx.expect(shown?.config?.every(c => c === false), `the three end-of-combat loot settings are hidden (${JSON.stringify(shown?.config)})`);
    ctx.expect(shown && !shown.tab && !shown.listed, "the settings window has no « End-of-combat loot » tab, and lists none of its settings");
    ctx.expect(shown?.keepSpecial === true, "« keep special weapons » (applied at the first search) is still in the settings window");
    ctx.expect(shown?.enabled === false, "api.endLoot.enabled() is false although « lootManage » is on in the world");

    // 2. A real combat ends with both goblins dead.
    const after = await gm(`
      const scene = game.scenes.get(args.scene);
      const combat = await Combat.implementation.create({ scene: scene.id });
      await combat.createEmbeddedDocuments("Combatant", ["actor", "g1", "g2"].map(k => ({ tokenId: args.tokens[k], sceneId: scene.id })));
      await combat.startCombat();
      for ( const k of ["g1", "g2"] ) {
        const a = scene.tokens.get(args.tokens[k]).actor;
        await a.update({ "system.attributes.hp.value": 0 });
        await a.toggleStatusEffect("dead", { active: true, overlay: true });
      }
      await new Promise(r => setTimeout(r, 300));
      await combat.delete();
      await new Promise(r => setTimeout(r, 2500));
      const api = game.modules.get("darsh-loot").api;
      const goblins = ["g1", "g2"].map(k => scene.tokens.get(args.tokens[k]).actor);
      return { open: !!document.querySelector("#darsh-loot-rewards"), records: api.rewards.records().length,
        held: goblins.map((a, i) => !!api.endLoot.heldBy(scene.tokens.get(args.tokens[["g1", "g2"][i]]))),
        rolled: goblins.map(a => !!a.getFlag("darsh-loot", "rolled")), items: goblins.map(a => a.items.size),
        gp: goblins.map(a => a.system.currency.gp) };`, setup);
    ctx.expect(after && !after.open, "no Rewards / Loot window at the end of the combat");
    ctx.expect(after?.records === 0, `no encounter record (DAS's XP off) (${after?.records})`);
    ctx.expect(after?.held?.every(h => !h), `no corpse held (${JSON.stringify(after?.held)})`);
    ctx.expect(after?.rolled?.every(r => !r) && after.items.every(n => n === 1) && after.gp.every(g => g === 5),
      `nothing rolled or added to the corpses at the end of the combat (${JSON.stringify(after)})`);

    // 3. A record an earlier version left pending holds nothing.
    const old = await gm(`
      await game.settings.set("darsh-loot", "rewards", { records: [{ id: "dastestold", name: "Old encounter", status: "none", time: Date.now(),
        foes: [], members: [], loot: { status: "pending", mode: "individual", corpses: [{ key: args.uuids.g1, include: true, name: "DAS goblin A" }] } }] });
      await new Promise(r => setTimeout(r, 300));
      return !!game.modules.get("darsh-loot").api.endLoot.heldBy(fromUuidSync(args.uuids.g1));`, setup);
    ctx.expect(old === false, "a corpse in a record an earlier version left pending is not held");

    // 4. The player searches goblin A and takes everything.
    if ( !setup.ownedByPlayer ) { ctx.log("no character owned by « claude player »: player side not played"); return; }
    const taken = await ctx.asPlayer(`
      const api = game.modules.get("darsh-loot").api;
      const corpse = fromUuidSync(args.uuids.g1);
      const actor = game.actors.get(args.actor);
      const before = { gp: actor.system.currency.gp ?? 0, scimitars: actor.items.filter(i => i.name === "DAS test scimitar").length };
      let error = null;
      let ids = [];
      try {
        await api.ensureRolled?.(corpse);
        await game.users.activeGM.query("darsh-loot.roll", { corpse: args.uuids.g1 }, { timeout: 20000 }).catch(() => null);
        await new Promise(r => setTimeout(r, 800));
        ids = corpse.actor.items.map(i => i.id);
        await game.users.activeGM.query("darsh-loot.take", { source: { kind: "corpse", uuid: args.uuids.g1 }, looter: args.uuids.actor,
          itemIds: ids, coins: true }, { timeout: 20000 });
      } catch(err) { error = String(err?.message ?? err); }
      await new Promise(r => setTimeout(r, 1500));
      return { error, took: ids.length, held: !!api.endLoot.heldBy(corpse),
        gp: (actor.system.currency.gp ?? 0) - before.gp,
        scimitars: actor.items.filter(i => i.name === "DAS test scimitar").length - before.scimitars };`, setup);
    const corpse = await gm(`
      const a = fromUuidSync(args.uuids.g1).actor;
      return { rolled: !!a.getFlag("darsh-loot", "rolled"), items: a.items.size, coins: Object.values(a.system.currency ?? {}).reduce((s, v) => s + (v || 0), 0) };`, setup);
    ctx.expect(taken && !taken.error && !taken.held, `the player's take from goblin A is accepted (${JSON.stringify(taken)})`);
    ctx.expect(taken?.scimitars === 1, `exactly one scimitar reached the character, not two (${taken?.scimitars})`);
    ctx.expect(taken?.gp >= 5, `the goblin's coins reached the character (+${taken?.gp} gp)`);
    ctx.expect(corpse?.rolled && corpse.items === 0 && corpse.coins === 0, `the corpse was rolled once and is now empty (${JSON.stringify(corpse)})`);
  }
};
