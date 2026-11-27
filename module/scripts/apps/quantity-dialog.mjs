/**
 * « How many? » — one small window for every gesture that moves part of a stack (drop on the ground, take from a search
 * window, give). The whole stack by default. Decides nothing: it only returns the number.
 */

/**
 * @param {{ title: string, label: string, max: number, ok: string, icon?: string, value?: number }} options
 * @returns {Promise<number|null>}  A whole number between 1 and `max`; 1 without asking when there is nothing to choose;
 *   null when the player gave up.
 */
export async function askQuantity({ title, label, max, ok, icon="fa-solid fa-hand-holding", value=max }) {
  const most = Math.max(1, Math.floor(Number(max) || 1));
  if ( most <= 1 ) return 1;
  const escape = foundry.utils.escapeHTML;
  const answer = await foundry.applications.api.DialogV2.prompt({
    window: { title, icon },
    content: `<label class="dlo-qty-field">${escape(label)}
      <input type="number" name="quantity" min="1" max="${most}" step="1" value="${Math.min(Math.max(1, value), most)}" autofocus></label>`,
    ok: { label: ok, callback: (event, button) => button.form.elements.quantity.valueAsNumber },
    rejectClose: false
  });
  if ( !Number.isFinite(answer) || (answer < 1) ) return null;
  return Math.min(Math.floor(answer), most);
}
