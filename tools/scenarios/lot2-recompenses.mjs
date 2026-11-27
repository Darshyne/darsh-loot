/**
 * Lot 2 (2026-11-27) — XP rewards, played on the bench: GM client, and the real player client when there is one. On a temporary
 * scene with a test primary party (the player's character, a companion, an absent character), two goblins, an orc and an NPC ally:
 *  1. semi-automatic (default): a real combat ends with one goblin dead and one at 0 hp — the « Rewards » window opens at the GM on
 *     the encounter's record (goblins ticked, orc not, the absent character unticked, the ally taking a share); the shortcuts are
 *     there (tokens toolbar, Group sheet header, the Core's right-click menu on a character);
 *  2. « Give »: 100 XP split 33 / 33 (the ally's share lost), 1 XP to the party's pool, a public card with floating text over both
 *     characters, the companion can level up; the player's client gets the card;
 *  3. « Give » again: the « already given » window (forceable refusal); giving up writes nothing;
 *  4. the GM client reloads: the record is still there, the window reopens on it;
 *  5. a reward by hand: « New », the DMG « moderate » challenge for the ticked characters, given;
 *  6. per kill: a goblin's XP is given as it dies, not again when it dies twice; the end of the combat closes the record;
 *  7. dnd5e « level up without XP »: no toolbar button, no menu entry, the end of a combat makes no record;
 *  8. player side: no « Rewards » entry in the player's menu, and a crafted award request is refused (GM only).
 * Restored: the viewed scene, the primary party, dnd5e's leveling mode, the rewards settings and records, the player's XP.
 *
 * Run with the Core's runner (on the bench: `npm run banc:passe -- "<this path>"`).
 */
const MODULE = "darsh-loot";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "loot — lot 2: XP rewards (end of combat, window, forced, reload, per kill, noxp, player)",
  players: true,

  async run(ctx) {
    const gm = async (code, args) => (await ctx.call("run-script", { code, ...(args ? { args } : {}), waitMs: 30000 }))?.result;

    const setup = await gm(`
      const S = (k, v) => game.settings.set("darsh-loot", k, v);
      const player = game.users.find(u => u.name === "claude player");
      let actor = game.actors.find(a => (a.type === "character") && player && a.testUserPermission(player, "OWNER"));
      const TEST = { "darsh-loot": { test: true } };
      const previous = { scene: canvas.scene?.id ?? null, level: canvas.level?.id ?? null,
        party: game.settings.get("dnd5e", "primaryParty")?.actor?.id ?? null, active: game.scenes.active?.id ?? null, leveling: game.settings.get("dnd5e", "levelingMode"),
        settings: Object.fromEntries(["xpManage", "xpToolbar", "xpWhen", "xpSplit", "xpRemainder", "xpRecipients", "rewards", "lootManage"].map(k => [k, game.settings.get("darsh-loot", k)])),
        xp: actor?.system.details.xp.value ?? null };
      const pc = name => Actor.implementation.create({ name, type: "character", img: "icons/svg/mystery-man.svg", flags: TEST });
      if ( !actor ) actor = await pc("DAS test hero");
      const companion = await pc("DAS test companion");
      const absent = await pc("DAS test absent");
      const group = await Actor.implementation.create({ name: "DAS test party", type: "group", img: "icons/svg/mystery-man.svg", flags: TEST,
        system: { members: [{ actor: actor.id }, { actor: companion.id }, { actor: absent.id }], details: { xp: { value: 0 } } } });
      await game.settings.set("dnd5e", "primaryParty", { actor: group.id });
      await game.settings.set("dnd5e", "levelingMode", "xp");
      const npc = (name, cr) => Actor.implementation.create({ name, type: "npc", img: "icons/svg/skull.svg", flags: { "darsh-loot": { test: true, rolled: true } },
        system: { attributes: { hp: { value: 7, max: 7 } }, details: { cr, type: { value: "humanoid" } } } });
      const [g1, g2, orc, ally, g3] = [await npc("DAS goblin 1", 0.25), await npc("DAS goblin 2", 0.25), await npc("DAS orc", 0.5),
        await npc("DAS ally", 0.125), await npc("DAS goblin 3", 0.25)];
      const scene = await Scene.create({ name: "DAS Loot — lot 2 rewards (test)", width: 2000, height: 1500, padding: 0,
        grid: { size: 100, distance: 5 }, tokenVision: false, environment: { darknessLevel: 0, globalLight: { enabled: true } },
        ownership: { default: 2 }, flags: TEST });
      const H = CONST.TOKEN_DISPOSITIONS.HOSTILE, F = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
      const at = (a, x, y, extra={}) => ({ name: a.name, actorId: a.id, x, y, elevation: 0, ...extra });
      const tokens = await scene.createEmbeddedDocuments("Token", [
        at(actor, 300, 300, { actorLink: true, disposition: F }), at(companion, 300, 500, { actorLink: true, disposition: F }),
        at(g1, 700, 300, { disposition: H }), at(g2, 700, 500, { disposition: H }), at(orc, 900, 400, { disposition: H }),
        at(ally, 400, 700, { disposition: F }), at(g3, 1100, 400, { disposition: H })]);
      await actor.update({ "system.details.xp.value": 0 });
      await companion.update({ "system.details.xp.value": 280 });
      // Lot 3: this scenario is about XP alone — the end-of-combat loot (on by default) would keep the shortcuts and the window.
      await S("xpManage", true); await S("xpToolbar", true); await S("lootManage", false);
      await S("xpWhen", "semi"); await S("xpSplit", "equal"); await S("xpRemainder", "party"); await S("xpRecipients", "present");
      await S("rewards", { records: [] });
      // Activated, so that the player's client views it too (its right-click menu is read there).
      await scene.activate();
      for ( let i = 0; i < 40 && ((canvas.scene?.id !== scene.id) || !canvas.ready); i++ ) await new Promise(r => setTimeout(r, 250));
      await new Promise(r => setTimeout(r, 800));
      const id = t => t.id;
      return { previous, scene: scene.id, viewed: canvas.scene?.id === scene.id, actor: actor.id, ownedByPlayer: !!player && actor.testUserPermission(player, "OWNER"),
        companion: companion.id, absent: absent.id, group: group.id, party: game.actors.party?.id === group.id,
        tokens: { actor: id(tokens[0]), companion: id(tokens[1]), g1: id(tokens[2]), g2: id(tokens[3]), orc: id(tokens[4]), ally: id(tokens[5]), g3: id(tokens[6]) },
        xp: { g1: g1.system.details.xp.value, orc: orc.system.details.xp.value, ally: ally.system.details.xp.value } };`);
    if ( !ctx.expect(setup?.viewed && setup.party, `test scene, creatures and primary party ready (${JSON.stringify({ viewed: setup?.viewed, party: setup?.party, xp: setup?.xp })})`) ) return;
    ctx.restore(() => gm(`
      const p = args.previous;
      for ( const c of game.combats.filter(c => c.scene?.id === args.scene) ) await c.delete();
      if ( p.active ) await game.scenes.get(p.active)?.activate();
      if ( p.scene ) await game.scenes.get(p.scene)?.view(p.level ? { level: p.level } : {});
      await game.settings.set("dnd5e", "primaryParty", { actor: p.party });
      await game.settings.set("dnd5e", "levelingMode", p.leveling);
      for ( const [k, v] of Object.entries(p.settings) ) await game.settings.set("darsh-loot", k, v);
      if ( p.xp !== null ) await game.actors.get(args.actor)?.update({ "system.details.xp.value": p.xp });
      await game.scenes.get(args.scene)?.delete();
      const left = game.actors.filter(a => a.getFlag("darsh-loot", "test"));
      if ( left.length ) await Actor.implementation.deleteDocuments(left.map(a => a.id));
      for ( const app of foundry.applications.instances.values() ) if ( app.id?.startsWith("darsh-loot-") ) await app.close().catch(() => {});
      ui.controls?.render({ reset: true });
      return true;`, setup).catch(err => ctx.log(`cleanup: ${err.message}`)));
    ctx.expect(setup.xp.g1 === 50 && setup.xp.orc === 100, `dnd5e gives the creatures their XP from their CR (${JSON.stringify(setup.xp)})`);

    const xpNow = () => gm(`
      const x = id => game.actors.get(id)?.system.details.xp.value ?? null;
      return { actor: x(args.actor), companion: x(args.companion), absent: x(args.absent), pool: x(args.group) };`, setup);
    const cardsSince = time => gm(`
      return game.messages.contents.filter(m => m.getFlag("darsh-loot", "rewards") && (m.timestamp >= args.time))
        .map(m => ({ text: m.content.replace(/<[^>]+>/g, "").trim(), whisper: m.whisper.length, float: m.getFlag("darsh-loot", "feedback")?.text ?? null,
          also: m.getFlag("darsh-loot", "feedback")?.also?.length ?? 0 }));`, { time });
    /** A real combat on the test scene with these tokens, started; returns its id. */
    const fight = keys => gm(`
      const scene = game.scenes.get(args.scene);
      const combat = await Combat.implementation.create({ scene: scene.id });
      await combat.createEmbeddedDocuments("Combatant", args.keys.map(k => ({ tokenId: args.tokens[k], sceneId: scene.id })));
      await combat.startCombat();
      return combat.id;`, { ...setup, keys });

    // 1. Semi-automatic: the end of a real combat opens the window on the record.
    const combatId = await fight(["actor", "companion", "g1", "g2", "orc", "ally"]);
    const ended = await gm(`
      const scene = game.scenes.get(args.scene);
      await scene.tokens.get(args.tokens.g1).actor.toggleStatusEffect("dead", { active: true, overlay: true });
      await scene.tokens.get(args.tokens.g2).actor.update({ "system.attributes.hp.value": 0 });
      await game.combats.get(args.combatId).delete();
      for ( let i = 0; i < 40 && !document.querySelector("#darsh-loot-rewards"); i++ ) await new Promise(r => setTimeout(r, 250));
      const api = game.modules.get("darsh-loot").api.rewards;
      const record = api.records()[0] ?? null;
      const win = document.querySelector("#darsh-loot-rewards");
      return { open: !!win, dnd5e: !!win?.classList.contains("dnd5e2"), rows: win?.querySelectorAll(".dlo-rw-row").length ?? 0,
        total: win?.querySelector(".dlo-rw-total")?.textContent?.trim() ?? null, status: record?.status,
        foes: record?.foes.map(f => [f.name, f.defeated, f.include]), members: record?.members.map(m => [m.name, m.present, m.include]),
        allies: record?.allies.map(a => [a.name, a.include]) };`, { ...setup, combatId });
    ctx.expect(ended?.open && ended.dnd5e, `the end of the combat opened the « Rewards » window at the GM, in the dnd5e look (${JSON.stringify({ open: ended?.open, dnd5e: ended?.dnd5e })})`);
    // Sorted: the server does not always give the combatants back in the order they were created.
    ctx.expect(JSON.stringify([...(ended?.foes ?? [])].sort()) === JSON.stringify([["DAS goblin 1", true, true], ["DAS goblin 2", true, true], ["DAS orc", false, false]]),
      `goblins (dead, 0 hp) ticked, the orc (alive) not (${JSON.stringify(ended?.foes)})`);
    ctx.expect(ended?.members?.find(m => m[0] === "DAS test absent")?.[2] === false && ended.members.filter(m => m[2]).length === 2,
      `the two characters who fought are ticked, the absent one is listed unticked (${JSON.stringify(ended?.members)})`);
    ctx.expect(JSON.stringify(ended?.allies) === JSON.stringify([["DAS ally", true]]), `the NPC ally takes a share (${JSON.stringify(ended?.allies)})`);
    ctx.expect(ended?.status === "pending" && /100/.test(ended?.total ?? ""), `record pending, window total 100 XP (« ${ended?.total} »)`);

    const shortcuts = await gm(`
      const label = game.i18n.localize("DLO.Rewards.Menu");
      ui.controls.render({ reset: true });
      await new Promise(r => setTimeout(r, 300));
      const tool = !!ui.controls.controls?.tokens?.tools?.dloRewards;
      const group = game.actors.get(args.group);
      await group.sheet.render(true);
      for ( let i = 0; i < 20 && !group.sheet.element?.querySelector(".dlo-sheet-rewards"); i++ ) await new Promise(r => setTimeout(r, 200));
      const sheet = !!group.sheet.element?.querySelector(".dlo-sheet-rewards");
      await group.sheet.close();
      const engine = game.modules.get("dnd5e-combat")?.api;
      const scene = game.scenes.get(args.scene);
      scene.tokens.get(args.tokens.actor).object?.control({ releaseOthers: true });
      await new Promise(r => setTimeout(r, 300));
      const entries = engine?.ui?.tokenMenu ? await engine.ui.tokenMenu(scene.tokens.get(args.tokens.companion).object) : null;
      canvas.tokens.releaseAll();
      return { tool, sheet, menu: entries ? entries.some(e => e.label === label) : null, labels: (entries ?? []).map(e => e.label) };`, setup);
    ctx.expect(shortcuts?.tool, "a « Rewards » button in the tokens toolbar");
    ctx.expect(shortcuts?.sheet, "a « Rewards » button in the header of dnd5e's Group sheet");
    if ( shortcuts?.menu === null ) ctx.log("the Core has no api.ui.tokenMenu: menu entry not read");
    else ctx.expect(shortcuts?.menu, `« Rewards… » in the Core's right-click menu on a character (${(shortcuts?.labels ?? []).join(" | ")})`);

    // 2. « Give ».
    const t2 = Date.now() - 1000;
    await gm(`document.querySelector("#darsh-loot-rewards [data-action=award]")?.click();
      for ( let i = 0; i < 40 && game.modules.get("darsh-loot").api.rewards.records()[0]?.status !== "awarded"; i++ ) await new Promise(r => setTimeout(r, 250));
      await new Promise(r => setTimeout(r, 800)); return true;`);
    let now = await xpNow();
    ctx.expect(now.actor === 33 && now.companion === 313 && now.absent === 0 && now.pool === 1,
      `given: 33 XP each to the two who fought (the ally's share lost), nothing to the absent one, 1 XP to the party's pool (${JSON.stringify(now)})`);
    const cards = await cardsSince(t2);
    ctx.expect(cards?.length === 1 && cards[0].whisper === 0 && cards[0].float && cards[0].also === 1,
      `one public card, floating text over both characters (${JSON.stringify(cards)})`);
    ctx.expect(/DAS test companion/.test(cards?.[0]?.text ?? "") && (cards?.[0]?.text ?? "").split("DAS test companion").length > 2,
      `the card names the shares and says the companion can level up (« ${cards?.[0]?.text} »)`);
    if ( setup.ownedByPlayer ) {
      const seen = await ctx.asPlayer(`return game.messages.contents.filter(m => m.getFlag("darsh-loot", "rewards") && m.timestamp >= args.time && m.visible).length;`, { time: t2 });
      ctx.expect(seen === 1, `the player's client received the card (${seen})`);
    }

    // 3. « Give » again: the forceable refusal; giving up writes nothing.
    const again = await gm(`
      document.querySelector("#darsh-loot-rewards [data-action=award]")?.click();
      let dialog = null;
      for ( let i = 0; i < 30 && !dialog; i++ ) { await new Promise(r => setTimeout(r, 200));
        dialog = [...foundry.applications.instances.values()].find(a => a.element?.querySelector(".dlo-force-reason")); }
      const text = dialog?.element.querySelector(".dlo-force-reason")?.textContent ?? null;
      dialog?.element.querySelector("[data-action=no]")?.click();
      await new Promise(r => setTimeout(r, 800));
      return { text };`);
    now = await xpNow();
    ctx.expect(!!again?.text && now.actor === 33 && now.companion === 313,
      `giving again: « ${again?.text} » with « do it anyway »; given up, nothing written (${JSON.stringify(now)})`);

    ctx.log("step 4: GM reload");
    // 4. The GM client reloads: the record is still there.
    // The Core's own F5 (its tools/reload.mjs): `api.mcp.reload`, then wait for `status` with a new boot time.
    const engine = async fn => (await ctx.call("call-module-api", { moduleId: "dnd5e-combat", fn, args: {}, waitMs: 5000 }))?.result ?? null;
    const status0 = await engine("status").catch(err => { ctx.log(`status: ${err.message}`); return null; });
    const booted = status0?.bootedAt ?? null;
    ctx.log(`status before reload: ${JSON.stringify(status0)?.slice(0, 300)}`);
    const reloaded = booted ? await engine("reload").then(() => true).catch(err => { ctx.log(`reload: ${err.message}`); return false; }) : false;
    let back = null;
    if ( reloaded ) {
      for ( let i = 0; i < 45 && !(back?.ready && (back.bootedAt !== booted)); i++ ) { await pause(2000); back = await engine("status").catch(() => null); }
    }
    if ( back?.ready && (back.bootedAt !== booted) ) {
      await pause(3000);
      // The connector may need a moment before it runs scripts on the reloaded client: a few tries.
      let after = null;
      let tries = 0;
      for ( let i = 0; (i < 4) && !after; i++, tries++ ) after = await gm(`
        // Few, short waits: a freshly reloaded hidden tab runs its timers slowly.
        const api = game.modules.get("darsh-loot").api.rewards;
        api.open();
        for ( let i = 0; i < 5 && !document.querySelector("#darsh-loot-rewards"); i++ ) await new Promise(r => setTimeout(r, 200));
        const r = api.records()[0];
        return { status: r?.status, awards: r?.awards?.length, window: !!document.querySelector("#darsh-loot-rewards .dlo-rw-done") };`, setup)
        .catch(async err => { ctx.log(`after reload (${i + 1}): ${err.message}`); await pause(5000); return null; });
      ctx.expect(tries === 1, `the first opening of the window after the reload works at once (${tries} tries)`);
      ctx.expect(after?.status === "awarded" && after.awards === 1 && after.window,
        `after the GM's reload the record is intact and the window shows it, goblins marked given (${JSON.stringify(after)})`);
    } else ctx.log("the GM client could not be reloaded here: persistence checked through the world setting only");

    ctx.log(`step 5: by hand (back: ${JSON.stringify(back)?.slice(0, 200)})`);
    // 5. A reward by hand: « New », the DMG « moderate » challenge.
    const manual = await gm(`
      const api = game.modules.get("darsh-loot").api.rewards;
      api.open();
      for ( let i = 0; i < 20 && !document.querySelector("#darsh-loot-rewards"); i++ ) await new Promise(r => setTimeout(r, 200));
      document.querySelector("#darsh-loot-rewards [data-action=create]")?.click();
      for ( let i = 0; i < 20 && api.records()[0]?.foes?.length !== 0; i++ ) await new Promise(r => setTimeout(r, 200));
      await new Promise(r => setTimeout(r, 500));
      const id = api.records()[0].id;
      const absent = api.record(id).members.map(m => ({ ...m, include: !m.name.includes("absent") }));
      await api.update(id, { members: absent });
      await new Promise(r => setTimeout(r, 500));
      document.querySelector("#darsh-loot-rewards [data-action=challenge][data-difficulty=moderate]")?.click();
      for ( let i = 0; i < 20 && !api.record(id).bonus; i++ ) await new Promise(r => setTimeout(r, 200));
      const bonus = api.record(id).bonus;
      const done = await api.award(id);
      return { bonus, done };`, setup);
    now = await xpNow();
    ctx.expect(manual?.bonus > 0 && manual.done?.xp === manual.bonus && now.actor === 33 + (manual.bonus / 2) && now.absent === 0,
      `a reward by hand: the « moderate » challenge is worth ${manual?.bonus} XP for the two ticked characters, given (${JSON.stringify(now)})`);

    ctx.log("step 6: per kill");
    // 6. Per kill.
    await gm(`await game.settings.set("darsh-loot", "xpWhen", "kill"); return true;`);
    const before = await xpNow();
    const killId = await fight(["actor", "companion", "g3"]);
    const kill = await gm(`
      const scene = game.scenes.get(args.scene);
      const g3 = scene.tokens.get(args.tokens.g3).actor;
      const count = () => game.messages.contents.filter(m => m.getFlag("darsh-loot", "rewards")).length;
      const start = count();
      await g3.toggleStatusEffect("dead", { active: true, overlay: true });
      for ( let i = 0; i < 30 && count() === start; i++ ) await new Promise(r => setTimeout(r, 250));
      const first = count() - start;
      await g3.toggleStatusEffect("dead", { active: false });
      await g3.toggleStatusEffect("dead", { active: true, overlay: true });
      await new Promise(r => setTimeout(r, 2000));
      const second = count() - start;
      const status = game.modules.get("darsh-loot").api.rewards.records().find(r => r.combat === args.killId)?.status;
      await game.combats.get(args.killId).delete();
      await new Promise(r => setTimeout(r, 1500));
      const closed = game.modules.get("darsh-loot").api.rewards.records().find(r => r.combat === args.killId)?.status;
      return { first, second, status, closed, extra: count() - start };`, { ...setup, killId });
    now = await xpNow();
    ctx.expect(kill?.first === 1 && kill.status === "open" && now.actor === before.actor + 25 && now.companion === before.companion + 25,
      `per kill: the goblin's 50 XP given as it dies, 25 each, the record stays open (${JSON.stringify({ kill, before, now })})`);
    ctx.expect(kill?.second === 1 && kill.extra === 1 && kill.closed === "awarded", `dying again gives nothing more; the end of the combat closes the record (${JSON.stringify(kill)})`);

    // 7 bis. The user's switches: the toolbar button hidden on its own; DAS's XP off (the default) hides everything.
    const switches = await gm(`
      const S = (k, v) => game.settings.set("darsh-loot", k, v);
      const tool = () => !!ui.controls.controls?.tokens?.tools?.dloRewards;
      const label = game.i18n.localize("DLO.Rewards.Menu");
      const engine = game.modules.get("dnd5e-combat")?.api;
      const scene = game.scenes.get(args.scene);
      const menu = async () => { scene.tokens.get(args.tokens.actor).object?.control({ releaseOthers: true });
        await new Promise(r => setTimeout(r, 300));
        const entries = engine?.ui?.tokenMenu ? await engine.ui.tokenMenu(scene.tokens.get(args.tokens.companion).object) : [];
        canvas.tokens.releaseAll(); return entries.some(e => e.label === label); };
      await S("xpToolbar", false); await new Promise(r => setTimeout(r, 300));
      const hidden = { tool: tool(), menu: await menu() };
      await S("xpToolbar", true); await S("xpManage", false); await new Promise(r => setTimeout(r, 300));
      for ( const app of foundry.applications.instances.values() ) if ( app.id === "darsh-loot-rewards" ) await app.close();
      const opened = game.modules.get("darsh-loot").api.rewards.open();
      const off = { tool: tool(), menu: await menu(), opened: !!opened };
      await S("xpManage", true); await new Promise(r => setTimeout(r, 300));
      return { hidden, off, label, back: tool() };`, setup);
    ctx.expect(switches && !switches.hidden.tool && switches.hidden.menu, `« XP button in the toolbar » off: no toolbar button, the menu entry stays (${JSON.stringify(switches?.hidden)})`);
    ctx.expect(switches && !switches.off.tool && !switches.off.menu && !switches.off.opened && switches.back,
      `« Handle XP with DAS » off: no button, no menu entry, the window does not open; back on, the button returns (${JSON.stringify(switches)})`);
    ctx.expect(switches?.label === "XP…", `the menu entry is called « ${switches?.label} »`);

    // 7. dnd5e levels up without XP: silent.
    const noxp = await gm(`
      await game.settings.set("dnd5e", "levelingMode", "noxp");
      await game.settings.set("darsh-loot", "xpWhen", "semi");
      ui.controls.render({ reset: true });
      await new Promise(r => setTimeout(r, 300));
      const tool = !!ui.controls.controls?.tokens?.tools?.dloRewards;
      const api = game.modules.get("darsh-loot").api.rewards;
      const n = api.records().length;
      const scene = game.scenes.get(args.scene);
      const combat = await Combat.implementation.create({ scene: scene.id });
      await combat.createEmbeddedDocuments("Combatant", [args.tokens.actor, args.tokens.orc].map(tokenId => ({ tokenId, sceneId: scene.id })));
      await combat.startCombat();
      await combat.delete();
      await new Promise(r => setTimeout(r, 1500));
      const engine = game.modules.get("dnd5e-combat")?.api;
      scene.tokens.get(args.tokens.actor).object?.control({ releaseOthers: true });
      await new Promise(r => setTimeout(r, 300));
      const entries = engine?.ui?.tokenMenu ? await engine.ui.tokenMenu(scene.tokens.get(args.tokens.companion).object) : [];
      canvas.tokens.releaseAll();
      await game.settings.set("dnd5e", "levelingMode", "xp");
      ui.controls.render({ reset: true });
      return { tool, records: api.records().length - n, menu: entries.some(e => e.label === game.i18n.localize("DLO.Rewards.Menu")) };`, setup);
    ctx.expect(noxp && !noxp.tool && noxp.records === 0 && !noxp.menu, `dnd5e without XP: no toolbar button, no menu entry, no record (${JSON.stringify(noxp)})`);

    // 8. Player side.
    if ( !setup.ownedByPlayer ) { ctx.log("no character owned by « claude player »: player side not played"); return; }
    const playerSide = await ctx.asPlayer(`
      const engine = game.modules.get("dnd5e-combat")?.api;
      const label = game.i18n.localize("DLO.Rewards.Menu");
      let labels = null;
      const mine = canvas.scene?.tokens.get(args.tokens.actor);
      if ( engine?.ui?.tokenMenu && mine?.object && canvas.scene?.id === args.scene ) {
        mine.object.control({ releaseOthers: true });
        await new Promise(r => setTimeout(r, 300));
        labels = (await engine.ui.tokenMenu(canvas.scene.tokens.get(args.tokens.companion).object) ?? []).map(e => e.label);
        canvas.tokens.releaseAll();
      }
      const id = game.modules.get("darsh-loot").api.rewards.records()[0]?.id ?? "x";
      let error = null;
      try { await game.users.activeGM.query("darsh-loot.awardXP", { id, force: true }, { timeout: 20000 }); }
      catch(err) { error = String(err?.message ?? err); }
      return { labels, hasEntry: labels ? labels.includes(label) : null, error, tool: !!ui.controls.controls?.tokens?.tools?.dloRewards };`, setup);
    if ( playerSide?.labels === null ) ctx.log("the player's client does not view the test scene: its menu is not read");
    else ctx.expect(playerSide?.hasEntry === false, `no « Rewards » entry in the player's menu (${(playerSide?.labels ?? []).join(" | ")})`);
    ctx.expect(!playerSide?.tool, "no « Rewards » button in the player's toolbar");
    const after = await xpNow();
    ctx.expect(!!playerSide?.error && /GM/i.test(playerSide.error) && after.actor === now.actor, `a crafted award request from the player is refused (« ${playerSide?.error} »), nothing written`);
  }
};
