/**
 * La fenêtre d'un « DAS · Mécanisme » (étape 13, SPEC §3.13) : celle du cœur pour ses champs simples, plus un cadre **Actions** — une
 * ligne par action (type, effet, cible choisie sur la carte ou fichier son), « Ajouter une action », « Supprimer ». Le cœur ne sait pas
 * dessiner une liste d'objets (`ArrayField` de `SchemaField`) : les lignes n'ont pas d'attribut `name`, et la liste est relue et écrite
 * en entier à l'enregistrement (`_processFormData`), y compris vide.
 *
 * Le choix sur la carte vient de runtime/pick.mjs, fourni au démarrage (`MechanismConfig.pick`) : une fenêtre ne connaît pas runtime/.
 */
import { MODULE_ID, loc } from "../shared.mjs";
import { ACTION_TYPES, ACTION_MODES, ACTION_TARGETS, normalizeAction } from "../core/mechanisms.mjs";
import { TRAP_ZONE, TRAP_RELAY } from "../adapter/trap-behavior.mjs";
import { isTrapToken } from "../adapter/trapped.mjs";

const esc = text => foundry.utils.escapeHTML(String(text ?? ""));

/** L'UUID du piège désigné par un clic : le « DAS · Piège » d'une région (ou celui de son relais), un token piège (ou sa région). */
function trapUuidOf(doc) {
  if ( !doc ) return null;
  if ( doc.documentName === "Token" ) return isTrapToken(doc) ? doc.uuid : null;
  if ( doc.documentName !== "Region" ) return null;
  const own = doc.behaviors.find(b => (b.type === TRAP_ZONE) && !b.disabled);
  if ( own ) return own.uuid;
  const relay = doc.behaviors.find(b => b.type === TRAP_RELAY);
  if ( relay?.system.trap ) return relay.system.trap;
  const tokenId = doc.getFlag(MODULE_ID, "trapToken");
  return tokenId ? (doc.parent.tokens.get(tokenId)?.uuid ?? null) : null;
}

/** Le nom montré d'une cible (porte : « Porte », lumière : « Lumière »…), ou « introuvable ». */
function targetLabel(uuid) {
  if ( !uuid ) return "";
  const doc = fromUuidSync(uuid, { strict: false });
  if ( !doc ) return loc("MechanismZone.Actions.Missing");
  if ( doc.documentName === "Wall" ) return loc("MechanismZone.Actions.Door");
  if ( doc.documentName === "AmbientLight" ) return loc("MechanismZone.Actions.Light");
  if ( doc.documentName === "RegionBehavior" ) return doc.system?.displayName || doc.region?.name || doc.name;
  return doc.name || doc.documentName;
}

function rowHtml(action) {
  const a = normalizeAction(action);
  const types = ACTION_TYPES.map(t => `<option value="${t}" ${t === a.type ? "selected" : ""}>${esc(loc(`MechanismZone.Actions.Type.${t}`))}</option>`).join("");
  return `<li class="dlo-action" data-type="${a.type}">
    <select data-f="type" aria-label="${esc(loc("MechanismZone.Actions.TypeLabel"))}">${types}</select>
    <select data-f="mode" aria-label="${esc(loc("MechanismZone.Actions.ModeLabel"))}"></select>
    <span class="dlo-action-target">
      <input type="text" data-f="target" value="${esc(a.target ?? "")}" placeholder="UUID">
      <button type="button" class="icon" data-dlo-pick data-tooltip="${esc(loc("Pick.Button"))}"><i class="fa-solid fa-crosshairs" inert></i></button>
      <span class="dlo-action-name hint">${esc(targetLabel(a.target))}</span>
    </span>
    <span class="dlo-action-sound">
      <input type="text" data-f="src" value="${esc(a.src)}" placeholder="sounds/…">
      <button type="button" class="icon" data-dlo-file data-tooltip="${esc(loc("MechanismZone.Actions.Browse"))}"><i class="fa-solid fa-file-audio" inert></i></button>
      <input type="number" data-f="volume" value="${a.volume}" min="0" max="1" step="0.1" aria-label="${esc(loc("MechanismZone.Actions.Volume"))}">
    </span>
    <button type="button" class="icon" data-dlo-remove data-tooltip="${esc(loc("MechanismZone.Actions.Remove"))}"><i class="fa-solid fa-trash" inert></i></button>
  </li>`;
}

/** Les effets proposés pour le type de la ligne, l'effet gardé s'il existe encore. */
function fillModes(row, keep=null) {
  const type = row.querySelector('[data-f="type"]').value;
  const select = row.querySelector('[data-f="mode"]');
  const current = keep ?? select.value;
  const modes = ACTION_MODES[type] ?? [];
  select.innerHTML = modes.map(m => `<option value="${m}" ${m === current ? "selected" : ""}>${esc(loc(`MechanismZone.Actions.Mode.${m}`))}</option>`).join("");
  row.dataset.type = type;
  row.querySelector(".dlo-action-target").hidden = !ACTION_TARGETS[type]?.length;
  row.querySelector(".dlo-action-sound").hidden = type !== "sound";
}

/** Les actions telles que les lignes les disent. */
export function readActions(root) {
  return [...root.querySelectorAll(".dlo-action")].map(row => {
    const value = f => row.querySelector(`[data-f="${f}"]`)?.value ?? "";
    return normalizeAction({ type: value("type"), mode: value("mode"), target: value("target"), src: value("src"), volume: value("volume") });
  });
}

export class MechanismConfig extends foundry.applications.sheets.RegionBehaviorConfig {
  static DEFAULT_OPTIONS = { classes: ["dlo-trap-config", "dlo-mechanism-config"], position: { width: 640 } };

  /** Fourni par runtime/pick.mjs : `(types, app) => Promise<string|null>` (UUID choisi sur la carte). */
  static pick = null;

  _getFields() {
    const fieldsets = super._getFields();
    const actions = CONFIG.RegionBehavior.dataModels[this.document.type]?.schema.fields.actions;
    for ( const set of fieldsets ) set.fields = (set.fields ?? []).filter(f => f.field !== actions);
    return fieldsets;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const form = this.element.querySelector("form") ?? this.element;
    // Redessiné à chaque rendu, d'après le document (un actionnement pendant que la fenêtre est ouverte change son état).
    form.querySelector(".dlo-mechanism-actions")?.remove();
    const fieldset = document.createElement("fieldset");
    fieldset.className = "dlo-mechanism-actions dlo-trap-section";
    fieldset.innerHTML = `<legend><i class="fa-solid fa-list-check" inert></i> ${esc(loc("MechanismZone.Actions.Legend"))}</legend>
      <p class="hint dlo-trap-hint">${esc(loc("MechanismZone.Actions.Hint"))}</p>
      <ol class="dlo-actions">${(this.document._source.system.actions ?? []).map(rowHtml).join("")}</ol>
      <button type="button" data-dlo-add><i class="fa-solid fa-plus" inert></i> ${esc(loc("MechanismZone.Actions.Add"))}</button>`;
    const footer = form.querySelector(".form-footer");
    if ( footer ) footer.before(fieldset);
    else form.append(fieldset);
    const list = fieldset.querySelector(".dlo-actions");
    const sources = this.document._source.system.actions ?? [];
    list.querySelectorAll(".dlo-action").forEach((row, i) => fillModes(row, normalizeAction(sources[i]).mode));
    fieldset.addEventListener("change", event => {
      const row = event.target.closest(".dlo-action");
      if ( !row ) return;
      if ( event.target.dataset.f === "type" ) fillModes(row);
      if ( event.target.dataset.f === "target" ) row.querySelector(".dlo-action-name").textContent = targetLabel(event.target.value.trim());
    });
    fieldset.addEventListener("click", event => this.#onClick(event, list));
    bindMacroDrop(fieldset);
    this.setPosition({ height: "auto" });
  }

  async #onClick(event, list) {
    const button = event.target.closest("button");
    if ( !button ) return;
    const row = button.closest(".dlo-action");
    if ( button.hasAttribute("data-dlo-add") ) {
      event.preventDefault();
      list.insertAdjacentHTML("beforeend", rowHtml({}));
      fillModes(list.lastElementChild);
      this.setPosition({ height: "auto" });
    } else if ( button.hasAttribute("data-dlo-remove") ) {
      event.preventDefault();
      row?.remove();
      this.setPosition({ height: "auto" });
    } else if ( button.hasAttribute("data-dlo-pick") && row ) {
      event.preventDefault();
      const type = row.querySelector('[data-f="type"]').value;
      const types = (type === "trap") ? ["Region", "Token"] : [...(ACTION_TARGETS[type] ?? [])];
      if ( (type === "macro") || !MechanismConfig.pick ) return ui.notifications.info(loc("MechanismZone.Actions.MacroHint"));
      let uuid = await MechanismConfig.pick(types, this);
      if ( uuid && (type === "trap") ) {
        uuid = trapUuidOf(fromUuidSync(uuid, { strict: false }));
        if ( !uuid ) return ui.notifications.warn(loc("MechanismZone.Actions.NoTrap"));
      }
      if ( !uuid ) return;
      const input = row.querySelector('[data-f="target"]');
      input.value = uuid;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else if ( button.hasAttribute("data-dlo-file") && row ) {
      event.preventDefault();
      const input = row.querySelector('[data-f="src"]');
      const FilePicker = foundry.applications.apps.FilePicker.implementation;
      new FilePicker({ type: "audio", current: input.value, callback: path => { input.value = path; } }).render(true);
    }
  }

  /** La liste des actions, relue des lignes (vide si toutes ont été supprimées). */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    data.system ??= {};
    data.system.actions = readActions(form);
    return data;
  }
}

/** Une macro glissée sur le champ cible d'une ligne « macro » (barre latérale, compendium) y écrit son UUID. */
export function bindMacroDrop(root) {
  root.addEventListener("drop", event => {
    const input = event.target.closest?.('.dlo-action [data-f="target"]');
    if ( !input ) return;
    const TextEditor = foundry.applications.ux.TextEditor.implementation;
    const data = TextEditor.getDragEventData(event);
    if ( !data?.uuid ) return;
    event.preventDefault();
    input.value = data.uuid;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
