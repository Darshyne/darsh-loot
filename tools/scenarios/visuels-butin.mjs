/**
 * The two loot cues of 2026-11-27: golden motes over a corpse that still has something to take (`lootGlint`), and ground piles
 * drawn as cards — rounded corners and a thin gold rim (`pileFrame`). On a temporary scene: « claude player »'s character, three
 * dead test NPCs — A with a gear item, B empty, C with a gear item but behind a wall — and a pile the GM drops near the character.
 *  1. GM: A and C glint, B does not; the pile shows a framed icon.
 *  2. Settings: `pileFrame` off gives the plain icon back, `rounded` frames it again; `lootGlint` off stops every glint, and in
 *     its default « outside combat » mode a started combat stops it too.
 *  3. Player (`players: true`): A glints, C does not (behind the wall), the pile is framed.
 * With `DLO_CAPTURE_DIR` set, a picture of the GM's and of the player's view is written there (to look at, not checked).
 * Restored: scene (tokens, wall, tiles, regions), test actors, pile store, item, settings, GM view.
 *
 * Run with the Core's runner: `node tools/scenario.mjs "../Foundry dnd5e butin et commerce/tools/scenarios/visuels-butin.mjs"`
 * (on the bench: `npm run banc:passe -- "<that path>"`).
 */
import fs from "node:fs";
import path from "node:path";

const MODULE = "darsh-loot";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Page code: a PNG (base64) of the scene area around the test tokens, as this client draws it. */
const CAPTURE = `
  await canvas.animatePan({ x: 750, y: 550, scale: 1.2, duration: 0 });
  await new Promise(r => setTimeout(r, 900));
  const region = new PIXI.Rectangle(300, 300, 900, 500);
  const url = await canvas.app.renderer.extract.base64(canvas.stage, "image/png", 1, region);
  return url;`;

export default {
  name: "loot — corpse glint and framed ground piles (GM, settings, player)",
  players: true,

  async run(ctx) {
    const gm = async (code, args) => (await ctx.call("run-script", { code, ...(args ? { args } : {}), waitMs: 20000 }))?.result;
    const api = async (fn, args={}) => (await ctx.call("call-module-api", { moduleId: MODULE, fn, args, waitMs: 8000 }))?.result;
    const capture = async (who, code) => {
      const dir = process.env.DLO_CAPTURE_DIR;
      if ( !dir ) return;
      try {
        const url = await code(CAPTURE);
        if ( typeof url !== "string" ) return ctx.log(`capture ${who}: nothing (${JSON.stringify(url)?.slice(0, 120)})`);
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `visuels-butin-${who}.png`);
        fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
        ctx.log(`capture ${who}: ${file}`);
      } catch(err) { ctx.log(`capture ${who}: ${err.message}`); }
    };

    const setup = await gm(`
      const player = game.users.find(u => u.name === "claude player");
      const actor = game.actors.find(a => (a.type === "character") && player && a.testUserPermission(player, "OWNER"));
      if ( !player || !actor ) return { missing: true };
      const previous = { scene: canvas.scene?.id ?? null, level: canvas.level?.id ?? null,
        settings: { pileFrame: game.settings.get("${MODULE}", "pileFrame"), lootGlint: game.settings.get("${MODULE}", "lootGlint"),
          autoTreasure: game.settings.get("${MODULE}", "autoTreasure"), whoLoots: game.settings.get("${MODULE}", "whoLoots") } };
      await game.settings.set("${MODULE}", "autoTreasure", false);
      await game.settings.set("${MODULE}", "whoLoots", "all");
      await game.settings.set("${MODULE}", "pileFrame", "gold");
      await game.settings.set("${MODULE}", "lootGlint", "peace");
      const scene = await Scene.create({ name: "DAS Loot — visuals (test)", width: 1500, height: 1100, padding: 0,
        grid: { size: 100, distance: 5 }, tokenVision: true, environment: { darknessLevel: 0, globalLight: { enabled: true } },
        background: { color: "#3b3a33" }, ownership: { default: 2 }, flags: { "${MODULE}": { test: true } } });
      const gear = name => ({ name, type: "loot", img: "icons/commodities/gems/gem-faceted-round-red.webp",
        system: { quantity: 1, properties: ["gear"], price: { value: 10, denomination: "gp" } } });
      const npc = (name, items) => ({ name, type: "npc", img: "icons/svg/skull.svg", flags: { "${MODULE}": { test: true } },
        system: { attributes: { hp: { value: 0, max: 7 } } }, items,
        prototypeToken: { actorLink: false, texture: { src: "icons/svg/skull.svg" } } });
      const actors = await Actor.implementation.createDocuments([npc("DAS glint A", [gear("DAS ruby A")]), npc("DAS glint B", []),
        npc("DAS glint C", [gear("DAS ruby C")])]);
      await scene.createEmbeddedDocuments("Wall", [{ c: [850, 200, 850, 900] }]);
      const tokens = await scene.createEmbeddedDocuments("Token", [
        { name: actor.name, actorId: actor.id, x: 500, y: 500, sight: { enabled: true, range: 60 } },
        { name: "DAS glint A", actorId: actors[0].id, actorLink: false, x: 700, y: 400 },
        { name: "DAS glint B", actorId: actors[1].id, actorLink: false, x: 700, y: 600 },
        { name: "DAS glint C", actorId: actors[2].id, actorLink: false, x: 1000, y: 500 }]);
      for ( const t of tokens.slice(1) ) await t.actor.toggleStatusEffect("dead", { active: true, overlay: true });
      const item = await Item.create({ name: "DAS test goblet", type: "loot", img: "icons/containers/kitchenware/goblet-jeweled-gold-red.webp",
        flags: { "${MODULE}": { test: true } } });
      await scene.view();
      const byName = Object.fromEntries(tokens.slice(1).map(t => [t.name, t.uuid]));
      return { previous, scene: scene.id, actors: actors.map(a => a.id), tokens: [byName["DAS glint A"], byName["DAS glint B"], byName["DAS glint C"]],
        item: item.uuid, itemId: item.id };`);
    if ( setup?.missing ) { ctx.log("no character owned by « claude player »: not applicable"); return; }
    if ( !ctx.expect(setup?.scene, `test scene created (${JSON.stringify(setup)?.slice(0, 300)})`) ) return;
    ctx.restore(() => gm(`
      const scene = game.scenes.get(args.scene);
      for ( const c of game.combats.filter(c => c.scene?.id === args.scene) ) await c.delete();
      const stores = (scene?.regions?.contents ?? []).flatMap(r => r.behaviors.contents.map(b => b.system?.actor)).filter(Boolean);
      if ( args.previous.scene ) await game.scenes.get(args.previous.scene)?.view(args.previous.level ? { level: args.previous.level } : {});
      await scene?.delete();
      for ( const uuid of stores ) { const a = fromUuidSync(uuid, { strict: false }); if ( a?.documentName === "Actor" ) await a.delete(); }
      const left = args.actors.filter(id => game.actors.has(id));
      if ( left.length ) await Actor.implementation.deleteDocuments(left);
      await game.items.get(args.itemId)?.delete();
      for ( const [k, v] of Object.entries(args.previous.settings) ) await game.settings.set("${MODULE}", k, v);
      return true;`, setup).catch(err => ctx.log(`cleanup: ${err.message}`)));
    await pause(2000);

    // The GM drops the goblet next to the character.
    const drop = await api("groundDrop", { itemUuid: setup.item, x: 560, y: 760 });
    if ( !ctx.expect(drop?.region, `GM drop (${JSON.stringify(drop)})`) ) return;
    await pause(2500);

    // 1. GM: A and C glint, B (empty) does not; the pile is framed.
    const [uA, uB, uC] = setup.tokens;
    // What each test corpse holds, to read a failure.
    const corpses = () => gm(`
      return args.tokens.map(uuid => { const t = fromUuidSync(uuid); const a = t?.actor;
        return { name: t?.name, dead: !!a?.statuses?.has("dead"), items: a?.items.map(i => i.name + ":" + [...(i.system.properties ?? [])].join("+")),
          coins: a?.system.currency, rolled: a?.getFlag("${MODULE}", "rolled") ?? a?.getFlag("${MODULE}", "treasure") ?? null }; });`, setup);
    let v = await api("visualsState");
    ctx.expect(v?.glint?.mode === "peace", `default glint mode is « outside combat » (${v?.glint?.mode})`);
    ctx.expect(v?.glint?.corpses?.includes(uA) && v.glint.corpses.includes(uC), `GM: corpses A and C glint (${JSON.stringify(v?.glint)})`);
    if ( !ctx.expect(!v?.glint?.corpses?.includes(uB), "GM: the empty corpse B does not glint")
      || !v?.glint?.corpses?.includes(uC) ) ctx.log(`corpses: ${JSON.stringify(await corpses())}`);
    ctx.expect(v?.piles?.length === 1 && v.piles[0].framed, `GM: the pile shows a framed icon (${JSON.stringify(v?.piles)})`);
    await capture("mj", code => gm(code));

    // 2. Settings.
    const set = async (key, value) => { await gm(`await game.settings.set("${MODULE}", args.key, args.value); return true;`, { key, value });
      await pause(1500); return api("visualsState"); };
    v = await set("pileFrame", "off");
    ctx.expect(v?.piles?.[0] && !v.piles[0].framed, `pileFrame « off »: the plain icon is back (${JSON.stringify(v?.piles)})`);
    v = await set("pileFrame", "rounded");
    ctx.expect(v?.piles?.[0]?.framed, `pileFrame « rounded »: framed again (${JSON.stringify(v?.piles)})`);
    await set("pileFrame", "gold");
    v = await set("lootGlint", "off");
    ctx.expect(v?.glint?.corpses?.length === 0, `lootGlint « off »: nothing glints (${JSON.stringify(v?.glint)})`);
    await set("lootGlint", "peace");
    await gm(`
      const scene = game.scenes.get(args.scene);
      const combat = await Combat.implementation.create({ scene: scene.id });
      await combat.createEmbeddedDocuments("Combatant", [{ tokenId: scene.tokens.contents[0].id, sceneId: scene.id }]);
      await combat.startCombat();
      return true;`, setup);
    await pause(800);
    v = await api("visualsState");
    ctx.expect(v?.glint?.corpses?.length === 0, `« outside combat »: a started combat stops the glint (${JSON.stringify(v?.glint)})`);
    v = await set("lootGlint", "always");
    ctx.expect(v?.glint?.corpses?.includes(uA), `« always »: A glints during combat (${JSON.stringify(v?.glint)})`);
    await gm(`for ( const c of game.combats.filter(c => c.scene?.id === args.scene) ) await c.delete(); return true;`, setup);
    await set("lootGlint", "peace");

    // 3. Player.
    if ( !ctx.asPlayer ) { ctx.log("no player client: player side not applicable"); return; }
    const seen = await ctx.asPlayer(`
      const scene = game.scenes.get(args.scene);
      if ( canvas.scene?.id !== scene.id ) await scene.view();
      for ( let i = 0; i < 40 && (!canvas.ready || canvas.loading); i++ ) await new Promise(r => setTimeout(r, 250));
      const own = canvas.tokens.placeables.find(t => t.document.actor?.isOwner && (t.document.actor.type === "character"));
      own?.control({ releaseOthers: true });
      await new Promise(r => setTimeout(r, 2500));
      const { glintState } = await import("/modules/${MODULE}/scripts/runtime/glint.mjs");
      const { pileFramed } = await import("/modules/${MODULE}/scripts/runtime/pile-frame.mjs");
      const pile = scene.tiles.find(t => t.getFlag("${MODULE}", "pileTile"));
      return { glint: glintState(), framed: pileFramed(pile), controlled: !!own };`, setup);
    ctx.expect(seen?.controlled, `player controls their character (${JSON.stringify(seen)})`);
    ctx.expect(seen?.glint?.corpses?.includes(uA), `player: corpse A glints (${JSON.stringify(seen?.glint)})`);
    ctx.expect(!seen?.glint?.corpses?.includes(uC), "player: corpse C, behind the wall, does not glint");
    ctx.expect(!seen?.glint?.corpses?.includes(uB), "player: the empty corpse B does not glint");
    ctx.expect(seen?.framed === true, "player: the pile shows a framed icon");
    await capture("joueur", code => ctx.asPlayer(code, setup));
  }
};
