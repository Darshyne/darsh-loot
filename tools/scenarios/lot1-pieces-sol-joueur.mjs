/**
 * Lot 1 (2026-11-27) — coins dropped on the ground, with a REAL player client. On a temporary ACTIVE scene with two V14 levels
 * (the player's client views it), the token of « claude player »'s character stands on the UPPER level with 10 gp and 6 sp:
 *  1. the Core's right-click menu of a square has no coin entry (user's decision of 2026-11-27); gold dragged from the sheet to
 *     the map asks how many; 4 gp typed: a pile showing coins appears next to the character, ON ITS LEVEL, holding 4 gp;
 *  2. the coin icons of the player's character sheet can be dragged; such a drag dropped on the map asks how many, the coin
 *     dragged filled in; confirmed, the 6 sp join the same pile (one pile per square);
 *  3. the player's client received a public card for each drop;
 *  4. crafted requests: dropping the coins of a character the player does not own is refused; a huge amount moves no more
 *     than the purse holds;
 *  5. the player takes the coins back from the pile: the purse is whole again and the pile disappears.
 * Without the bench's player client: not applicable. Restored: the active and viewed scenes, the test actors, the purse.
 *
 * Run with the Core's runner: `node tools/scenario.mjs "../Foundry dnd5e butin et commerce/tools/scenarios/lot1-pieces-sol-joueur.mjs"`
 * (on the bench: `npm run banc:passe -- "<that path>"`).
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "loot — lot 1: a real player drops coins on the ground (drag from the sheet, pile on its level, taken back)",
  players: true,

  async run(ctx) {
    const gm = async (code, args) => (await ctx.call("run-script", { code, ...(args ? { args } : {}), waitMs: 30000 }))?.result;

    const setup = await gm(`
      const player = game.users.find(u => u.name === "claude player");
      const actor = game.actors.find(a => (a.type === "character") && player && a.testUserPermission(player, "OWNER"));
      if ( !player || !actor ) return { missing: true };
      const previous = { scene: canvas.scene?.id ?? null, level: canvas.level?.id ?? null, active: game.scenes.active?.id ?? null,
        purse: { ...actor.system.currency }, reach: game.settings.get("darsh-loot", "reach"), dropMode: game.settings.get("darsh-loot", "dropMode") };
      const TEST = { "darsh-loot": { test: true } };
      const scene = await Scene.create({ name: "DAS Loot — lot 1 coins on the ground (test)", width: 2500, height: 2500, padding: 0,
        grid: { size: 100, distance: 5 }, tokenVision: false, environment: { darknessLevel: 0, globalLight: { enabled: true } },
        ownership: { default: 2 }, flags: TEST });
      const ground = scene.levels.contents[0];
      await ground.update({ name: "Ground", elevation: { bottom: 0, top: 20 } });
      const [upper] = await scene.createEmbeddedDocuments("Level", [{ name: "Upper", elevation: { bottom: 20, top: 40 } }]);
      const other = await Actor.implementation.create({ name: "DAS test stranger", type: "character", img: "icons/svg/mystery-man.svg",
        system: { currency: { gp: 9 } }, flags: TEST });
      const tokens = await scene.createEmbeddedDocuments("Token", [
        { name: actor.name, actorId: actor.id, actorLink: true, x: 500, y: 500, elevation: 20, level: upper.id },
        { name: other.name, actorId: other.id, actorLink: true, x: 900, y: 500, elevation: 20, level: upper.id }]);
      await actor.update({ "system.currency": { pp: 0, gp: 10, ep: 0, sp: 6, cp: 0 } });
      await game.settings.set("darsh-loot", "reach", 5);
      await game.settings.set("darsh-loot", "dropMode", "on");
      await scene.activate();
      await scene.view({ level: upper.id });
      for ( let i = 0; i < 40 && ((canvas.scene?.id !== scene.id) || !canvas.ready); i++ ) await new Promise(r => setTimeout(r, 250));
      await new Promise(r => setTimeout(r, 1000));
      return { previous, scene: scene.id, viewed: canvas.scene?.id === scene.id, actor: actor.id, actorUuid: actor.uuid, other: other.id,
        looter: tokens[0].uuid, stranger: tokens[1].uuid, upper: upper.id, ground: ground.id };`);
    if ( setup?.missing ) { ctx.log("no character owned by « claude player »: not applicable"); return; }
    if ( !ctx.expect(setup?.viewed, `two-level scene ready, active and viewed by the GM (${JSON.stringify({ viewed: setup?.viewed })})`) ) return;
    ctx.restore(() => gm(`
      const actor = game.actors.get(args.actor);
      const p = args.previous;
      if ( p.active ) await game.scenes.get(p.active)?.activate();
      if ( p.scene ) await game.scenes.get(p.scene)?.view(p.level ? { level: p.level } : {});
      await game.scenes.get(args.scene)?.delete();
      await actor?.update({ "system.currency": p.purse });
      const left = game.actors.filter(a => a.getFlag("darsh-loot", "test") || (a.getFlag("darsh-loot", "containerOf") ?? "").includes(args.scene));
      if ( left.length ) await Actor.implementation.deleteDocuments(left.map(a => a.id));
      await game.settings.set("darsh-loot", "reach", p.reach);
      await game.settings.set("darsh-loot", "dropMode", p.dropMode);
      return true;`, setup).catch(err => ctx.log(`cleanup: ${err.message}`)));

    const who = await ctx.asPlayer(`
      for ( let i = 0; i < 60 && ((canvas.scene?.id !== args.scene) || !canvas.ready); i++ ) await new Promise(r => setTimeout(r, 250));
      await new Promise(r => setTimeout(r, 800));
      // The character stands on the upper level: the player looks at that level, as he would to play it.
      if ( canvas.level?.id !== args.upper ) await canvas.scene.view({ level: args.upper });
      for ( let i = 0; i < 40 && ((canvas.level?.id !== args.upper) || !canvas.ready); i++ ) await new Promise(r => setTimeout(r, 250));
      await new Promise(r => setTimeout(r, 800));
      return { user: game.user.name, gm: game.user.isGM, activeGM: game.users.activeGM?.name ?? null, scene: canvas.scene?.id === args.scene,
        level: canvas.level?.id ?? null, upper: canvas.level?.id === args.upper, query: typeof CONFIG.queries["darsh-loot.dropCoins"] };`, setup);
    ctx.log(`player client: ${JSON.stringify(who)}`);
    if ( !ctx.expect(who && !who.gm && who.activeGM && who.scene && (who.query === "function"), `a player client (${who?.user}) viewing the test scene, with an active GM`) ) return;

    const state = () => gm(`
      const scene = game.scenes.get(args.scene);
      const actor = game.actors.get(args.actor);
      const piles = scene.regions.filter(r => r.getFlag("darsh-loot", "pile")).map(r => {
        const b = r.behaviors.contents[0];
        const store = b?.system.actor ? fromUuidSync(b.system.actor, { strict: false }) : null;
        const tile = scene.tiles.get(r.getFlag("darsh-loot", "pile").tile);
        return { id: r.id, behavior: b?.uuid ?? null, x: r.bounds.x, y: r.bounds.y, levels: [...(r._source.levels ?? [])], gp: store?.system.currency.gp ?? 0, sp: store?.system.currency.sp ?? 0,
          img: tile?.texture.src ?? null, tileElevation: tile?.elevation ?? null, tileLevels: [...(tile?._source.levels ?? [])], alpha: tile?.alpha ?? null };
      });
      return { purse: { gp: actor.system.currency.gp, sp: actor.system.currency.sp }, piles, stranger: game.actors.get(args.other)?.system.currency.gp ?? null };`, setup);
    /** At the player: wait for the « how many coins » window, type the amounts given (others left as filled in), confirm. */
    const fill = `
      const fillCoins = async amounts => {
        const form = () => document.querySelector(".dlo-coin-fields")?.closest("form");
        for ( let i = 0; i < 40 && !form(); i++ ) await new Promise(r => setTimeout(r, 250));
        if ( !form() ) return { dialog: false };
        const seen = Object.fromEntries([...form().querySelectorAll("input[type=number]")].map(i => [i.name, { value: i.value, max: i.max }]));
        for ( const [k, v] of Object.entries(amounts) ) form().elements[k].value = String(v);
        form().querySelector('button[data-action="ok"]').click();
        return { dialog: true, seen };
      };`;

    // 1. The ground menu, then the drop.
    const since = Date.now() - 1;
    const menu = await ctx.asPlayer(`${fill}
      const engine = game.modules.get("dnd5e-combat")?.api;
      const mine = fromUuidSync(args.looter);
      mine.object?.control({ releaseOthers: true });
      await new Promise(r => setTimeout(r, 300));
      const entries = engine?.ui?.groundMenu?.({ x: 650, y: 550 }) ?? [];
      const labels = entries.map(e => e.label);
      Hooks.call("dropCanvasData", canvas, { type: "darsh-loot.coins", actor: game.actors.get(args.actor).uuid, key: "gp", x: 650, y: 550 }, null);
      const typed = await fillCoins({ gp: 4 });
      await new Promise(r => setTimeout(r, 2500));
      return { labels, typed };`, setup);
    ctx.expect(!(menu?.labels ?? []).some(l => /coins|pièces/i.test(l)), `the player's right-click menu of a square has no coin entry (${(menu?.labels ?? []).join(" | ")})`);
    ctx.expect(menu?.typed?.dialog && menu.typed.seen?.gp?.max === "10" && menu.typed.seen?.gp?.value === "10" && menu.typed.seen?.sp?.max === "6", `gold dragged from the sheet to the map: it asks how many of each coin held, the gold filled in (${JSON.stringify(menu?.typed)})`);
    let now = await state();
    const pile = now.piles[0];
    ctx.expect(now.piles.length === 1 && pile.gp === 4 && now.purse.gp === 6, `4 gp typed: one pile holds 4 gp, 6 gp stay in the purse (${JSON.stringify(now)})`);
    ctx.expect(pile && Math.abs(pile.x - 500) <= 150 && Math.abs(pile.y - 500) <= 150, `the pile is next to the character (${pile?.x}, ${pile?.y})`);
    ctx.expect(pile && pile.levels.includes(setup.upper) && pile.tileLevels.includes(setup.upper) && pile.tileElevation === 20,
      `it is on the character's V14 level, on its floor (levels ${JSON.stringify(pile?.levels)}, tile at ${pile?.tileElevation})`);
    ctx.expect(pile && /coins/.test(pile.img ?? "") && pile.alpha === 1, `the pile shows coins and is revealed after the flight (${pile?.img}, alpha ${pile?.alpha})`);

    // 2. The sheet's coins can be dragged; a drag dropped on the same square joins the pile.
    const drag = await ctx.asPlayer(`${fill}
      const actor = game.actors.get(args.actor);
      await actor.sheet.render({ force: true });
      const icons = () => [...(actor.sheet.element?.querySelectorAll("section.currency label i.currency") ?? [])];
      for ( let i = 0; i < 40 && !icons().some(el => el.draggable); i++ ) await new Promise(r => setTimeout(r, 250));
      const draggable = icons().filter(el => el.draggable).map(el => el.dataset.dloCoins);
      // What the drag carries, as the core hands it to the map when it is dropped there.
      let carried = null;
      const sp = icons().find(el => el.dataset.dloCoins === "sp");
      if ( sp ) {
        const dt = new DataTransfer();
        sp.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
        try { carried = JSON.parse(dt.getData("text/plain")); } catch { carried = null; }
      }
      await actor.sheet.close();
      if ( !carried ) return { draggable, carried };
      Hooks.call("dropCanvasData", canvas, { ...carried, x: args.x, y: args.y }, null);
      const typed = await fillCoins({});
      await new Promise(r => setTimeout(r, 2500));
      return { draggable, carried: carried.type, typed };`, { ...setup, x: pile ? pile.x + 20 : 650, y: pile ? pile.y + 20 : 550 });
    ctx.expect((drag?.draggable ?? []).includes("gp") && (drag?.draggable ?? []).includes("sp"), `the coins of the player's sheet can be dragged (${JSON.stringify(drag?.draggable)})`);
    ctx.expect(drag?.typed?.dialog && drag.typed.seen?.sp?.value === "6" && drag.typed.seen?.gp?.value === "0", `silver dragged to the map: « how many » opens with all the silver filled in (${JSON.stringify(drag?.typed)})`);
    now = await state();
    ctx.expect(now.piles.length === 1 && now.piles[0].gp === 4 && now.piles[0].sp === 6 && now.purse.sp === 0, `the 6 sp joined the same pile (${JSON.stringify(now)})`);

    // 3. Everyone is told.
    const cards = await ctx.asPlayer(`return game.messages.contents.filter(m => (m.timestamp >= args.since) && m.getFlag("darsh-loot", "dropCoins")).map(m => m.whisper.length);`, { since });
    ctx.expect(cards?.length === 2 && cards.every(n => n === 0), `the player's client received a public card for each drop (${JSON.stringify(cards)})`);

    // 4. Crafted requests.
    const send = data => ctx.asPlayer(`
      try { return { answer: await game.users.activeGM.query("darsh-loot.dropCoins", args, { timeout: 30000 }) ?? null }; }
      catch(err) { return { error: String(err?.message ?? err) }; }`, data);
    const notMine = await send({ dropper: setup.stranger, x: 1050, y: 550, coins: { gp: 9 } });
    now = await state();
    ctx.expect(!!notMine.error && now.stranger === 9 && now.piles.length === 1, `dropping the coins of a character the player does not own: refused (${JSON.stringify(notMine)})`);
    const huge = await send({ dropper: setup.looter, x: now.piles[0].x + 20, y: now.piles[0].y + 20, coins: { gp: 99999, pp: 5 } });
    await pause(1500);
    now = await state();
    ctx.expect(!huge.error && now.purse.gp === 0 && now.piles.length === 1 && now.piles[0].gp === 10, `a huge amount: only the 6 gp of the purse move, none is created (${JSON.stringify(now.piles[0])}, ${JSON.stringify(huge)})`);

    // 5. Taken back.
    const back = await ctx.asPlayer(`
      const api = game.modules.get("darsh-loot").api;
      return await api.takeFromContainer(fromUuidSync(args.behavior), fromUuidSync(args.looter), { coins: true });`, { ...setup, behavior: now.piles[0].behavior });
    await pause(1200);
    now = await state();
    ctx.expect(!!back && now.purse.gp === 10 && now.purse.sp === 6 && now.piles.length === 0, `the player takes the coins back: the purse is whole, the pile is gone (${JSON.stringify(now)})`);
  }
};
