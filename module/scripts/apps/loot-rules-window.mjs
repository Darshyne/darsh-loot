/**
 * The « Loot tables » window (lot 3, 2026-11-27; request of IncognitoAnkh, Core#48) — GM only. Custom loot tables by challenge
 * rating, creature type and size: an ordered list of rules, the first that matches a creature wins (core/end-loot.mjs). Each rule
 * draws on a roll table (picked in the list or dropped from the sidebar or a compendium), a number of times, in addition to the
 * DMG treasure or in its place. A table set on the NPC itself still comes on top. Every change is saved at once (world setting
 * `lootRules`).
 */
import { MODULE_ID, loc, setting } from "../shared.mjs";
import { cleanRule, RULE_EFFECTS } from "../core/end-loot.mjs";

const { ApplicationV2 } = foundry.applications.api;
const escape = s => foundry.utils.escapeHTML(String(s ?? ""));

export class LootRulesWindow extends ApplicationV2 {
  constructor(options={}) {
    super({ id: `${MODULE_ID}-loot-rules`, ...options });
  }

  static DEFAULT_OPTIONS = {
    classes: ["dlo-loot", "dnd5e2", "titlebar", "dlo-loot-rules"],
    window: { icon: "fa-solid fa-table-list", resizable: true },
    position: { width: 760, height: "auto" },
    actions: {
      addRule: LootRulesWindow.#onAdd,
      removeRule: LootRulesWindow.#onRemove,
      moveRule: LootRulesWindow.#onMove,
      openTable: LootRulesWindow.#onOpenTable
    }
  };

  static instance = null;

  /** Opens the window (GM), or brings it forward. */
  static show() {
    if ( !game.user.isGM ) return null;
    const app = LootRulesWindow.instance ?? new LootRulesWindow();
    LootRulesWindow.instance = app;
    const shown = app.rendered;
    app.render({ force: true });
    if ( shown ) app.bringToFront();
    return app;
  }

  get title() {
    return loc("EndLoot.Rules.Title");
  }

  /** The rules as stored, cleaned. */
  static rules() {
    return (setting("lootRules")?.rules ?? []).map(cleanRule);
  }

  static async save(rules) {
    await game.settings.set(MODULE_ID, "lootRules", { rules: rules.map(cleanRule) });
    LootRulesWindow.instance?.render();
  }

  async _renderHTML() {
    const root = document.createElement("form");
    root.className = "dlo-body dlo-rules-body standard-form";
    root.addEventListener("submit", event => event.preventDefault());
    const rules = LootRulesWindow.rules();
    const types = Object.entries(CONFIG.DND5E?.creatureTypes ?? {}).map(([k, v]) => [k, game.i18n.localize(v.label ?? v)]);
    const sizes = Object.entries(CONFIG.DND5E?.actorSizes ?? {}).map(([k, v]) => [k, game.i18n.localize(v.label ?? v)]);
    const tables = game.tables.contents.map(t => [t.uuid, t.name]).sort((a, b) => a[1].localeCompare(b[1], game.i18n.lang));
    const option = (value, label, current) => `<option value="${escape(value)}" ${value === current ? "selected" : ""}>${escape(label)}</option>`;
    const tableName = uuid => (uuid ? (fromUuidSync(uuid, { strict: false })?.name ?? uuid) : "");

    const rows = rules.map((r, i) => {
      const known = tables.some(([u]) => u === r.table);
      const tableOptions = [option("", loc("EndLoot.Rules.NoTable"), r.table),
        ...(r.table && !known ? [option(r.table, tableName(r.table), r.table)] : []),
        ...tables.map(([u, n]) => option(u, n, r.table))].join("");
      return `
      <tr class="dlo-rule" data-index="${i}">
        <td class="dlo-rule-order">
          <button type="button" class="icon" data-action="moveRule" data-dir="-1" ${i ? "" : "disabled"} data-tooltip="${loc("EndLoot.Rules.Up")}"><i class="fa-solid fa-arrow-up"></i></button>
          <button type="button" class="icon" data-action="moveRule" data-dir="1" ${i < rules.length - 1 ? "" : "disabled"} data-tooltip="${loc("EndLoot.Rules.Down")}"><i class="fa-solid fa-arrow-down"></i></button>
        </td>
        <td><input type="number" data-field="crMin" step="any" min="0" value="${r.crMin ?? ""}" placeholder="0" aria-label="${loc("EndLoot.Rules.CrMin")}"></td>
        <td><input type="number" data-field="crMax" step="any" min="0" value="${r.crMax ?? ""}" placeholder="∞" aria-label="${loc("EndLoot.Rules.CrMax")}"></td>
        <td><select data-field="type">${[option("", loc("EndLoot.Rules.Any"), r.type), ...types.map(([k, l]) => option(k, l, r.type))].join("")}</select></td>
        <td><select data-field="size">${[option("", loc("EndLoot.Rules.Any"), r.size), ...sizes.map(([k, l]) => option(k, l, r.size))].join("")}</select></td>
        <td class="dlo-rule-table" data-tooltip="${loc("EndLoot.Rules.DropHint")}">
          <select data-field="table">${tableOptions}</select>
          ${r.table ? `<a data-action="openTable" data-uuid="${escape(r.table)}" data-tooltip="${loc("EndLoot.Rules.Open")}"><i class="fa-solid fa-up-right-from-square"></i></a>` : ""}
        </td>
        <td><input type="number" data-field="draws" min="1" max="20" step="1" value="${r.draws}" aria-label="${loc("EndLoot.Rules.Draws")}"></td>
        <td><select data-field="effect">${RULE_EFFECTS.map(e => option(e, loc(`EndLoot.Rules.Effect.${e}`), r.effect)).join("")}</select></td>
        <td><button type="button" class="icon" data-action="removeRule" data-tooltip="${loc("EndLoot.Rules.Remove")}"><i class="fa-solid fa-trash"></i></button></td>
      </tr>`;
    }).join("");

    root.innerHTML = `
      <p class="dlo-hint">${loc("EndLoot.Rules.Hint")}</p>
      ${rules.length ? `<table class="dlo-rules">
        <thead><tr><th></th><th>${loc("EndLoot.Rules.CrMin")}</th><th>${loc("EndLoot.Rules.CrMax")}</th><th>${loc("EndLoot.Rules.Type")}</th>
          <th>${loc("EndLoot.Rules.Size")}</th><th>${loc("EndLoot.Rules.Table")}</th><th>${loc("EndLoot.Rules.Draws")}</th>
          <th>${loc("EndLoot.Rules.Effect.Label")}</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>` : `<p class="dlo-empty">${loc("EndLoot.Rules.None")}</p>`}
      <footer class="dlo-foot">
        <button type="button" class="dlo-on" data-action="addRule"><i class="fa-solid fa-plus"></i> ${loc("EndLoot.Rules.Add")}</button>
      </footer>`;
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const form = this.element.querySelector("form.dlo-rules-body");
    form?.addEventListener("change", event => this.#onChange(event));
    // A roll table dropped on a rule (sidebar or compendium) becomes its table.
    form?.addEventListener("dragover", event => event.preventDefault());
    form?.addEventListener("drop", event => this.#onDrop(event));
  }

  _onClose(options) {
    super._onClose(options);
    if ( LootRulesWindow.instance === this ) LootRulesWindow.instance = null;
  }

  async #onChange(event) {
    const el = event.target;
    const row = el.closest(".dlo-rule");
    if ( !row || !el.dataset.field ) return;
    const rules = LootRulesWindow.rules();
    const rule = rules[Number(row.dataset.index)];
    if ( !rule ) return;
    rule[el.dataset.field] = el.value;
    await LootRulesWindow.save(rules);
  }

  async #onDrop(event) {
    const row = event.target.closest(".dlo-rule");
    let data = null;
    try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
    if ( (data?.type !== "RollTable") || !data.uuid ) return;
    event.preventDefault();
    const rules = LootRulesWindow.rules();
    if ( row ) rules[Number(row.dataset.index)].table = data.uuid;
    else rules.push(cleanRule({ id: foundry.utils.randomID(), table: data.uuid }));
    await LootRulesWindow.save(rules);
  }

  static async #onAdd() {
    await LootRulesWindow.save([...LootRulesWindow.rules(), cleanRule({ id: foundry.utils.randomID() })]);
  }

  static async #onRemove(event, target) {
    const index = Number(target.closest(".dlo-rule")?.dataset.index);
    await LootRulesWindow.save(LootRulesWindow.rules().filter((r, i) => i !== index));
  }

  static async #onMove(event, target) {
    const index = Number(target.closest(".dlo-rule")?.dataset.index);
    const to = index + Number(target.dataset.dir);
    const rules = LootRulesWindow.rules();
    if ( !rules[index] || !rules[to] ) return;
    [rules[index], rules[to]] = [rules[to], rules[index]];
    await LootRulesWindow.save(rules);
  }

  static #onOpenTable(event, target) {
    fromUuid(target.dataset.uuid).then(t => t?.sheet?.render(true)).catch(() => {});
  }
}
