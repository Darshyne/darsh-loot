/**
 * GM macro — lists, for every merchant of the world, the items it cannot sell because they are not marked as equipment (the
 * « Gear » property dnd5e puts on what an NPC carries). **It changes nothing**: the result is whispered to the GM.
 *
 * Why: since lot 0 (2026-11-26) a merchant only sells its gear — an item without the property used to be shown, priced and paid
 * for, and never delivered. Merchants imported from Item Piles or made before dnd5e 6.0 may hold such items: run this before
 * updating, then tick « Gear » on the listed items (item sheet, properties).
 *
 * Self-contained on purpose: it reads the sheets directly and carries its own texts (English and French), so it also runs on a
 * world whose DAS · Loot & Trade is older than this macro, or switched off. Merchants looked at: NPCs with a Loot & Trade
 * merchant flag, NPCs still set up as Item Piles merchants, and unlinked merchant tokens whose own inventory differs.
 */
if ( !game.user.isGM ) return ui.notifications.warn("GM only.");
const fr = game.i18n.lang === "fr";
const T = fr ? {
  title: "Marchands — objets invendables",
  none: "Aucun marchand trouvé dans ce monde.",
  clean: "Tous les objets des {n} marchand(s) sont marqués « Équipement » : rien à faire.",
  summary: "{bad} marchand(s) sur {n} ont des objets non marqués « Équipement » ({items} objet(s)). Rien n'a été modifié.",
  how: "Pour qu'un objet se vende : ouvrez sa fiche et cochez la propriété « Équipement ». Les lignes en gras sont celles qu'un joueur verrait disparaître de l'étal (objet visible, avec un prix).",
  merchant: "Marchand", where: "Où", sellable: "Vendables", unsellable: "Non marqués « Équipement »",
  world: "acteur du monde", token: "token sur « {scene} »", itemPiles: "Item Piles, pas encore repris", off: "boutique désactivée",
  natural: "arme naturelle", hidden: "caché", free: "sans prix", notForSale: "pas à vendre"
} : {
  title: "Merchants — items that cannot be sold",
  none: "No merchant found in this world.",
  clean: "Every item of the {n} merchant(s) is marked as « Gear »: nothing to do.",
  summary: "{bad} merchant(s) out of {n} hold items not marked as « Gear » ({items} item(s)). Nothing was changed.",
  how: "For an item to be sold: open its sheet and tick the « Gear » property. Lines in bold are the ones a player would see vanish from the stall (visible item, with a price).",
  merchant: "Merchant", where: "Where", sellable: "Sellable", unsellable: "Not marked as « Gear »",
  world: "world actor", token: "token on « {scene} »", itemPiles: "Item Piles, not imported yet", off: "shop switched off",
  natural: "natural weapon", hidden: "hidden", free: "no price", notForSale: "not for sale"
};
const fill = (text, data={}) => text.replace(/\{(\w+)\}/g, (_, key) => data[key] ?? "");
const escape = s => foundry.utils.escapeHTML(String(s ?? ""));
const PHYSICAL = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);

const ours = actor => actor.flags?.["darsh-loot"]?.merchant;
const theirs = actor => { const d = actor.flags?.["item-piles"]?.data; return !!d && (d.enabled === true) && (d.type === "merchant"); };
const isMerchant = actor => (actor?.type === "npc") && ((ours(actor) !== undefined) || theirs(actor));

/** What this merchant holds: how many items it can sell, and those it cannot. */
function look(actor, where) {
  const physical = actor.items.filter(i => PHYSICAL.has(i.type));
  const stuck = physical.filter(i => !i.system.properties?.has("gear")).map(i => {
    const shop = i.flags?.["darsh-loot"]?.shop ?? {};
    const piles = i.flags?.["item-piles"]?.item ?? {};
    const notes = [];
    const natural = (i.type === "weapon") && (i.system.type?.value === "natural");
    const hidden = (shop.hidden === true) || (piles.hidden === true);
    const priced = (Number(i.system.price?.value) || 0) > 0;
    if ( natural ) notes.push(T.natural);
    if ( hidden ) notes.push(T.hidden);
    if ( !priced ) notes.push(T.free);
    if ( (shop.notForSale === true) || (piles.notForSale === true) ) notes.push(T.notForSale);
    // What a player loses sight of: an item that was on display with a price.
    return { name: i.name, quantity: i.system.quantity ?? 1, notes, shown: !natural && !hidden && priced };
  });
  const state = [];
  if ( (ours(actor) === undefined) && theirs(actor) ) state.push(T.itemPiles);
  else if ( ours(actor)?.enabled !== true ) state.push(T.off);
  return { name: actor.name, where: [where, ...state].join(" — "), sellable: physical.length - stuck.length, stuck };
}

const found = [];
for ( const actor of game.actors ) if ( isMerchant(actor) ) found.push(look(actor, T.world));
// Unlinked tokens carry their own copy of the inventory: listed only when it differs from the world actor's.
for ( const scene of game.scenes ) {
  for ( const token of scene.tokens ) {
    if ( token.actorLink || !token.actor || !isMerchant(token.actor) ) continue;
    const changed = (token.delta?._source?.items?.length ?? 0) > 0;
    if ( changed ) found.push(look(token.actor, fill(T.token, { scene: scene.name })));
  }
}

if ( !found.length ) {
  ui.notifications.info(T.none);
  return;
}
const bad = found.filter(m => m.stuck.length);
const items = bad.reduce((n, m) => n + m.stuck.length, 0);
const line = i => {
  const text = `${escape(i.name)}${i.quantity > 1 ? ` ×${i.quantity}` : ""}${i.notes.length ? ` <em>(${i.notes.map(escape).join(", ")})</em>` : ""}`;
  return i.shown ? `<strong>${text}</strong>` : text;
};
const rows = bad.sort((a, b) => a.name.localeCompare(b.name)).map(m => `<tr><td>${escape(m.name)}</td><td>${escape(m.where)}</td>
  <td>${m.sellable}</td><td>${m.stuck.map(line).join("<br>")}</td></tr>`).join("");
const content = bad.length
  ? `<p><strong>${fill(T.summary, { bad: bad.length, n: found.length, items })}</strong></p><p>${T.how}</p>
     <table><tr><th>${T.merchant}</th><th>${T.where}</th><th>${T.sellable}</th><th>${T.unsellable}</th></tr>${rows}</table>`
  : `<p><strong>${fill(T.clean, { n: found.length })}</strong></p>`;
await ChatMessage.implementation.create({ whisper: [game.user.id], content: `<h3>${T.title}</h3>${content}` });
ui.notifications.info(bad.length ? fill(T.summary, { bad: bad.length, n: found.length, items }) : fill(T.clean, { n: found.length }));
