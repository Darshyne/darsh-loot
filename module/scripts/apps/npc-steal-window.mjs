/**
 * 0.21.0 (issue #5) : la fenêtre du MJ quand un de ses PNJ vole un personnage. Les poches du personnage (tout objet physique), le DD exact
 * de chaque objet (le MJ voit tout), ce qui est porté (impossible), ce que ce PNJ a déjà tenté, et « Au hasard ». Un clic tente le vol :
 * `onSteal(source, thief, itemId)` reçue à l'ouverture (runtime/theft.mjs `npcSteal`).
 */
import { MODULE_ID, loc, sceneSetting } from "../shared.mjs";
import { victimView } from "../adapter/theft.mjs";

const { ApplicationV2 } = foundry.applications.api;
const escape = s => foundry.utils.escapeHTML(String(s ?? ""));

export class NpcStealWindow extends ApplicationV2 {
  constructor({ source, thief, onSteal, ...options }) {
    super({ id: `${MODULE_ID}-${source.key}`, ...options });
    this.source = source;
    this.thief = thief;
    this.onSteal = onSteal;
    this.busy = false;
  }

  static DEFAULT_OPTIONS = {
    classes: ["dlo-loot", "dlo-steal", "dlo-npc-steal"],
    window: { icon: "fa-solid fa-hand", resizable: true },
    position: { width: 380, height: "auto" },
    actions: { steal: NpcStealWindow.#onSteal }
  };

  static open = new Map();

  static show(source, thief, onSteal) {
    const existing = NpcStealWindow.open.get(source.key);
    if ( existing ) {
      existing.thief = thief ?? existing.thief;
      existing.onSteal = onSteal ?? existing.onSteal;
      existing.render({ force: true });
      return existing.bringToFront();
    }
    const app = new NpcStealWindow({ source, thief, onSteal });
    NpcStealWindow.open.set(source.key, app);
    return app.render({ force: true });
  }

  get title() {
    return loc("Steal.NpcTitle", { name: this.source.name });
  }

  #blocked() {
    if ( !this.thief?.actor ) return loc("Window.NoLooter");
    if ( game.combat?.started ) return loc("Steal.InCombat");
    if ( this.source.distance(this.thief) > sceneSetting("reach", this.thief.parent) ) return loc("Refus.Loin");
    return null;
  }

  async _prepareContext() {
    const view = victimView(this.source.actor, this.thief?.actor?.id ?? "");
    return { ...view, blocked: this.#blocked(), thiefName: this.thief?.name ?? "" };
  }

  async _renderHTML(context) {
    const root = document.createElement("div");
    root.className = "dlo-body";
    const slot = (e, name, img) => {
      const state = !e.possible ? "worn" : e.tried ? "tried" : "open";
      const label = !e.possible ? loc(e.equipped ? "Steal.Worn" : "Steal.Heavy") : e.tried ? loc("Steal.TriedNpc") : loc("Steal.Dc", { dc: e.dc });
      return `<li class="dlo-slot dlo-steal-${state} dlo-diff-${e.difficulty ?? "none"}" ${state === "open" ? `data-action="steal"` : ""}
        data-item-id="${e.id}" data-tooltip="${escape(name)} — ${escape(label)}">
        <img src="${img}" alt="" draggable="false">
        ${(e.quantity > 1) ? `<span class="dlo-qty">${e.quantity}</span>` : ""}
        ${(state === "open") ? `<span class="dlo-dc">${e.dc}</span>` : ""}
      </li>`;
    };
    const purse = context.purse ? slot(context.purse, loc("Steal.PurseHandful"), "icons/containers/bags/coinpouch-simple-tan.webp") : "";
    const disabled = (context.blocked || this.busy) ? "disabled" : "";
    const open = [...(context.purse ? [context.purse] : []), ...context.entries].some(e => e.possible && !e.tried);
    const empty = !context.entries.length && !context.purse;
    root.innerHTML = `
      <p class="dlo-to">${loc("Steal.By", { name: escape(context.thiefName) })} · ${loc("Steal.Passive", { value: context.perception })}</p>
      ${empty ? `<p class="dlo-empty">${loc("Window.Empty")}</p>` : `<ol class="dlo-grid ${disabled}">${purse}${context.entries.map(e => slot(e, e.name, e.img)).join("")}</ol>`}
      <div class="dlo-actions"><button type="button" data-action="steal" data-item-id="random" ${(disabled || !open) ? "disabled" : ""}>
        <i class="fa-solid fa-dice"></i> ${loc("Steal.Random")}</button></div>
      <p class="dlo-hint">${loc("Steal.NpcHint")}</p>
      ${context.blocked ? `<p class="dlo-blocked">${context.blocked}</p>` : ""}`;
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onClose(options) {
    super._onClose(options);
    NpcStealWindow.open.delete(this.source.key);
  }

  refresh() {
    if ( !this.source.exists() ) return this.close();
    return this.render();
  }

  static async #onSteal(event, target) {
    if ( this.busy || this.#blocked() ) return;
    this.busy = true;
    if ( this.rendered ) this.render();
    try { await this.onSteal(this.source, this.thief, target.dataset.itemId); }
    finally { this.busy = false; if ( this.rendered ) this.render(); }
  }
}
