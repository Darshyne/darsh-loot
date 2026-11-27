/**
 * The two loot cues of 2026-11-27: the « Loot » status on a corpse that still has something to take (`lootMark`), and ground piles
 * drawn as cards — rounded corners and a thin gold rim (`pileFrame`). On a temporary scene: « claude player »'s character, three
 * dead test NPCs — A and C each with a gear item, B empty — and a pile the GM drops near the character.
 *  1. GM: A and C wear the status, B does not; the pile shows a framed icon.
 *  2. The GM takes C's item: C loses the status. `lootMark` off removes every mark, back on puts them back.
 *     `pileFrame` off gives the plain icon back, `rounded` frames it again.
 *  3. Player (`players: true`): A wears the status on their client too, B and C do not; the pile is framed.
 * With `DLO_CAPTURE_DIR` set, a picture of the GM's and of the player's view is written there (to look at, not checked).
 * Restored: scene (tokens, tiles, regions), test actors, pile store, item, settings, GM view.
 *
 * Run with the Core's runner: `node tools/scenario.mjs "../Foundry dnd5e butin et commerce/tools/scenarios/visuels-butin.mjs"`
 * (on the bench: `npm run banc:passe -- "<that path>"`).
 */
import fs from "node:fs";
import path from "node:path";

const MODULE = "darsh-loot";
const STATUS = "darsh-loot-loot";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Page code: a PNG (base64) of the scene area around the test tokens, as this client draws it. */
const CAPTURE = `
  await canvas.animatePan({ x: 750, y: 550, scale: 1.2, duration: 0 });
  await new Promise(r => setTimeout(r, 900));
  const region = new PIXI.Rectangle(350, 300, 800, 450);
  return canvas.app.renderer.extract.base64(canvas.stage, "image/png", 1, region);`;

export default {
  name: "loot — « Loot » status on corpses and framed ground piles (GM, settings, player)",
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
      if ( !Object.values(CONFIG.statusEffects).some(s => s.id === "${STATUS}") ) return { noStatus: true };
      const previous = { scene: canvas.scene?.id ?? null, level: canvas.level?.id ?? null,
        settings: { pileFrame: game.settings.get("${MODULE}", "pileFrame"), lootMark: game.settings.get("${MODULE}", "lootMark"),
          autoTreasure: game.settings.get("${MODULE}", "autoTreasure") } };
      await game.settings.set("${MODULE}", "autoTreasure", false);
      await game.settings.set("${MODULE}", "pileFrame", "gold");
      await game.settings.set("${MODULE}", "lootMark", true);
      const scene = await Scene.create({ name: "DAS Loot — visuals (test)", width: 1500, height: 1100, padding: 0,
        grid: { size: 100, distance: 5 }, tokenVision: true, environment: { darknessLevel: 0, globalLight: { enabled: true } },
        background: { color: "#3b3a33" }, ownership: { default: 2 }, flags: { "${MODULE}": { test: true } } });
      const gear = name => ({ name, type: "loot", img: "icons/commodities/gems/gem-faceted-round-red.webp",
        system: { quantity: 1, properties: ["gear"], price: { value: 10, denomination: "gp" } } });
      const npc = (name, items) => ({ name, type: "npc", img: "icons/svg/mystery-man.svg", flags: { "${MODULE}": { test: true } },
        system: { attributes: { hp: { value: 0, max: 7 } } }, items,
        prototypeToken: { actorLink: false, texture: { src: "icons/svg/mystery-man.svg" } } });
      const actors = await Actor.implementation.createDocuments([npc("DAS loot A", [gear("DAS ruby A")]), npc("DAS loot B", []),
        npc("DAS loot C", [gear("DAS ruby C")])]);
      // The server does not always return created documents in the order asked: find each by its name.
      const of = name => actors.find(a => a.name === name).id;
      const tokens = await scene.createEmbeddedDocuments("Token", [
        { name: actor.name, actorId: actor.id, x: 500, y: 500, sight: { enabled: true, range: 60 } },
        { name: "DAS loot A", actorId: of("DAS loot A"), actorLink: false, x: 700, y: 400 },
        { name: "DAS loot B", actorId: of("DAS loot B"), actorLink: false, x: 700, y: 600 },
        { name: "DAS loot C", actorId: of("DAS loot C"), actorLink: false, x: 900, y: 500 }]);
      for ( const t of tokens.slice(1) ) await t.actor.toggleStatusEffect("dead", { active: true, overlay: true });
      const item = await Item.create({ name: "DAS test goblet", type: "loot", img: "icons/containers/kitchenware/goblet-jeweled-gold-red.webp",
        flags: { "${MODULE}": { test: true } } });
      await scene.view();
      const byName = Object.fromEntries(tokens.slice(1).map(t => [t.name, t.uuid]));
      return { previous, scene: scene.id, actors: actors.map(a => a.id), tokens: [byName["DAS loot A"], byName["DAS loot B"], byName["DAS loot C"]],
        item: item.uuid, itemId: item.id };`);
    if ( setup?.missing ) { ctx.log("no character owned by « claude player »: not applicable"); return; }
    if ( !ctx.expect(!setup?.noStatus, "the « Loot » status is registered") ) return;
    if ( !ctx.expect(setup?.scene, `test scene created (${JSON.stringify(setup)?.slice(0, 300)})`) ) return;
    ctx.restore(() => gm(`
      const scene = game.scenes.get(args.scene);
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

    const drop = await api("groundDrop", { itemUuid: setup.item, x: 560, y: 760 });
    if ( !ctx.expect(drop?.region, `GM drop (${JSON.stringify(drop)})`) ) return;
    await pause(2000);

    // 1. GM.
    const [uA, uB, uC] = setup.tokens;
    let v = await api("visualsState");
    ctx.expect(v?.marked?.includes(uA) && v.marked.includes(uC), `GM: corpses A and C wear « Loot » (${JSON.stringify(v?.marked)})`);
    ctx.expect(v?.marked && !v.marked.includes(uB), "GM: the empty corpse B does not");
    ctx.expect(v?.piles?.length === 1 && v.piles[0].framed, `GM: the pile shows a framed icon (${JSON.stringify(v?.piles)})`);
    await capture("mj", code => gm(code));

    // 2. Taking C's item, then the settings.
    await gm(`const a = fromUuidSync(args.c).actor; await a.items.getName("DAS ruby C")?.delete(); return true;`, { c: uC });
    await pause(1200);
    v = await api("visualsState");
    ctx.expect(!v?.marked?.includes(uC) && v?.marked?.includes(uA), `emptied, C loses « Loot »; A keeps it (${JSON.stringify(v?.marked)})`);
    const set = async (key, value, wait=1500) => { await gm(`await game.settings.set("${MODULE}", args.key, args.value); return true;`, { key, value });
      await pause(wait); return api("visualsState"); };
    v = await set("lootMark", false);
    ctx.expect(v?.marked?.length === 0, `lootMark off: no mark left (${JSON.stringify(v?.marked)})`);
    v = await set("lootMark", true);
    ctx.expect(v?.marked?.includes(uA) && !v.marked.includes(uC), `lootMark on: A marked again (${JSON.stringify(v?.marked)})`);
    v = await set("pileFrame", "off");
    ctx.expect(v?.piles?.[0] && !v.piles[0].framed, `pileFrame « off »: the plain icon is back (${JSON.stringify(v?.piles)})`);
    v = await set("pileFrame", "rounded");
    ctx.expect(v?.piles?.[0]?.framed, `pileFrame « rounded »: framed again (${JSON.stringify(v?.piles)})`);
    await set("pileFrame", "gold");

    // 3. Player.
    if ( !ctx.asPlayer ) { ctx.log("no player client: player side not applicable"); return; }
    const seen = await ctx.asPlayer(`
      const scene = game.scenes.get(args.scene);
      if ( canvas.scene?.id !== scene.id ) await scene.view();
      for ( let i = 0; i < 40 && (!canvas.ready || canvas.loading); i++ ) await new Promise(r => setTimeout(r, 250));
      const own = canvas.tokens.placeables.find(t => t.document.actor?.isOwner && (t.document.actor.type === "character"));
      own?.control({ releaseOthers: true });
      await new Promise(r => setTimeout(r, 2000));
      const { pileFramed } = await import("/modules/${MODULE}/scripts/runtime/pile-frame.mjs");
      const pile = scene.tiles.find(t => t.getFlag("${MODULE}", "pileTile"));
      const marked = args.tokens.map(uuid => !!fromUuidSync(uuid)?.actor?.statuses.has("${STATUS}"));
      return { marked, framed: pileFramed(pile), controlled: !!own };`, setup);
    ctx.expect(seen?.controlled, `player controls their character (${JSON.stringify(seen)})`);
    ctx.expect(JSON.stringify(seen?.marked) === "[true,false,false]", `player: A wears « Loot », B and C do not (${JSON.stringify(seen?.marked)})`);
    ctx.expect(seen?.framed === true, "player: the pile shows a framed icon");
    await capture("joueur", code => ctx.asPlayer(code, setup));
  }
};
