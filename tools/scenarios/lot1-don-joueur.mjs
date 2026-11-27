/**
 * Lot 1 (2026-11-27) — giving an item or coins, with a REAL player client. On a temporary ACTIVE scene (the player's client
 * views it), the token of « claude player »'s character stands next to a companion nobody plays, with 4 potions and 10 gp:
 *  1. the Core's right-click menu of the companion, as the player gets it, keeps « Trade » alone (no « give » entry: user's
 *     decision of 2026-11-27); the potion dragged onto the companion's token asks how many; 2 typed: given, 2 stay, no pile;
 *  2. dragged again, 1 typed: given;
 *  3. the same drag on an empty square still makes a pile, as before;
 *  4. the gold of the sheet's purse dragged onto the companion's token: « how many » with all the gold filled in; 4 kept: given;
 *  5. a friend far away: the « do it anyway » window opens; given up: nothing moves;
 *  6. « ask » mode: the gift waits for the GM (who answers for a character nobody plays) and moves once accepted; and the
 *     acceptance window, sent by the GM client to the player's, answers what the player clicks — a player cannot send it;
 *  7. crafted: giving the items of a character the player does not own is refused.
 * Without the bench's player client: not applicable. Restored: the active and viewed scenes, the setting, the test actors, the
 * character's purse and items.
 *
 * Run with the Core's runner: `node tools/scenario.mjs "../Foundry dnd5e butin et commerce/tools/scenarios/lot1-don-joueur.mjs"`
 * (on the bench: `npm run banc:passe -- "<that path>"`).
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const MARK = "​⁠";

export default {
  name: "loot — lot 1: a real player gives an item and coins to another character (drag on the token, ask mode)",
  players: true,

  async run(ctx) {
    const gm = async (code, args) => (await ctx.call("run-script", { code, ...(args ? { args } : {}), waitMs: 30000 }))?.result;

    const setup = await gm(`
      const player = game.users.find(u => u.name === "claude player");
      const actor = game.actors.find(a => (a.type === "character") && player && a.testUserPermission(player, "OWNER"));
      if ( !player || !actor ) return { missing: true };
      const previous = { scene: canvas.scene?.id ?? null, level: canvas.level?.id ?? null, active: game.scenes.active?.id ?? null,
        purse: { ...actor.system.currency }, reach: game.settings.get("darsh-loot", "reach"),
        giveMode: game.settings.get("darsh-loot", "giveMode"), dropMode: game.settings.get("darsh-loot", "dropMode") };
      const TEST = { "darsh-loot": { test: true } };
      const scene = await Scene.create({ name: "DAS Loot — lot 1 gifts (test)", width: 2500, height: 2500, padding: 0,
        grid: { size: 100, distance: 5 }, tokenVision: false, environment: { darknessLevel: 0, globalLight: { enabled: true } },
        ownership: { default: 2 }, flags: TEST });
      const pc = name => Actor.implementation.create({ name, type: "character", img: "icons/svg/mystery-man.svg", flags: TEST,
        system: { currency: { gp: 0 } } });
      const [companion, distant] = [await pc("DAS test companion"), await pc("DAS test distant friend")];
      const [potion] = await actor.createEmbeddedDocuments("Item", [{ name: "DAS test potion", type: "consumable", system: { quantity: 4 } }]);
      const at = (a, x, y) => ({ name: a.name, actorId: a.id, actorLink: true, x, y, elevation: 0 });
      const tokens = await scene.createEmbeddedDocuments("Token", [at(actor, 300, 300), at(companion, 400, 300), at(distant, 1500, 300)]);
      await actor.update({ "system.currency": { pp: 0, gp: 10, ep: 0, sp: 0, cp: 0 } });
      await game.settings.set("darsh-loot", "reach", 5);
      await game.settings.set("darsh-loot", "giveMode", "direct");
      await game.settings.set("darsh-loot", "dropMode", "on");
      await scene.activate();
      await scene.view();
      for ( let i = 0; i < 40 && ((canvas.scene?.id !== scene.id) || !canvas.ready); i++ ) await new Promise(r => setTimeout(r, 250));
      await new Promise(r => setTimeout(r, 1000));
      return { previous, scene: scene.id, viewed: canvas.scene?.id === scene.id, actor: actor.id, player: player.id,
        companion: companion.id, distant: distant.id, potion: potion.id, potionUuid: potion.uuid,
        looter: tokens[0].uuid, companionToken: tokens[1].uuid, distantToken: tokens[2].uuid };`);
    if ( setup?.missing ) { ctx.log("no character owned by « claude player »: not applicable"); return; }
    if ( !ctx.expect(setup?.viewed && setup.potion, `scene ready, active and viewed by the GM (${JSON.stringify({ viewed: setup?.viewed })})`) ) return;
    ctx.restore(() => gm(`
      const actor = game.actors.get(args.actor);
      const p = args.previous;
      for ( const app of foundry.applications.instances.values() ) if ( app.options?.classes?.includes("dlo-give-offer") ) await app.close().catch(() => {});
      if ( p.active ) await game.scenes.get(p.active)?.activate();
      if ( p.scene ) await game.scenes.get(p.scene)?.view(p.level ? { level: p.level } : {});
      await game.scenes.get(args.scene)?.delete();
      const mine = (actor?.items ?? []).filter(i => i.name.startsWith("DAS test ")).map(i => i.id);
      if ( mine.length ) await actor.deleteEmbeddedDocuments("Item", mine);
      await actor?.update({ "system.currency": p.purse });
      const left = game.actors.filter(a => a.getFlag("darsh-loot", "test") || (a.getFlag("darsh-loot", "containerOf") ?? "").includes(args.scene));
      if ( left.length ) await Actor.implementation.deleteDocuments(left.map(a => a.id));
      for ( const k of ["reach", "giveMode", "dropMode"] ) await game.settings.set("darsh-loot", k, p[k]);
      return true;`, setup).catch(err => ctx.log(`cleanup: ${err.message}`)));

    const who = await ctx.asPlayer(`
      for ( let i = 0; i < 60 && ((canvas.scene?.id !== args.scene) || !canvas.ready); i++ ) await new Promise(r => setTimeout(r, 250));
      await new Promise(r => setTimeout(r, 800));
      return { user: game.user.name, gm: game.user.isGM, activeGM: game.users.activeGM?.name ?? null, scene: canvas.scene?.id === args.scene,
        query: typeof CONFIG.queries["darsh-loot.give"] };`, setup);
    ctx.log(`player client: ${JSON.stringify(who)}`);
    if ( !ctx.expect(who && !who.gm && who.activeGM && who.scene && (who.query === "function"), `a player client (${who?.user}) viewing the test scene, with an active GM`) ) return;

    const state = () => gm(`
      const count = (a, name) => (a?.items ?? []).filter(i => i.name === name).reduce((n, i) => n + (i.system.quantity ?? 1), 0);
      const [me, companion, distant] = [args.actor, args.companion, args.distant].map(id => game.actors.get(id));
      return { potions: [count(me, "DAS test potion"), count(companion, "DAS test potion"), count(distant, "DAS test potion")],
        gp: [me.system.currency.gp, companion.system.currency.gp], piles: game.scenes.get(args.scene).regions.filter(r => r.getFlag("darsh-loot", "pile")).length };`, setup);
    /** Helpers of the player's page: wait for an element, token centres. */
    const tools = `
      const waitFor = async (selector, ms=10000) => { for ( let i = 0; i < ms / 250 && !document.querySelector(selector); i++ ) await new Promise(r => setTimeout(r, 250)); return document.querySelector(selector); };
      const centre = uuid => { const t = fromUuidSync(uuid); const s = canvas.scene.grid.size; return { x: t._source.x + (s / 2), y: t._source.y + (s / 2) }; };
      const settle = ms => new Promise(r => setTimeout(r, ms));`;

    // 1. The menu, then « Give an item… ».
    const since = Date.now() - 1;
    const menu = await ctx.asPlayer(`${tools}
      const engine = game.modules.get("dnd5e-combat")?.api;
      fromUuidSync(args.looter).object?.control({ releaseOthers: true });
      await settle(300);
      const entries = await engine?.ui?.tokenMenu?.(fromUuidSync(args.companionToken).object) ?? [];
      const labels = entries.map(e => e.label);
      Hooks.call("dropCanvasData", canvas, { type: "Item", uuid: args.potionUuid, ...centre(args.companionToken) }, null);
      const input = await waitFor("input[name=quantity]");
      if ( !input ) return { labels, dialog: false };
      const max = input.max;
      input.value = "2";
      input.closest("form").querySelector('button[data-action="ok"]').click();
      await settle(2000);
      return { labels, trade: game.i18n.localize("DLO.Trade.Menu"), dialog: true, max };`, setup);
    ctx.expect((menu?.labels ?? []).includes(menu?.trade) && !(menu?.labels ?? []).some(l => /^(give an item|give coins|donner un objet|donner des pi)/i.test(l)),
      `the player's right-click menu of the companion keeps « ${menu?.trade} » alone, no « give » entry (${(menu?.labels ?? []).join(" | ")})`);
    let now = await state();
    ctx.expect(menu?.dialog && menu.max === "4" && now.potions[0] === 2 && now.potions[1] === 2 && now.piles === 0, `the potion dragged onto the companion's token asks how many; 2 of 4 typed — 2 given, 2 kept, no pile (${JSON.stringify(now)}, ${JSON.stringify(menu)})`);
    const card = await ctx.asPlayer(`
      const m = game.messages.contents.find(m => (m.timestamp >= args.since) && m.getFlag("darsh-loot", "give"));
      return m ? { whisper: m.whisper.length, fly: m.getFlag("darsh-loot", "flyFx")?.to?.length ?? 0, floats: 1 + (m.getFlag("darsh-loot", "feedback")?.also?.length ?? 0) } : null;`, { since });
    ctx.expect(card && card.whisper === 0 && card.fly === 1 && card.floats === 2, `the player's client received the public card: the potion flies to the companion, a floating text over each (${JSON.stringify(card)})`);

    // 2. Dragged again: one more.
    const onToken = await ctx.asPlayer(`${tools}
      Hooks.call("dropCanvasData", canvas, { type: "Item", uuid: args.potionUuid, ...centre(args.companionToken) }, null);
      const input = await waitFor("input[name=quantity]");
      if ( !input ) return { dialog: false };
      const title = input.closest(".application, dialog")?.querySelector(".window-title")?.innerText ?? null;
      input.value = "1";
      input.closest("form").querySelector('button[data-action="ok"]').click();
      await settle(2000);
      return { dialog: true, title };`, setup);
    now = await state();
    ctx.expect(onToken?.dialog && now.potions[0] === 1 && now.potions[1] === 3 && now.piles === 0, `the potion dragged onto the companion's token: given, no pile on the ground (${JSON.stringify(now)}, « ${onToken?.title} »)`);

    // 3. On an empty square: a pile, as before.
    await ctx.asPlayer(`${tools}
      Hooks.call("dropCanvasData", canvas, { type: "Item", uuid: args.potionUuid, x: 350, y: 450 }, null);
      await settle(2500);
      return true;`, setup);
    now = await state();
    ctx.expect(now.piles === 1 && now.potions[0] === 0 && now.potions[1] === 3, `the same drag on an empty square still makes a pile (${JSON.stringify(now)})`);

    // 4. Coins of the sheet dragged onto the token.
    const coins = await ctx.asPlayer(`${tools}
      Hooks.call("dropCanvasData", canvas, { type: "darsh-loot.coins", actor: game.actors.get(args.actor).uuid, key: "gp", ...centre(args.companionToken) }, null);
      const fields = await waitFor(".dlo-coin-fields");
      if ( !fields ) return { dialog: false };
      const form = fields.closest("form");
      const filled = form.elements.gp.value;
      form.elements.gp.value = "4";
      form.querySelector('button[data-action="ok"]').click();
      await settle(2000);
      return { dialog: true, filled };`, setup);
    now = await state();
    ctx.expect(coins?.dialog && coins.filled === "10" && now.gp[0] === 6 && now.gp[1] === 4 && now.piles === 1, `gold dragged onto the token: all of it filled in, 4 kept — given, not dropped (${JSON.stringify(now.gp)}, ${JSON.stringify(coins)})`);

    // 5. Far away: the warning window, given up.
    const far = await ctx.asPlayer(`${tools}
      const api = game.modules.get("darsh-loot").api;
      const pending = api.give(fromUuidSync(args.looter), fromUuidSync(args.distantToken), { coins: { gp: 1 } });
      const reason = await waitFor(".dlo-force-reason");
      if ( !reason ) return { dialog: false };
      const text = reason.innerText;
      reason.closest(".application, dialog").querySelector('button[data-action="no"]').click();
      return { dialog: true, text, answer: await pending };`, setup);
    now = await state();
    ctx.expect(far?.dialog && far.answer === null && now.gp[0] === 6, `a friend far away: « ${far?.text} » — given up, nothing moves (${JSON.stringify(now.gp)})`);
    const crossed = await ctx.asPlayer(`
      try { return { answer: await game.users.activeGM.query("darsh-loot.give", args, { timeout: 30000 }) ?? null }; }
      catch(err) { return { error: String(err?.message ?? err) }; }`, { giver: setup.looter, receiver: setup.distantToken, coins: { gp: 1 } });
    ctx.expect(!!crossed.error && crossed.error.includes(MARK), `the same request sent raw: a refusal that can be forced (${JSON.stringify(crossed).replaceAll(MARK, "‹mark›")})`);

    // 6. « Ask » mode.
    await gm(`await game.settings.set("darsh-loot", "giveMode", "ask"); return true;`);
    await pause(500);
    await ctx.asPlayer(`
      const api = game.modules.get("darsh-loot").api;
      window.__dasGift = api.give(fromUuidSync(args.looter), fromUuidSync(args.companionToken), { coins: { gp: 2 } });
      return true;`, setup);
    const asked = await gm(`
      let button = null;
      for ( let i = 0; i < 40 && !(button = document.querySelector('.dlo-give-offer button[data-action="yes"]')); i++ ) await new Promise(r => setTimeout(r, 250));
      const text = button?.closest(".application, dialog")?.querySelector(".window-content, .dialog-content")?.innerText ?? null;
      const before = game.actors.get(args.companion).system.currency.gp;
      button?.click();
      return { asked: !!button, text, before };`, setup);
    const answered = await ctx.asPlayer(`return await window.__dasGift;`);
    await pause(500);
    now = await state();
    ctx.expect(asked?.asked && asked.before === 4, `« ask » mode: the GM, who answers for a character nobody plays, is asked first — nothing moved yet (« ${asked?.text?.trim()} », companion ${asked?.before} gp)`);
    ctx.expect(!!answered && now.gp[0] === 4 && now.gp[1] === 6, `accepted: the 2 gp move (${JSON.stringify(now.gp)})`);
    await ctx.asPlayer(`window.__dasClicks = (async () => {
        const wait = async sel => { for ( let i = 0; i < 60 && !document.querySelector(sel); i++ ) await new Promise(r => setTimeout(r, 250)); return document.querySelector(sel); };
        (await wait('.dlo-give-offer button[data-action="no"]'))?.click();
        await new Promise(r => setTimeout(r, 1500));
        (await wait('.dlo-give-offer button[data-action="yes"]'))?.click();
      })(); return true;`);
    const windowAnswers = await gm(`
      const player = game.users.get(args.player);
      const offer = { giver: "DAS test companion", receiver: "the player's character", what: "a test" };
      const first = await player.query("darsh-loot.giveOffer", offer, { timeout: 20000 });
      const second = await player.query("darsh-loot.giveOffer", offer, { timeout: 20000 });
      return { first, second };`, setup);
    ctx.expect(windowAnswers?.first === false && windowAnswers?.second === true, `the acceptance window at the player answers what the player clicks: Refuse, then Accept (${JSON.stringify(windowAnswers)})`);
    const selfOffer = await ctx.asPlayer(`return await CONFIG.queries["darsh-loot.giveOffer"]({ giver: "x", receiver: "y", what: "z" }, { user: game.user });`);
    ctx.expect(selfOffer === false, `a player cannot make that window appear (${JSON.stringify(selfOffer)})`);
    await gm(`await game.settings.set("darsh-loot", "giveMode", "direct"); return true;`);

    // 7. Crafted.
    const notMine = await ctx.asPlayer(`
      try { return { answer: await game.users.activeGM.query("darsh-loot.give", args, { timeout: 30000 }) ?? null }; }
      catch(err) { return { error: String(err?.message ?? err) }; }`, { giver: setup.companionToken, receiver: setup.looter, coins: { gp: 5 }, force: true });
    now = await state();
    ctx.expect(!!notMine.error && now.gp[0] === 4 && now.gp[1] === 6, `giving the coins of a character the player does not own to oneself: refused, even « forced » (${JSON.stringify(notMine)})`);
  }
};
