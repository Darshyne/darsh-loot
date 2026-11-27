/**
 * The module's windows wear the dnd5e system's look and follow the user's theme (design review of 2026-11-27, option B).
 * On the GM client, with a temporary dead NPC (coins and two items) placed on the viewed scene, for the light then the dark
 * theme of the windows (`core.uiConfig.colorScheme.applications`, the « Appearance » setting):
 *  1. the search window carries `dnd5e2` and keeps its title in the header (`titlebar`);
 *  2. each coin is the system's coin icon (`i.currency.<key>` with its picture), not an abbreviation;
 *  3. the text of the coins and of the buttons stands out from their background (contrast ratio ≥ 4.5);
 *  4. the buttons follow the theme: their background is not the same in light and in dark;
 *  5. the trade window's number fields have a visible border and the window's text colour (they were unreadable in light).
 * Restored: the GM's colour scheme, the windows, the token and the actor.
 *
 * Run with the Core's runner: `node tools/scenario.mjs "../Foundry dnd5e butin et commerce/tools/scenarios/habillage-theme.mjs"`
 * (on the bench: `npm run banc:passe -- "<that path>"`).
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "loot — the windows wear the dnd5e look and follow the light / dark theme",

  async run(ctx) {
    const gm = async (code, args) => (await ctx.call("run-script", { code, ...(args ? { args } : {}), waitMs: 20000 }))?.result;

    const setup = await gm(`
      if ( !canvas.scene ) return { missing: true };
      const scheme = game.settings.get("core", "uiConfig").colorScheme;
      const actor = await Actor.create({ name: "DAS theme corpse (test)", type: "npc", img: "icons/svg/mystery-man.svg",
        flags: { "darsh-loot": { test: true } },
        system: { currency: { pp: 1, gp: 12, sp: 5, cp: 0, ep: 0 }, attributes: { hp: { value: 0, max: 10 } } } });
      await actor.createEmbeddedDocuments("Item", [
        { name: "DAS test dagger", type: "weapon", img: "icons/weapons/daggers/dagger-straight-blue.webp" },
        { name: "DAS test rope", type: "loot", img: "icons/sundries/survival/rope-wrapped-brown.webp", system: { quantity: 3 } }]);
      const d = canvas.dimensions;
      const [token] = await canvas.scene.createEmbeddedDocuments("Token", [{ name: actor.name, actorId: actor.id, actorLink: true,
        x: d.sceneX + (2 * d.size), y: d.sceneY + (2 * d.size) }]);
      await actor.toggleStatusEffect("dead", { active: true, overlay: true }).catch(() => null);
      return { scheme, actor: actor.id, token: token.id, scene: canvas.scene.id };`);
    if ( setup?.missing ) { ctx.log("no viewed scene: not applicable"); return; }
    if ( !ctx.expect(setup?.token, `temporary corpse placed (${JSON.stringify(setup)})`) ) return;
    ctx.restore(() => gm(`
      const { TradeWindow } = await import("/modules/darsh-loot/scripts/apps/trade-window.mjs");
      for ( const a of TradeWindow.open.values() ) a.trade = { ...a.trade, cancelled: true };
      for ( const a of [...foundry.applications.instances.values()] ) if ( a.element?.matches?.(".dlo-loot") ) await a.close({ animate: false });
      const c = game.settings.get("core", "uiConfig");
      await game.settings.set("core", "uiConfig", { ...c, colorScheme: args.scheme });
      await game.scenes.get(args.scene)?.tokens.get(args.token)?.delete();
      await game.actors.get(args.actor)?.delete();
      return true;`, setup).catch(err => ctx.log(`cleanup: ${err.message}`)));
    await pause(1500);

    const look = {};
    for ( const theme of ["light", "dark"] ) {
      look[theme] = await gm(`
        const c = game.settings.get("core", "uiConfig");
        await game.settings.set("core", "uiConfig", { ...c, colorScheme: { ...c.colorScheme, applications: args.theme } });
        await new Promise(r => setTimeout(r, 500));
        const src = await import("/modules/darsh-loot/scripts/adapter/sources.mjs");
        const { openSource } = await import("/modules/darsh-loot/scripts/runtime/open.mjs");
        const { TradeWindow } = await import("/modules/darsh-loot/scripts/apps/trade-window.mjs");
        const token = canvas.scene.tokens.get(args.token);
        const looter = canvas.scene.tokens.find(t => t.actor?.type === "character" && t.actor.hasPlayerOwner) ?? null;
        await openSource(src.corpseSource(token), looter);
        TradeWindow.show({ id: "das-theme-test",
          a: { user: game.user.id, name: "A", actor: token.actor.uuid, items: [], coins: { gp: 15 }, accepted: false },
          b: { user: "x", name: "B", actor: "Actor.x", items: [], coins: { gp: 5 }, accepted: false } },
          { update() {}, accept() {}, unaccept() {}, cancel() {} });
        await new Promise(r => setTimeout(r, 800));
        const rgb = s => { const m = String(s).match(/[\\d.]+/g)?.map(Number) ?? [0, 0, 0, 1]; return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
        const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          return (0.2126 * f(r)) + (0.7152 * f(g)) + (0.0722 * f(b)); };
        const contrast = (fg, bg) => { const [a, b] = [lum(rgb(fg)), lum(rgb(bg))].sort((x, y) => y - x); return Math.round(((a + 0.05) / (b + 0.05)) * 10) / 10; };
        const win = [...document.querySelectorAll(".dlo-loot")].find(e => !e.matches(".dlo-trade, .dlo-shop"));
        const title = win?.querySelector(".window-header .window-title");
        const coins = win?.querySelector(".dlo-coins");
        const icons = [...(win?.querySelectorAll(".dlo-coin i.currency") ?? [])];
        const button = win?.querySelector(".dlo-foot button:not(:disabled)") ?? win?.querySelector(".dlo-foot button");
        const coin = win?.querySelector(".dlo-coin");
        const input = document.querySelector(".dlo-trade input[data-coin]");
        const cs = e => e ? getComputedStyle(e) : null;
        const out = {
          classes: win ? ["dnd5e2", "titlebar"].filter(k => win.classList.contains(k)) : [],
          titleShown: !!title && (cs(title).display !== "none") && (title.getBoundingClientRect().width > 0),
          coinKinds: win?.querySelectorAll(".dlo-coin").length ?? 0,
          icons: icons.length,
          pictures: icons.filter(i => cs(i).backgroundImage.includes("currency")).length,
          abbreviations: win?.querySelectorAll(".dlo-coin-abbr").length ?? 0,
          coinContrast: (coin && coins) ? contrast(cs(coin).color, cs(coins).backgroundColor) : 0,
          buttonContrast: button ? contrast(cs(button).color, cs(button).backgroundColor) : 0,
          buttonBackground: button ? cs(button).backgroundColor : null,
          inputBorder: input ? parseFloat(cs(input).borderTopWidth) : 0,
          inputBorderStyle: input ? cs(input).borderTopStyle : null,
          inputColour: input ? cs(input).color : null,
          textColour: win ? cs(win.querySelector(".window-content")).color : null
        };
        for ( const a of TradeWindow.open.values() ) a.trade = { ...a.trade, cancelled: true };
        for ( const a of [...foundry.applications.instances.values()] ) if ( a.element?.matches?.(".dlo-loot") ) await a.close({ animate: false });
        return out;`, { ...setup, theme });
      const l = look[theme];
      if ( !ctx.expect(l, `${theme}: the windows opened`) ) return;
      ctx.expect(l.classes.length === 2, `${theme}: the search window carries dnd5e2 and titlebar (${l.classes.join(", ")})`);
      ctx.expect(l.titleShown, `${theme}: its title is shown in the header`);
      ctx.expect((l.coinKinds === 3) && (l.icons === 3) && (l.pictures === 3) && !l.abbreviations,
        `${theme}: three coins, each the system's coin icon with its picture (${l.coinKinds} coins, ${l.icons} icons, ${l.pictures} pictures, ${l.abbreviations} abbreviations)`);
      ctx.expect(l.coinContrast >= 4.5, `${theme}: coin amounts readable on their card (contrast ${l.coinContrast})`);
      ctx.expect(l.buttonContrast >= 4.5, `${theme}: button text readable (contrast ${l.buttonContrast})`);
      ctx.expect((l.inputBorder >= 1) && (l.inputBorderStyle !== "none") && (l.inputColour === l.textColour),
        `${theme}: the trade's number fields have a visible border and the text colour (${l.inputBorder}px ${l.inputBorderStyle}, ${l.inputColour} / ${l.textColour})`);
    }
    ctx.expect(look.light.buttonBackground !== look.dark.buttonBackground,
      `the buttons follow the theme (${look.light.buttonBackground} in light, ${look.dark.buttonBackground} in dark)`);
  }
};
