/**
 * The GM macro « List merchants' items that cannot be sold » (tools/macros/marchands-objets-invendables.js), played as a GM would
 * run it, on three test merchants: a Loot & Trade merchant holding gear and non-gear items (one hidden, one without a price, one
 * natural weapon), an Item Piles merchant not imported yet, and a merchant whose items are all gear. Checked: the macro writes
 * nothing (items and flags unchanged), whispers one message to the GM only, names the two merchants with unsellable items and
 * their items, puts in bold only what a player would see vanish, and leaves the clean merchant out.
 * Restored: the test actors and the message.
 *
 * Run with the Core's runner: `node tools/scenario.mjs "../Foundry dnd5e butin et commerce/tools/scenarios/macro-marchands.mjs"`
 * (on the bench: `npm run banc:passe -- "<that path>"`).
 */
import fs from "node:fs";
import path from "node:path";

const MACRO = path.resolve(import.meta.dirname, "..", "macros", "marchands-objets-invendables.js");

export default {
  name: "loot — GM macro: merchants' items that cannot be sold (read-only report)",

  async run(ctx) {
    const gm = async (code, args) => (await ctx.call("run-script", { code, ...(args ? { args } : {}), waitMs: 20000 }))?.result;
    const setup = await gm(`
      const TEST = { test: true };
      const item = (name, extra={}, flags={}) => ({ name, type: "loot", system: { quantity: 1, price: { value: 5, denomination: "gp" }, ...extra }, flags });
      const ours = await Actor.implementation.create({ name: "DAS macro merchant A", type: "npc",
        flags: { "darsh-loot": { ...TEST, merchant: { enabled: true } } },
        items: [
          item("DAS gear rope", { properties: ["gear"] }),
          item("DAS plain lamp"),
          item("DAS hidden ring", {}, { "darsh-loot": { shop: { hidden: true } } }),
          item("DAS free pebble", { price: { value: 0, denomination: "gp" } }),
          { name: "DAS bite", type: "weapon", system: { quantity: 1, type: { value: "natural" }, price: { value: 1, denomination: "gp" } } },
          { name: "DAS spell", type: "spell", system: { level: 1 } }
        ] });
      const piles = await Actor.implementation.create({ name: "DAS macro merchant B", type: "npc",
        flags: { "darsh-loot": TEST, "item-piles": { data: { enabled: true, type: "merchant" } } },
        items: [item("DAS old sword", { quantity: 3 })] });
      const clean = await Actor.implementation.create({ name: "DAS macro merchant C", type: "npc",
        flags: { "darsh-loot": { ...TEST, merchant: { enabled: true } } },
        items: [item("DAS gear torch", { properties: ["gear"] })] });
      const snapshot = a => JSON.stringify(a.toObject());
      return { ids: [ours.id, piles.id, clean.id], before: [ours, piles, clean].map(snapshot), messages: game.messages.size,
        gear: [...(ours.items.getName("DAS plain lamp").system.properties ?? [])] };`);
    if ( !ctx.expect(setup?.ids?.length === 3, `three test merchants created (${JSON.stringify(setup?.gear)})`) ) return;
    ctx.restore(() => gm(`
      const left = args.ids.filter(id => game.actors.has(id));
      if ( left.length ) await Actor.implementation.deleteDocuments(left);
      for ( const m of game.messages.filter(m => m.content.includes("DAS macro merchant")) ) await m.delete();
      return true;`, setup).catch(err => ctx.log(`cleanup: ${err.message}`)));
    if ( setup.gear.includes("gear") ) { ctx.log("dnd5e marks every NPC item as gear at creation in this version: not applicable"); return; }

    // The macro, exactly as shipped: the body of a script macro.
    const command = fs.readFileSync(MACRO, "utf8");
    await ctx.call("run-script", { code: command, waitMs: 20000 });
    const after = await gm(`
      const actors = args.ids.map(id => game.actors.get(id));
      const messages = game.messages.contents.slice(args.messages).filter(m => m.content.includes("DAS macro merchant"));
      const m = messages.at(-1);
      const bold = [...(m?.content ?? "").matchAll(/<strong>(.*?)<\\/strong>/g)].map(x => x[1]);
      return { same: actors.map((a, i) => JSON.stringify(a.toObject()) === args.before[i]), count: messages.length,
        whisper: (m?.whisper ?? []).map(id => game.users.get(id)?.isGM), content: m?.content ?? "", bold };`, setup);
    ctx.expect(after?.same?.every(Boolean), `the macro changed nothing on the three merchants (${JSON.stringify(after?.same)})`);
    ctx.expect(after?.count === 1 && after.whisper.length === 1 && after.whisper[0] === true, `one message, whispered to the GM only (${after?.count}, ${JSON.stringify(after?.whisper)})`);
    const text = after?.content ?? "";
    ctx.expect(text.includes("DAS macro merchant A") && text.includes("DAS macro merchant B"), "both merchants with unsellable items are named");
    ctx.expect(!text.includes("DAS macro merchant C") && !text.includes("DAS gear rope") && !text.includes("DAS spell"),
      "the clean merchant, the gear item and the spell are left out");
    for ( const name of ["DAS plain lamp", "DAS hidden ring", "DAS free pebble", "DAS bite", "DAS old sword"] ) ctx.expect(text.includes(name), `listed: ${name}`);
    const bold = (after?.bold ?? []).join(" | ");
    ctx.expect(bold.includes("DAS plain lamp") && bold.includes("DAS old sword") && !bold.includes("DAS hidden ring") && !bold.includes("DAS free pebble") && !bold.includes("DAS bite"),
      `in bold: only what a player would see vanish from the stall (${bold})`);
    ctx.expect(text.includes("×3"), "a stack shows its quantity");
    ctx.log(`report: ${text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 600)}`);
  }
};
