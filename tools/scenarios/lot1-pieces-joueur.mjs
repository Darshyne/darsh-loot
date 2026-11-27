/**
 * Lot 1 (2026-11-27, issue darsh-loot#19) — sharing the coins, with a REAL player client. On a temporary scene with two V14
 * levels, viewed by the GM, with a token of « claude player »'s character and a companion; both form a test primary party:
 *  1. the player opens the search window of a corpse next to the character: the « Share » button is there and names the two
 *     members; clicked, the 9 gp are split 4 / 4, 1 gp stays on the corpse, and the player's client receives the public card;
 *  2. the right-click menu the Core builds for the player offers « Share the coins with the party » on a corpse;
 *  3. a corpse far away, shared through the module's API as the interface does: the GM client refuses with a reason, the
 *     player's client shows the « do it anyway » window; confirmed, the share is done and the GM gets a whispered note;
 *  4. a corpse on the other V14 level, same square distance: out of reach (a refusal that can be forced, nothing moves);
 *  5. crafted requests: sharing for a character the player does not own is refused even « forced »; a living NPC's pockets
 *     are never shared.
 * Without the bench's player client: not applicable. Restored: the viewed scene, the primary party, the sharing settings, the
 * test actors, the character's purse.
 *
 * Run with the Core's runner: `node tools/scenario.mjs "../Foundry dnd5e butin et commerce/tools/scenarios/lot1-pieces-joueur.mjs"`
 * (on the bench: `npm run banc:passe -- "<that path>"`).
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const MARK = "​⁠";

export default {
  name: "loot — lot 1: a real player shares the coins of a corpse with the party (window, menu, forced refusal, levels)",
  players: true,

  async run(ctx) {
    const gm = async (code, args) => (await ctx.call("run-script", { code, ...(args ? { args } : {}), waitMs: 30000 }))?.result;

    const setup = await gm(`
      const player = game.users.find(u => u.name === "claude player");
      const actor = game.actors.find(a => (a.type === "character") && player && a.testUserPermission(player, "OWNER"));
      if ( !player || !actor ) return { missing: true };
      const S = (k, v) => game.settings.set("darsh-loot", k, v);
      const previous = { scene: canvas.scene?.id ?? null, level: canvas.level?.id ?? null, purse: { ...actor.system.currency },
        party: game.settings.get("dnd5e", "primaryParty")?.actor?.id ?? null,
        whoLoots: game.settings.get("darsh-loot", "whoLoots"), reach: game.settings.get("darsh-loot", "reach"),
        shareWith: game.settings.get("darsh-loot", "shareWith"), shareRemainder: game.settings.get("darsh-loot", "shareRemainder") };
      const TEST = { "darsh-loot": { test: true } };
      const scene = await Scene.create({ name: "DAS Loot — lot 1 coins (test)", width: 2500, height: 2500, padding: 0,
        grid: { size: 100, distance: 5 }, tokenVision: false, environment: { darknessLevel: 0, globalLight: { enabled: true } },
        ownership: { default: 2 }, flags: TEST });
      const ground = scene.levels.contents[0];
      await ground.update({ name: "Ground", elevation: { bottom: 0, top: 20 } });
      const [upper] = await scene.createEmbeddedDocuments("Level", [{ name: "Upper", elevation: { bottom: 20, top: 40 } }]);
      const dead = (name, gp) => Actor.implementation.create({ name, type: "npc", img: "icons/svg/skull.svg",
        system: { attributes: { hp: { value: 0, max: 10 } }, details: { type: { value: "humanoid" }, cr: 0 }, currency: { gp } },
        flags: { "darsh-loot": { test: true, rolled: true } } });
      const [near, far, above, menu] = [await dead("DAS corpse near", 9), await dead("DAS corpse far", 6), await dead("DAS corpse above", 4), await dead("DAS corpse menu", 2)];
      const alive = await Actor.implementation.create({ name: "DAS living guard", type: "npc", img: "icons/svg/mystery-man.svg",
        system: { attributes: { hp: { value: 10, max: 10 } }, currency: { gp: 8 } }, flags: TEST });
      const companion = await Actor.implementation.create({ name: "DAS test companion", type: "character", img: "icons/svg/mystery-man.svg", flags: TEST });
      const group = await Actor.implementation.create({ name: "DAS test party", type: "group", img: "icons/svg/mystery-man.svg", flags: TEST,
        system: { members: [{ actor: actor.id }, { actor: companion.id }] } });
      await game.settings.set("dnd5e", "primaryParty", { actor: group.id });
      const at = (a, x, y, extra={}) => ({ name: a.name, actorId: a.id, x, y, elevation: 0, level: ground.id, ...extra });
      const tokens = await scene.createEmbeddedDocuments("Token", [
        at(actor, 300, 300, { actorLink: true }), at(companion, 300, 200, { actorLink: true }), at(near, 400, 300), at(far, 1500, 300),
        at(above, 200, 300, { level: upper.id, elevation: 20 }), at(menu, 300, 400), at(alive, 200, 400)]);
      for ( const t of [tokens[2], tokens[3], tokens[4], tokens[5]] ) await t.actor.toggleStatusEffect("dead", { active: true, overlay: true });
      await actor.update({ "system.currency": { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 } });
      await S("whoLoots", "all"); await S("reach", 5); await S("shareWith", "party"); await S("shareRemainder", "source");
      await scene.view();
      for ( let i = 0; i < 40 && ((canvas.scene?.id !== scene.id) || !canvas.ready); i++ ) await new Promise(r => setTimeout(r, 250));
      await new Promise(r => setTimeout(r, 1000));
      return { previous, scene: scene.id, viewed: canvas.scene?.id === scene.id, actor: actor.id, actorName: actor.name, companion: companion.id, player: player.id,
        looter: tokens[0].uuid, companionToken: tokens[1].uuid, near: tokens[2].uuid, far: tokens[3].uuid, above: tokens[4].uuid,
        menu: tokens[5].uuid, alive: tokens[6].uuid, party: game.actors.party?.id === group.id };`);
    if ( setup?.missing ) { ctx.log("no character owned by « claude player »: not applicable"); return; }
    if ( !ctx.expect(setup?.viewed && setup.party, `scene, corpses and test primary party ready, viewed by the GM (${JSON.stringify({ viewed: setup?.viewed, party: setup?.party })})`) ) return;
    ctx.restore(() => gm(`
      const actor = game.actors.get(args.actor);
      const p = args.previous;
      if ( p.scene ) await game.scenes.get(p.scene)?.view(p.level ? { level: p.level } : {});
      await game.settings.set("dnd5e", "primaryParty", { actor: p.party });
      await game.scenes.get(args.scene)?.delete();
      await actor?.update({ "system.currency": p.purse });
      const left = game.actors.filter(a => a.getFlag("darsh-loot", "test"));
      if ( left.length ) await Actor.implementation.deleteDocuments(left.map(a => a.id));
      for ( const k of ["whoLoots", "reach", "shareWith", "shareRemainder"] ) await game.settings.set("darsh-loot", k, p[k]);
      for ( const app of foundry.applications.instances.values() ) if ( app.id?.startsWith("darsh-loot-") ) await app.close().catch(() => {});
      return true;`, setup).catch(err => ctx.log(`cleanup: ${err.message}`)));

    const who = await ctx.asPlayer(`return { user: game.user.name, gm: game.user.isGM, activeGM: game.users.activeGM?.name ?? null,
      share: typeof CONFIG.queries["darsh-loot.shareCoins"], party: game.actors.party?.name ?? null };`);
    ctx.log(`player client: ${JSON.stringify(who)}`);
    if ( !ctx.expect(who && !who.gm && who.activeGM && (who.share === "function"), `a player client (${who?.user}) with an active GM and the share request`) ) return;

    const gold = () => gm(`
      const gp = uuid => { const d = fromUuidSync(uuid, { strict: false }); return (d?.actor ?? d)?.system.currency.gp ?? null; };
      return { me: game.actors.get(args.actor).system.currency.gp, companion: game.actors.get(args.companion).system.currency.gp,
        near: gp(args.near), far: gp(args.far), above: gp(args.above), alive: gp(args.alive) };`, setup);
    const send = data => ctx.asPlayer(`
      try { return { answer: await game.users.activeGM.query("darsh-loot.shareCoins", args, { timeout: 30000 }) ?? null }; }
      catch(err) { return { error: String(err?.message ?? err) }; }`, data);

    // 1. The window: the button, then the share.
    const seen = await ctx.asPlayer(`
      const api = game.modules.get("darsh-loot").api;
      await api.open(fromUuidSync(args.near), fromUuidSync(args.looter));
      for ( let i = 0; i < 40 && !document.querySelector(".dlo-loot .dlo-share"); i++ ) await new Promise(r => setTimeout(r, 250));
      const button = document.querySelector(".dlo-loot .dlo-share");
      if ( !button ) return { button: false, html: document.querySelector(".dlo-loot")?.innerText ?? null };
      const tooltip = button.dataset.tooltip;
      const since = Date.now() - 1;
      button.click();
      for ( let i = 0; i < 40 && !game.messages.contents.some(m => (m.timestamp >= since) && m.getFlag("darsh-loot", "share")); i++ ) await new Promise(r => setTimeout(r, 250));
      const card = game.messages.contents.find(m => (m.timestamp >= since) && m.getFlag("darsh-loot", "share"));
      await new Promise(r => setTimeout(r, 800));
      return { button: true, disabled: button.disabled, tooltip, card: card ? { whisper: card.whisper.length, fx: card.getFlag("darsh-loot", "flyFx")?.to?.length ?? 0,
        float: !!card.getFlag("darsh-loot", "feedback") } : null, coinsLeft: document.querySelector(".dlo-loot .dlo-coins")?.innerText ?? null };`, setup);
    ctx.expect(seen?.button && seen.tooltip?.includes(setup.actorName) && seen.tooltip.includes("DAS test companion"),
      `the search window shows « Share », naming the two members (${JSON.stringify(seen?.tooltip ?? seen)})`);
    let now = await gold();
    ctx.expect(now.me === 4 && now.companion === 4 && now.near === 1, `clicked: 9 gp split 4 / 4, 1 gp stays on the corpse (${JSON.stringify(now)})`);
    ctx.expect(seen?.card && seen.card.whisper === 0 && seen.card.float && seen.card.fx === 2,
      `the player's client received the public card, with floating texts and the coins flying to both members (${JSON.stringify(seen?.card)})`);
    ctx.expect(/1/.test(seen?.coinsLeft ?? ""), `the player's window now shows what is left (« ${seen?.coinsLeft} »)`);
    await ctx.asPlayer(`for ( const app of foundry.applications.instances.values() ) if ( app.id?.startsWith("darsh-loot-") ) await app.close().catch(() => {}); return true;`);

    // 2. The Core's right-click menu, as the player gets it.
    const menu = await ctx.asPlayer(`
      const engine = game.modules.get("dnd5e-combat")?.api;
      const mine = fromUuidSync(args.looter);
      if ( !engine?.ui?.tokenMenu || (canvas.scene?.id !== mine.parent.id) ) return { skipped: canvas.scene?.name ?? null };
      mine.object?.control({ releaseOthers: true });
      await new Promise(r => setTimeout(r, 300));
      const entries = await engine.ui.tokenMenu(fromUuidSync(args.menu).object);
      return { labels: (entries ?? []).map(e => e.label), wanted: game.i18n.localize("DLO.Share.MenuCoins") };`, setup);
    if ( menu?.skipped !== undefined ) ctx.log(`the player's client does not view the test scene (${menu.skipped}): the menu is read GM-side by the selftest part`);
    else ctx.expect((menu?.labels ?? []).includes(menu?.wanted), `the player's right-click menu on a corpse offers « ${menu?.wanted} » (${(menu?.labels ?? []).join(" | ")})`);

    // 3. Too far: the « do it anyway » window, then the forced share and the note to the GM.
    const before = Date.now() - 1;
    const forced = await ctx.asPlayer(`
      const api = game.modules.get("darsh-loot").api;
      const pending = api.shareCoins(fromUuidSync(args.far), fromUuidSync(args.looter));
      for ( let i = 0; i < 40 && !document.querySelector(".dlo-force-reason"); i++ ) await new Promise(r => setTimeout(r, 250));
      const reason = document.querySelector(".dlo-force-reason");
      if ( !reason ) return { dialog: false, answer: await Promise.race([pending, new Promise(r => setTimeout(() => r("pending"), 500))]) };
      const text = reason.innerText;
      const dialog = reason.closest(".application, dialog");
      const yes = dialog.querySelector('button[data-action="yes"]');
      const label = yes?.innerText ?? null;
      yes?.click();
      const answer = await pending;
      return { dialog: true, text, label, answer };`, setup);
    await pause(600);
    now = await gold();
    ctx.expect(forced?.dialog && forced.text && forced.label, `too far: the player reads the reason and « do it anyway » (« ${forced?.text} » / « ${forced?.label} »)`);
    ctx.expect(!!forced?.answer?.each && now.far === 0 && now.me === 7 && now.companion === 7, `confirmed: the share is done, 6 gp split 3 / 3 (${JSON.stringify(now)})`);
    const told = await gm(`
      const m = game.messages.contents.filter(m => (m.timestamp >= args.before) && m.getFlag("darsh-loot", "forced"));
      return m.map(x => ({ whisper: x.whisper.map(id => game.users.get(id)?.isGM), text: x.content.replace(/<[^>]+>/g, "").trim() }));`, { before });
    ctx.expect(told?.length === 1 && told[0].whisper.length && told[0].whisper.every(Boolean), `the GM is told in a whisper (${JSON.stringify(told)})`);

    // 4. The other V14 level.
    const above = await send({ source: { kind: "corpse", uuid: setup.above }, looter: setup.looter });
    now = await gold();
    ctx.expect(!!above.error && above.error.includes(MARK) && now.above === 4, `a corpse on the other V14 level: out of reach, a refusal that can be forced (${JSON.stringify(above).replaceAll(MARK, "‹mark›")})`);

    // 5. Crafted requests.
    const notMine = await send({ source: { kind: "corpse", uuid: setup.near }, looter: setup.companionToken, force: true });
    ctx.expect(!!notMine.error && !notMine.error.includes(MARK), `sharing for a character the player does not own: refused, even « forced » (${JSON.stringify(notMine)})`);
    const pockets = await send({ source: { kind: "pocket", uuid: setup.alive }, looter: setup.looter, force: true });
    now = await gold();
    ctx.expect(!!pockets.error && now.alive === 8, `the pockets of a living NPC are not shared (${JSON.stringify(pockets)})`);
    ctx.expect(now.near === 1 && now.me === 7, `nothing else moved (${JSON.stringify(now)})`);
  }
};
