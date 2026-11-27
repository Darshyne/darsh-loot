/**
 * A merchant's shop (SPEC §3.7).
 *
 * Player side — a BG3-style barter: the character's inventory on the left, the stall on the right, the two trays in the middle (what
 * I give, what I get) and the balance; gold fills the gap. A click puts one copy on the tray (Shift: the whole stack), a click on the
 * tray takes it back. Icons or a list by category (`shopView`, per client), a search field, a right-click menu on every item
 * (details, add, steal).
 *
 * GM side (2026-11-27, user's request) — tabs: the stall to manage (drop items in, edit price and quantity, hide, lock against
 * restocks, remove), the barter when the GM trades for a character, the merchant's settings (apps/merchant-form.mjs), the sales and
 * theft log. Open / closed in the header.
 *
 * The window decides nothing: the cart is local, the quote (adapter/shop.mjs `quote`) is only shown; « Conclude » sends the cart to
 * the GM (`actions.deal`), who quotes again and carries it out. Every write is an action passed in (runtime/shop.mjs `SHOP_ACTIONS`).
 */
import { MODULE_ID, loc, setting, sceneSetting } from "../shared.mjs";
import { merchantOf, stockView, waresView, quote, formatPrice, purseView, shopOpenTo, salesLog } from "../adapter/shop.mjs";
import { byCategory, matchesSearch, parseGold, CP_PER } from "../core/shop.mjs";
import { escape, itemPicture, showItemInfo } from "./shop-parts.mjs";
import { merchantFormContext, merchantFormHTML, readMerchantForm, wireTables } from "./merchant-form.mjs";

const { ApplicationV2 } = foundry.applications.api;

/** The next stall state of an item, on the « visibility » button: for sale → shown, not for sale → hidden → for sale. */
const nextVisibility = shop => (shop.hidden ? { hidden: false, notForSale: false }
  : (shop.notForSale ? { hidden: true, notForSale: false } : { hidden: false, notForSale: true }));

/** Copper pieces → the gold the price field shows (« 12.5 »). */
const goldText = cp => String(Math.round(Number(cp) || 0) / CP_PER.gp);

export class ShopWindow extends ApplicationV2 {
  /**
   * @param {{ source: object, looter: TokenDocument|Actor|null, actions: object }} options
   *   `looter`: the token that acts, or the character's actor when it has no token on the scene; null for the GM managing the stall.
   */
  constructor({ source, looter, actions, ...options }) {
    super({ id: `${MODULE_ID}-${source.key}`, ...options });
    this.source = source;
    this.looter = looter;
    this.actions = actions;
    this.cart = { buy: new Map(), sell: new Map() };
    this.query = "";
    this.tab = null;          // GM: "stall", "trade", "settings", "log"
    this.tables = null;       // GM: restock tables being edited in the settings tab
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
      shopTab: ShopWindow.#onTab,
      view: ShopWindow.#onView,
      restock: ShopWindow.#onRestock,
      sheet: ShopWindow.#onSheet,
      show: ShopWindow.#onShow,
      link: ShopWindow.#onLink,
      toggleClosed: ShopWindow.#onToggleClosed,
      cycle: ShopWindow.#onCycle,
      lock: ShopWindow.#onLock,
      delete: ShopWindow.#onDelete,
      info: ShopWindow.#onInfo,
      sellableAll: ShopWindow.#onSellableAll,
      clearLog: ShopWindow.#onClearLog,
      removeTable: ShopWindow.#onRemoveTable,
      memorize: ShopWindow.#onMemorize
    }
  };

  /** The open shops, by source key. */
  static open = new Map();

  static show(source, looter, actions) {
    const existing = ShopWindow.open.get(source.key);
    if ( existing ) {
      if ( looter && (looter !== existing.looter) ) { existing.looter = looter; existing.#empty(); existing.tab = null; }
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

  /** The character who trades: the acting token's, or the character itself (shop without a token) — never the merchant. */
  get buyer() {
    const actor = (this.looter instanceof Actor) ? this.looter : (this.looter?.actor ?? null);
    return (actor && (actor !== this.source.actor)) ? actor : null;
  }

  get gm() {
    return game.user.isGM;
  }

  /** How this client shows the items: « grid » (icons) or « list » (by category). */
  get view() {
    return (setting("shopView") === "list") ? "list" : "grid";
  }

  /** Why one cannot trade now (null: one can). */
  #blocked() {
    if ( !this.buyer ) return loc("Window.NoLooter");
    if ( this.gm ) return null;
    const actor = this.source.actor;
    if ( merchantOf(actor).closed ) return loc("Shop.Closed");
    if ( this.source.doc.documentName === "Actor" ) return shopOpenTo(actor, game.user) ? null : loc("Shop.NotShown");
    if ( this.source.distance(this.looter) > sceneSetting("reach", this.looter?.parent) ) return loc("Shop.TooFar");
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

  /** The GM's current tab: the barter when trading for a character, else the stall. */
  #tab() {
    if ( !this.gm ) return "trade";
    const tabs = ["stall", "settings", "log", ...(this.buyer ? ["trade"] : [])];
    if ( !tabs.includes(this.tab) ) this.tab = this.buyer ? "trade" : "stall";
    return this.tab;
  }

  async _prepareContext() {
    const actor = this.source.actor;
    const merchant = merchantOf(actor);
    const gm = this.gm;
    const tab = this.#tab();
    const buyer = this.buyer;
    const stock = stockView(actor, (tab === "stall") ? null : buyer, { gm });
    const mine = buyer ? waresView(buyer, actor, this.source.doc) : [];
    let deal = null;
    if ( buyer ) {
      deal = quote(actor, this.source.doc, buyer, this.#lines());
      // The stock or the inventory moved under the cart: the cart follows what is still possible.
      if ( deal.changed ) {
        this.cart.buy = new Map(deal.buy.map(l => [l.id, l.quantity]));
        this.cart.sell = new Map(deal.sell.map(l => [l.id, l.quantity]));
      }
    }
    const description = merchant.description
      ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(merchant.description) : "";
    let form = null;
    if ( gm && (tab === "settings") ) {
      this.tables ??= merchant.tables.map(t => ({ ...t }));
      form = await merchantFormContext(actor, this.tables);
    }
    return { actor, merchant, gm, tab, buyer, stock, mine, deal, description, form, log: gm ? salesLog(actor) : [],
      blocked: this.#blocked() };
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** What the badges and the tooltip of an item say. */
  #notes(e, side) {
    const refused = (side === "sell") && (e.verdict === "refuse");
    const kept = (side === "buy") && (e.notForSale || e.stuck);
    const notes = [];
    if ( refused ) notes.push(loc("Shop.Refused"));
    if ( (side === "sell") && (e.verdict === "fence") ) notes.push(loc("Shop.Fenced"));
    if ( kept ) notes.push(loc(e.stuck ? "Shop.StuckNote" : "Shop.NotForSale"));
    if ( e.hidden ) notes.push(loc("Shop.Hidden"));
    if ( e.locked ) notes.push(loc("Shop.LockedNote"));
    if ( e.priceCp !== null && e.priceCp !== undefined ) notes.push(loc("Shop.FixedPriceNote"));
    return { refused, kept, notes };
  }

  #badges(e, side) {
    const { kept } = this.#notes(e, side);
    return [
      (side === "sell") && (e.verdict === "fence") ? `<i class="fa-solid fa-mask" data-tooltip="${loc("Shop.Fenced")}"></i>` : "",
      kept ? `<i class="fa-solid fa-ban dlo-warn"></i>` : "",
      e.hidden ? `<i class="fa-solid fa-eye-slash"></i>` : "",
      e.locked ? `<i class="fa-solid fa-lock"></i>` : "",
      ((e.priceCp ?? null) !== null) ? `<i class="fa-solid fa-tag"></i>` : ""
    ].join("");
  }

  /** How many are left out of the tray (null: endless). */
  #left(e, side) {
    const taken = this.cart[side].get(e.id) ?? 0;
    return Number.isFinite(e.available) ? Math.max(0, e.quantity - taken) : null;
  }

  /** One item of the inventory or of the stall, as an icon. */
  #slot(e, side, { manage=false }={}) {
    const left = manage ? (Number.isFinite(e.available) ? e.quantity : null) : this.#left(e, side);
    const { refused, kept, notes } = this.#notes(e, side);
    const classes = ["dlo-slot", "dlo-shop-slot", "dlo-shop-item"];
    if ( refused || kept ) classes.push("dlo-shop-no");
    if ( left === 0 ) classes.push("dlo-shop-out");
    if ( e.hidden ) classes.push("dlo-shop-hidden");
    const tip = `${escape(e.name)} — ${formatPrice(e.unit)}${notes.length ? `<br>${notes.join("<br>")}` : ""}`;
    const action = (manage || refused || kept || (left === 0)) ? "" : `data-action="add"`;
    return `
      <li class="${classes.join(" ")}" ${action} data-side="${side}" data-item-id="${e.id}" data-name="${escape(e.name)}"
          data-tooltip="${escape(tip)}" ${manage ? "draggable=\"true\"" : ""}>
        ${itemPicture(e.img)}
        ${(left === null) ? `<span class="dlo-qty">∞</span>` : ((left !== 1) ? `<span class="dlo-qty">${left}</span>` : "")}
        ${e.contents ? `<span class="dlo-inside"><i class="fa-solid fa-box-open"></i> ${e.contents}</span>` : ""}
        <span class="dlo-shop-badge">${this.#badges(e, side)}</span>
        <span class="dlo-shop-price">${formatPrice(e.unit)}</span>
      </li>`;
  }

  /** One item as a list row; `manage`: the GM's stall, with quantity and price fields. */
  #row(e, side, { manage=false }={}) {
    const left = manage ? (Number.isFinite(e.available) ? e.quantity : null) : this.#left(e, side);
    const { refused, kept, notes } = this.#notes(e, side);
    const classes = ["dlo-shop-row", "dlo-shop-item"];
    if ( refused || kept ) classes.push("dlo-shop-no");
    if ( left === 0 ) classes.push("dlo-shop-out");
    if ( e.hidden ) classes.push("dlo-shop-hidden");
    const action = (manage || refused || kept || (left === 0)) ? "" : `data-action="add"`;
    const tip = notes.length ? `data-tooltip="${escape(notes.join("<br>"))}"` : "";
    const qty = (left === null) ? "∞" : left;
    if ( !manage ) {
      return `
        <li class="${classes.join(" ")}" ${action} data-side="${side}" data-item-id="${e.id}" data-name="${escape(e.name)}" ${tip}>
          ${itemPicture(e.img)}
          <span class="dlo-row-name">${escape(e.name)}${e.contents ? ` <span class="dlo-muted">(${e.contents})</span>` : ""}
            <span class="dlo-shop-badge">${this.#badges(e, side)}</span></span>
          <span class="dlo-row-qty">${qty}</span>
          <span class="dlo-row-price">${formatPrice(e.unit)}</span>
        </li>`;
    }
    const shown = e.hidden ? "fa-eye-slash" : (e.notForSale ? "fa-ban" : "fa-eye");
    const shownTip = loc(e.hidden ? "Shop.Hidden" : (e.notForSale ? "Shop.NotForSale" : "Shop.ForSale"));
    const fixed = (e.priceCp ?? null) !== null;
    return `
      <li class="${classes.join(" ")} dlo-shop-manage" data-side="buy" data-item-id="${e.id}" data-name="${escape(e.name)}" draggable="true" ${tip}>
        ${itemPicture(e.img)}
        <span class="dlo-row-name">${escape(e.name)}${e.contents ? ` <span class="dlo-muted">(${e.contents})</span>` : ""}
          <span class="dlo-shop-badge">${e.stuck ? `<i class="fa-solid fa-ban dlo-warn" data-tooltip="${escape(loc("Shop.StuckNote"))}"></i>` : ""}</span></span>
        <input type="number" class="dlo-row-qty-input" min="0" step="1" value="${e.quantity}" data-tooltip="${loc("Shop.Quantity")}"
          ${Number.isFinite(e.available) ? "" : "disabled"}>
        <span class="dlo-row-price-field ${fixed ? "dlo-fixed" : ""}">
          <input type="text" class="dlo-row-price-input" value="${fixed ? goldText(e.priceCp) : ""}" placeholder="${fixed ? "" : goldText(e.unit)}"
            data-tooltip="${escape(loc("Shop.PriceHint", { price: formatPrice(e.unit) }))}">
          <span class="dlo-muted">${loc("Shop.GoldAbbr")}</span>
        </span>
        <span class="dlo-row-tools">
          <button type="button" data-action="cycle" class="${e.hidden || e.notForSale ? "dlo-on" : ""}" data-tooltip="${shownTip}"><i class="fa-solid ${shown}"></i></button>
          <button type="button" data-action="lock" class="${e.locked ? "dlo-on" : ""}" data-tooltip="${loc(e.locked ? "Shop.LockedNote" : "Shop.LockHint")}"><i class="fa-solid ${e.locked ? "fa-lock" : "fa-lock-open"}"></i></button>
          <button type="button" data-action="delete" data-tooltip="${loc("Shop.RemoveItem")}"><i class="fa-solid fa-trash"></i></button>
        </span>
      </li>`;
  }

  /** A column's items, in the client's view; empty text when there are none. */
  #items(entries, side, empty, options={}) {
    if ( !entries.length ) return `<p class="dlo-empty">${empty}</p>`;
    if ( this.view === "grid" ) return `<ol class="dlo-grid">${entries.map(e => this.#slot(e, side, options)).join("")}</ol>`;
    return byCategory(entries).map(group => `
      <section class="dlo-shop-category" data-category="${group.type}">
        <h4>${escape(game.i18n.localize(CONFIG.Item.typeLabels?.[group.type] ?? group.type))} <span class="dlo-muted">${group.entries.length}</span></h4>
        <ol class="dlo-shop-list">${group.entries.map(e => this.#row(e, side, options)).join("")}</ol>
      </section>`).join("");
  }

  /** A line on a tray. */
  #tray(lines, side) {
    return lines.map(l => `
      <li class="dlo-slot dlo-shop-slot" data-action="remove" data-side="${side}" data-item-id="${l.id}"
          data-tooltip="${escape(`${escape(l.name)} — ${formatPrice(l.price)}`)}">
        ${itemPicture(l.img)}
        ${(l.quantity > 1) ? `<span class="dlo-qty">${l.quantity}</span>` : ""}
        <span class="dlo-shop-price">${formatPrice(l.price)}</span>
      </li>`).join("");
  }

  #purse(actor) {
    const coins = purseView(actor);
    return coins.length ? coins.map(c => `<span class="dlo-coin dlo-coin-${c.key}">${c.value} ${c.abbr}</span>`).join(" ") : `<span class="dlo-muted">—</span>`;
  }

  /** Search field and view switch. */
  #toolbar() {
    return `
      <div class="dlo-shop-tools">
        <label class="dlo-shop-search"><i class="fa-solid fa-magnifying-glass"></i>
          <input type="search" value="${escape(this.query)}" placeholder="${loc("Shop.Search")}" aria-label="${loc("Shop.Search")}"></label>
        <span class="dlo-shop-views">
          <button type="button" data-action="view" data-view="grid" class="${this.view === "grid" ? "dlo-on" : ""}" data-tooltip="${loc("Shop.ViewGrid")}"><i class="fa-solid fa-table-cells"></i></button>
          <button type="button" data-action="view" data-view="list" class="${this.view === "list" ? "dlo-on" : ""}" data-tooltip="${loc("Shop.ViewList")}"><i class="fa-solid fa-list"></i></button>
        </span>
      </div>`;
  }

  /** The barter: inventory, trays, stall. */
  #trade(context) {
    const { merchant, buyer, stock, mine, deal, blocked } = context;
    const off = blocked ? "dlo-off" : "";
    let balance = "";
    let warning = "";
    if ( deal ) {
      if ( deal.net > 0 ) balance = loc("Shop.YouPay", { price: formatPrice(deal.net) });
      else if ( deal.net < 0 ) balance = loc("Shop.YouEarn", { price: formatPrice(-deal.net) });
      else balance = loc("Shop.Even");
      if ( !deal.ok ) warning = loc(deal.reason === "playerFunds" ? "Shop.NoFunds" : "Shop.MerchantNoFunds");
    }
    const canDeal = !!deal && !blocked && deal.ok && !deal.empty;
    return `
      ${this.#toolbar()}
      <div class="dlo-shop-cols dlo-shop-view-${this.view}">
        <section class="dlo-shop-col dlo-shop-mine ${off}">
          <h3>${buyer ? escape(buyer.name) : loc("Shop.NoBuyer")}</h3>
          <div class="dlo-shop-scroll">${buyer ? this.#items(mine, "sell", loc("Shop.NothingToSell")) : ""}</div>
          <div class="dlo-shop-purse">${buyer ? this.#purse(buyer) : ""}</div>
        </section>
        <section class="dlo-shop-col dlo-shop-deal ${off}">
          <h3>${loc("Shop.YouGive")} <span class="dlo-shop-total">${deal ? formatPrice(deal.sellTotal) : ""}</span></h3>
          <ol class="dlo-grid dlo-shop-tray">${deal ? this.#tray(deal.sell, "sell") : ""}</ol>
          <h3>${loc("Shop.YouGet")} <span class="dlo-shop-total">${deal ? formatPrice(deal.buyTotal) : ""}</span></h3>
          <ol class="dlo-grid dlo-shop-tray">${deal ? this.#tray(deal.buy, "buy") : ""}</ol>
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
          <div class="dlo-shop-scroll">${this.#items(stock, "buy", loc("Shop.EmptyStall"))}</div>
          <div class="dlo-shop-purse">${merchant.infiniteCoins ? `<span class="dlo-muted">${loc("Shop.EndlessCoins")}</span>` : this.#purse(context.actor)}</div>
        </section>
      </div>
      <p class="dlo-hint">${loc("Shop.Hint")}</p>`;
  }

  /** GM: the stall to manage, full width. */
  #stall(context) {
    const { merchant, stock } = context;
    // Items the merchant cannot hand over (NPC items without the « Gear » property, e.g. created with the actor): players never see
    // them; one button makes them all sellable.
    const stuck = stock.filter(e => e.stuck).length;
    return `
      ${stuck ? `<p class="dlo-shop-stuck"><i class="fa-solid fa-triangle-exclamation"></i> ${loc("Shop.StuckCount", { count: stuck })}
        <button type="button" data-action="sellableAll"><i class="fa-solid fa-screwdriver-wrench"></i> ${loc("Shop.MakeAllSellable")}</button></p>` : ""}
      ${this.#toolbar()}
      <section class="dlo-shop-col dlo-shop-stock dlo-shop-managed dlo-shop-view-${this.view}">
        <h3>${loc("Shop.Stall")} <span class="dlo-muted">${stock.length}</span></h3>
        <div class="dlo-shop-scroll">${this.#items(stock, "buy", loc("Shop.EmptyStall"), { manage: true })}</div>
        <div class="dlo-shop-dropzone"><i class="fa-solid fa-download"></i> ${loc("Shop.DropHere")}</div>
        <div class="dlo-shop-purse">${merchant.infiniteCoins ? `<span class="dlo-muted">${loc("Shop.EndlessCoins")}</span>` : this.#purse(context.actor)}</div>
      </section>
      <p class="dlo-hint">${loc("Shop.GMHint")}</p>`;
  }

  /** GM: the sales and theft log, newest first. */
  #log(context) {
    const lines = [...context.log].reverse();
    if ( !lines.length ) return `<p class="dlo-empty">${loc("Shop.LogEmpty")}</p>`;
    const when = l => new Date(l.time).toLocaleString(game.i18n.lang, { dateStyle: "short", timeStyle: "short" });
    const what = l => {
      if ( l.kind === "theft" ) return `<i class="fa-solid fa-hand"></i> ${loc("Shop.LogTheft", { item: escape(l.item) })}`;
      if ( l.kind === "caught" ) return `<i class="fa-solid fa-hand dlo-warn"></i> ${loc("Shop.LogCaught", { item: escape(l.item) })}`;
      const parts = [];
      if ( l.bought?.length ) parts.push(loc("Shop.ChatBought", { what: l.bought.map(escape).join(", "), price: formatPrice(l.paid ?? 0) }));
      if ( l.sold?.length ) parts.push(loc("Shop.ChatSold", { what: l.sold.map(escape).join(", "), price: formatPrice(l.earned ?? 0) }));
      return `<i class="fa-solid fa-handshake"></i> ${parts.join(" · ")}`;
    };
    const net = l => ((l.kind !== "deal") || !l.net) ? "" : ((l.net > 0) ? `+${formatPrice(l.net)}` : `−${formatPrice(-l.net)}`);
    return `
      <table class="dlo-shop-log">
        <tr><th>${loc("Shop.LogWhen")}</th><th>${loc("Shop.LogWho")}</th><th>${loc("Shop.LogWhat")}</th><th>${loc("Shop.LogTill")}</th></tr>
        ${lines.map(l => `<tr class="dlo-log-${l.kind}"><td>${when(l)}</td><td>${escape(l.who)}${l.user ? ` <span class="dlo-muted">(${escape(l.user)})</span>` : ""}</td>
          <td>${what(l)}</td><td>${net(l)}</td></tr>`).join("")}
      </table>
      <footer class="dlo-foot"><button type="button" data-action="clearLog"><i class="fa-solid fa-eraser"></i> ${loc("Shop.LogClear")}</button></footer>`;
  }

  async _renderHTML(context) {
    const { merchant, gm, tab } = context;
    const root = document.createElement("div");
    root.className = `dlo-body dlo-shop-body ${gm ? "dlo-shop-gm-mode" : ""}`;
    const closed = merchant.closed;
    const status = gm
      ? `<button type="button" class="dlo-shop-status ${closed ? "dlo-closed" : "dlo-open"}" data-action="toggleClosed" data-tooltip="${loc("Shop.ToggleShop")}">
          <i class="fa-solid ${closed ? "fa-door-closed" : "fa-door-open"}"></i> ${loc(closed ? "Shop.StatusClosed" : "Shop.StatusOpen")}</button>`
      : (closed ? `<span class="dlo-shop-closed">${loc("Shop.ClosedTag")}</span>` : "");
    const gmBar = gm ? `
      <div class="dlo-shop-gm">
        <nav class="dlo-shop-tabs">
          <button type="button" data-action="shopTab" data-tab="stall" class="${tab === "stall" ? "dlo-on" : ""}"><i class="fa-solid fa-boxes-stacked"></i> ${loc("Shop.TabStall")}</button>
          ${context.buyer ? `<button type="button" data-action="shopTab" data-tab="trade" class="${tab === "trade" ? "dlo-on" : ""}"><i class="fa-solid fa-handshake"></i> ${loc("Shop.TabTrade", { name: escape(context.buyer.name) })}</button>` : ""}
          <button type="button" data-action="shopTab" data-tab="settings" class="${tab === "settings" ? "dlo-on" : ""}"><i class="fa-solid fa-gear"></i> ${loc("Shop.Configure")}</button>
          <button type="button" data-action="shopTab" data-tab="log" class="${tab === "log" ? "dlo-on" : ""}"><i class="fa-solid fa-book"></i> ${loc("Shop.TabLog")}</button>
        </nav>
        <span class="dlo-shop-gm-tools">
          <button type="button" data-action="restock" data-tooltip="${loc("Shop.Restock")}"><i class="fa-solid fa-rotate"></i></button>
          <button type="button" data-action="show" data-tooltip="${loc("Shop.Show")}"><i class="fa-solid fa-eye"></i></button>
          <button type="button" data-action="link" data-tooltip="${loc("Shop.Link")}"><i class="fa-solid fa-link"></i></button>
          <button type="button" data-action="sheet" data-tooltip="${loc("Shop.Sheet")}"><i class="fa-solid fa-address-card"></i></button>
        </span>
      </div>` : "";
    let body;
    // A closed shop shows its players a closed door, not its stall (user's request, 2026-11-27); it opens again with the shop.
    if ( !gm && closed ) {
      this.#empty();
      body = `<div class="dlo-shop-shut"><i class="fa-solid fa-door-closed"></i>
        <p class="dlo-shop-shut-title">${loc("Shop.ShutTitle")}</p><p>${loc("Shop.ShutText")}</p></div>`;
    }
    else if ( tab === "stall" ) body = this.#stall(context);
    else if ( tab === "settings" ) body = `<form class="dlo-shop-settings dlo-merchant-config">${merchantFormHTML(context.form)}
        <footer class="dlo-foot"><button type="submit"><i class="fa-solid fa-floppy-disk"></i> ${loc("Merchant.Save")}</button></footer></form>`;
    else if ( tab === "log" ) body = this.#log(context);
    else body = this.#trade(context);

    root.innerHTML = `
      <header class="dlo-shop-head">
        ${itemPicture(this.source.img ?? "icons/svg/mystery-man.svg", "dlo-shop-portrait")}
        <div class="dlo-shop-about">
          <h2>${escape(this.source.name)} ${status}</h2>
          <div class="dlo-shop-desc">${context.description}</div>
        </div>
      </header>
      ${gmBar}
      <div class="dlo-shop-tab dlo-shop-tab-${tab}">${body}</div>`;
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  /* -------------------------------------------- */
  /*  Listeners                                   */
  /* -------------------------------------------- */

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    // The item menu, on a right click: the shop's own (no image under the pointer, see apps/shop-parts.mjs).
    this._createContextMenu(() => this.#menu(), ".dlo-shop-item[data-item-id]", { hookName: "getShopWindowItemOptions",
      parentClassHooks: false, fixed: true });
    // GM: items (and roll tables) dropped anywhere on the window go to the stall (or to its restock tables).
    this.element.addEventListener("dragover", event => { if ( this.gm ) event.preventDefault(); });
    this.element.addEventListener("drop", event => this.#onDrop(event));
    this.element.addEventListener("dragstart", event => {
      const li = event.target.closest?.(".dlo-shop-item[draggable]");
      const item = li && this.source.actor?.items.get(li.dataset.itemId);
      if ( item ) event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
    });
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    // Search: filters what is shown without drawing the window again (the field keeps its focus).
    const search = el.querySelector(".dlo-shop-search input");
    search?.addEventListener("input", () => { this.query = search.value; this.#filter(); });
    this.#filter();
    if ( !this.gm ) return;
    // GM, stall list: quantity and price typed in place.
    el.querySelectorAll(".dlo-row-qty-input").forEach(input => input.addEventListener("change", () => {
      const item = this.#item(input);
      if ( item ) this.actions.quantity(item, input.value);
    }));
    el.querySelectorAll(".dlo-row-price-input").forEach(input => input.addEventListener("change", () => {
      const item = this.#item(input);
      const cp = parseGold(input.value);
      if ( Number.isNaN(cp) ) { ui.notifications.warn(loc("Shop.BadPrice")); input.value = ""; return; }
      if ( item ) this.actions.price(item, cp);
    }));
    el.querySelectorAll(".dlo-row-qty-input, .dlo-row-price-input").forEach(input => input.addEventListener("keydown", event => {
      if ( event.key === "Enter" ) { event.preventDefault(); input.blur(); }
    }));
    // GM, settings tab: the shared form.
    const form = el.querySelector("form.dlo-shop-settings");
    if ( form ) {
      wireTables(form, this.tables, () => this.render());
      form.addEventListener("submit", event => this.#onSave(event, form));
    }
  }

  /** Hide what does not match the search, and the categories left empty. */
  #filter() {
    const el = this.element;
    if ( !el ) return;
    el.querySelectorAll(".dlo-shop-scroll .dlo-shop-item").forEach(li => { li.hidden = !matchesSearch(li.dataset.name, this.query); });
    el.querySelectorAll(".dlo-shop-category").forEach(sec => { sec.hidden = !sec.querySelector(".dlo-shop-item:not([hidden])"); });
  }

  /** The merchant's item an element belongs to. */
  #item(el) {
    const id = el.closest?.("[data-item-id]")?.dataset.itemId;
    return id ? (this.source.actor?.items.get(id) ?? null) : null;
  }

  /** The item an element of either column belongs to (the character's on the « sell » side). */
  #anyItem(li) {
    const id = li.dataset.itemId;
    return (li.dataset.side === "sell") ? (this.buyer?.items.get(id) ?? null) : (this.source.actor?.items.get(id) ?? null);
  }

  /** The stall entry of an item, as the window shows it (price for the current buyer). */
  #entry(li) {
    const side = li.dataset.side;
    const list = (side === "sell") ? (this.buyer ? waresView(this.buyer, this.source.actor, this.source.doc) : [])
      : stockView(this.source.actor, (this.tab === "stall") ? null : this.buyer, { gm: this.gm });
    return list.find(e => e.id === li.dataset.itemId) ?? null;
  }

  /** The right-click menu of an item (player and GM), built once; each entry says when it shows. */
  #menu() {
    const gm = () => this.gm;
    const stall = li => li.dataset.side === "buy";
    const shopFlags = li => this.#item(li)?.getFlag(MODULE_ID, "shop") ?? {};
    const canAdd = li => (this.#tab() === "trade") && !!li.dataset.action;
    return [
      { label: "DLO.Shop.Details", icon: "<i class=\"fa-solid fa-circle-info\"></i>",
        onClick: (event, li) => this.#info(li) },
      { label: "DLO.Shop.AddOne", icon: "<i class=\"fa-solid fa-plus\"></i>", visible: canAdd,
        onClick: (event, li) => this.#add(li.dataset.side, li.dataset.itemId, false) },
      { label: "DLO.Shop.AddAll", icon: "<i class=\"fa-solid fa-angles-right\"></i>", visible: canAdd,
        onClick: (event, li) => this.#add(li.dataset.side, li.dataset.itemId, true) },
      { label: "DLO.Shop.Steal", icon: "<i class=\"fa-solid fa-hand\"></i>",
        visible: li => !gm() && stall(li) && (this.source.doc.documentName === "Token") && (setting("pickpocket") !== "off"),
        onClick: (event, li) => this.actions.steal(this.source, this.looter, li.dataset.itemId) },
      { label: "DLO.Shop.ItemSheet", icon: "<i class=\"fa-solid fa-pen-to-square\"></i>", visible: li => gm() && stall(li),
        onClick: (event, li) => this.#item(li)?.sheet.render({ force: true }) },
      { label: "DLO.Shop.SetPrice", icon: "<i class=\"fa-solid fa-tag\"></i>", visible: li => gm() && stall(li),
        onClick: (event, li) => this.#askPrice(li) },
      { label: "DLO.Shop.AutoPrice", icon: "<i class=\"fa-solid fa-calculator\"></i>",
        visible: li => gm() && stall(li) && Number.isFinite(shopFlags(li).price),
        onClick: (event, li) => this.actions.price(this.#item(li), null) },
      { label: "DLO.Shop.SetQuantity", icon: "<i class=\"fa-solid fa-hashtag\"></i>", visible: li => gm() && stall(li),
        onClick: (event, li) => this.#askQuantity(li) },
      { label: "DLO.Shop.ForSale", icon: "<i class=\"fa-solid fa-eye\"></i>",
        visible: li => gm() && stall(li) && (shopFlags(li).hidden || shopFlags(li).notForSale),
        onClick: (event, li) => this.actions.flag(this.#item(li), { hidden: false, notForSale: false }) },
      { label: "DLO.Shop.MarkNotForSale", icon: "<i class=\"fa-solid fa-ban\"></i>",
        visible: li => gm() && stall(li) && !shopFlags(li).notForSale,
        onClick: (event, li) => this.actions.flag(this.#item(li), { hidden: false, notForSale: true }) },
      { label: "DLO.Shop.HideItem", icon: "<i class=\"fa-solid fa-eye-slash\"></i>",
        visible: li => gm() && stall(li) && !shopFlags(li).hidden,
        onClick: (event, li) => this.actions.flag(this.#item(li), { hidden: true, notForSale: false }) },
      { label: "DLO.Shop.Lock", icon: "<i class=\"fa-solid fa-lock\"></i>", visible: li => gm() && stall(li) && !shopFlags(li).locked,
        onClick: (event, li) => this.actions.flag(this.#item(li), { locked: true }) },
      { label: "DLO.Shop.Unlock", icon: "<i class=\"fa-solid fa-lock-open\"></i>", visible: li => gm() && stall(li) && !!shopFlags(li).locked,
        onClick: (event, li) => this.actions.flag(this.#item(li), { locked: false }) },
      { label: "DLO.Shop.MakeSellable", icon: "<i class=\"fa-solid fa-screwdriver-wrench\"></i>",
        visible: li => gm() && stall(li) && !!this.#entry(li)?.stuck,
        onClick: (event, li) => this.actions.sellable(this.#item(li)) },
      { label: "DLO.Shop.RemoveItem", icon: "<i class=\"fa-solid fa-trash\"></i>", visible: li => gm() && stall(li),
        onClick: (event, li) => this.actions.remove(this.#item(li)) }
    ];
  }

  async #info(li) {
    const item = this.#anyItem(li);
    const entry = this.#entry(li);
    if ( !item ) return;
    return showItemInfo(item, { price: entry ? formatPrice(entry.unit) : "", quantity: Number.isFinite(entry?.available) ? entry.quantity : null });
  }

  /** GM: a small window to type the price (gold); empty → the automatic price. */
  async #askPrice(li) {
    const item = this.#item(li);
    const entry = this.#entry(li);
    if ( !item ) return;
    const now = Number.isFinite(item.getFlag(MODULE_ID, "shop")?.price) ? goldText(item.getFlag(MODULE_ID, "shop").price) : "";
    const value = await foundry.applications.api.DialogV2.prompt({
      window: { title: loc("Shop.SetPriceTitle", { name: item.name }), icon: "fa-solid fa-tag" },
      content: `<p>${loc("Shop.SetPriceAsk", { price: entry ? formatPrice(entry.unit) : "" })}</p>
        <input type="text" name="price" value="${now}" placeholder="${(entry && !now) ? goldText(entry.unit) : ""}" autofocus>`,
      ok: { label: loc("Merchant.Save"), callback: (event, button) => button.form.elements.price.value },
      rejectClose: false
    }).catch(() => null);
    if ( (value === null) || (value === undefined) ) return;
    const cp = parseGold(value);
    if ( Number.isNaN(cp) ) return ui.notifications.warn(loc("Shop.BadPrice"));
    return this.actions.price(item, cp);
  }

  /** GM: a small window to type the quantity. */
  async #askQuantity(li) {
    const item = this.#item(li);
    if ( !item ) return;
    const value = await foundry.applications.api.DialogV2.prompt({
      window: { title: loc("Shop.SetQuantityTitle", { name: item.name }), icon: "fa-solid fa-hashtag" },
      content: `<input type="number" name="quantity" min="0" step="1" value="${item.system.quantity ?? 0}" autofocus>`,
      ok: { label: loc("Merchant.Save"), callback: (event, button) => button.form.elements.quantity.value },
      rejectClose: false
    }).catch(() => null);
    if ( (value === null) || (value === undefined) || (value === "") ) return;
    return this.actions.quantity(item, value);
  }

  /** GM: what is dropped on the window — items (one, a folder of them) go to the stall, a roll table to the restock tables. */
  async #onDrop(event) {
    if ( !this.gm ) return;
    event.preventDefault();
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const actor = this.source.actor;
    if ( !data?.type || !actor ) return;
    if ( data.type === "RollTable" ) {
      const merchant = merchantOf(actor);
      if ( !data.uuid || merchant.tables.some(t => t.uuid === data.uuid) ) return;
      await this.actions.save(actor, { ...actor.getFlag(MODULE_ID, "merchant"), tables: [...merchant.tables, { uuid: data.uuid, rolls: "1" }] });
      this.tables = null;
      return ui.notifications.info(loc("Shop.TableAdded"));
    }
    let items = [];
    if ( data.type === "Item" ) {
      const item = await Item.implementation.fromDropData(data).catch(() => null);
      if ( item && (item.parent !== actor) ) items = [item];
    } else if ( (data.type === "Folder") && data.uuid ) {
      const folder = await fromUuid(data.uuid).catch(() => null);
      if ( folder?.type === "Item" ) items = folder.contents;
    }
    if ( !items.length ) return;
    const names = await this.actions.add(actor, items.map(i => i.toObject()));
    if ( names?.length ) ui.notifications.info(loc("Shop.Added", { names: names.join(", ") }));
  }

  /** GM, settings tab: save the form. */
  async #onSave(event, form) {
    event.preventDefault();
    const data = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(form).object);
    const { flag, name } = readMerchantForm(data, this.tables);
    await this.actions.save(this.source.actor, flag, name, (this.source.doc.documentName === "Token") ? this.source.doc : null);
    this.tables = null;
    ui.notifications.info(loc("Shop.Saved", { name: name || this.source.name }));
    return this.render();
  }

  _onClose(options) {
    super._onClose(options);
    ShopWindow.open.delete(this.source.key);
  }

  /** After a change of the merchant or of the character: draw again; close if the merchant is gone. */
  refresh() {
    if ( !this.source.exists() ) return this.close();
    // The settings form is not drawn again under the GM's typing (it is read when saved).
    if ( this.gm && (this.tab === "settings") && this.element?.querySelector("form.dlo-shop-settings")?.contains(document.activeElement) ) return null;
    return this.render();
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** Put one copy on the tray (all that is left with `all`). */
  #add(side, itemId, all) {
    if ( this.#blocked() ) return;
    const entries = (side === "buy") ? stockView(this.source.actor, this.buyer) : waresView(this.buyer, this.source.actor, this.source.doc);
    const entry = entries.find(e => e.id === itemId);
    if ( !entry ) return;
    const now = this.cart[side].get(itemId) ?? 0;
    const max = Number.isFinite(entry.available) ? entry.available : now + 1;
    const next = all && Number.isFinite(entry.available) ? max : Math.min(now + 1, max);
    this.cart[side].set(itemId, next);
    return this.render();
  }

  /** Put one copy on the tray (Shift: all that is left). */
  static #onAdd(event, target) {
    return this.#add(target.dataset.side, target.dataset.itemId, event.shiftKey);
  }

  /** Take one copy back from the tray (Shift: the whole line). */
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

  static #onTab(event, target) {
    this.tab = target.dataset.tab;
    if ( this.tab !== "settings" ) this.tables = null;
    return this.render();
  }

  static async #onView(event, target) {
    await game.settings.set(MODULE_ID, "shopView", target.dataset.view);
    for ( const app of ShopWindow.open.values() ) app.render();
  }

  static async #onRestock(event, target) {
    target.disabled = true;
    try { await this.actions.restock(this.source); }
    finally { if ( target.isConnected ) target.disabled = false; }
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

  static #onLink() {
    return this.actions.link(this.source);
  }

  static #onToggleClosed() {
    return this.actions.toggleClosed(this.source.actor);
  }

  static #onCycle(event, target) {
    const item = this.#item(target);
    if ( item ) return this.actions.flag(item, nextVisibility(item.getFlag(MODULE_ID, "shop") ?? {}));
  }

  static #onLock(event, target) {
    const item = this.#item(target);
    if ( item ) return this.actions.flag(item, { locked: !item.getFlag(MODULE_ID, "shop")?.locked });
  }

  static #onDelete(event, target) {
    const item = this.#item(target);
    if ( item ) return this.actions.remove(item);
  }

  static async #onSellableAll(event, target) {
    target.disabled = true;
    const ids = stockView(this.source.actor, null, { gm: true }).filter(e => e.stuck).map(e => e.id);
    for ( const id of ids ) {
      const item = this.source.actor.items.get(id);
      if ( item ) await this.actions.sellable(item);
    }
  }

  static #onInfo(event, target) {
    const li = target.closest("[data-item-id]");
    if ( li ) return this.#info(li);
  }

  static async #onClearLog() {
    await this.actions.clearLog(this.source.actor);
  }

  static #onRemoveTable(event, target) {
    this.tables?.splice(Number(target.dataset.index), 1);
    return this.render();
  }

  static async #onMemorize() {
    const count = await this.actions.memorize(this.source.actor);
    ui.notifications.info(loc("Merchant.Memorized", { count }));
  }
}
