/**
 * Fenêtre d'échange (SPEC §3.6, étape 7), la même chez les deux joueurs : à gauche ce que je donne (glisser des objets de
 * ma fiche, quantités, pièces), à droite ce que je reçois (lecture seule), les validations des deux côtés. Elle ne décide
 * rien : chaque geste part au MJ par `actions` (runtime/trade.mjs), qui renvoie l'état à tous.
 */
import { MODULE_ID, loc } from "../shared.mjs";
import { COINS } from "../core/loot.mjs";

const { ApplicationV2 } = foundry.applications.api;
const escape = s => foundry.utils.escapeHTML(String(s ?? ""));

export class TradeWindow extends ApplicationV2 {
  constructor({ state, actions, ...options }) {
    super({ id: `${MODULE_ID}-trade-${state.id}`, ...options });
    this.trade = state;
    this.actions = actions;
  }

  static DEFAULT_OPTIONS = {
    classes: ["dlo-loot", "dlo-trade"],
    window: { icon: "fa-solid fa-right-left", resizable: true },
    position: { width: 520, height: "auto" },
    actions: {
      remove: TradeWindow.#onRemove,
      accept: TradeWindow.#onAccept,
      unaccept: TradeWindow.#onUnaccept,
      cancel: TradeWindow.#onCancel
    }
  };

  static open = new Map();

  /** Ouvre ou met à jour la fenêtre de cet échange ; la ferme s'il est conclu ou annulé. */
  static show(state, actions) {
    let app = TradeWindow.open.get(state.id);
    if ( state.cancelled ) {
      ui.notifications.info(loc("Trade.Cancelled", { name: state.cancelledBy ?? "" }));
      if ( app ) app.trade = state;   // déjà annulé : la fermeture ne renvoie pas d'annulation
      return app?.close();
    }
    if ( !app ) {
      app = new TradeWindow({ state, actions });
      TradeWindow.open.set(state.id, app);
    }
    app.trade = state;
    app.render({ force: true });
    if ( state.done ) {
      ui.notifications.info(loc("Trade.Done"));
      setTimeout(() => app.close(), 1500);
    }
    return app;
  }

  /** Mon côté : celui que je tiens (le MJ peut tenir l'un ou l'autre). */
  get mine() {
    return (this.trade.a.user === game.user.id) ? "a" : "b";
  }

  get theirs() {
    return (this.mine === "a") ? "b" : "a";
  }

  get title() {
    return loc("Trade.Title", { a: this.trade[this.mine].name, b: this.trade[this.theirs].name });
  }

  async _prepareContext() {
    return { mine: this.trade[this.mine], theirs: this.trade[this.theirs], done: this.trade.done };
  }

  async _renderHTML(context) {
    const root = document.createElement("div");
    root.className = "dlo-body dlo-trade-body";
    const done = context.done;
    const itemRow = (i, editable) => `
      <li class="dlo-trade-item" data-item-id="${i.id}">
        <img src="${i.img}" alt="" draggable="false">
        <span class="dlo-trade-name">${escape(i.name)}</span>
        ${editable
          ? `<input type="number" class="dlo-trade-qty" min="1" value="${i.quantity}" data-item-id="${i.id}" ${done ? "disabled" : ""}>
             <button type="button" class="dlo-trade-remove" data-action="remove" data-item-id="${i.id}" data-tooltip="${loc("Trade.Remove")}" ${done ? "disabled" : ""}><i class="fa-solid fa-xmark"></i></button>`
          : `<span class="dlo-trade-qty-ro">×${i.quantity}</span>`}
      </li>`;
    const coinsOf = (side, editable) => COINS.map(k => {
      const cfg = CONFIG.DND5E.currencies[k] ?? {};
      const v = side.coins[k] ?? 0;
      if ( !editable ) return v ? `<span class="dlo-coin">${v} ${cfg.abbreviation ?? k}</span>` : "";
      return `<label class="dlo-trade-coin">${cfg.abbreviation ?? k}
        <input type="number" min="0" value="${v}" data-coin="${k}" ${done ? "disabled" : ""}></label>`;
    }).join("");
    const status = side => side.accepted
      ? `<span class="dlo-trade-ok"><i class="fa-solid fa-check"></i> ${loc("Trade.Accepted")}</span>`
      : `<span class="dlo-trade-wait">${loc("Trade.Waiting")}</span>`;
    const mine = context.mine;
    const theirs = context.theirs;
    root.innerHTML = `
      <div class="dlo-trade-cols">
        <section class="dlo-trade-col dlo-trade-mine">
          <h3>${loc("Trade.YouGive", { name: escape(mine.name) })} ${status(mine)}</h3>
          <ol class="dlo-trade-list">${mine.items.map(i => itemRow(i, true)).join("")}</ol>
          <p class="dlo-hint">${loc("Trade.DropHint")}</p>
          <div class="dlo-trade-coins">${coinsOf(mine, true)}</div>
        </section>
        <section class="dlo-trade-col dlo-trade-theirs">
          <h3>${loc("Trade.YouGet", { name: escape(theirs.name) })} ${status(theirs)}</h3>
          <ol class="dlo-trade-list">${theirs.items.map(i => itemRow(i, false)).join("") || `<li class="dlo-empty">${loc("Trade.Nothing")}</li>`}</ol>
          <div class="dlo-trade-coins">${coinsOf(theirs, false)}</div>
        </section>
      </div>
      <footer class="dlo-foot">
        <button type="button" data-action="cancel" ${done ? "disabled" : ""}><i class="fa-solid fa-ban"></i> ${loc("Trade.Cancel")}</button>
        ${mine.accepted
          ? `<button type="button" data-action="unaccept" ${done ? "disabled" : ""}><i class="fa-solid fa-rotate-left"></i> ${loc("Trade.Unaccept")}</button>`
          : `<button type="button" data-action="accept" ${done ? "disabled" : ""}><i class="fa-solid fa-handshake"></i> ${loc("Trade.Accept")}</button>`}
      </footer>`;
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    // Quantités et pièces : l'offre repart au MJ à chaque changement.
    el.querySelectorAll(".dlo-trade-qty, [data-coin]").forEach(input => input.addEventListener("change", () => this.#send()));
    // Glisser un objet de ma fiche dans la fenêtre : il s'ajoute à mon offre.
    const mine = el.querySelector(".dlo-trade-mine");
    mine?.addEventListener("dragover", event => event.preventDefault());
    mine?.addEventListener("drop", event => this.#onDrop(event));
  }

  /** Mon offre telle qu'affichée, avec les changements saisis. */
  #readOffer({ without=null, add=null }={}) {
    const el = this.element;
    const items = [...el.querySelectorAll(".dlo-trade-mine .dlo-trade-item")]
      .filter(li => li.dataset.itemId !== without)
      .map(li => ({ id: li.dataset.itemId, quantity: Number(li.querySelector(".dlo-trade-qty")?.value) || 1 }));
    if ( add ) items.push(add);
    const coins = Object.fromEntries([...el.querySelectorAll("[data-coin]")].map(i => [i.dataset.coin, Number(i.value) || 0]));
    return { items, coins };
  }

  #send(options) {
    if ( this.trade.done ) return;
    return this.actions.update(this.trade.id, this.#readOffer(options));
  }

  async #onDrop(event) {
    event.preventDefault();
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if ( (data?.type !== "Item") || !data.uuid ) return;
    const item = await fromUuid(data.uuid).catch(() => null);
    if ( !item || (item.parent?.uuid !== this.trade[this.mine].actor) ) return ui.notifications.warn(loc("Trade.NotYours"));
    return this.#send({ add: { id: item.id, quantity: item.system.quantity ?? 1 } });
  }

  _onClose(options) {
    super._onClose(options);
    TradeWindow.open.delete(this.trade.id);
    // Fermer la fenêtre d'un échange en cours l'annule (pour les deux).
    if ( !this.trade.done && !this.trade.cancelled ) this.actions.cancel(this.trade.id);
  }

  static #onRemove(event, target) {
    return this.#send({ without: target.dataset.itemId });
  }

  static #onAccept() {
    return this.actions.accept(this.trade.id, true);
  }

  static #onUnaccept() {
    return this.actions.accept(this.trade.id, false);
  }

  static #onCancel() {
    return this.close();
  }
}
