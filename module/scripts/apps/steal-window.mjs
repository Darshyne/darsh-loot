/**
 * Fenêtre du vol à la tire (SPEC §3.3) : ce que la victime a sur elle, la difficulté de chaque objet (jamais le DD),
 * ce qui est porté (impossible) et ce qui a déjà été tenté. Un clic tente le vol : `onSteal` reçue à l'ouverture.
 */
import { MODULE_ID, loc, setting } from "../shared.mjs";
import { pocketView } from "../adapter/theft.mjs";

const { ApplicationV2 } = foundry.applications.api;
const escape = s => foundry.utils.escapeHTML(String(s ?? ""));

export class StealWindow extends ApplicationV2 {
  constructor({ source, thief, onSteal, ...options }) {
    super({ id: `${MODULE_ID}-${source.key}`, ...options });
    this.source = source;
    this.thief = thief;
    this.onSteal = onSteal;
    this.busy = false;
  }

  static DEFAULT_OPTIONS = {
    classes: ["dlo-loot", "dlo-steal"],
    window: { icon: "fa-solid fa-hand-sparkles", resizable: true },
    position: { width: 360, height: "auto" },
    actions: { steal: StealWindow.#onSteal }
  };

  static open = new Map();

  static show(source, thief, onSteal) {
    const existing = StealWindow.open.get(source.key);
    if ( existing ) {
      existing.thief = thief ?? existing.thief;
      existing.render({ force: true });
      return existing.bringToFront();
    }
    const app = new StealWindow({ source, thief, onSteal });
    StealWindow.open.set(source.key, app);
    return app.render({ force: true });
  }

  get title() {
    return loc("Steal.Title", { name: this.source.name });
  }

  #blocked() {
    if ( !this.thief?.actor ) return loc("Window.NoLooter");
    if ( game.combat?.started ) return loc("Steal.InCombat");
    if ( this.source.distance(this.thief) > setting("reach") ) return loc("Refus.Loin");
    return null;
  }

  async _prepareContext() {
    const view = pocketView(this.source.actor, this.thief?.actor?.id ?? "");
    return { ...view, blocked: this.#blocked(), thiefName: this.thief?.name ?? "" };
  }

  async _renderHTML(context) {
    const root = document.createElement("div");
    root.className = "dlo-body";
    const slot = e => {
      const state = !e.possible ? "worn" : e.tried ? "tried" : "open";
      const label = !e.possible ? loc("Steal.Worn") : e.tried ? loc("Steal.Tried") : loc(`Steal.Difficulty.${e.difficulty}`);
      return `<li class="dlo-slot dlo-steal-${state} dlo-diff-${e.difficulty ?? "none"}" ${state === "open" ? `data-action="steal"` : ""}
        data-item-id="${e.id}" data-tooltip="${escape(e.name)} — ${escape(label)}">
        <img src="${e.img}" alt="" draggable="false">
        ${(e.quantity > 1) ? `<span class="dlo-qty">${e.quantity}</span>` : ""}
        <span class="dlo-diff"></span>
      </li>`;
    };
    const purse = context.purse ? (() => {
      const p = context.purse;
      const state = p.tried ? "tried" : "open";
      const label = p.tried ? loc("Steal.Tried") : loc(`Steal.Difficulty.${p.difficulty}`);
      return `<li class="dlo-slot dlo-steal-${state} dlo-diff-${p.difficulty}" ${state === "open" ? `data-action="steal"` : ""}
        data-item-id="coins" data-tooltip="${loc("Steal.Purse")} — ${escape(label)}">
        <img src="icons/containers/bags/coinpouch-simple-tan.webp" alt="" draggable="false"><span class="dlo-diff"></span></li>`;
    })() : "";
    const disabled = (context.blocked || this.busy) ? "disabled" : "";
    const empty = !context.entries.length && !context.purse;
    root.innerHTML = `
      <p class="dlo-to">${context.thiefName ? loc("Steal.By", { name: escape(context.thiefName) }) : ""}</p>
      ${context.alert ? `<p class="dlo-blocked"><i class="fa-solid fa-eye"></i> ${loc("Steal.Alert")}</p>` : ""}
      ${empty ? `<p class="dlo-empty">${loc("Window.Empty")}</p>` : `<ol class="dlo-grid ${disabled}">${purse}${context.entries.map(slot).join("")}</ol>`}
      <p class="dlo-hint">${loc("Steal.Hint")}</p>
      ${context.blocked ? `<p class="dlo-blocked">${context.blocked}</p>` : ""}`;
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onClose(options) {
    super._onClose(options);
    StealWindow.open.delete(this.source.key);
  }

  refresh() {
    if ( !this.source.exists() ) return this.close();
    return this.render();
  }

  static async #onSteal(event, target) {
    if ( this.busy || this.#blocked() ) return;
    this.busy = true;
    try { await this.onSteal(this.source, this.thief, target.dataset.itemId); }
    finally { this.busy = false; if ( this.rendered ) this.render(); }
  }
}
