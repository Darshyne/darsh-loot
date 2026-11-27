/**
 * The merchant revision of 2026-11-27 (user's list): ways into a shop and the GM's shop window. On a temporary scene with a merchant
 * NPC and « claude player »'s character:
 *  1. ways in — the sidebar menu (« Open the shop », « Make it a merchant », routed at init), the Core's token menu on the merchant's
 *     own token (GM), the shop button in the merchant's sheet header, a `@Shop[…]` journal link, a double click on the token (the shop
 *     opens, not the sheet);
 *  2. the GM window — tabs, open / closed in the header, an item dropped on the window joins the stall, price and quantity typed in
 *     the list, lock, search, the right-click menu, the settings tab renames the merchant;
 *  3. restocks — « full » removes what was drawn but leaves a locked item, « add » removes nothing;
 *  4. a real player buys: the deal goes through, the sales log keeps it; a closed shop refuses the purchase;
 *  5. « Cancel the shop », confirmed: back to a plain NPC.
 * Without the bench's player client, part 4 is skipped. Restored: scene, actors, items, settings, windows.
 *
 * Run with the Core's runner: `node tools/scenario.mjs "../Foundry dnd5e butin et commerce/tools/scenarios/boutique-marchand.mjs"`
 * (on the bench: `npm run banc:passe -- "<that path>"`).
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "loot — merchant revision: ways in, GM shop window, stall editing, restocks, sales log",
  players: true,

  async run(ctx) {
    const gm = async (code, args) => (await ctx.call("run-script", { code, ...(args ? { args } : {}), waitMs: 30000 }))?.result;

    const setup = await gm(`
      const player = game.users.find(u => u.name === "claude player");
      const actor = game.actors.find(a => (a.type === "character") && player && a.testUserPermission(player, "OWNER"));
      if ( !player || !actor ) return { missing: true };
      const previous = { scene: canvas.scene?.id ?? null, purse: { ...actor.system.currency }, view: game.settings.get("darsh-loot", "shopView"),
        reach: game.settings.get("darsh-loot", "reach") };
      const TEST = { "darsh-loot": { test: true } };
      const scene = await Scene.create({ name: "DAS Loot — merchant (test)", width: 1500, height: 1000, padding: 0,
        grid: { size: 100, distance: 5 }, tokenVision: false, environment: { darknessLevel: 0, globalLight: { enabled: true } },
        ownership: { default: 2 }, flags: TEST });
      const merchant = await Actor.implementation.create({ name: "DAS test merchant", type: "npc", img: "icons/svg/coins.svg",
        system: { attributes: { hp: { value: 10, max: 10 } }, currency: { gp: 0 } },
        flags: { "darsh-loot": { test: true, merchant: { enabled: true, infiniteCoins: true } } },
        items: [
          { name: "DAS test rope", type: "loot", system: { quantity: 3, price: { value: 1, denomination: "gp" } }, flags: { "darsh-loot": { shop: { base: 3 } } } },
          { name: "DAS test drawn", type: "loot", system: { quantity: 1, price: { value: 2, denomination: "gp" } }, flags: { "darsh-loot": { shop: { rolled: true } } } },
          { name: "DAS test drawn kept", type: "loot", system: { quantity: 1, price: { value: 2, denomination: "gp" } }, flags: { "darsh-loot": { shop: { rolled: true, locked: true } } } }] });
      const npc = await Actor.implementation.create({ name: "DAS test villager", type: "npc", img: "icons/svg/mystery-man.svg", flags: TEST });
      const [ware] = await Item.implementation.create([{ name: "DAS test lantern", type: "equipment", system: { quantity: 2, price: { value: 5, denomination: "gp" } }, flags: TEST }]);
      const tokens = await scene.createEmbeddedDocuments("Token", [
        { name: actor.name, actorId: actor.id, actorLink: true, x: 300, y: 300 },
        { name: merchant.name, actorId: merchant.id, actorLink: true, x: 400, y: 300 }]);
      if ( (actor.system.currency.gp ?? 0) < 10 ) await actor.update({ "system.currency.gp": 10 });
      await game.settings.set("darsh-loot", "reach", 5);
      await game.settings.set("darsh-loot", "shopView", "list");
      await scene.view();
      for ( let i = 0; i < 40 && ((canvas.scene?.id !== scene.id) || !canvas.ready); i++ ) await new Promise(r => setTimeout(r, 250));
      await new Promise(r => setTimeout(r, 800));
      return { previous, scene: scene.id, viewed: canvas.scene?.id === scene.id, actor: actor.id, actorUuid: actor.uuid, player: player.id,
        merchant: merchant.id, merchantUuid: merchant.uuid, npc: npc.id, ware: ware.id, wareUuid: ware.uuid,
        looter: tokens[0].uuid, token: tokens[1].uuid, tokenId: tokens[1].id, gp: actor.system.currency.gp ?? 0 };`);
    if ( setup?.missing ) { ctx.log("no character owned by « claude player »: not applicable"); return; }
    if ( !ctx.expect(setup?.viewed, "scene, merchant and character ready, viewed by the GM") ) return;
    ctx.restore(() => gm(`
      for ( const app of [...foundry.applications.instances.values()] ) if ( app.id?.startsWith("darsh-loot-") || (app.document?.getFlag?.("darsh-loot", "test")) ) await app.close().catch(() => {});
      for ( const app of [...foundry.applications.instances.values()] ) if ( app.document?.id === args.merchant ) await app.close().catch(() => {});
      if ( args.previous.scene ) await game.scenes.get(args.previous.scene)?.view();
      await game.scenes.get(args.scene)?.delete();
      const actor = game.actors.get(args.actor);
      const mine = (actor?.items ?? []).filter(i => i.name.startsWith("DAS test ")).map(i => i.id);
      if ( mine.length ) await actor.deleteEmbeddedDocuments("Item", mine);
      await actor?.update({ "system.currency": args.previous.purse });
      const left = game.actors.filter(a => a.getFlag("darsh-loot", "test"));
      if ( left.length ) await Actor.implementation.deleteDocuments(left.map(a => a.id));
      await game.items.get(args.ware)?.delete();
      await game.settings.set("darsh-loot", "shopView", args.previous.view);
      await game.settings.set("darsh-loot", "reach", args.previous.reach);
      return true;`, setup).catch(err => ctx.log(`cleanup: ${err.message}`)));

    // The GM's shop window for this merchant (by its token), and a helper to read it.
    const shopWindow = `const win = () => [...foundry.applications.instances.values()].find(a => (a.id === "darsh-loot-merchant-" + args.tokenId) && a.rendered);`;
    const closeAll = () => gm(`for ( const app of [...foundry.applications.instances.values()] ) if ( app.id?.startsWith("darsh-loot-merchant") ) await app.close(); return true;`);

    // 1. Ways in.
    const sidebar = await gm(`
      const options = [];
      Hooks.callAll("getActorContextOptions", ui.actors, options);
      const li = document.createElement("li");
      li.dataset.entryId = args.merchant;
      const merchantEntries = options.filter(o => o.label?.startsWith("DLO.") && (typeof o.visible !== "function" || o.visible(li))).map(o => o.label);
      li.dataset.entryId = args.npc;
      const npcEntries = options.filter(o => o.label?.startsWith("DLO.") && (typeof o.visible !== "function" || o.visible(li))).map(o => o.label);
      return { merchantEntries, npcEntries };`, setup);
    ctx.expect(sidebar?.merchantEntries?.includes("DLO.Shop.HudOpen") && sidebar.merchantEntries.includes("DLO.Shop.CloseShop")
      && !sidebar.merchantEntries.includes("DLO.Shop.OpenShop") && sidebar.merchantEntries.includes("DLO.Shop.Unmake")
      && sidebar.npcEntries?.includes("DLO.Shop.HudMake") && !sidebar.npcEntries.includes("DLO.Shop.HudOpen"),
      `actors sidebar: « View the shop », « Close the shop » (open shop) and « Cancel the shop » on a merchant, « Make it a merchant » on another NPC (${JSON.stringify(sidebar)})`);

    const menu = await gm(`
      const token = fromUuidSync(args.token);
      canvas.tokens.releaseAll();
      token.object.control({ releaseOthers: true });
      const entries = game.modules.get("dnd5e-combat").api.ui.tokenMenu(token) ?? [];
      const labels = entries.map(e => e.label);
      const open = entries.find(e => e.label === game.i18n.localize("DLO.Shop.HudOpen"));
      await open?.run?.();
      await new Promise(r => setTimeout(r, 800));
      ${shopWindow}
      const w = win();
      canvas.tokens.releaseAll();
      const actor = fromUuidSync(args.token).actor;
      w?.element.querySelector(".window-header .dlo-shop-sheet")?.click();
      await new Promise(r => setTimeout(r, 1200));
      const titleSheet = !!actor.sheet.rendered;
      await actor.sheet.close();
      return { titleSheet, labels, opened: !!w, tab: w?.tab ?? null, tabs: [...(w?.element.querySelectorAll(".dlo-shop-tabs button") ?? [])].length,
        status: !!w?.element.querySelector(".dlo-shop-status") };`, setup);
    ctx.expect(menu?.titleSheet, `the shop window's title bar has a button that opens the merchant's sheet (${JSON.stringify(menu)})`);
    ctx.expect(menu?.opened && (menu.tab === "stall") && (menu.tabs >= 3) && menu.status,
      `the Core's menu on the merchant's own token (GM): « Open the shop » opens the stall tab, with tabs and the open / closed button (${JSON.stringify(menu)})`);
    await closeAll();

    const sheet = await gm(`
      const actor = game.actors.get(args.merchant);
      await actor.sheet.render({ force: true });
      await new Promise(r => setTimeout(r, 1500));
      const button = actor.sheet.element?.querySelector(".window-header .dlo-sheet-shop");
      button?.click();
      await new Promise(r => setTimeout(r, 800));
      const opened = [...foundry.applications.instances.values()].some(a => a.id?.startsWith("darsh-loot-merchant") && a.rendered);
      // Closing then reopening the shop, sheet open: the button stays (user report, 2026-11-27).
      const api = game.modules.get("darsh-loot").api;
      const has = () => !!actor.sheet.element?.querySelector(".window-header .dlo-sheet-shop");
      await api.toggleShop(actor);
      await new Promise(r => setTimeout(r, 1200));
      const afterClose = has();
      await api.toggleShop(actor);
      await new Promise(r => setTimeout(r, 1200));
      const afterOpen = has();
      await actor.sheet.close();
      return { button: !!button, opened, afterClose, afterOpen, closedNow: actor.getFlag("darsh-loot", "merchant")?.closed };`, setup);
    ctx.expect(sheet?.button && sheet.opened, `a shop button in the merchant's sheet header opens the shop (${JSON.stringify(sheet)})`);
    ctx.expect(sheet?.afterClose && sheet.afterOpen && (sheet.closedNow === false),
      `the sheet header keeps its shop button when the shop is closed then reopened (${JSON.stringify(sheet)})`);

    // The same through the real actors sidebar: a right click on the merchant's entry, then « Close » / « Open » (user report, 2026-11-27).
    const viaSidebar = await gm(`
      const actor = game.actors.get(args.merchant);
      await ui.sidebar.changeTab?.("actors", "primary");
      await ui.actors.render({ force: true });
      await actor.sheet.render({ force: true });
      await new Promise(r => setTimeout(r, 1500));
      const has = () => !!actor.sheet.element?.querySelector(".window-header .dlo-sheet-shop");
      const pick = async label => {
        const entry = ui.actors.element.querySelector('[data-entry-id="' + args.merchant + '"]');
        if ( !entry ) return false;
        const r = entry.getBoundingClientRect();
        entry.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.x + 10, clientY: r.y + 5, button: 2 }));
        await new Promise(r => setTimeout(r, 500));
        const item = [...document.querySelectorAll("#context-menu li, .context-menu li")].find(li => li.textContent.trim() === game.i18n.localize(label));
        item?.click();
        await new Promise(r => setTimeout(r, 1800));
        return !!item;
      };
      const closedPicked = await pick("DLO.Shop.CloseShop");
      const afterClose = has(), closed = actor.getFlag("darsh-loot", "merchant")?.closed === true;
      const openedPicked = await pick("DLO.Shop.OpenShop");
      const afterOpen = has(), open = actor.getFlag("darsh-loot", "merchant")?.closed === false;
      await actor.sheet.close();
      return { closedPicked, afterClose, closed, openedPicked, afterOpen, open };`, setup);
    ctx.expect(viaSidebar?.closedPicked && viaSidebar.closed && viaSidebar.afterClose && viaSidebar.openedPicked && viaSidebar.open && viaSidebar.afterOpen,
      `closing then opening from the actors sidebar's right-click menu keeps the sheet's shop button (${JSON.stringify(viaSidebar)})`);
    await closeAll();

    const link = await gm(`
      const html = await foundry.applications.ux.TextEditor.implementation.enrichHTML("@Shop[" + args.merchantUuid + "]{The shop}");
      const div = document.createElement("div");
      div.innerHTML = html;
      document.body.append(div);
      const a = div.querySelector("a.dlo-shop-link");
      a?.click();
      await new Promise(r => setTimeout(r, 800));
      div.remove();
      const opened = [...foundry.applications.instances.values()].some(a => a.id?.startsWith("darsh-loot-merchant") && a.rendered);
      return { link: !!a, text: a?.textContent.trim() ?? null, opened };`, setup);
    ctx.expect(link?.link && link.opened, `a @Shop[…] journal link is drawn and opens the shop (${JSON.stringify(link)})`);
    await closeAll();

    const double = await gm(`
      const token = fromUuidSync(args.token);
      canvas.tokens.releaseAll();
      const c = canvas.clientCoordinatesFromCanvas(token.object.center);
      const view = canvas.app.view;
      const fire = type => view.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0, buttons: type === "pointerdown" ? 1 : 0,
        clientX: c.x, clientY: c.y, pointerId: 1, pointerType: "mouse", isPrimary: true }));
      fire("pointerdown"); fire("pointerup");
      await new Promise(r => setTimeout(r, 60));
      fire("pointerdown"); fire("pointerup");
      await new Promise(r => setTimeout(r, 1500));
      ${shopWindow}
      const sheetOpen = !!token.actor.sheet.rendered;
      if ( sheetOpen ) await token.actor.sheet.close();
      canvas.tokens.releaseAll();
      return { shop: !!win(), sheet: sheetOpen };`, setup);
    ctx.expect(double?.shop && !double.sheet, `a double click on the merchant's token opens the shop, not the sheet (${JSON.stringify(double)})`);
    await closeAll();

    // 2. The GM window: drop, price, quantity, lock, search, menu, open / closed, settings.
    const edit = await gm(`
      const api = game.modules.get("darsh-loot").api;
      const token = fromUuidSync(args.token);
      await api.shop(token);
      await new Promise(r => setTimeout(r, 800));
      ${shopWindow}
      const out = {};
      // An item dropped on the window.
      const transfer = new DataTransfer();
      transfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: args.wareUuid }));
      win().element.querySelector(".dlo-shop-dropzone").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      await new Promise(r => setTimeout(r, 1200));
      const lantern = () => token.actor.items.find(i => i.name === "DAS test lantern");
      out.dropped = lantern()?.system.quantity ?? 0;
      out.droppedBase = lantern()?.getFlag("darsh-loot", "shop")?.base ?? null;
      // Price and quantity typed in the list.
      const row = name => [...win().element.querySelectorAll(".dlo-shop-manage")].find(li => li.dataset.name === name);
      const type = async (input, value) => { input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(r => setTimeout(r, 700)); };
      await type(row("DAS test rope").querySelector(".dlo-row-price-input"), "7,5");
      const rope = () => token.actor.items.find(i => i.name === "DAS test rope");
      out.price = rope().getFlag("darsh-loot", "shop")?.price ?? null;
      out.unit = api.stock(token).find(e => e.name === "DAS test rope")?.unit ?? null;
      await type(row("DAS test rope").querySelector(".dlo-row-qty-input"), "8");
      out.quantity = rope().system.quantity;
      out.base = rope().getFlag("darsh-loot", "shop")?.base ?? null;
      row("DAS test rope").querySelector("[data-action=lock]").click();
      await new Promise(r => setTimeout(r, 700));
      out.locked = rope().getFlag("darsh-loot", "shop")?.locked === true;
      // Search.
      const search = win().element.querySelector(".dlo-shop-search input");
      search.value = "lantern";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      out.visible = [...win().element.querySelectorAll(".dlo-shop-scroll .dlo-shop-item")].filter(li => !li.hidden).map(li => li.dataset.name);
      search.value = "";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      // The right-click menu.
      row("DAS test rope").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
      await new Promise(r => setTimeout(r, 500));
      out.menu = [...document.querySelectorAll("#context-menu li")].map(li => li.textContent.trim());
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      // Open / closed.
      win().element.querySelector(".dlo-shop-status").click();
      await new Promise(r => setTimeout(r, 700));
      out.closed = token.actor.getFlag("darsh-loot", "merchant")?.closed === true;
      win().element.querySelector(".dlo-shop-status").click();
      await new Promise(r => setTimeout(r, 700));
      out.reopened = token.actor.getFlag("darsh-loot", "merchant")?.closed === false;
      // Items created with the actor are not gear: the banner makes them all sellable.
      out.stuckBefore = api.stock(token).filter(e => e.stuck).length;
      win().element.querySelector("[data-action=sellableAll]")?.click();
      await new Promise(r => setTimeout(r, 1500));
      out.stuckAfter = api.stock(token).filter(e => e.stuck).length;
      // The settings tab renames the merchant.
      win().element.querySelector("[data-action=shopTab][data-tab=settings]").click();
      await new Promise(r => setTimeout(r, 800));
      const form = win().element.querySelector("form.dlo-shop-settings");
      form.elements.name.value = "DAS test merchant renamed";
      form.requestSubmit();
      await new Promise(r => setTimeout(r, 1200));
      out.renamed = [token.actor.name, token.name];
      out.stillMerchant = api.isMerchant(token);
      return out;`, setup);
    ctx.expect(edit?.dropped === 2 && edit.droppedBase === 2, `an item dropped on the window joins the stall as fixed stock (${JSON.stringify({ dropped: edit?.dropped, base: edit?.droppedBase })})`);
    ctx.expect(edit?.price === 750 && edit.unit === 750, `a price typed in gold (« 7,5 ») becomes the asking price, 750 cp (${JSON.stringify({ price: edit?.price, unit: edit?.unit })})`);
    ctx.expect(edit?.quantity === 8 && edit.base === 8, `a quantity typed in the list, also the restock reference (${JSON.stringify({ quantity: edit?.quantity, base: edit?.base })})`);
    ctx.expect(edit?.locked, "the lock button locks the item against restocks");
    ctx.expect(JSON.stringify(edit?.visible) === JSON.stringify(["DAS test lantern"]), `the search keeps what matches (${JSON.stringify(edit?.visible)})`);
    ctx.expect((edit?.menu?.length ?? 0) >= 6, `the right-click menu of a stall item, GM side (${JSON.stringify(edit?.menu)})`);
    ctx.expect(edit?.closed && edit.reopened, "the header button closes then reopens the shop");
    ctx.expect(edit?.stuckBefore > 0 && edit.stuckAfter === 0, `« make all sellable » fixes the items created with the actor (${edit?.stuckBefore} → ${edit?.stuckAfter})`);
    ctx.expect(edit?.renamed?.every(n => n === "DAS test merchant renamed") && edit.stillMerchant, `the settings tab renames actor and token (${JSON.stringify(edit?.renamed)})`);

    // 3. Restocks.
    const restock = await gm(`
      const api = game.modules.get("darsh-loot").api;
      const token = fromUuidSync(args.token);
      const names = () => token.actor.items.map(i => i.name).sort();
      await api.restock(token, "add");
      const afterAdd = names();
      await api.restock(token, "full");
      return { afterAdd, afterFull: names() };`, setup);
    ctx.expect(restock?.afterAdd?.includes("DAS test drawn"), `« add » removes nothing (${JSON.stringify(restock?.afterAdd)})`);
    ctx.expect(!restock?.afterFull?.includes("DAS test drawn") && restock?.afterFull?.includes("DAS test drawn kept") && restock.afterFull.includes("DAS test rope"),
      `« full » removes what was drawn, not a locked item (${JSON.stringify(restock?.afterFull)})`);

    // 4. A real player buys one rope; the GM's log keeps it.
    const who = await ctx.asPlayer(`return { gm: game.user.isGM, activeGM: game.users.activeGM?.name ?? null };`);
    if ( !who || who.gm || !who.activeGM ) { ctx.log("no player client: part 4 not played"); return; }
    const rope = await gm(`return fromUuidSync(args.token).actor.items.find(i => i.name === "DAS test rope")?.id;`, setup);
    // A closed shop sells nothing, even when the request is sent by hand.
    await gm(`await game.modules.get("darsh-loot").api.toggleShop(fromUuidSync(args.token).actor); return true;`, setup);
    const refused = await ctx.asPlayer(`
      const api = game.modules.get("darsh-loot").api;
      const merchant = fromUuidSync(args.token);
      const before = merchant.actor.items.get(args.rope)?.system.quantity;
      await api.shop(merchant, fromUuidSync(args.looter));
      await new Promise(r => setTimeout(r, 800));
      const win = [...foundry.applications.instances.values()].find(a => a.id === "darsh-loot-merchant-" + args.tokenId && a.rendered);
      const screen = { shut: !!win?.element.querySelector(".dlo-shop-shut"), items: win?.element.querySelectorAll(".dlo-shop-item").length ?? -1 };
      await win?.close();
      let result = null, error = null;
      try { result = await api.deal(merchant, fromUuidSync(args.looter), { buy: [{ id: args.rope, quantity: 1 }], sell: [] }); }
      catch(err) { error = err.message; }
      await new Promise(r => setTimeout(r, 500));
      return { screen, bought: result?.bought?.length ?? 0, error, before, after: merchant.actor.items.get(args.rope)?.system.quantity };`, { ...setup, rope });
    await gm(`await game.modules.get("darsh-loot").api.toggleShop(fromUuidSync(args.token).actor); return true;`, setup);
    ctx.expect(refused && !refused.bought && (refused.before === refused.after),
      `a closed shop refuses a player's purchase (${JSON.stringify(refused)})`);
    ctx.expect(refused?.screen?.shut && (refused.screen.items === 0),
      `a closed shop shows the player a « closed, come back later » screen, no stall (${JSON.stringify(refused?.screen)})`);
    const bought = await ctx.asPlayer(`
      const api = game.modules.get("darsh-loot").api;
      const merchant = fromUuidSync(args.token);
      const me = fromUuidSync(args.looter);
      await api.shop(merchant, me);
      await new Promise(r => setTimeout(r, 800));
      const win = [...foundry.applications.instances.values()].find(a => a.id === "darsh-loot-merchant-" + args.tokenId && a.rendered);
      const view = { tabs: !!win?.element.querySelector(".dlo-shop-tabs"), rows: win?.element.querySelectorAll(".dlo-shop-stock .dlo-shop-item").length ?? 0,
        search: !!win?.element.querySelector(".dlo-shop-search input"), imgs: win?.element.querySelectorAll(".dlo-shop-item img").length ?? -1 };
      const result = await api.deal(merchant, me, { buy: [{ id: args.rope, quantity: 1 }], sell: [] });
      await win?.close();
      return { view, result };`, { ...setup, rope });
    ctx.expect(bought?.view?.rows > 0 && !bought.view.tabs && bought.view.search && (bought.view.imgs === 0),
      `the player's window: stall items, search, no GM tabs, no <img> under the pointer (${JSON.stringify(bought?.view)})`);
    ctx.expect(bought?.result?.bought?.length === 1, `the player buys one rope (${JSON.stringify(bought?.result)})`);
    await pause(800);
    const log = await gm(`return game.modules.get("darsh-loot").api.salesLog(fromUuidSync(args.token));`, setup);
    const last = log?.at?.(-1);
    ctx.expect(last?.kind === "deal" && last.bought?.length === 1 && (last.net === 750), `the sales log keeps the deal (${JSON.stringify(last)})`);

    // 4 b. An Item Piles merchant: the notice offers the takeover until it is done, then goes (user report, 2026-11-27).
    const piles = await gm(`
      const actor = await Actor.implementation.create({ name: "DAS test piles merchant", type: "npc",
        flags: { "darsh-loot": { test: true }, "item-piles": { data: { enabled: true, type: "merchant", buyPriceModifier: 1.5, sellPriceModifier: 0.4 } } },
        items: [{ name: "DAS test piles ware", type: "loot", system: { quantity: 2, price: { value: 1, denomination: "gp" } },
          flags: { "item-piles": { item: { hidden: true } } } }] });
      const api = game.modules.get("darsh-loot").api;
      await api.configureMerchant(actor);
      await new Promise(r => setTimeout(r, 1000));
      const config = () => [...foundry.applications.instances.values()].find(a => a.rendered && a.id?.includes(actor.id) && a.element.querySelector(".dlo-merchant-body"));
      const before = !!config()?.element.querySelector(".dlo-merchant-piles [data-action=convert]");
      config()?.element.querySelector(".dlo-merchant-piles [data-action=convert]")?.click();
      await new Promise(r => setTimeout(r, 1500));
      const after = !!config()?.element.querySelector(".dlo-merchant-piles");
      const flag = actor.getFlag("darsh-loot", "merchant") ?? {};
      const ware = actor.items.find(i => i.name === "DAS test piles ware");
      await config()?.close();
      return { before, after, enabled: flag.enabled, buy: flag.buy, sell: flag.sell, hidden: ware?.getFlag("darsh-loot", "shop")?.hidden ?? null,
        done: !!actor.getFlag("darsh-loot", "itemPilesDone") };`);
    ctx.expect(piles?.before && !piles.after && piles.done && piles.enabled && (piles.buy === 1.5) && (piles.sell === 0.4) && piles.hidden,
      `an Item Piles merchant: the notice offers the takeover, which keeps its prices and hidden items, then the notice is gone (${JSON.stringify(piles)})`);

    // 5. « Cancel the shop » from the actors sidebar, confirmed: a plain NPC again, its items kept, its sheet without the button.
    const cancel = await gm(`
      const actor = game.actors.get(args.merchant);
      const items = actor.items.size;
      await actor.sheet.render({ force: true });
      await new Promise(r => setTimeout(r, 1200));
      const options = [];
      Hooks.callAll("getActorContextOptions", ui.actors, options);
      const li = document.createElement("li");
      li.dataset.entryId = args.merchant;
      const entry = options.find(o => o.label === "DLO.Shop.Unmake");
      const running = entry?.onClick(new Event("click"), li);
      await new Promise(r => setTimeout(r, 800));
      const dialog = [...foundry.applications.instances.values()].find(a => (a instanceof foundry.applications.api.DialogV2) && a.rendered);
      dialog?.element.querySelector("[data-action=yes]")?.click();
      await running;
      await new Promise(r => setTimeout(r, 1200));
      const out = { asked: !!dialog, merchant: game.modules.get("darsh-loot").api.isMerchant?.(actor) ?? actor.getFlag("darsh-loot", "merchant")?.enabled === true,
        flag: actor.getFlag("darsh-loot", "merchant") ?? null, log: actor.getFlag("darsh-loot", "log") ?? null,
        marks: actor.items.filter(i => i.getFlag("darsh-loot", "shop")).length, items: actor.items.size, itemsBefore: items,
        button: !!actor.sheet.element?.querySelector(".window-header .dlo-sheet-shop") };
      await actor.sheet.close();
      return out;`, setup);
    ctx.expect(cancel?.asked && !cancel.merchant && !cancel.flag && !cancel.log && (cancel.marks === 0) && (cancel.items === cancel.itemsBefore) && !cancel.button,
      `« Cancel the shop » asks first, then makes a plain NPC: no merchant flag, log or stall marks, items kept, no sheet button (${JSON.stringify(cancel)})`);
  }
};
