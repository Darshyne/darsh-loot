/**
 * A real player (role Player, not Assistant GM), with an active GM connected and the game unpaused, uses Loot & Trade (Discord,
 * MArcoBossio, « Standard Players cannot interact with Container Regions/Tiles », 2026-11-26). On a temporary ACTIVE scene with
 * default ownership None (like a real scene) and two levels (ground 0–20, upper 20–40, a rug tile upstairs), a token of
 * « claude player »'s character on each floor, a container region next to each token and a trap region on each floor:
 *  1. the player drops an item from their character on the ground (the `dropCanvasData` hook, the canvas gesture): the pile is
 *     created through the active GM — no permission error on the player's side, the item leaves the sheet;
 *  2. holding the highlight key, the containers shine for the player, they stand where the player sees them, and opening one shows
 *     the loot window;
 *  3. a trap the GM has not revealed is not drawn for the player; once revealed (the « Show the trap to players » menu entry), it is
 *     drawn in red for the player too.
 * Each step is played on the ground floor and on the upper floor (and on a « Tile → zone » chest downstairs). Held on 0.22.5 the day
 * of the report (bench, 22 checks): the report was not reproduced with Loot & Trade alone; this scenario guards the player path. Without the bench's player client: not applicable. Restored:
 * active scene, scene (with its tiles, regions and tokens), stores, test item.
 *
 * Run with the Core's runner: `node tools/scenario.mjs "../Foundry dnd5e butin et commerce/tools/scenarios/joueur-interactions.mjs"`
 * (on the bench: `npm run banc:passe -- "<that path>"`).
 */
const MODULE = "darsh-loot";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "loot — a real player drops, highlights, opens and sees spotted traps (ground and upper floor)",
  players: true,

  async run(ctx) {
    const gm = async (code, args) => (await ctx.call("run-script", { code, ...(args ? { args } : {}), waitMs: 20000 }))?.result;

    // 1. The scene.
    const setup = await gm(`
      const player = game.users.find(u => u.name === "claude player");
      const actor = game.actors.find(a => (a.type === "character") && player && a.testUserPermission(player, "OWNER"));
      if ( !player || !actor ) return { missing: true };
      const previous = { active: game.scenes.active?.id ?? null, viewed: canvas.scene?.id ?? null, paused: game.paused };
      const scene = await Scene.create({ name: "DAS Loot — player (test)", width: 2000, height: 2000, padding: 0,
        grid: { size: 100, distance: 5 }, tokenVision: true, environment: { darknessLevel: 0, globalLight: { enabled: true } },
        flags: { "darsh-loot": { test: true } } });
      const ground = scene.levels.contents[0];
      await ground.update({ name: "Ground", elevation: { bottom: 0, top: 20 } });
      const [upper] = await scene.createEmbeddedDocuments("Level", [{ name: "Upper", elevation: { bottom: 20, top: 40 } }]);
      await scene.createEmbeddedDocuments("Tile", [{ texture: { src: "ui/parchment.jpg" }, x: 900, y: 900, width: 800, height: 800,
        elevation: 20, levels: [upper.id] }]);
      const tokens = await scene.createEmbeddedDocuments("Token", [
        { name: actor.name, actorId: actor.id, actorLink: true, x: 300, y: 300, elevation: 0, level: ground.id, sight: { enabled: true, range: 60 } },
        { name: actor.name, actorId: actor.id, actorLink: true, x: 1100, y: 1100, elevation: 20, level: upper.id, sight: { enabled: true, range: 60 } }]);
      const rect = (x, y) => [{ type: "rectangle", x, y, width: 100, height: 100 }];
      const regions = await scene.createEmbeddedDocuments("Region", [
        { name: "Chest ground (test)", levels: [ground.id], shapes: rect(400, 300),
          behaviors: [{ type: "darsh-loot.container", name: "Chest", system: {} }] },
        { name: "Chest upper (test)", levels: [upper.id], shapes: rect(1200, 1100),
          behaviors: [{ type: "darsh-loot.container", name: "Chest", system: {} }] },
        { name: "Trap ground (test)", levels: [ground.id], shapes: rect(300, 500),
          behaviors: [{ type: "darsh-loot.trap", name: "Trap", system: { hidden: { enabled: true, dc: 30, passive: 0 }, disarmDc: 10 } }] },
        { name: "Trap upper (test)", levels: [upper.id], shapes: rect(1100, 1300),
          behaviors: [{ type: "darsh-loot.trap", name: "Trap", system: { hidden: { enabled: true, dc: 30, passive: 0 }, disarmDc: 10 } }] }]);
      // An interactive tile: a chest image turned into a container zone (« Tile → zone »: a region bound to the tile, no level).
      const [chestTile] = await scene.createEmbeddedDocuments("Tile", [{ texture: { src: "icons/containers/chest/chest-reinforced-steel-brown.webp" },
        x: 200, y: 300, width: 100, height: 100, elevation: 0, levels: [ground.id] }]);
      const [tileChest] = await scene.createEmbeddedDocuments("Region", [{ name: "Chest tile (test)", visibility: CONST.REGION_VISIBILITY.LAYER,
        shapes: rect(200, 300), behaviors: [{ type: "darsh-loot.container", name: "Chest", system: {} }],
        flags: { "darsh-loot": { tile: chestTile.id } } }]);
      regions.push(tileChest);
      const items = await actor.createEmbeddedDocuments("Item", [
        { name: "DAS test lantern A", type: "loot", system: { quantity: 1 }, flags: { "darsh-loot": { test: true } } },
        { name: "DAS test lantern B", type: "loot", system: { quantity: 1 }, flags: { "darsh-loot": { test: true } } }]);
      await scene.activate();
      // The report: the game is unpaused.
      if ( game.paused ) game.togglePause(false, { broadcast: true });
      return { previous, scene: scene.id, ground: ground.id, upper: upper.id, actor: actor.id,
        tokens: tokens.map(t => t.id), regions: regions.map(r => r.id), items: items.map(i => i.uuid) };`);
    if ( setup?.missing ) { ctx.log("no character owned by « claude player »: not applicable"); return; }
    if ( !ctx.expect(setup?.scene, `two-level scene created and active (${JSON.stringify(setup)})`) ) return;
    ctx.restore(() => gm(`
      const scene = game.scenes.get(args.scene);
      const stores = (scene?.regions?.contents ?? []).flatMap(r => r.behaviors.contents.map(b => b.system?.actor)).filter(Boolean);
      if ( args.previous.paused && !game.paused ) game.togglePause(true, { broadcast: true });
      if ( args.previous.active ) await game.scenes.get(args.previous.active)?.activate();
      else if ( args.previous.viewed ) await game.scenes.get(args.previous.viewed)?.view();
      await scene?.delete();
      for ( const uuid of stores ) { const a = fromUuidSync(uuid, { strict: false }); if ( a?.documentName === "Actor" ) await a.delete(); }
      const actor = game.actors.get(args.actor);
      const left = actor?.items.filter(i => i.getFlag("darsh-loot", "test")).map(i => i.id) ?? [];
      if ( left.length ) await actor.deleteEmbeddedDocuments("Item", left);
      return true;`, setup).catch(err => ctx.log(`cleanup: ${err.message}`)));
    await pause(2500);

    const floors = [
      { name: "ground", level: setup.ground, token: setup.tokens[0], chest: setup.regions[0], trap: setup.regions[2], item: setup.items[0],
        drop: { x: 350, y: 450 }, extraChest: setup.regions[4] },
      { name: "upper", level: setup.upper, token: setup.tokens[1], chest: setup.regions[1], trap: setup.regions[3], item: setup.items[1],
        drop: { x: 1050, y: 1250 } }];

    for ( const floor of floors ) {
      // 2. The player views this floor, controls their token there, and drops an item next to it.
      const dropped = await ctx.asPlayer(`
        const scene = game.scenes.get(args.scene);
        if ( canvas.scene?.id !== scene.id || canvas.level?.id !== args.level ) await scene.view({ level: args.level });
        for ( let i = 0; i < 40 && (!canvas.ready || canvas.loading); i++ ) await new Promise(r => setTimeout(r, 250));
        await new Promise(r => setTimeout(r, 1500));
        canvas.tokens.get(args.token)?.control({ releaseOthers: true });
        const errors = [];
        const original = { error: console.error, nerror: ui.notifications.error, nwarn: ui.notifications.warn };
        console.error = (...a) => { errors.push(a.map(String).join(" ")); return original.error.apply(console, a); };
        ui.notifications.error = (m, o) => { errors.push(String(m)); return original.nerror.call(ui.notifications, m, o); };
        ui.notifications.warn = (m, o) => { errors.push(String(m)); return original.nwarn.call(ui.notifications, m, o); };
        const rejected = [];
        const onRejection = ev => rejected.push(String(ev.reason?.message ?? ev.reason));
        window.addEventListener("unhandledrejection", onRejection);
        try {
          Hooks.call("dropCanvasData", canvas, { type: "Item", uuid: args.item, x: args.drop.x, y: args.drop.y });
          await new Promise(r => setTimeout(r, 5000));
        } finally {
          console.error = original.error; ui.notifications.error = original.nerror; ui.notifications.warn = original.nwarn;
          window.removeEventListener("unhandledrejection", onRejection);
        }
        return { user: game.user.name, gm: game.user.isGM, role: game.user.role, activeGM: game.users.activeGM?.name ?? null,
          paused: game.paused, level: canvas.level?.id ?? null, controlled: canvas.tokens.controlled.map(t => t.id),
          stillOwned: !!fromUuidSync(args.item, { strict: false }), errors, rejected };`,
      { scene: setup.scene, level: floor.level, token: floor.token, item: floor.item, drop: floor.drop });
      ctx.log(`[${floor.name}] player drop: ${JSON.stringify(dropped)}`);
      if ( !ctx.expect(dropped && !dropped.gm && dropped.activeGM && dropped.level === floor.level,
        `[${floor.name}] a player client (${dropped?.user}, role ${dropped?.role}) with an active GM (${dropped?.activeGM}), on this floor`) ) return;
      const piles = await gm(`
        const scene = game.scenes.get(args.scene);
        return scene.regions.filter(r => r.getFlag("darsh-loot", "pile")).map(r => ({ id: r.id, levels: [...r.levels],
          tile: scene.tiles.get(r.getFlag("darsh-loot", "pile").tile)?.elevation ?? null }));`, { scene: setup.scene });
      const pile = piles?.find(p => p.levels.includes(floor.level));
      ctx.expect(!dropped.errors.length && !dropped.rejected.length,
        `[${floor.name}] drop: no error or warning on the player's side (${JSON.stringify([...dropped.errors, ...dropped.rejected])})`);
      ctx.expect(!dropped.stillOwned, `[${floor.name}] drop: the item left the character's sheet`);
      ctx.expect(!!pile, `[${floor.name}] drop: a pile stands on this floor (${JSON.stringify(piles)})`);

      // 3. Highlight key: the containers shine for the player; the player sees the chest and opens it (and the tile chest downstairs).
      for ( const [label, chestId] of [["chest", floor.chest], ["tile chest", floor.extraChest]] ) {
      if ( !chestId ) continue;
      const chest = await ctx.asPlayer(`
        const highlight = await import("/modules/darsh-loot/scripts/runtime/highlight.mjs");
        const sight = await import("/modules/darsh-loot/scripts/adapter/sight.mjs");
        const region = canvas.scene.regions.get(args.chest);
        const behavior = region?.behaviors.contents[0];
        Hooks.call("highlightObjects", true);
        await new Promise(r => setTimeout(r, 300));
        const lit = highlight.highlightState();
        Hooks.call("highlightObjects", false);
        const b = region.bounds;
        const center = { x: b.x + (b.width / 2), y: b.y + (b.height / 2) };
        const floor = sight.regionFloor(region);
        const token = canvas.tokens.get(args.token)?.document;
        const before = new Set(foundry.applications.instances.keys());
        await game.modules.get("darsh-loot").api.openContainer(behavior, token).catch(err => null);
        await new Promise(r => setTimeout(r, 2500));
        const opened = [...foundry.applications.instances.values()].filter(a => !before.has(a.id) && a.id.startsWith("darsh-loot-"));
        const ids = opened.map(a => a.id);
        for ( const app of opened ) await app.close();
        return { viewed: region.viewed, floor, seen: sight.regionSeen(region), point: sight.pointSeen(center, floor),
          zones: lit.zones, opened: ids, store: !!behavior?.system?.actor };`,
      { chest: chestId, token: floor.token });
      ctx.log(`[${floor.name}] player ${label}: ${JSON.stringify(chest)}`);
      ctx.expect(chest?.viewed && chest?.seen && chest?.point, `[${floor.name}] ${label}: the player sees it (${JSON.stringify(chest)})`);
      ctx.expect(chest?.zones >= 1, `[${floor.name}] ${label}: it shines under the highlight key (${chest?.zones} zone(s))`);
      ctx.expect(chest?.opened?.length >= 1, `[${floor.name}] ${label}: the player opens it (${JSON.stringify(chest?.opened)})`);
      }

      // 4. The trap: hidden, not drawn; revealed by the GM (« Show the trap to players »), drawn in red for the player.
      const trapState = () => ctx.asPlayer(`
        const highlight = await import("/modules/darsh-loot/scripts/runtime/highlight.mjs");
        highlight.redraw();
        const region = canvas.scene.regions.get(args.trap);
        return { traps: highlight.highlightState().traps, hidden: region?.hidden ?? null, viewed: region?.viewed ?? null };`,
      { trap: floor.trap });
      const before = await trapState();
      await gm(`
        const behavior = game.scenes.get(args.scene).regions.get(args.trap).behaviors.contents[0];
        await behavior.update({ "system.hidden.found": true, "system.source.hidden.found": true });
        return true;`, { scene: setup.scene, trap: floor.trap });
      await pause(1500);
      const after = await trapState();
      const gmSide = await gm(`
        const highlight = await import("/modules/darsh-loot/scripts/runtime/highlight.mjs");
        return highlight.highlightState().traps;`);
      ctx.log(`[${floor.name}] trap, player before ${JSON.stringify(before)}, after ${JSON.stringify(after)}, GM ${gmSide}`);
      ctx.expect(before?.traps === 0, `[${floor.name}] trap: hidden, not drawn for the player (${before?.traps})`);
      ctx.expect(after?.traps >= 1, `[${floor.name}] trap: revealed, drawn in red for the player (${after?.traps})`);
    }
  }
};
