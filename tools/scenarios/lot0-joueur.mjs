/**
 * Lot 0 (audit of 2026-11-26, defects 8, 10, 13, 16, 17) — requests a REAL player client sends to the active GM, as a player could
 * type them in the console, and what a real player sees when the GM client loses a trade. On a temporary scene with two levels
 * and one wall, viewed by the GM (the wall test runs on the GM's canvas), with a token of « claude player »'s character:
 *  1. take from a corpse right behind a wall: refused (« a wall is in the way »), the dagger stays;
 *  2. take from a corpse next to the character, no wall: done (the control: reach itself works);
 *  3. take from a corpse on the other V14 level, same square distance: refused (out of reach);
 *  4. `shopDeal` naming the merchant's ACTOR while its token is far away: refused; once the GM has shown the shop: accepted, the
 *     rope is bought and paid;
 *  5. `tradeOpen` with an NPC: refused; with another character: the trade window opens at the player; the GM client then says it
 *     holds no trade (what it does when it has just reloaded): the player's window closes, with the reason.
 * Without the bench's player client: not applicable. Restored: the viewed scene, the scene, the test actors, the character's purse
 * and items.
 *
 * Run with the Core's runner: `node tools/scenario.mjs "../Foundry dnd5e butin et commerce/tools/scenarios/lot0-joueur.mjs"`
 * (on the bench: `npm run banc:passe -- "<that path>"`).
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "loot — lot 0: a real player's crafted requests are refused by the GM (walls, levels, shop by actor, trades)",
  players: true,

  async run(ctx) {
    const gm = async (code, args) => (await ctx.call("run-script", { code, ...(args ? { args } : {}), waitMs: 30000 }))?.result;

    const setup = await gm(`
      const player = game.users.find(u => u.name === "claude player");
      const actor = game.actors.find(a => (a.type === "character") && player && a.testUserPermission(player, "OWNER"));
      if ( !player || !actor ) return { missing: true };
      const previous = { scene: canvas.scene?.id ?? null, level: canvas.level?.id ?? null, purse: { ...actor.system.currency },
        whoLoots: game.settings.get("darsh-loot", "whoLoots"), reach: game.settings.get("darsh-loot", "reach") };
      const TEST = { "darsh-loot": { test: true } };
      const scene = await Scene.create({ name: "DAS Loot — lot 0 player (test)", width: 2500, height: 2500, padding: 0,
        grid: { size: 100, distance: 5 }, tokenVision: false, environment: { darknessLevel: 0, globalLight: { enabled: true } },
        ownership: { default: 2 }, flags: TEST });
      const ground = scene.levels.contents[0];
      await ground.update({ name: "Ground", elevation: { bottom: 0, top: 20 } });
      const [upper] = await scene.createEmbeddedDocuments("Level", [{ name: "Upper", elevation: { bottom: 20, top: 40 } }]);
      // A wall right of the character's square, between it and the first corpse.
      await scene.createEmbeddedDocuments("Wall", [{ c: [400, 100, 400, 600] }]);
      const dead = name => Actor.implementation.create({ name, type: "npc", img: "icons/svg/skull.svg",
        system: { attributes: { hp: { value: 0, max: 10 } }, details: { type: { value: "humanoid" }, cr: 0 } },
        flags: { "darsh-loot": { test: true, rolled: true } },
        items: [{ name: "DAS test dagger", type: "weapon", system: { quantity: 1, properties: ["gear"] } }] });
      const [walled, near, above] = [await dead("DAS corpse behind wall"), await dead("DAS corpse near"), await dead("DAS corpse above")];
      const merchant = await Actor.implementation.create({ name: "DAS test merchant", type: "npc", img: "icons/svg/mystery-man.svg",
        system: { attributes: { hp: { value: 10, max: 10 } }, currency: { gp: 0 } },
        flags: { "darsh-loot": { test: true, merchant: { enabled: true } } },
        items: [{ name: "DAS test rope", type: "loot", system: { quantity: 2, price: { value: 1, denomination: "gp" }, properties: ["gear"] } }] });
      const other = await Actor.implementation.create({ name: "DAS test companion", type: "character", img: "icons/svg/mystery-man.svg", flags: TEST });
      const bystander = await Actor.implementation.create({ name: "DAS test bystander", type: "npc", img: "icons/svg/mystery-man.svg", flags: TEST });
      const at = (a, x, y, extra={}) => ({ name: a.name, actorId: a.id, x, y, elevation: 0, level: ground.id, ...extra });
      const tokens = await scene.createEmbeddedDocuments("Token", [
        at(actor, 300, 300, { actorLink: true }), at(walled, 400, 300), at(near, 300, 400),
        at(above, 200, 300, { level: upper.id }), at(merchant, 2000, 2000)]);
      for ( const t of tokens.slice(1, 4) ) await t.actor.toggleStatusEffect("dead", { active: true, overlay: true });
      if ( (actor.system.currency.gp ?? 0) < 5 ) await actor.update({ "system.currency.gp": 5 });
      await game.settings.set("darsh-loot", "whoLoots", "all");
      await game.settings.set("darsh-loot", "reach", 5);
      await scene.view();
      for ( let i = 0; i < 40 && ((canvas.scene?.id !== scene.id) || !canvas.ready); i++ ) await new Promise(r => setTimeout(r, 250));
      await new Promise(r => setTimeout(r, 1000));
      const dagger = t => t.actor.items.find(i => i.name === "DAS test dagger")?.id ?? null;
      return { previous, scene: scene.id, viewed: canvas.scene?.id === scene.id, actor: actor.id, actorUuid: actor.uuid, player: player.id,
        looter: tokens[0].uuid, gp: actor.system.currency.gp,
        walled: { uuid: tokens[1].uuid, item: dagger(tokens[1]) }, near: { uuid: tokens[2].uuid, item: dagger(tokens[2]) },
        above: { uuid: tokens[3].uuid, item: dagger(tokens[3]), level: tokens[3]._source.level, looterLevel: tokens[0]._source.level },
        merchantToken: tokens[4].uuid, merchantActor: tokens[4].actor.uuid, merchantId: merchant.id,
        rope: tokens[4].actor.items.find(i => i.name === "DAS test rope")?.id ?? null,
        other: other.uuid, bystander: bystander.uuid };`);
    if ( setup?.missing ) { ctx.log("no character owned by « claude player »: not applicable"); return; }
    if ( !ctx.expect(setup?.viewed && setup.walled.item && setup.rope, `scene, corpses and merchant ready, viewed by the GM (${JSON.stringify({ viewed: setup?.viewed, levels: [setup?.above?.looterLevel, setup?.above?.level] })})`) ) return;
    ctx.restore(() => gm(`
      const actor = game.actors.get(args.actor);
      if ( args.previous.scene ) await game.scenes.get(args.previous.scene)?.view(args.previous.level ? { level: args.previous.level } : {});
      await game.scenes.get(args.scene)?.delete();
      const mine = (actor?.items ?? []).filter(i => i.name.startsWith("DAS test ")).map(i => i.id);
      if ( mine.length ) await actor.deleteEmbeddedDocuments("Item", mine);
      await actor?.update({ "system.currency": args.previous.purse });
      const left = game.actors.filter(a => a.getFlag("darsh-loot", "test"));
      if ( left.length ) await Actor.implementation.deleteDocuments(left.map(a => a.id));
      await game.settings.set("darsh-loot", "whoLoots", args.previous.whoLoots);
      await game.settings.set("darsh-loot", "reach", args.previous.reach);
      for ( const app of foundry.applications.instances.values() ) if ( app.id?.startsWith("darsh-loot-") ) await app.close().catch(() => {});
      return true;`, setup).catch(err => ctx.log(`cleanup: ${err.message}`)));

    const who = await ctx.asPlayer(`return { user: game.user.name, gm: game.user.isGM, activeGM: game.users.activeGM?.name ?? null,
      queries: Object.keys(CONFIG.queries).filter(k => k.startsWith("darsh-loot.")).length };`);
    ctx.log(`player client: ${JSON.stringify(who)}`);
    if ( !ctx.expect(who && !who.gm && who.activeGM && who.queries > 0, `a player client (${who?.user}) with an active GM (${who?.activeGM})`) ) return;
    const send = (name, data) => ctx.asPlayer(`
      try { return { answer: await game.users.activeGM.query(args.name, args.data, { timeout: 30000 }) ?? null }; }
      catch(err) { return { error: String(err?.message ?? err) }; }`, { name, data });
    const count = (uuid, itemName) => gm(`
      const doc = fromUuidSync(args.uuid, { strict: false });
      const actor = doc?.actor ?? doc;
      return (actor?.items ?? []).filter(i => i.name === args.itemName).reduce((n, i) => n + (i.system.quantity ?? 1), 0);`, { uuid, itemName });
    const take = corpse => send("darsh-loot.take", { source: { kind: "corpse", uuid: corpse.uuid }, looter: setup.looter, itemIds: [corpse.item], coins: false });

    // 1. Behind a wall.
    const walled = await take(setup.walled);
    ctx.expect(!!walled.error && (await count(setup.walled.uuid, "DAS test dagger")) === 1, `a corpse right behind a wall: refused, the dagger stays (${JSON.stringify(walled)})`);
    // 2. The control: next to the character, no wall.
    const near = await take(setup.near);
    await pause(500);
    ctx.expect(!near.error && (await count(setup.near.uuid, "DAS test dagger")) === 0 && (await count(setup.actorUuid, "DAS test dagger")) === 1,
      `a corpse next to the character: taken (${JSON.stringify(near)})`);
    // 3. On the other level.
    const above = await take(setup.above);
    ctx.expect(!!above.error && (await count(setup.above.uuid, "DAS test dagger")) === 1, `a corpse on the other V14 level: refused (${JSON.stringify(above)})`);
    ctx.expect(walled.error !== above.error, `the two refusals give their own reason (« ${walled.error} » / « ${above.error} »)`);

    // 4. The shop addressed by its actor.
    const cart = { source: { kind: "merchant", uuid: setup.merchantActor }, looter: setup.looter, buy: [{ id: setup.rope, quantity: 1 }], sell: [] };
    const sneaky = await send("darsh-loot.shopDeal", cart);
    ctx.expect(!!sneaky.error && (await count(setup.actorUuid, "DAS test rope")) === 0, `shopDeal by the merchant's actor, token far away: refused (${JSON.stringify(sneaky)})`);
    const byToken = await send("darsh-loot.shopDeal", { ...cart, source: { kind: "merchant", uuid: setup.merchantToken } });
    ctx.expect(!!byToken.error, `shopDeal by its token from across the map: refused too (${JSON.stringify(byToken)})`);
    const shown = await gm(`
      const actor = fromUuidSync(args.uuid, { strict: false });
      const count = await game.modules.get("darsh-loot").api.showShop(actor);
      return { count, shown: actor.getFlag("darsh-loot", "shown") ?? null };`, { uuid: setup.merchantActor });
    await pause(1500);
    ctx.expect(shown?.count >= 1 && (shown.shown?.users ?? []).includes(setup.player), `the GM shows the shop to the connected players (${JSON.stringify(shown)})`);
    const windowOpen = await ctx.asPlayer(`
      const apps = [...foundry.applications.instances.values()].filter(a => a.id?.includes("darsh-loot") && a.rendered);
      const ids = apps.map(a => a.id);
      for ( const app of apps ) await app.close().catch(() => {});
      return ids;`);
    ctx.expect((windowOpen ?? []).length >= 1, `the shop window opened at the player (${JSON.stringify(windowOpen)})`);
    const allowed = await send("darsh-loot.shopDeal", cart);
    await pause(500);
    const after = await gm(`return game.actors.get(args.actor).system.currency.gp;`, setup);
    ctx.expect(!allowed.error && (await count(setup.actorUuid, "DAS test rope")) === 1 && (after === setup.gp - 1),
      `once shown: the deal is done, one rope for one gold piece (${JSON.stringify(allowed)}, ${setup.gp} → ${after} gp)`);

    // 5. Trades.
    const toNpc = await send("darsh-loot.tradeOpen", { from: setup.actorUuid, to: setup.bystander });
    ctx.expect(!!toNpc.error, `a trade with an NPC: refused (${JSON.stringify(toNpc)})`);
    const opened = await send("darsh-loot.tradeOpen", { from: setup.actorUuid, to: setup.other });
    await pause(1500);
    const tradeWindows = () => ctx.asPlayer(`
      const { TradeWindow } = await import("/modules/darsh-loot/scripts/apps/trade-window.mjs");
      return [...TradeWindow.open.values()].map(a => ({ id: a.trade.id, gm: a.trade.gm ?? null, rev: a.trade.rev ?? null, rendered: !!a.rendered }));`);
    const before = await tradeWindows();
    ctx.expect(!opened.error && before.some(w => w.id === opened.answer?.id && w.gm), `a trade with another character: the window opens at the player, the state names the GM client (${JSON.stringify(before)})`);
    const fromPlayer = await send("darsh-loot.tradeReset", {});
    ctx.expect((await tradeWindows()).length === before.length, `a player cannot make trade windows close (${JSON.stringify(fromPlayer)})`);
    const reset = await gm(`
      const player = game.users.get(args.player);
      return await player.query("darsh-loot.tradeReset", {}, { timeout: 10000 });`, setup);
    await pause(1000);
    const closed = await tradeWindows();
    ctx.expect(reset === true && !closed.some(w => w.id === opened.answer?.id), `the GM client says it holds no trade: the player's window closes (${JSON.stringify(closed)})`);
    const dead = await send("darsh-loot.tradeUpdate", { id: opened.answer?.id, offer: { items: [], coins: {} } });
    ctx.log(`witness: the same trade, still in the GM's memory here, answers ${JSON.stringify(dead)}`);
    await gm(`await CONFIG.queries["darsh-loot.tradeCancel"]({ id: args.id }, { user: game.user }); return true;`, { id: opened.answer?.id }).catch(() => {});
  }
};
