/**
 * Fenêtre de fouille d'une source de butin — cadavre ou conteneur (SPEC §3.1, §3.2) — première version, l'habillage
 * BG3 définitif viendra ensuite. Une fenêtre par source. Elle ne décide rien : les actions sont les fonctions reçues à
 * l'ouverture (`onTake`, `onUnlock`).
 */
import { MODULE_ID, loc, setting } from "../shared.mjs";
import { lootView, hasThievesTools, keyItem } from "../adapter/dnd5e.mjs";

const { ApplicationV2 } = foundry.applications.api;
const escape = s => foundry.utils.escapeHTML(String(s ?? ""));

export class LootWindow extends ApplicationV2 {
  /**
   * @param {{ source: object, looter: TokenDocument|null, handlers: { onTake: Function, onUnlock: Function } }} options
   */
  constructor({ source, looter, handlers, ...options }) {
    super({ id: `${MODULE_ID}-${source.key}`, ...options });
    this.source = source;
    this.looter = looter;
    this.handlers = handlers;
  }

  static DEFAULT_OPTIONS = {
    classes: ["dlo-loot"],
    window: { icon: "fa-solid fa-sack", resizable: true },
    position: { width: 340, height: "auto" },
    actions: {
      take: LootWindow.#onTake,
      takeAll: LootWindow.#onTakeAll,
      takeCoins: LootWindow.#onTakeCoins,
      unlock: LootWindow.#onUnlock,
      openStore: LootWindow.#onOpenStore
    }
  };

  /** Les fenêtres ouvertes, par clé de source. */
  static open = new Map();

  /** Ouvre (ou ramène au premier plan) la fenêtre de cette source. */
  static show(source, looter, handlers) {
    const existing = LootWindow.open.get(source.key);
    if ( existing ) {
      existing.looter = looter ?? existing.looter;
      existing.render({ force: true });
      return existing.bringToFront();
    }
    const app = new LootWindow({ source, looter, handlers });
    LootWindow.open.set(source.key, app);
    return app.render({ force: true });
  }

  get title() {
    return loc("Window.Title", { name: this.source.name });
  }

  /** Pourquoi on ne peut rien prendre maintenant (null : on peut). */
  #blocked() {
    if ( !this.looter?.actor ) return loc("Window.NoLooter");
    if ( game.user.isGM ) return null;
    if ( (this.source.kind === "corpse") && (setting("whoLoots") === "gm") ) return loc("Refus.MJSeul");
    if ( this.source.distance(this.looter) > setting("reach") ) return loc("Refus.Loin");
    return null;
  }

  async _prepareContext() {
    const actor = this.source.actor;
    const view = actor ? lootView(actor) : { entries: [], coins: [], empty: true };
    if ( !view.empty ) this.hadLoot = true;
    const locked = this.source.locked();
    const system = this.source.doc.system ?? {};
    const looterActor = this.looter?.actor;
    return {
      ...view,
      locked,
      dc: system.dc,
      key: (locked && looterActor) ? keyItem(looterActor, system.key) : null,
      tools: !!(locked && looterActor && hasThievesTools(looterActor)),
      blocked: this.#blocked(),
      looterName: this.looter?.name ?? "",
      gm: game.user.isGM,
      container: this.source.kind === "container"
    };
  }

  async _renderHTML(context) {
    const root = document.createElement("div");
    root.className = "dlo-body";
    const disabled = context.blocked ? "disabled" : "";
    const store = (context.gm && context.container)
      ? `<button type="button" class="dlo-store" data-action="openStore"><i class="fa-solid fa-box-open"></i> ${loc("Window.OpenStore")}</button>` : "";

    if ( context.locked ) {
      const buttons = [];
      if ( context.key ) buttons.push(`<button type="button" data-action="unlock" data-method="key" ${disabled}>
        <i class="fa-solid fa-key"></i> ${loc("Lock.UseKey", { name: escape(context.key.name) })}</button>`);
      if ( context.tools ) buttons.push(`<button type="button" data-action="unlock" data-method="pick" ${disabled}>
        <i class="fa-solid fa-screwdriver"></i> ${loc("Lock.Pick", { dc: context.dc })}</button>`);
      if ( context.gm ) buttons.push(`<button type="button" data-action="unlock" data-method="gm">
        <i class="fa-solid fa-lock-open"></i> ${loc("Lock.GMOpen")}</button>`);
      root.innerHTML = `
        <p class="dlo-to">${context.looterName ? loc("Window.To", { name: escape(context.looterName) }) : ""}</p>
        <p class="dlo-lock"><i class="fa-solid fa-lock"></i> ${loc("Lock.Locked")}</p>
        ${buttons.length ? "" : `<p class="dlo-blocked">${loc("Lock.NoWay")}</p>`}
        ${context.blocked ? `<p class="dlo-blocked">${context.blocked}</p>` : ""}
        <footer class="dlo-foot dlo-lock-actions">${store}${buttons.join("")}</footer>`;
      return root;
    }

    const slots = context.entries.map(e => `
      <li class="dlo-slot" data-action="take" data-item-id="${e.id}" data-tooltip="${escape(e.name)}">
        <img src="${e.img}" alt="" draggable="false">
        ${(e.quantity > 1) ? `<span class="dlo-qty">${e.quantity}</span>` : ""}
        ${e.contents ? `<span class="dlo-inside"><i class="fa-solid fa-box-open"></i> ${e.contents}</span>` : ""}
      </li>`).join("");
    const coins = context.coins.map(c => {
      const cfg = CONFIG.DND5E.currencies[c.key] ?? {};
      return `<span class="dlo-coin dlo-coin-${c.key}" data-tooltip="${cfg.label ?? c.key}">${c.value} ${cfg.abbreviation ?? c.key}</span>`;
    }).join("");
    root.innerHTML = `
      <p class="dlo-to">${context.looterName ? loc("Window.To", { name: escape(context.looterName) }) : ""}</p>
      ${context.empty ? `<p class="dlo-empty">${loc("Window.Empty")}</p>` : `<ol class="dlo-grid ${disabled}">${slots}</ol>`}
      ${coins ? `<div class="dlo-coins" data-action="takeCoins" data-tooltip="${loc("Window.TakeCoins")}">${coins}</div>` : ""}
      ${context.blocked ? `<p class="dlo-blocked">${context.blocked}</p>` : ""}
      <footer class="dlo-foot">
        ${store}
        <button type="button" data-action="takeAll" ${(disabled || context.empty) ? "disabled" : ""}>
          <i class="fa-solid fa-hand-holding"></i> ${loc("Window.TakeAll")}
        </button>
      </footer>`;
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onClose(options) {
    super._onClose(options);
    LootWindow.open.delete(this.source.key);
  }

  /**
   * Après un changement de la source ou du pilleur : redessiner ; fermer si la source a disparu, ou si elle vient
   * d'être vidée (on a tout pris — une fenêtre ouverte sur une source déjà vide reste, pour dire « Rien à prendre »).
   */
  refresh() {
    if ( !this.source.exists() ) return this.close();
    const actor = this.source.actor;
    const empty = actor ? lootView(actor).empty : true;
    if ( empty && this.hadLoot && !this.source.locked() ) return this.close();
    return this.render();
  }

  static async #onTake(event, target) {
    if ( this.#blocked() || this.source.locked() ) return;
    await this.handlers.onTake(this.source, this.looter, { itemIds: [target.dataset.itemId] });
  }

  static async #onTakeCoins() {
    if ( this.#blocked() || this.source.locked() ) return;
    await this.handlers.onTake(this.source, this.looter, { coins: true });
  }

  static async #onTakeAll() {
    if ( this.#blocked() || this.source.locked() ) return;
    const { entries } = lootView(this.source.actor);
    await this.handlers.onTake(this.source, this.looter, { itemIds: entries.map(e => e.id), coins: true });
  }

  static async #onUnlock(event, target) {
    const method = target.dataset.method;
    if ( (method !== "gm") && this.#blocked() ) return;
    target.disabled = true;
    try { await this.handlers.onUnlock(this.source, this.looter, method); }
    finally { if ( target.isConnected ) target.disabled = false; }
  }

  static #onOpenStore() {
    this.source.actor?.sheet.render({ force: true });
  }
}
