/**
 * Small pieces of the shop window (apps/shop-window.mjs): HTML escaping, an item's picture, the « Details » window of an item.
 *
 * An item's picture is a `<span>` with a background image, never an `<img>`: modules that put their own menu on every image
 * (« Image Context ») would otherwise open it on a right click in the shop, over the shop's own menu (user report, 2026-11-27).
 */
import { loc } from "../shared.mjs";

export const escape = s => foundry.utils.escapeHTML(String(s ?? ""));

/** An item's picture, as a span (see above). */
export function itemPicture(src, extra="") {
  const url = String(src || "icons/svg/item-bag.svg").replaceAll("\"", "%22");
  return `<span class="dlo-pic ${extra}" style="background-image: url(&quot;${escape(url)}&quot;)"></span>`;
}

/** The text of a dnd5e item a player may read: its unidentified name and description when it is not identified. */
function readable(item) {
  const identified = item.system.identified !== false;
  return {
    name: identified ? item.name : (item.system.unidentified?.name || item.name),
    description: identified ? (item.system.description?.value ?? "") : (item.system.unidentified?.description ?? "")
  };
}

/**
 * The « Details » window of an item (player and GM): picture, name, type, price in this shop, weight, rarity, description.
 * @param {Item} item
 * @param {{ price?: string, quantity?: number|null }} [extra]
 */
export async function showItemInfo(item, { price="", quantity=null }={}) {
  const { name, description } = game.user.isGM ? { name: item.name, description: item.system.description?.value ?? "" } : readable(item);
  const enriched = description
    ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(description, { relativeTo: item, secrets: game.user.isGM })
    : `<p class="dlo-muted">${loc("Shop.NoDescription")}</p>`;
  const facts = [];
  const type = game.i18n.localize(CONFIG.Item.typeLabels?.[item.type] ?? item.type);
  facts.push(type);
  if ( price ) facts.push(`${loc("Shop.Price")} : ${price}`);
  if ( Number.isFinite(quantity) ) facts.push(`${loc("Shop.Quantity")} : ${quantity}`);
  const weight = item.system.weight?.value;
  if ( Number(weight) > 0 ) facts.push(`${loc("Shop.Weight")} : ${weight} ${game.i18n.localize(CONFIG.DND5E?.weightUnits?.[item.system.weight.units]?.abbreviation ?? "lb")}`);
  const rarity = item.system.rarity;
  if ( rarity && CONFIG.DND5E?.itemRarity?.[rarity] ) facts.push(game.i18n.localize(CONFIG.DND5E.itemRarity[rarity]));
  return foundry.applications.api.DialogV2.prompt({
    window: { title: name, icon: "fa-solid fa-circle-info" },
    classes: ["dlo-loot", "dlo-item-info"],
    position: { width: 420 },
    content: `<div class="dlo-info-head">${itemPicture(item.img, "dlo-info-pic")}<div><h3>${escape(name)}</h3>
      <p class="dlo-muted">${facts.map(escape).join(" · ")}</p></div></div><div class="dlo-info-desc">${enriched}</div>`,
    ok: { label: loc("Shop.Close"), icon: "fa-solid fa-check" },
    rejectClose: false
  }).catch(() => null);
}
