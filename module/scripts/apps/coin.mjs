/**
 * A coin as the dnd5e system draws it: the system's coin icon (`<i class="currency gp">`), whose picture dnd5e sets for every
 * currency of `CONFIG.DND5E.currencies` inside a `.dnd5e2` window (all the module's windows carry that class). A currency
 * without an icon (added by a world or a module) keeps its abbreviation as text. Nothing of the system is copied: the icon
 * and its picture come from dnd5e at runtime.
 */
const escape = s => foundry.utils.escapeHTML(String(s ?? ""));

/** The icon of one currency, with its name for screen readers and the tooltip. */
export function coinIcon(key) {
  const cfg = CONFIG.DND5E.currencies[key] ?? {};
  const label = escape(game.i18n.localize(cfg.label ?? key));
  if ( !cfg.icon ) return `<span class="dlo-coin-abbr">${escape(game.i18n.localize(cfg.abbreviation ?? key))}</span>`;
  return `<i class="currency ${escape(key)}" aria-label="${label}"></i>`;
}

/** An amount and its coin: « 15 (gold coin icon) », with the currency's name as tooltip. */
export function coinAmount(key, value, extra="") {
  const label = escape(game.i18n.localize(CONFIG.DND5E.currencies[key]?.label ?? key));
  return `<span class="dlo-coin dlo-coin-${escape(key)} ${extra}" data-tooltip="${label}">${value} ${coinIcon(key)}</span>`;
}
