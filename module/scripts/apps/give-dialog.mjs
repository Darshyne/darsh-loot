/**
 * « Give an item… » — pick one of the character's items and how many. Decides nothing: it returns the choice.
 */

/**
 * @param {{ title: string, items: { id: string, name: string, quantity: number, equipped?: boolean }[], ok: string }} options
 * @returns {Promise<{ item: string, quantity: number }|null>}
 */
export async function askGift({ title, items, ok }) {
  if ( !items.length ) return null;
  const escape = foundry.utils.escapeHTML;
  const options = items.map(i => `<option value="${i.id}" data-max="${i.quantity}">${escape(i.name)}${(i.quantity > 1) ? ` (${i.quantity})` : ""}</option>`).join("");
  const answer = await foundry.applications.api.DialogV2.prompt({
    window: { title, icon: "fa-solid fa-hand-holding-heart" },
    classes: ["dlo-give"],
    content: `<div class="dlo-give-fields">
      <select name="gift">${options}</select>
      <input type="number" name="quantity" min="1" max="${items[0].quantity}" step="1" value="${items[0].quantity}">
    </div>`,
    // The quantity follows the item chosen: its whole stack by default, never more.
    render: (event, dialog) => {
      const form = dialog.element.querySelector("form");
      const select = form?.elements.gift, quantity = form?.elements.quantity;
      select?.addEventListener("change", () => {
        const max = Number(select.selectedOptions[0]?.dataset.max) || 1;
        quantity.max = String(max);
        quantity.value = String(max);
      });
    },
    ok: { label: ok, callback: (event, button) => ({ item: button.form.elements.gift.value, quantity: button.form.elements.quantity.valueAsNumber }) },
    rejectClose: false
  });
  if ( !answer?.item ) return null;
  const chosen = items.find(i => i.id === answer.item);
  if ( !chosen ) return null;
  const n = Math.floor(Number(answer.quantity));
  return { item: chosen.id, quantity: Math.min(Math.max(1, Number.isFinite(n) ? n : chosen.quantity), chosen.quantity) };
}
