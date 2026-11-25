/**
 * Piles on an upper floor (V14 levels; Discord, Gack, « loot piles on levels not working »). On a temporary scene with two levels
 * (ground 0–20, upper 20–40), a rug tile on the upper floor (elevation 20), and a token of « claude player »'s character upstairs:
 *  1. the GM drops a world item on the upper floor (`api.mcp.groundDrop`, the sidebar gesture): the pile's tile stands on the upper
 *     floor (elevation 20, level « upper »), not at 0 under it;
 *  2. on the real player client (`players: true`), viewing the upper floor: the pile's region is drawn, its floor is 20, and the
 *     pile is seen — before the fix the player tested it at 0, took the rug for a roof and never saw it (only « Move here »);
 *  3. a plain open region on the upper floor (a lever, a trap) also stands on that floor (20), not at 0.
 * Without the bench's player client: not applicable. Restored: scene (with its tiles and regions), pile store, item, GM view.
 *
 * Run with the Core's runner: `node tools/scenario.mjs "../Foundry dnd5e butin et commerce/tools/scenarios/tas-etage.mjs"`
 * (on the bench: `npm run banc:passe -- "<that path>"`).
 */
const MODULE = "darsh-loot";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "loot — a pile dropped on an upper floor is seen and opened by a player (V14 levels)",
  players: true,

  async run(ctx) {
    const gm = async (code, args) => (await ctx.call("run-script", { code, ...(args ? { args } : {}), waitMs: 20000 }))?.result;

    // 1. The scene: two levels, a rug upstairs, the player's character upstairs, viewed by the GM on the upper floor.
    const setup = await gm(`
      const player = game.users.find(u => u.name === "claude player");
      const actor = game.actors.find(a => (a.type === "character") && player && a.testUserPermission(player, "OWNER"));
      if ( !player || !actor ) return { missing: true };
      const previous = { scene: canvas.scene?.id ?? null, level: canvas.level?.id ?? null };
      const scene = await Scene.create({ name: "DAS Loot — levels (test)", width: 1500, height: 1500, padding: 0,
        grid: { size: 100, distance: 5 }, tokenVision: true, environment: { darknessLevel: 0, globalLight: { enabled: true } },
        ownership: { default: 2 }, flags: { "darsh-loot": { test: true } } });
      const ground = scene.levels.contents[0];
      await ground.update({ name: "Ground", elevation: { bottom: 0, top: 20 } });
      const [upper] = await scene.createEmbeddedDocuments("Level", [{ name: "Upper", elevation: { bottom: 20, top: 40 } }]);
      await scene.createEmbeddedDocuments("Tile", [{ texture: { src: "ui/parchment.jpg" }, x: 300, y: 300, width: 700, height: 700,
        elevation: 20, levels: [upper.id] }]);
      await scene.createEmbeddedDocuments("Token", [{ name: actor.name, actorId: actor.id, x: 500, y: 500, elevation: 20, level: upper.id,
        sight: { enabled: true, range: 60 } }]);
      const [lever] = await scene.createEmbeddedDocuments("Region", [{ name: "Lever (test)", levels: [upper.id],
        shapes: [{ type: "rectangle", x: 700, y: 700, width: 100, height: 100 }] }]);
      const item = await Item.create({ name: "DAS test lantern", type: "loot", flags: { "darsh-loot": { test: true } } });
      await scene.view({ level: upper.id });
      return { previous, scene: scene.id, upper: upper.id, ground: ground.id, lever: lever.id, item: item.uuid, itemId: item.id,
        actor: actor.name };`);
    if ( setup?.missing ) { ctx.log("no character owned by « claude player »: not applicable"); return; }
    if ( !ctx.expect(setup?.scene, `two-level scene created (${JSON.stringify(setup)})`) ) return;
    ctx.restore(() => gm(`
      const scene = game.scenes.get(args.scene);
      const stores = (scene?.regions?.contents ?? []).flatMap(r => r.behaviors.contents.map(b => b.system?.actor)).filter(Boolean);
      if ( args.previous.scene ) await game.scenes.get(args.previous.scene)?.view(args.previous.level ? { level: args.previous.level } : {});
      await scene?.delete();
      for ( const uuid of stores ) { const a = fromUuidSync(uuid, { strict: false }); if ( a?.documentName === "Actor" ) await a.delete(); }
      await game.items.get(args.itemId)?.delete();
      return true;`, setup).catch(err => ctx.log(`cleanup: ${err.message}`)));
    await pause(1500);

    // 2. The GM drops the lantern next to the character, upstairs.
    const drop = (await ctx.call("call-module-api", { moduleId: MODULE, fn: "groundDrop", args: { itemUuid: setup.item, x: 650, y: 550 },
      waitMs: 8000 }))?.result;
    if ( !ctx.expect(drop?.region, `GM drop upstairs (${JSON.stringify(drop)})`) ) return;
    const placed = await gm(`
      const scene = game.scenes.get(args.scene);
      const region = scene.regions.get(args.region);
      const tile = scene.tiles.get(region.getFlag("darsh-loot", "pile")?.tile);
      return { tileElevation: tile?.elevation ?? null, tileLevels: [...(tile?.levels ?? [])], regionLevels: [...region.levels] };`,
    { scene: setup.scene, region: drop.region });
    ctx.expect(placed?.tileElevation === 20, `the pile's tile stands on the upper floor (elevation ${placed?.tileElevation}, expected 20)`);
    ctx.expect(placed?.tileLevels?.[0] === setup.upper && placed?.regionLevels?.[0] === setup.upper,
      `tile and region on the upper level (${JSON.stringify(placed)})`);
    await pause(1500);

    // 3. The player, viewing the upper floor: the pile is drawn, stands at 20 and is seen; the lever region stands at 20 too.
    const seen = await ctx.asPlayer(`
      const scene = game.scenes.get(args.scene);
      if ( canvas.scene?.id !== scene.id || canvas.level?.id !== args.upper ) await scene.view({ level: args.upper });
      for ( let i = 0; i < 40 && (!canvas.ready || canvas.loading); i++ ) await new Promise(r => setTimeout(r, 250));
      await new Promise(r => setTimeout(r, 2000));
      const sight = await import("/modules/darsh-loot/scripts/adapter/sight.mjs");
      const region = scene.regions.get(args.region);
      const lever = scene.regions.get(args.lever);
      const b = region.bounds;
      const center = { x: b.x + (b.width / 2), y: b.y + (b.height / 2) };
      const floor = sight.regionFloor(region);
      return { user: game.user.name, gm: game.user.isGM, level: canvas.level?.id ?? null, viewed: region.viewed, floor,
        seen: sight.pointSeen(center, floor), regionSeen: sight.regionSeen(region), atZero: sight.pointSeen(center, 0),
        leverFloor: sight.regionFloor(lever), vision: canvas.visibility?.tokenVision ?? null };`,
    { scene: setup.scene, upper: setup.upper, region: drop.region, lever: setup.lever });
    ctx.log(`player client: ${JSON.stringify(seen)}`);
    if ( !ctx.expect(seen && !seen.gm && seen.level === setup.upper, `a player client viewing the upper floor (${seen?.user})`) ) return;
    ctx.expect(seen.viewed, "the pile's region is drawn for the player on the upper floor");
    ctx.expect(seen.floor === 20, `the pile's floor is the upper floor (${seen.floor}, expected 20)`);
    ctx.expect(seen.seen && seen.regionSeen, `the player sees the pile (point ${seen.seen}, region ${seen.regionSeen})`);
    ctx.log(`witness: tested at 0 as before the fix, the pile is ${seen.atZero ? "seen" : "hidden under the rug"}`);
    ctx.expect(seen.leverFloor === 20, `an open region upstairs (lever, trap) stands on the upper floor (${seen.leverFloor}, expected 20)`);
  }
};
