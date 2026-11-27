/**
 * Lot 3 (2026-11-27) — end-of-combat loot, played on the bench: GM client, and the real player client when there is one. On a
 * temporary ACTIVE scene, the character of « claude player » and four goblins (a scimitar each, 5 gp, the DMG « individual »
 * treasure), DAS's XP off (the default), a custom loot rule for humanoids of CR 0–1 (a world table with one « DAS test trinket »):
 *  1. individual: a real combat ends with two goblins dead — the window opens at the GM named « Loot », in the dnd5e look, with the
 *     two corpses; they are held: the player's take is refused, its client sees them held; the « Loot tables » window opens;
 *  2. « Distribute the loot »: each corpse is rolled (the rule's trinket, more than its 5 gp), the record says it, a public card; the
 *     player then takes a corpse's coins;
 *  3. grouped, with a GM reload before validation: a second combat, two more goblins; « In one shared chest » and « keep special
 *     weapons » ticked; the GM client reloads — the record, its mode and the held corpses are still there; « Gather the loot »: one
 *     encounter chest on the scene (a whole square, chest icon), holding both scimitars (kept special) and the coins, the corpses
 *     empty;
 *  4. the player takes everything from the encounter chest: it reaches the character, and the emptied chest disappears.
 * Restored: the active and viewed scenes, the settings, the records, the test actors, table and chest stores.
 *
 * Run with the Core's runner (on the bench: `npm run banc:passe -- "<this path>"`).
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "loot — lot 3: end-of-combat loot (individual, grouped chest, GM reload, player takes from the chest)",
  players: true,

  async run(ctx) {
    const gm = async (code, args) => (await ctx.call("run-script", { code, ...(args ? { args } : {}), waitMs: 30000 }))?.result;

    const setup = await gm(`
      const S = (k, v) => game.settings.set("darsh-loot", k, v);
      const player = game.users.find(u => u.name === "claude player");
      let actor = game.actors.find(a => (a.type === "character") && player && a.testUserPermission(player, "OWNER"));
      const TEST = { "darsh-loot": { test: true } };
      const KEYS = ["xpManage", "lootWhen", "lootMode", "keepSpecial", "lootRules", "rewards", "reach", "autoTreasure", "whoLoots", "pockets"];
      const previous = { scene: canvas.scene?.id ?? null, level: canvas.level?.id ?? null, active: game.scenes.active?.id ?? null,
        settings: Object.fromEntries(KEYS.map(k => [k, game.settings.get("darsh-loot", k)])),
        purse: actor ? { ...actor.system.currency } : null, items: actor ? actor.items.map(i => i.id) : [] };
      let own = false;
      if ( !actor ) { actor = await Actor.implementation.create({ name: "DAS test hero", type: "character", img: "icons/svg/mystery-man.svg", flags: TEST }); own = true; }
      const table = await RollTable.implementation.create({ name: "DAS test loot rule", formula: "1d1", replacement: true, flags: TEST,
        results: [{ type: "text", range: [1, 1], weight: 1, name: "DAS test trinket", description: "DAS test trinket" }] });
      const goblin = name => Actor.implementation.create({ name, type: "npc", img: "icons/svg/skull.svg", flags: TEST,
        system: { attributes: { hp: { value: 7, max: 7 } }, currency: { gp: 5 },
          details: { cr: 0.25, type: { value: "humanoid" }, treasure: { value: ["individual"] } } },
        items: [{ name: "DAS test scimitar", type: "weapon", system: { quantity: 1, properties: ["gear", "fin"] } }] });
      const [g1, g2, g3, g4] = [await goblin("DAS goblin A"), await goblin("DAS goblin B"), await goblin("DAS goblin C"), await goblin("DAS goblin D")];
      const scene = await Scene.create({ name: "DAS Loot — lot 3 end-of-combat loot (test)", width: 2000, height: 1500, padding: 0,
        grid: { size: 100, distance: 5 }, tokenVision: false, environment: { darknessLevel: 0, globalLight: { enabled: true } },
        ownership: { default: 2 }, flags: TEST });
      const H = CONST.TOKEN_DISPOSITIONS.HOSTILE, F = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
      const at = (a, x, y, extra={}) => ({ name: a.name, actorId: a.id, x, y, elevation: 0, ...extra });
      const tokens = await scene.createEmbeddedDocuments("Token", [
        at(actor, 400, 300, { actorLink: true, disposition: F }),
        at(g1, 500, 300, { disposition: H }), at(g2, 500, 400, { disposition: H }),
        at(g3, 600, 300, { disposition: H }), at(g4, 700, 300, { disposition: H })]);
      await S("xpManage", false); await S("lootWhen", "semi"); await S("lootMode", "individual"); await S("keepSpecial", false);
      await S("reach", 10); await S("autoTreasure", true); await S("whoLoots", "all"); await S("pockets", false);
      await S("lootRules", { rules: [{ id: "dastest", crMin: 0, crMax: 1, type: "humanoid", size: "", table: table.uuid, draws: 1, effect: "add" }] });
      await S("rewards", { records: [] });
      await scene.activate();
      await scene.view();
      for ( let i = 0; i < 40 && ((canvas.scene?.id !== scene.id) || !canvas.ready); i++ ) await new Promise(r => setTimeout(r, 250));
      await new Promise(r => setTimeout(r, 1000));
      const id = t => t.id;
      return { previous, own, scene: scene.id, viewed: canvas.scene?.id === scene.id, actor: actor.id, table: table.id,
        ownedByPlayer: !!player && actor.testUserPermission(player, "OWNER"),
        tokens: { actor: id(tokens[0]), g1: id(tokens[1]), g2: id(tokens[2]), g3: id(tokens[3]), g4: id(tokens[4]) },
        uuids: { actor: tokens[0].uuid, g1: tokens[1].uuid, g2: tokens[2].uuid, g3: tokens[3].uuid, g4: tokens[4].uuid } };`);
    if ( !ctx.expect(setup?.viewed, `test scene, goblins and loot rule ready, viewed by the GM (${JSON.stringify({ viewed: setup?.viewed })})`) ) return;
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
      await game.tables.get(args.table)?.delete();
      return true;`, setup).catch(err => ctx.log(`cleanup: ${err.message}`)));

    /** A real combat with these tokens, started; the goblins named are killed; the combat is deleted (the Core says it ended). */
    const fightAndKill = keys => gm(`
      for ( const app of foundry.applications.instances.values() ) if ( app.id === "darsh-loot-rewards" ) await app.close();
      await new Promise(r => setTimeout(r, 300));
      const scene = game.scenes.get(args.scene);
      const combat = await Combat.implementation.create({ scene: scene.id });
      await combat.createEmbeddedDocuments("Combatant", ["actor", ...args.keys].map(k => ({ tokenId: args.tokens[k], sceneId: scene.id })));
      await combat.startCombat();
      for ( const k of args.keys ) {
        const a = scene.tokens.get(args.tokens[k]).actor;
        await a.update({ "system.attributes.hp.value": 0 });
        await a.toggleStatusEffect("dead", { active: true, overlay: true });
      }
      await new Promise(r => setTimeout(r, 300));
      await combat.delete();
      for ( let i = 0; i < 40 && !document.querySelector("#darsh-loot-rewards"); i++ ) await new Promise(r => setTimeout(r, 250));
      await new Promise(r => setTimeout(r, 500));
      const win = document.querySelector("#darsh-loot-rewards");
      const app = [...foundry.applications.instances.values()].find(a => a.id === "darsh-loot-rewards");
      const record = game.modules.get("darsh-loot").api.rewards.records()[0] ?? null;
      const api = game.modules.get("darsh-loot").api.endLoot;
      return { open: !!win, dnd5e: !!win?.classList.contains("dnd5e2"), title: app?.title ?? null, id: record?.id ?? null,
        status: record?.status, loot: record?.loot?.status, corpses: (record?.loot?.corpses ?? []).map(c => c.name),
        rows: win?.querySelectorAll(".dlo-rw-loot .dlo-rw-row").length ?? 0, xpShown: !!win?.querySelector("[data-action=award]"),
        held: args.keys.map(k => !!api.heldBy(scene.tokens.get(args.tokens[k]))) };`, { ...setup, keys });

    // 1. Individual: the end of a real combat opens the window on the encounter's loot.
    const first = await fightAndKill(["g1", "g2"]);
    ctx.expect(first?.open && first.dnd5e, `the end of the combat opened the window at the GM, in the dnd5e look (${JSON.stringify({ open: first?.open, dnd5e: first?.dnd5e })})`);
    ctx.expect(first?.title === "Loot" || first?.title === "Butin", `with DAS's XP off the window is named after the loot (« ${first?.title} »), no XP part (${!first?.xpShown})`);
    ctx.expect(!first?.xpShown, "no « Give XP » button while DAS's XP is off");
    ctx.expect(first?.loot === "pending" && first.rows === 2 && JSON.stringify(first.corpses) === JSON.stringify(["DAS goblin A", "DAS goblin B"]),
      `the record has a pending loot part with the two corpses (${JSON.stringify({ loot: first?.loot, corpses: first?.corpses, rows: first?.rows })})`);
    ctx.expect(first?.held?.every(Boolean), `both corpses are held until the GM distributes (${JSON.stringify(first?.held)})`);

    if ( setup.ownedByPlayer ) {
      const before = await ctx.asPlayer(`
        const api = game.modules.get("darsh-loot").api;
        const corpse = fromUuidSync(args.uuids.g1);
        let error = null;
        try { await game.users.activeGM.query("darsh-loot.take", { source: { kind: "corpse", uuid: args.uuids.g1 }, looter: args.uuids.actor,
          itemIds: [], coins: true }, { timeout: 20000 }); }
        catch(err) { error = String(err?.message ?? err); }
        return { held: !!api.endLoot.heldBy(corpse), error };`, setup);
      ctx.expect(before?.held, "the player's client sees the corpse held");
      ctx.expect(!!before?.error && /GM|MJ/.test(before.error), `a player's take from a held corpse is refused (« ${before?.error} »)`);
    } else ctx.log("no character owned by « claude player »: player side not played");

    const rules = await gm(`
      document.querySelector("#darsh-loot-rewards [data-action=lootRules]")?.click();
      for ( let i = 0; i < 20 && !document.querySelector("#darsh-loot-loot-rules"); i++ ) await new Promise(r => setTimeout(r, 200));
      const win = document.querySelector("#darsh-loot-loot-rules");
      const out = { open: !!win, dnd5e: !!win?.classList.contains("dnd5e2"), rows: win?.querySelectorAll(".dlo-rule").length ?? 0,
        table: win?.querySelector(".dlo-rule [data-field=table]")?.value ?? null };
      const app = [...foundry.applications.instances.values()].find(a => a.id === "darsh-loot-loot-rules");
      await app?.close();
      return out;`);
    ctx.expect(rules?.open && rules.dnd5e && rules.rows === 1 && /RollTable/.test(rules.table ?? ""),
      `« Loot tables… » opens the rules window in the dnd5e look, with the test rule and its table (${JSON.stringify(rules)})`);

    // 2. « Distribute the loot » (individual).
    const t2 = Date.now() - 1000;
    const dist = await gm(`
      document.querySelector("#darsh-loot-rewards [data-action=distribute]")?.click();
      const api = game.modules.get("darsh-loot").api;
      for ( let i = 0; i < 60 && api.rewards.record(args.id)?.loot?.status !== "done"; i++ ) await new Promise(r => setTimeout(r, 250));
      await new Promise(r => setTimeout(r, 500));
      const scene = game.scenes.get(args.scene);
      const view = k => { const a = scene.tokens.get(args.tokens[k]).actor;
        return { rolled: !!a.getFlag("darsh-loot", "rolled"), gp: a.system.currency.gp, items: a.items.map(i => i.name).sort() }; };
      const cards = game.messages.contents.filter(m => (m.timestamp >= args.since) && m.getFlag("darsh-loot", "endLoot") === args.id)
        .map(m => ({ whisper: m.whisper.length, text: m.content.replace(/<[^>]+>/g, "").trim() }));
      return { loot: api.rewards.record(args.id)?.loot, g1: view("g1"), g2: view("g2"), cards,
        held: !!api.endLoot.heldBy(scene.tokens.get(args.tokens.g1)), line: document.querySelector("#darsh-loot-rewards .dlo-rw-done-line")?.textContent?.trim() ?? null };`,
      { ...setup, id: first?.id, since: t2 });
    ctx.expect(dist?.loot?.status === "done" && dist.loot.mode === "individual" && !dist.held,
      `distributed (individual): the record says it and the corpses are free (${JSON.stringify({ status: dist?.loot?.status, mode: dist?.loot?.mode, held: dist?.held })})`);
    ctx.expect(dist?.g1?.rolled && dist.g2.rolled && dist.g1.items.includes("DAS test trinket") && dist.g2.items.includes("DAS test trinket"),
      `each corpse was rolled and got the custom rule's table draw (${JSON.stringify({ g1: dist?.g1, g2: dist?.g2 })})`);
    ctx.expect(dist?.g1?.gp > 5 && dist.g2.gp > 5, `the DMG individual treasure was added to their 5 gp (${dist?.g1?.gp} gp, ${dist?.g2?.gp} gp)`);
    ctx.expect(dist?.cards?.length === 1 && dist.cards[0].whisper === 0, `one public card announces the loot (${JSON.stringify(dist?.cards)})`);
    ctx.expect(!!dist?.line, `the window shows the loot as distributed (« ${dist?.line} »)`);

    if ( setup.ownedByPlayer ) {
      const took = await ctx.asPlayer(`
        const api = game.modules.get("darsh-loot").api;
        const before = game.actors.get(args.actor).system.currency.gp;
        const r = await api.take(fromUuidSync(args.uuids.g1), fromUuidSync(args.uuids.actor), { coins: true });
        await new Promise(res => setTimeout(res, 800));
        return { r: !!r, gained: game.actors.get(args.actor).system.currency.gp - before };`, setup);
      ctx.expect(took?.r && took.gained >= dist?.g1?.gp, `after the distribution the player takes the corpse's coins (${JSON.stringify(took)})`);
    }

    // 3. Grouped, with a GM reload before validation.
    const second = await fightAndKill(["g3", "g4"]);
    ctx.expect(second?.open && second.loot === "pending" && second.held?.every(Boolean), `a second combat: a new record, its two corpses held (${JSON.stringify(second)})`);
    const chosen = await gm(`
      const win = document.querySelector("#darsh-loot-rewards");
      const radio = win?.querySelector("input[name=lootMode][value=grouped]");
      if ( radio ) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); }
      const api = game.modules.get("darsh-loot").api.rewards;
      for ( let i = 0; i < 20 && api.record(args.id)?.loot?.mode !== "grouped"; i++ ) await new Promise(r => setTimeout(r, 200));
      await new Promise(r => setTimeout(r, 400));
      const box = document.querySelector("#darsh-loot-rewards input[name=keepSpecial]");
      if ( box ) { box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); }
      for ( let i = 0; i < 20 && !api.record(args.id)?.loot?.keepSpecial; i++ ) await new Promise(r => setTimeout(r, 200));
      const loot = api.record(args.id)?.loot;
      return { mode: loot?.mode, keepSpecial: loot?.keepSpecial };`, { id: second?.id });
    ctx.expect(chosen?.mode === "grouped" && chosen.keepSpecial, `« In one shared chest » and « keep special weapons » saved in the record (${JSON.stringify(chosen)})`);

    ctx.log("step 3: GM reload before validation");
    const engine = async fn => (await ctx.call("call-module-api", { moduleId: "dnd5e-combat", fn, args: {}, waitMs: 5000 }))?.result ?? null;
    const status0 = await engine("status").catch(err => { ctx.log(`status: ${err.message}`); return null; });
    const booted = status0?.bootedAt ?? null;
    const reloaded = booted ? await engine("reload").then(() => true).catch(err => { ctx.log(`reload: ${err.message}`); return false; }) : false;
    let back = null;
    if ( reloaded ) {
      for ( let i = 0; i < 45 && !(back?.ready && (back.bootedAt !== booted)); i++ ) { await pause(2000); back = await engine("status").catch(() => null); }
    }
    const didReload = !!(back?.ready && (back.bootedAt !== booted));
    if ( didReload ) await pause(3000);
    else ctx.log("the GM client could not be reloaded here: persistence checked through the world setting only");
    let after = null;
    for ( let i = 0; (i < 4) && !after; i++ ) after = await gm(`
      const api = game.modules.get("darsh-loot").api;
      api.rewards.open(args.id);
      for ( let i = 0; i < 10 && !document.querySelector("#darsh-loot-rewards .dlo-rw-loot"); i++ ) await new Promise(r => setTimeout(r, 200));
      const scene = game.scenes.get(args.scene);
      const loot = api.rewards.record(args.id)?.loot;
      const checked = document.querySelector("#darsh-loot-rewards input[name=lootMode]:checked")?.value ?? null;
      return { status: loot?.status, mode: loot?.mode, checked, held: ["g3", "g4"].map(k => !!api.endLoot.heldBy(scene.tokens.get(args.tokens[k]))) };`,
      { ...setup, id: second?.id }).catch(async err => { ctx.log(`after reload (${i + 1}): ${err.message}`); await pause(5000); return null; });
    ctx.expect(after?.status === "pending" && after.mode === "grouped" && after.checked === "grouped" && after.held?.every(Boolean),
      `${didReload ? "after the GM's reload" : "reopened"}: the record, its grouped mode and the held corpses are still there (${JSON.stringify(after)})`);

    const grouped = await gm(`
      const api = game.modules.get("darsh-loot").api;
      document.querySelector("#darsh-loot-rewards [data-action=distribute]")?.click();
      for ( let i = 0; i < 80 && api.rewards.record(args.id)?.loot?.status !== "done"; i++ ) await new Promise(r => setTimeout(r, 250));
      await new Promise(r => setTimeout(r, 800));
      const scene = game.scenes.get(args.scene);
      const loot = api.rewards.record(args.id)?.loot;
      const behavior = loot?.chest ? fromUuidSync(loot.chest.behavior) : null;
      const region = behavior?.parent ?? null;
      const store = behavior?.system?.actor ? fromUuidSync(behavior.system.actor) : null;
      const tile = region ? scene.tiles.get(region.getFlag("darsh-loot", "pile")?.tile) : null;
      const corpse = k => api.view(scene.tokens.get(args.tokens[k]));
      return { status: loot?.status, mode: loot?.mode, behavior: behavior?.uuid ?? null, encounter: region?.getFlag("darsh-loot", "pile")?.encounter ?? null,
        width: tile?.width ?? null, grid: scene.grid.size, img: tile?.texture?.src ?? null,
        storeItems: store ? store.items.map(i => ({ name: i.name, preserve: i.getFlag("dnd5e", "gear")?.preserve ?? null })) : null,
        storeGp: store?.system.currency.gp ?? null, g3: corpse("g3").empty, g4: corpse("g4").empty };`, { ...setup, id: second?.id });
    ctx.expect(grouped?.status === "done" && grouped.mode === "grouped" && !!grouped.behavior && grouped.encounter === second?.id,
      `« Gather the loot »: an encounter chest on the scene, tied to the record (${JSON.stringify({ status: grouped?.status, encounter: grouped?.encounter })})`);
    ctx.expect(grouped?.width === grouped?.grid && /chest/.test(grouped?.img ?? ""), `the chest takes a whole square, with a chest icon (${grouped?.width} px, ${grouped?.img})`);
    const scimitars = (grouped?.storeItems ?? []).filter(i => i.name === "DAS test scimitar");
    ctx.expect(scimitars.length >= 1 && scimitars.every(i => i.preserve === true) && (grouped?.storeItems ?? []).some(i => i.name === "DAS test trinket"),
      `the chest holds the scimitars (kept special) and the rule's trinkets (${JSON.stringify(grouped?.storeItems)})`);
    ctx.expect(grouped?.storeGp >= 10 && grouped.g3 && grouped.g4, `the coins went in too (${grouped?.storeGp} gp) and both corpses are empty`);

    // 4. The player takes everything from the encounter chest.
    if ( !setup.ownedByPlayer || !grouped?.behavior ) return;
    // The character walks up to the chest (the GM moves its token next to it).
    const walked = await gm(`
      const region = fromUuidSync(args.behavior)?.parent;
      const b = region?.bounds;
      const token = game.scenes.get(args.scene).tokens.get(args.tokens.actor);
      if ( !b || !token ) return null;
      await token.update({ x: b.x - 100, y: b.y }, { animate: false });
      await new Promise(r => setTimeout(r, 500));
      return { x: token.x, y: token.y, chest: { x: b.x, y: b.y } };`, { ...setup, behavior: grouped.behavior });
    ctx.log(`character next to the chest: ${JSON.stringify(walked)}`);
    const fromChest = await ctx.asPlayer(`
      const api = game.modules.get("darsh-loot").api;
      const behavior = fromUuidSync(args.behavior);
      const store = fromUuidSync(behavior.system.actor);
      const ids = api.view(store).entries.map(e => e.id);
      const before = { gp: game.actors.get(args.actor).system.currency.gp, items: game.actors.get(args.actor).items.size };
      let error = null;
      try {
        await game.users.activeGM.query("darsh-loot.take", { source: { kind: "container", uuid: args.behavior }, looter: args.uuids.actor,
          itemIds: ids, coins: true }, { timeout: 20000 });
      } catch(err) { error = String(err?.message ?? err); }
      await new Promise(res => setTimeout(res, 1500));
      const actor = game.actors.get(args.actor);
      return { r: !error, error, took: ids.length, gp: actor.system.currency.gp - before.gp, items: actor.items.size - before.items,
        scimitar: actor.items.some(i => i.name === "DAS test scimitar") };`, { ...setup, behavior: grouped.behavior });
    const gone = await gm(`await new Promise(r => setTimeout(r, 1000)); return { exists: !!fromUuidSync(args.behavior) };`, { behavior: grouped.behavior });
    ctx.expect(fromChest?.r && fromChest.gp >= grouped.storeGp && fromChest.scimitar && fromChest.items >= 1,
      `the player took everything from the encounter chest (${JSON.stringify(fromChest)})`);
    ctx.expect(gone && !gone.exists, "the emptied encounter chest disappeared");
  }
};
