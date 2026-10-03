/**
 * Réglages d'un marchand (SPEC §3.7), pour le MJ : activer la boutique, coefficients d'achat et de vente, attitude,
 * objets volés, stock et caisse, tables de réassort, coefficients par type d'objet, attitude et remise par personnage.
 * La fenêtre n'écrit rien elle-même : `actions.save(actor, flag)`, `actions.memorize(actor)`, `actions.convert(actor)`.
 */
import { MODULE_ID, loc } from "../shared.mjs";
import { merchantOf, itemPilesMerchant } from "../adapter/shop.mjs";
import { ATTITUDES, STOLEN_POLICIES } from "../core/shop.mjs";

const { ApplicationV2 } = foundry.applications.api;
const escape = s => foundry.utils.escapeHTML(String(s ?? ""));

/** Les types d'objets qu'un marchand peut tarifer à part (types physiques de dnd5e). */
const ITEM_TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container"];

export class MerchantConfig extends ApplicationV2 {
  constructor({ actor, actions, ...options }) {
    super({ id: `${MODULE_ID}-merchant-${actor.uuid.replaceAll(".", "-")}`, ...options });
    this.actor = actor;
    this.actions = actions;
    this.tables = null;   // lignes de tables en cours d'édition (avant enregistrement)
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["dlo-loot", "dlo-merchant-config"],
    window: { icon: "fa-solid fa-store", resizable: true },
    position: { width: 560, height: "auto" },
    form: { handler: MerchantConfig.#onSubmit, closeOnSubmit: true },
    actions: {
      removeTable: MerchantConfig.#onRemoveTable,
      memorize: MerchantConfig.#onMemorize,
      convert: MerchantConfig.#onConvert
    }
  };

  static open = new Map();

  static show(actor, actions) {
    const existing = MerchantConfig.open.get(actor.uuid);
    if ( existing ) { existing.render({ force: true }); return existing.bringToFront(); }
    const app = new MerchantConfig({ actor, actions });
    MerchantConfig.open.set(actor.uuid, app);
    return app.render({ force: true });
  }

  get title() {
    return loc("Merchant.Title", { name: this.actor.name });
  }

  /** Les personnages des joueurs, pour l'attitude et la remise de chacun. */
  #characters() {
    return game.actors.filter(a => (a.type === "character") && a.hasPlayerOwner).sort((a, b) => a.name.localeCompare(b.name));
  }

  async _prepareContext() {
    const merchant = merchantOf(this.actor);
    this.tables ??= merchant.tables.map(t => ({ ...t }));
    const tables = [];
    for ( const t of this.tables ) {
      const doc = t.uuid ? await fromUuid(t.uuid).catch(() => null) : null;
      tables.push({ ...t, name: doc?.name ?? loc("Merchant.TableMissing") });
    }
    return { merchant, tables, characters: this.#characters(), itemPiles: itemPilesMerchant(this.actor) };
  }

  async _renderHTML(context) {
    const { merchant, tables, characters } = context;
    const root = document.createElement("div");
    root.className = "dlo-body dlo-merchant-body";
    const check = (name, value) => `<input type="checkbox" name="${name}" ${value ? "checked" : ""}>`;
    const number = (name, value, step="0.05") => `<input type="number" name="${name}" value="${value}" min="0" step="${step}">`;
    const options = (keys, current, label) => keys.map(k => `<option value="${k}" ${k === current ? "selected" : ""}>${label(k)}</option>`).join("");
    const attitudes = current => options(Object.keys(ATTITUDES), current, k => loc(`Merchant.Attitude.${k}`));
    const row = (label, field, hint="") => `
      <div class="dlo-field"><label>${label}</label><div class="dlo-field-input">${field}</div>${hint ? `<p class="dlo-hint">${hint}</p>` : ""}</div>`;

    root.innerHTML = `
      ${context.itemPiles ? `<p class="dlo-merchant-piles"><i class="fa-solid fa-circle-info"></i> ${loc("Merchant.ItemPiles")}
        <button type="button" data-action="convert">${loc("Merchant.Convert")}</button></p>` : ""}
      <fieldset>
        <legend>${loc("Merchant.Shop")}</legend>
        ${row(loc("Merchant.Enabled"), check("enabled", merchant.enabled), loc("Merchant.EnabledHint"))}
        ${row(loc("Merchant.ClosedField"), check("closed", merchant.closed))}
        ${row(loc("Merchant.Owner"), `<input type="text" name="owner" value="${escape(merchant.owner)}">`, loc("Merchant.OwnerHint"))}
        ${row(loc("Merchant.Description"), `<textarea name="description" rows="3">${escape(merchant.description)}</textarea>`)}
      </fieldset>
      <fieldset>
        <legend>${loc("Merchant.Prices")}</legend>
        ${row(loc("Merchant.Buy"), number("buy", merchant.buy), loc("Merchant.BuyHint"))}
        ${row(loc("Merchant.Sell"), number("sell", merchant.sell), loc("Merchant.SellHint"))}
        ${row(loc("Merchant.AttitudeField"), `<select name="attitude">${attitudes(merchant.attitude)}</select>`, loc("Merchant.AttitudeHint"))}
        ${row(loc("Merchant.Stolen"), `<select name="stolen">${options(STOLEN_POLICIES, merchant.stolen, k => loc(`Merchant.StolenPolicy.${k}`))}</select>`)}
        ${row(loc("Merchant.FenceRate"), number("fenceRate", merchant.fenceRate), loc("Merchant.FenceRateHint"))}
      </fieldset>
      <fieldset>
        <legend>${loc("Merchant.Stock")}</legend>
        ${row(loc("Merchant.InfiniteStock"), check("infiniteStock", merchant.infiniteStock))}
        ${row(loc("Merchant.InfiniteCoins"), check("infiniteCoins", merchant.infiniteCoins))}
        <div class="dlo-merchant-tables">
          <p class="dlo-hint">${loc("Merchant.TablesHint")}</p>
          <ol>${tables.map((t, i) => `
            <li data-index="${i}">
              <span class="dlo-merchant-table-name">${escape(t.name)}</span>
              <input type="text" class="dlo-merchant-rolls" data-index="${i}" value="${escape(t.rolls)}" data-tooltip="${loc("Merchant.Rolls")}">
              <button type="button" data-action="removeTable" data-index="${i}" data-tooltip="${loc("Merchant.RemoveTable")}"><i class="fa-solid fa-xmark"></i></button>
            </li>`).join("")}</ol>
          <div class="dlo-merchant-drop">${loc("Merchant.DropTable")}</div>
        </div>
        <button type="button" data-action="memorize" data-tooltip="${loc("Merchant.MemorizeHint")}"><i class="fa-solid fa-thumbtack"></i> ${loc("Merchant.Memorize")}</button>
      </fieldset>
      <fieldset>
        <legend>${loc("Merchant.Types")}</legend>
        <p class="dlo-hint">${loc("Merchant.TypesHint")}</p>
        <table class="dlo-merchant-grid">
          <tr><th></th><th>${loc("Merchant.Buy")}</th><th>${loc("Merchant.Sell")}</th></tr>
          ${ITEM_TYPES.map(t => {
            const v = merchant.types[t] ?? { buy: 1, sell: 1 };
            return `<tr><td>${escape(game.i18n.localize(CONFIG.Item.typeLabels[t] ?? t))}</td>
              <td>${number(`types.${t}.buy`, v.buy)}</td><td>${number(`types.${t}.sell`, v.sell)}</td></tr>`;
          }).join("")}
        </table>
      </fieldset>
      <fieldset>
        <legend>${loc("Merchant.Characters")}</legend>
        <p class="dlo-hint">${loc("Merchant.CharactersHint")}</p>
        ${characters.length ? `<table class="dlo-merchant-grid">
          <tr><th></th><th>${loc("Merchant.AttitudeField")}</th><th>${loc("Merchant.Discount")}</th></tr>
          ${characters.map(c => {
            const v = merchant.characters[c.id] ?? { attitude: null, discount: 0 };
            return `<tr><td>${escape(c.name)}</td>
              <td><select name="characters.${c.id}.attitude"><option value="">${loc("Merchant.SameAttitude")}</option>${attitudes(v.attitude)}</select></td>
              <td><input type="number" name="characters.${c.id}.discount" value="${v.discount}" min="-100" max="100" step="5"></td></tr>`;
          }).join("")}
        </table>` : `<p class="dlo-empty">${loc("Merchant.NoCharacters")}</p>`}
      </fieldset>
      <footer class="dlo-foot">
        <button type="submit"><i class="fa-solid fa-floppy-disk"></i> ${loc("Merchant.Save")}</button>
      </footer>`;
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    // Le nombre de tirages d'une table se garde entre deux redessins.
    el.querySelectorAll(".dlo-merchant-rolls").forEach(input => input.addEventListener("change", () => {
      const t = this.tables[Number(input.dataset.index)];
      if ( t ) t.rolls = input.value.trim() || "1";
    }));
    const drop = el.querySelector(".dlo-merchant-tables");
    drop?.addEventListener("dragover", event => event.preventDefault());
    drop?.addEventListener("drop", event => this.#onDropTable(event));
  }

  _onClose(options) {
    super._onClose(options);
    MerchantConfig.open.delete(this.actor.uuid);
  }

  /** Une table lâchée sur la liste s'ajoute aux tables de réassort. */
  async #onDropTable(event) {
    event.preventDefault();
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if ( (data?.type !== "RollTable") || !data.uuid ) return;
    if ( this.tables.some(t => t.uuid === data.uuid) ) return;
    this.tables.push({ uuid: data.uuid, rolls: "1" });
    return this.render();
  }

  static #onRemoveTable(event, target) {
    this.tables.splice(Number(target.dataset.index), 1);
    return this.render();
  }

  static async #onMemorize() {
    const count = await this.actions.memorize(this.actor);
    ui.notifications.info(loc("Merchant.Memorized", { count }));
  }

  static async #onConvert() {
    await this.actions.convert(this.actor);
    this.tables = null;
    ui.notifications.info(loc("Merchant.Converted", { name: this.actor.name }));
    return this.render();
  }

  /** Enregistre : le drapeau complet du marchand (types et personnages toujours écrits en entier). */
  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const num = (v, fallback) => (Number.isFinite(Number(v)) && (Number(v) >= 0) ? Number(v) : fallback);
    const flag = {
      enabled: !!data.enabled,
      closed: !!data.closed,
      owner: String(data.owner ?? "").trim(),
      description: String(data.description ?? ""),
      buy: num(data.buy, 1),
      sell: num(data.sell, 0.5),
      attitude: data.attitude,
      stolen: data.stolen,
      fenceRate: num(data.fenceRate, 0.5),
      infiniteStock: !!data.infiniteStock,
      infiniteCoins: !!data.infiniteCoins,
      tables: this.tables.map(t => ({ uuid: t.uuid, rolls: t.rolls })),
      types: Object.fromEntries(ITEM_TYPES.map(t => [t, { buy: num(data.types?.[t]?.buy, 1), sell: num(data.types?.[t]?.sell, 1) }])),
      characters: Object.fromEntries(Object.entries(data.characters ?? {}).map(([id, v]) => [id,
        { attitude: v.attitude || null, discount: Number(v.discount) || 0 }]))
    };
    await this.actions.save(this.actor, flag);
  }
}
