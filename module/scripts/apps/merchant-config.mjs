/**
 * A merchant's settings (SPEC §3.7), for the GM, in a window of their own (the form is shared with the « Settings » tab of the GM's
 * shop window: apps/merchant-form.mjs). The window writes nothing itself: `actions.save(actor, flag, name)`, `actions.memorize(actor)`,
 * `actions.convert(actor)`.
 */
import { MODULE_ID, loc } from "../shared.mjs";
import { merchantOf, itemPilesMerchant } from "../adapter/shop.mjs";
import { merchantFormContext, merchantFormHTML, readMerchantForm, wireTables } from "./merchant-form.mjs";

const { ApplicationV2 } = foundry.applications.api;

export class MerchantConfig extends ApplicationV2 {
  constructor({ actor, actions, ...options }) {
    super({ id: `${MODULE_ID}-merchant-${actor.uuid.replaceAll(".", "-")}`, ...options });
    this.actor = actor;
    this.actions = actions;
    this.tables = null;   // restock tables being edited (before saving)
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

  async _prepareContext() {
    this.tables ??= merchantOf(this.actor).tables.map(t => ({ ...t }));
    return { ...(await merchantFormContext(this.actor, this.tables)), itemPiles: itemPilesMerchant(this.actor) };
  }

  async _renderHTML(context) {
    const root = document.createElement("div");
    root.className = "dlo-body dlo-merchant-body";
    root.innerHTML = `
      ${context.itemPiles ? `<p class="dlo-merchant-piles"><i class="fa-solid fa-circle-info"></i> ${loc("Merchant.ItemPiles")}
        <button type="button" data-action="convert">${loc("Merchant.Convert")}</button></p>` : ""}
      ${merchantFormHTML(context)}
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
    wireTables(this.element, this.tables, () => this.render());
  }

  _onClose(options) {
    super._onClose(options);
    MerchantConfig.open.delete(this.actor.uuid);
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

  /** Save: the whole merchant flag (types and characters always written in full), and the name. */
  static async #onSubmit(event, form, formData) {
    const { flag, name } = readMerchantForm(foundry.utils.expandObject(formData.object), this.tables);
    await this.actions.save(this.actor, flag, name);
  }
}
