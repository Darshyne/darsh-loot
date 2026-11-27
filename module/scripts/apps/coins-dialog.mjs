/**
 * « How many coins? » — one field per coin the character holds (drop on the ground, give). Decides nothing: it returns the
 * amounts typed, capped to what is held.
 */

/**
 * @param {{ title: string, have: Record<string, number>, ok: string, preset?: Record<string, number>, icon?: string }} options
 *   have: what the character holds, by coin (only these get a field) ; preset: amounts filled in at opening.
 * @returns {Promise<Record<string, number>|null>}  Positive amounts only; null when the player gave up or typed nothing.
 */
export async function askCoins({ title, have, ok, preset={}, icon="fa-solid fa-coins" }) {
  const escape = foundry.utils.escapeHTML;
  const order = Object.keys(CONFIG.DND5E?.currencies ?? {});
  const keys = Object.keys(have).filter(k => have[k] > 0).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if ( !keys.length ) return null;
  const fields = keys.map(key => {
    const cfg = CONFIG.DND5E?.currencies?.[key] ?? {};
    return `<label class="dlo-coin-field"><span>${escape(cfg.label ?? key)} <em>(${have[key]})</em></span>
      <input type="number" name="${key}" min="0" max="${have[key]}" step="1" value="${Math.min(preset[key] ?? 0, have[key])}"></label>`;
  }).join("");
  const answer = await foundry.applications.api.DialogV2.prompt({
    window: { title, icon },
    content: `<div class="dlo-coin-fields">${fields}</div>`,
    ok: { label: ok, callback: (event, button) => Object.fromEntries(keys.map(k => [k, button.form.elements[k].valueAsNumber])) },
    rejectClose: false
  });
  if ( !answer ) return null;
  const coins = {};
  for ( const key of keys ) {
    const n = Math.min(Math.floor(Number(answer[key]) || 0), have[key]);
    if ( n > 0 ) coins[key] = n;
  }
  return Object.keys(coins).length ? coins : null;
}
