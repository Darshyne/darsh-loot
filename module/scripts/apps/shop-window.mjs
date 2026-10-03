/**
 * Boutique d'un marchand (SPEC §3.7), troc façon BG3 : à gauche l'inventaire du personnage, à droite l'étal, au centre
 * les deux plateaux — ce que je donne, ce que je reçois — et la balance ; l'or comble l'écart. Un clic pose un
 * exemplaire sur le plateau (Maj : toute la pile), un clic sur le plateau le reprend.
 *
 * La fenêtre ne décide rien : le panier est local, le devis (adapter/shop.mjs `quote`) n'est qu'un affichage ; « Conclure »
 * envoie le panier au MJ (`actions.deal`), qui refait le devis et exécute.
 */
import { MODULE_ID, loc, setting } from "../shared.mjs";
import { merchantOf, stockView, waresView, quote, formatPrice, purseView } from "../adapter/shop.mjs";

const { ApplicationV2 } = foundry.applications.api;
const escape = s => foundry.utils.escapeHTML(String(s ?? ""));

export class ShopWindow extends ApplicationV2 {
  /**
   * @param {{ source: object, looter: TokenDocument|null, actions: object }} options
   *   actions : `deal(source, looter, cart)`, `restock(source)`, `configure(actor)`, `flag(item, shop)`, `show(source)`.
   *   `looter` : le token qui agit, ou l'acteur du personnage s'il n'a pas de token sur la scène.
   */
  constructor({ source, looter, actions, ...options }) {
    super({ id: `${MODULE_ID}-${source.key}`, ...options });
    this.source = source;
    this.looter = looter;
    this.actions = actions;
    this.cart = { buy: new Map(), sell: new Map() };
  }

  static DEFAULT_OPTIONS = {
    classes: ["dlo-loot", "dlo-shop"],
    window: { icon: "fa-solid fa-store", resizable: true },
    position: { width: 880, height: "auto" },
    actions: {
      add: ShopWindow.#onAdd,
      remove: ShopWindow.#onRemove,
      clear: ShopWindow.#onClear,
      deal: ShopWindow.#onDeal,
      configure: ShopWindow.#onConfigure,
      restock: ShopWindow.#onRestock,
      sheet: ShopWindow.#onSheet,
      show: ShopWindow.#onShow
    }
  };

  /** Les boutiques ouvertes, par clé de source. */
  static open = new Map();

  static show(source, looter, actions) {
    const existing = ShopWindow.open.get(source.key);
    if ( existing ) {
      if ( looter && (looter !== existing.looter) ) { existing.looter = looter; existing.#empty(); }
      existing.render({ force: true });
      return existing.bringToFront();
    }
    const app = new ShopWindow({ source, looter, actions });
    ShopWindow.open.set(source.key, app);
    return app.render({ force: true });
  }

  get title() {
    return loc("Shop.Title", { name: this.source.name });
  }

  /**
   * Le personnage qui commerce : celui du token qui agit — ou le personnage lui-même quand il n'a pas de token sur la
   * scène (boutique sans token) —, jamais le marchand.
   */
  get buyer() {
    const actor = (this.looter instanceof Actor) ? this.looter : (this.looter?.actor ?? null);
    return (actor && (actor !== this.source.actor)) ? actor : null;
  }

  /** Pourquoi on ne peut pas commercer maintenant (null : on peut). */
  #blocked() {
    if ( !this.buyer ) return loc("Window.NoLooter");
    if ( game.user.isGM ) return null;
    if ( merchantOf(this.source.actor).closed ) return loc("Shop.Closed");
    if ( this.source.distance(this.looter) > setting("reach") ) return loc("Shop.TooFar");
    return null;
  }

  #empty() {
    this.cart.buy.clear();
    this.cart.sell.clear();
  }

  #lines() {
    const list = map => [...map].map(([id, quantity]) => ({ id, quantity }));
    return { buy: list(this.cart.buy), sell: list(this.cart.sell) };
  }

  async _prepareContext() {
    const actor = this.source.actor;
    const merchant = merchantOf(actor);
    const gm = game.user.isGM;
    const buyer = this.buyer;
    const stock = stockView(actor, buyer, { gm });
    const mine = buyer ? waresView(buyer, actor, this.source.doc) : [];
    let deal = null;
    if ( buyer ) {
      deal = quote(actor, this.source.doc, buyer, this.#lines());
      // Le stock ou l'inventaire a bougé sous le panier : le panier suit ce qui est encore possible.
      if ( deal.changed ) {
        this.cart.buy = new Map(deal.buy.map(l => [l.id, l.quantity]));
        this.cart.sell = new Map(deal.sell.map(l => [l.id, l.quantity]));
      }
    }
    const description = merchant.description
      ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(merchant.description) : "";
    return { actor, merchant, gm, buyer, stock, mine, deal, description, blocked: this.#blocked() };
  }

  async _renderHTML(context) {
    const { merchant, gm, buyer, stock, mine, deal, blocked } = context;
    const root = document.createElement("div");
    root.className = "dlo-body dlo-shop-body";
    const off = blocked ? "dlo-off" : "";

    /** Une case d'inventaire ou d'étal : ce qui reste hors du plateau, le prix à l'unité. */
    const slot = (e, side) => {
      const taken = this.cart[side].get(e.id) ?? 0;
      const left = Number.isFinite(e.available) ? Math.max(0, e.quantity - taken) : null;
      const refused = (side === "sell") && (e.verdict === "refuse");
      const kept = (side === "buy") && e.notForSale;
      const classes = ["dlo-slot", "dlo-shop-slot"];
      if ( refused || kept ) classes.push("dlo-shop-no");
      if ( left === 0 ) classes.push("dlo-shop-out");
      if ( e.hidden ) classes.push("dlo-shop-hidden");
      const notes = [];
      if ( refused ) notes.push(loc("Shop.Refused"));
      if ( (side === "sell") && (e.verdict === "fence") ) notes.push(loc("Shop.Fenced"));
      if ( kept ) notes.push(loc("Shop.NotForSale"));
      if ( e.hidden ) notes.push(loc("Shop.Hidden"));
      const tip = `${escape(e.name)} — ${formatPrice(e.unit)}${notes.length ? `<br>${notes.join("<br>")}` : ""}`;
      const action = (refused || kept || (left === 0)) ? "" : `data-action="add"`;
      return `
        <li class="${classes.join(" ")}" ${action} data-side="${side}" data-item-id="${e.id}" data-tooltip="${escape(tip)}">
          <img src="${e.img}" alt="" draggable="false">
          ${(left === null) ? `<span class="dlo-qty">∞</span>` : ((left !== 1) ? `<span class="dlo-qty">${left}</span>` : "")}
          ${e.contents ? `<span class="dlo-inside"><i class="fa-solid fa-box-open"></i> ${e.contents}</span>` : ""}
          ${(side === "sell") && (e.verdict === "fence") ? `<span class="dlo-shop-badge"><i class="fa-solid fa-mask"></i></span>` : ""}
          ${kept ? `<span class="dlo-shop-badge"><i class="fa-solid fa-ban"></i></span>` : ""}
          ${e.hidden ? `<span class="dlo-shop-badge dlo-shop-badge-left"><i class="fa-solid fa-eye-slash"></i></span>` : ""}
          <span class="dlo-shop-price">${formatPrice(e.unit)}</span>
        </li>`;
    };
    /** Une ligne posée sur un plateau. */
    const tray = (lines, side) => lines.map(l => `
      <li class="dlo-slot dlo-shop-slot" data-action="remove" data-side="${side}" data-item-id="${l.id}"
          data-tooltip="${escape(`${escape(l.name)} — ${formatPrice(l.price)}`)}">
        <img src="${l.img}" alt="" draggable="false">
        ${(l.quantity > 1) ? `<span class="dlo-qty">${l.quantity}</span>` : ""}
        <span class="dlo-shop-price">${formatPrice(l.price)}</span>
      </li>`).join("");
    const purse = actor => {
      const coins = purseView(actor);
      return coins.length ? coins.map(c => `<span class="dlo-coin dlo-coin-${c.key}">${c.value} ${c.abbr}</span>`).join(" ") : `<span class="dlo-muted">—</span>`;
    };

    let balance = "";
    let warning = "";
    if ( deal ) {
      if ( deal.net > 0 ) balance = loc("Shop.YouPay", { price: formatPrice(deal.net) });
      else if ( deal.net < 0 ) balance = loc("Shop.YouEarn", { price: formatPrice(-deal.net) });
      else balance = loc("Shop.Even");
      if ( !deal.ok ) warning = loc(deal.reason === "playerFunds" ? "Shop.NoFunds" : "Shop.MerchantNoFunds");
    }
    const canDeal = !!deal && !blocked && deal.ok && !deal.empty;

    const gmBar = gm ? `
      <div class="dlo-shop-gm">
        <button type="button" data-action="configure"><i class="fa-solid fa-gear"></i> ${loc("Shop.Configure")}</button>
        <button type="button" data-action="restock"><i class="fa-solid fa-boxes-stacked"></i> ${loc("Shop.Restock")}</button>
        <button type="button" data-action="sheet"><i class="fa-solid fa-address-card"></i> ${loc("Shop.Sheet")}</button>
        <button type="button" data-action="show"><i class="fa-solid fa-eye"></i> ${loc("Shop.Show")}</button>
        <span class="dlo-hint">${loc("Shop.GMHint")}</span>
      </div>` : "";

    root.innerHTML = `
      <header class="dlo-shop-head">
        <img class="dlo-shop-portrait" src="${this.source.img ?? "icons/svg/mystery-man.svg"}" alt="">
        <div class="dlo-shop-about">
          <h2>${escape(this.source.name)}${merchant.closed ? ` <span class="dlo-shop-closed">${loc("Shop.ClosedTag")}</span>` : ""}</h2>
          <div class="dlo-shop-desc">${context.description}</div>
        </div>
      </header>
      ${gmBar}
      <div class="dlo-shop-cols">
        <section class="dlo-shop-col dlo-shop-mine ${off}">
          <h3>${buyer ? escape(buyer.name) : loc("Shop.NoBuyer")}</h3>
          ${mine.length ? `<ol class="dlo-grid">${mine.map(e => slot(e, "sell")).join("")}</ol>` : (buyer ? `<p class="dlo-empty">${loc("Shop.NothingToSell")}</p>` : "")}
          <div class="dlo-shop-purse">${buyer ? purse(buyer) : ""}</div>
        </section>
        <section class="dlo-shop-col dlo-shop-deal ${off}">
          <h3>${loc("Shop.YouGive")} <span class="dlo-shop-total">${deal ? formatPrice(deal.sellTotal) : ""}</span></h3>
          <ol class="dlo-grid dlo-shop-tray">${deal ? tray(deal.sell, "sell") : ""}</ol>
          <h3>${loc("Shop.YouGet")} <span class="dlo-shop-total">${deal ? formatPrice(deal.buyTotal) : ""}</span></h3>
          <ol class="dlo-grid dlo-shop-tray">${deal ? tray(deal.buy, "buy") : ""}</ol>
          <p class="dlo-shop-balance">${balance}</p>
          ${warning ? `<p class="dlo-blocked">${warning}</p>` : ""}
          ${blocked ? `<p class="dlo-blocked">${blocked}</p>` : ""}
          <footer class="dlo-foot dlo-shop-foot">
            <button type="button" data-action="clear" ${(!deal || deal.empty) ? "disabled" : ""}><i class="fa-solid fa-rotate-left"></i> ${loc("Shop.Clear")}</button>
            <button type="button" data-action="deal" ${canDeal ? "" : "disabled"}><i class="fa-solid fa-handshake"></i> ${loc("Shop.Deal")}</button>
          </footer>
        </section>
        <section class="dlo-shop-col dlo-shop-stock ${off}">
          <h3>${loc("Shop.Stall")}</h3>
          ${stock.length ? `<ol class="dlo-grid">${stock.map(e => slot(e, "buy")).join("")}</ol>` : `<p class="dlo-empty">${loc("Shop.EmptyStall")}</p>`}
          <div class="dlo-shop-purse">${merchant.infiniteCoins ? `<span class="dlo-muted">${loc("Shop.EndlessCoins")}</span>` : purse(context.actor)}</div>
        </section>
      </div>
      <p class="dlo-hint">${loc("Shop.Hint")}</p>`;
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    if ( !game.user.isGM ) return;
    // MJ : clic droit sur une marchandise — à vendre → exposée, pas à vendre → cachée des joueurs → à vendre.
    this.element.querySelectorAll(".dlo-shop-stock .dlo-shop-slot").forEach(li => {
      li.addEventListener("contextmenu", event => {
        event.preventDefault();
        const item = this.source.actor?.items.get(li.dataset.itemId);
        if ( !item ) return;
        const shop = item.getFlag(MODULE_ID, "shop") ?? {};
        const next = shop.hidden ? { hidden: false, notForSale: false }
          : (shop.notForSale ? { hidden: true, notForSale: false } : { hidden: false, notForSale: true });
        this.actions.flag(item, next);
      });
    });
  }

  _onClose(options) {
    super._onClose(options);
    ShopWindow.open.delete(this.source.key);
  }

  /** Après un changement du marchand ou du personnage : redessiner ; fermer si le marchand n'est plus là. */
  refresh() {
    if ( !this.source.exists() ) return this.close();
    return this.render();
  }

  /** Pose un exemplaire sur le plateau (Maj : tout ce qui reste). */
  static #onAdd(event, target) {
    if ( this.#blocked() ) return;
    const { side, itemId } = target.dataset;
    const entries = (side === "buy") ? stockView(this.source.actor, this.buyer) : waresView(this.buyer, this.source.actor, this.source.doc);
    const entry = entries.find(e => e.id === itemId);
    if ( !entry ) return;
    const now = this.cart[side].get(itemId) ?? 0;
    const max = Number.isFinite(entry.available) ? entry.available : now + 1;
    const next = event.shiftKey && Number.isFinite(entry.available) ? max : Math.min(now + 1, max);
    this.cart[side].set(itemId, next);
    return this.render();
  }

  /** Reprend un exemplaire du plateau (Maj : toute la ligne). */
  static #onRemove(event, target) {
    const { side, itemId } = target.dataset;
    const now = this.cart[side].get(itemId) ?? 0;
    if ( event.shiftKey || (now <= 1) ) this.cart[side].delete(itemId);
    else this.cart[side].set(itemId, now - 1);
    return this.render();
  }

  static #onClear() {
    this.#empty();
    return this.render();
  }

  static async #onDeal(event, target) {
    if ( this.#blocked() ) return;
    target.disabled = true;
    const done = await this.actions.deal(this.source, this.looter, this.#lines());
    if ( done ) {
      this.#empty();
      ui.notifications.info(loc("Shop.Done"));
    }
    return this.render();
  }

  static #onConfigure() {
    return this.actions.configure(this.source.actor);
  }

  static async #onRestock(event, target) {
    target.disabled = true;
    await this.actions.restock(this.source);
    return this.render();
  }

  static #onSheet() {
    this.source.actor?.sheet.render({ force: true });
  }

  static async #onShow(event, target) {
    target.disabled = true;
    try { await this.actions.show(this.source); }
    finally { if ( target.isConnected ) target.disabled = false; }
  }
}
