/**
 * Lot 1 (2026-11-27, audit defect 21) — partial quantities, with a REAL player client. On a temporary scene viewed by the GM,
 * with a token of « claude player »'s character next to a dead archer carrying 20 arrows and 3 daggers:
 *  1. the player opens the search window and clicks the arrows: the « how many? » window opens with the whole stack; 6 chosen:
 *     6 arrows arrive, 14 stay on the corpse;
 *  2. Shift+click on the arrows takes the 14 left at once, without a question;
 *  3. crafted quantities (negative, huge) sent to the GM never create or lose a dagger;
 *  4. a crafted partial take from a corpse far away is refused, nothing moves.
 * Without the bench's player client: not applicable. Restored: the viewed scene, the test actors, the character's items.
 *
 * Run with the Core's runner: `node tools/scenario.mjs "../Foundry dnd5e butin et commerce/tools/scenarios/lot1-quantites-joueur.mjs"`
 * (on the bench: `npm run banc:passe -- "<that path>"`).
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "loot — lot 1: a real player takes part of a stack (how many?, Shift+click, crafted quantities)",
  players: true,

  async run(ctx) {
    const gm = async (code, args) => (await ctx.call("run-script", { code, ...(args ? { args } : {}), waitMs: 30000 }))?.result;

    const setup = await gm(`
      const player = game.users.find(u => u.name === "claude player");
      const actor = game.actors.find(a => (a.type === "character") && player && a.testUserPermission(player, "OWNER"));
      if ( !player || !actor ) return { missing: true };
      const previous = { scene: canvas.scene?.id ?? null, level: canvas.level?.id ?? null,
        whoLoots: game.settings.get("darsh-loot", "whoLoots"), reach: game.settings.get("darsh-loot", "reach") };
      const TEST = { "darsh-loot": { test: true } };
      const scene = await Scene.create({ name: "DAS Loot — lot 1 quantities (test)", width: 2500, height: 2500, padding: 0,
        grid: { size: 100, distance: 5 }, tokenVision: false, environment: { darknessLevel: 0, globalLight: { enabled: true } },
        ownership: { default: 2 }, flags: TEST });
      const dead = name => Actor.implementation.create({ name, type: "npc", img: "icons/svg/skull.svg",
        system: { attributes: { hp: { value: 0, max: 10 } }, details: { type: { value: "humanoid" }, cr: 0 } },
        flags: { "darsh-loot": { test: true, rolled: true } },
        items: [{ name: "DAS test arrows", type: "consumable", system: { quantity: 20, properties: ["gear"] } },
          { name: "DAS test daggers", type: "weapon", system: { quantity: 3, properties: ["gear"] } }] });
      const [near, far] = [await dead("DAS archer near"), await dead("DAS archer far")];
      const at = (a, x, y, extra={}) => ({ name: a.name, actorId: a.id, x, y, elevation: 0, ...extra });
      const tokens = await scene.createEmbeddedDocuments("Token", [at(actor, 300, 300, { actorLink: true }), at(near, 400, 300), at(far, 1500, 300)]);
      for ( const t of tokens.slice(1) ) await t.actor.toggleStatusEffect("dead", { active: true, overlay: true });
      await game.settings.set("darsh-loot", "whoLoots", "all");
      await game.settings.set("darsh-loot", "reach", 5);
      await scene.view();
      for ( let i = 0; i < 40 && ((canvas.scene?.id !== scene.id) || !canvas.ready); i++ ) await new Promise(r => setTimeout(r, 250));
      await new Promise(r => setTimeout(r, 1000));
      const id = (t, name) => t.actor.items.find(i => i.name === name)?.id ?? null;
      return { previous, scene: scene.id, viewed: canvas.scene?.id === scene.id, actor: actor.id, actorUuid: actor.uuid,
        looter: tokens[0].uuid, near: tokens[1].uuid, far: tokens[2].uuid,
        arrows: id(tokens[1], "DAS test arrows"), daggers: id(tokens[1], "DAS test daggers"), farArrows: id(tokens[2], "DAS test arrows") };`);
    if ( setup?.missing ) { ctx.log("no character owned by « claude player »: not applicable"); return; }
    if ( !ctx.expect(setup?.viewed && setup.arrows && setup.daggers, `scene and corpses ready, viewed by the GM (${JSON.stringify({ viewed: setup?.viewed })})`) ) return;
    ctx.restore(() => gm(`
      const actor = game.actors.get(args.actor);
      if ( args.previous.scene ) await game.scenes.get(args.previous.scene)?.view(args.previous.level ? { level: args.previous.level } : {});
      await game.scenes.get(args.scene)?.delete();
      const mine = (actor?.items ?? []).filter(i => i.name.startsWith("DAS test ")).map(i => i.id);
      if ( mine.length ) await actor.deleteEmbeddedDocuments("Item", mine);
      const left = game.actors.filter(a => a.getFlag("darsh-loot", "test"));
      if ( left.length ) await Actor.implementation.deleteDocuments(left.map(a => a.id));
      await game.settings.set("darsh-loot", "whoLoots", args.previous.whoLoots);
      await game.settings.set("darsh-loot", "reach", args.previous.reach);
      for ( const app of foundry.applications.instances.values() ) if ( app.id?.startsWith("darsh-loot-") ) await app.close().catch(() => {});
      return true;`, setup).catch(err => ctx.log(`cleanup: ${err.message}`)));

    const who = await ctx.asPlayer(`return { user: game.user.name, gm: game.user.isGM, activeGM: game.users.activeGM?.name ?? null };`);
    if ( !ctx.expect(who && !who.gm && who.activeGM, `a player client (${who?.user}) with an active GM (${who?.activeGM})`) ) return;
    const count = (uuid, itemName) => gm(`
      const doc = fromUuidSync(args.uuid, { strict: false });
      const actor = doc?.actor ?? doc;
      return (actor?.items ?? []).filter(i => i.name === args.itemName).reduce((n, i) => n + (i.system.quantity ?? 1), 0);`, { uuid, itemName });
    const both = async name => [await count(setup.near, name), await count(setup.actorUuid, name)];
    const send = data => ctx.asPlayer(`
      try { return { answer: await game.users.activeGM.query("darsh-loot.take", args, { timeout: 30000 }) ?? null }; }
      catch(err) { return { error: String(err?.message ?? err) }; }`, data);

    // 1. The window asks how many.
    const asked = await ctx.asPlayer(`
      const api = game.modules.get("darsh-loot").api;
      await api.open(fromUuidSync(args.near), fromUuidSync(args.looter));
      const slot = () => document.querySelector('.dlo-loot .dlo-slot[data-item-id="' + args.arrows + '"]');
      for ( let i = 0; i < 40 && !slot(); i++ ) await new Promise(r => setTimeout(r, 250));
      if ( !slot() ) return { slot: false };
      const tooltip = slot().dataset.tooltip;
      slot().click();
      const input = () => document.querySelector("input[name=quantity]");
      for ( let i = 0; i < 40 && !input(); i++ ) await new Promise(r => setTimeout(r, 250));
      if ( !input() ) return { slot: true, tooltip, dialog: false };
      const seen = { max: input().max, value: input().value };
      input().value = "6";
      input().closest("form").querySelector('button[data-action="ok"]').click();
      await new Promise(r => setTimeout(r, 1500));
      return { slot: true, tooltip, dialog: true, seen, badge: slot()?.querySelector(".dlo-qty")?.innerText ?? null };`, setup);
    ctx.expect(asked?.dialog && asked.seen?.max === "20" && asked.seen?.value === "20", `a click on the stack asks how many, 20 by default (${JSON.stringify(asked)})`);
    let now = await both("DAS test arrows");
    ctx.expect(now[0] === 14 && now[1] === 6, `6 chosen: 14 arrows stay on the corpse, 6 with the character (${now.join(" / ")})`);
    ctx.expect(asked?.badge === "14", `the player's window shows the 14 left (« ${asked?.badge} »)`);

    // 2. Shift+click takes the rest.
    await ctx.asPlayer(`
      const slot = document.querySelector('.dlo-loot .dlo-slot[data-item-id="' + args.arrows + '"]');
      slot?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
      await new Promise(r => setTimeout(r, 1500));
      const asked = !!document.querySelector("input[name=quantity]");
      for ( const app of foundry.applications.instances.values() ) if ( app.id?.startsWith("darsh-loot-") ) await app.close().catch(() => {});
      return { asked };`, setup);
    now = await both("DAS test arrows");
    ctx.expect(now[0] === 0 && now[1] === 20, `Shift+click: the 14 left are taken at once (${now.join(" / ")})`);

    // 3. Crafted quantities.
    const negative = await send({ source: { kind: "corpse", uuid: setup.near }, looter: setup.looter, itemIds: [setup.daggers], coins: false, quantities: { [setup.daggers]: -2 } });
    await pause(500);
    now = await both("DAS test daggers");
    ctx.expect(!negative.error && (now[0] + now[1] === 3), `a negative quantity creates nothing: 3 daggers in all (${now.join(" / ")}, ${JSON.stringify(negative)})`);
    const huge = await send({ source: { kind: "corpse", uuid: setup.near }, looter: setup.looter, itemIds: [setup.daggers], coins: false, quantities: { [setup.daggers]: 9999 } });
    await pause(500);
    now = await both("DAS test daggers");
    ctx.expect(now[0] + now[1] === 3, `a huge quantity neither: still 3 daggers (${now.join(" / ")}, ${JSON.stringify(huge)})`);

    // 4. Far away.
    const far = await send({ source: { kind: "corpse", uuid: setup.far }, looter: setup.looter, itemIds: [setup.farArrows], coins: false, quantities: { [setup.farArrows]: 2 } });
    ctx.expect(!!far.error && (await count(setup.far, "DAS test arrows")) === 20, `a partial take from a corpse far away: refused, the 20 arrows stay (${JSON.stringify(far)})`);
  }
};
