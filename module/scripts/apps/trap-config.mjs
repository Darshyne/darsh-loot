/**
 * 0.17.2 (demande de l'utilisateur, 2026-10-27) : la fenêtre d'un piège en sections nettes au lieu d'une seule liste. Le cœur range
 * tous les champs d'un comportement de région dans un même cadre (client/applications/sheets/region-behavior-config.mjs,
 * `_getFields` : les sous-groupes `hidden`, `source.hidden` s'y aplatissent, leurs libellés se confondent). Ici, chaque partie du piège
 * a son cadre, son pictogramme et une phrase d'aide : le piège (qui le lance), la **zone d'effet** (qui est touché), la **source** (d'où
 * part l'effet), le **déclencheur** (ce qui le fait partir) et l'armement. Même découpage pour un coffre piégé (contenu, serrure,
 * cachette, puis les parties de son piège).
 *
 * `trapSections` sert aussi aux réglages d'un token ou d'une porte piégés (runtime/traps.mjs), qui ne sont pas un comportement.
 */
import { loc } from "../shared.mjs";

/** Les sections, dans l'ordre : `key` (libellés `DLO.TrapSections.<key>`), pictogramme, chemins des champs sous `system.`. */
const ZONE_SECTIONS = [
  { key: "Trap", icon: "fa-solid fa-burst", paths: ["label", "actor", "activity", "initiative"] },
  { key: "Area", icon: "fa-solid fa-bullseye", paths: ["effectRegion"] },
  { key: "Source", icon: "fa-solid fa-crosshairs", paths: ["source"] },
  { key: "Trigger", icon: "fa-solid fa-shoe-prints", paths: ["triggerRegion", "minSize", "height", "hidden"] },
  { key: "Arming", icon: "fa-solid fa-screwdriver-wrench", paths: ["armed", "rearm", "delay", "triggeredAt", "disarmDc", "failure", "disarmed"] }
];

const CONTAINER_SECTIONS = [
  { key: "Contents", icon: "fa-solid fa-box-open", paths: ["label", "actor", "table", "draws", "hoard", "theme", "rolled", "owner"] },
  { key: "Lock", icon: "fa-solid fa-lock", paths: ["locked", "dc", "key"] },
  { key: "Cache", icon: "fa-solid fa-eye-slash", paths: ["hidden"] },
  { key: "Trap", icon: "fa-solid fa-burst", paths: ["trap.enabled", "trap.actor", "trap.activity", "trap.initiative"] },
  { key: "Area", icon: "fa-solid fa-bullseye", paths: ["trap.effectRegion"], hint: "AreaChest" },
  { key: "Source", icon: "fa-solid fa-crosshairs", paths: ["trap.source"] },
  { key: "Trigger", icon: "fa-solid fa-shoe-prints", paths: ["trap.trigger", "trap.minSize", "trap.hidden"], hint: "TriggerChest" },
  { key: "Arming", icon: "fa-solid fa-screwdriver-wrench", paths: ["trap.armed", "trap.rearm", "trap.delay", "trap.triggeredAt", "trap.disarmDc", "trap.failure", "trap.disarmed"] }
];

/** Les sections d'un type de comportement (null : la fenêtre du cœur telle quelle). */
const SECTIONS_BY_KIND = { trap: ZONE_SECTIONS, container: CONTAINER_SECTIONS };

/** Légende et aide d'une section, traduites. */
export function sectionText(section) {
  return { legend: loc(`TrapSections.${section.key}.Legend`), hint: loc(`TrapSections.${section.hint ?? section.key}.Hint`) };
}

/** Les champs de formulaire sous un chemin (un champ, ou tous ceux d'un sous-groupe, récursivement). */
function fieldsUnder(field, source, path, out) {
  if ( !field ) return out;
  if ( field.constructor.hasFormSupport ) out.push({ field, value: foundry.utils.getProperty(source, path) });
  else if ( field instanceof foundry.data.fields.SchemaField ) {
    for ( const sub of Object.values(field.fields) ) fieldsUnder(sub, source, `${path}.${sub.name}`, out);
  }
  return out;
}

/**
 * La fenêtre d'un « DAS · Piège » ou d'un « DAS · Conteneur » : celle du cœur, dont le cadre des champs propres est remplacé par une
 * section par partie. Un champ qu'aucune section ne nomme (ajouté plus tard) tombe dans un dernier cadre, pour ne jamais disparaître.
 */
export function trapConfigClass(kind) {
  const Base = foundry.applications.sheets.RegionBehaviorConfig;
  return class TrapBehaviorConfig extends Base {
    static DEFAULT_OPTIONS = { classes: ["dlo-trap-config"], position: { width: 560 } };

    _getFields() {
      const sections = SECTIONS_BY_KIND[kind];
      const fieldsets = super._getFields();
      if ( !sections ) return fieldsets;
      const doc = this.document;
      const schema = CONFIG.RegionBehavior.dataModels[doc.type].schema;
      // Les cadres du cœur avant les champs propres : identité, statut, évènements (le dernier est celui des champs propres).
      const kept = fieldsets.filter(f => f.legend !== CONFIG.RegionBehavior.typeLabels[doc.type]);
      const used = new Set();
      const out = [];
      for ( const section of sections ) {
        const fields = [];
        for ( const path of section.paths ) {
          used.add(path.split(".")[0] === "trap" ? path : path.split(".")[0]);
          fieldsUnder(schema.getField(path), doc._source, `system.${path}`, fields);
        }
        // La zone d'effet d'un piège de zone : cette région elle-même ; l'ancien champ ne se montre que s'il reste à reprendre.
        const shown = fields.filter(f => !((kind === "trap") && (f.field.name === "effectRegion") && !f.value));
        out.push({ fieldset: true, legend: sectionText(section).legend, fields: shown, dloSection: section });
      }
      const rest = [];
      for ( const field of Object.values(schema.fields) ) {
        if ( (field.name === "events") || used.has(field.name) ) continue;
        if ( (field.name === "trap") && (kind === "container") ) {
          for ( const sub of Object.values(field.fields) ) {
            if ( !used.has(`trap.${sub.name}`) ) fieldsUnder(sub, doc._source, `system.trap.${sub.name}`, rest);
          }
          continue;
        }
        fieldsUnder(field, doc._source, `system.${field.name}`, rest);
      }
      if ( rest.length ) out.push({ fieldset: true, legend: CONFIG.RegionBehavior.typeLabels[doc.type], fields: rest });
      this._dloSections = out.filter(f => f.dloSection);
      return [...kept, ...out];
    }

    /** Pictogramme, aide et marque de chaque section (le gabarit du cœur ne montre qu'une légende). */
    async _onRender(context, options) {
      await super._onRender(context, options);
      const legends = new Map((this._dloSections ?? []).map(f => [f.legend, f.dloSection]));
      for ( const fieldset of this.element.querySelectorAll("fieldset") ) {
        const legend = fieldset.querySelector(":scope > legend");
        const section = legends.get(legend?.textContent.trim());
        if ( !section || fieldset.classList.contains("dlo-trap-section") ) continue;
        decorateSection(fieldset, section);
      }
      const prefix = (kind === "container") ? "system.trap" : "system";
      await bindActivityPicker(this.element, { activity: `${prefix}.activity`, actor: `${prefix}.actor` });
    }
  };
}

/** Une section dessinée : classe, pictogramme dans la légende, phrase d'aide sous elle. */
export function decorateSection(fieldset, section) {
  const { hint } = sectionText(section);
  fieldset.classList.add("dlo-trap-section", `dlo-trap-${section.key.toLowerCase()}`);
  const legend = fieldset.querySelector(":scope > legend");
  if ( legend && !legend.querySelector("i") ) legend.insertAdjacentHTML("afterbegin", `<i class="${section.icon}" inert></i> `);
  if ( hint ) {
    const p = document.createElement("p");
    p.className = "hint dlo-trap-hint";
    p.textContent = hint;
    legend ? legend.after(p) : fieldset.prepend(p);
  }
}

/**
 * 0.17.2 (demande de l'utilisateur) : le champ « Activité » d'un piège devient une liste — « Selon le niveau des cibles » (vide, la
 * tranche du DMG 2024 choisie au déclenchement, runtime/traps.mjs `activityOf`), puis les activités de l'acteur piège par leur nom,
 * au lieu d'un identifiant à taper. Un identifiant gardé qui ne correspond plus à rien reste proposé, marqué introuvable.
 * @param {HTMLElement} root
 * @param {{ activity: string, actor?: string|null, fixed?: Actor|null }} names  `activity` : nom du champ ; `actor` : nom du champ de
 *   l'acteur piège (la liste suit ses changements) ; `fixed` : l'acteur lui-même (token piège, son acteur).
 */
export async function bindActivityPicker(root, { activity, actor=null, fixed=null }) {
  const input = root?.querySelector(`[name="${activity}"]`);
  if ( !input ) return;
  let select = input;
  if ( input.tagName !== "SELECT" ) {
    select = document.createElement("select");
    select.name = input.name;
    if ( input.id ) select.id = input.id;
    select.dataset.value = input.value ?? "";
    input.replaceWith(select);
  }
  const fill = async uuid => {
    const owner = fixed ?? (uuid ? await fromUuid(uuid).catch(() => null) : null);
    const current = select.value || select.dataset.value || "";
    const esc = text => foundry.utils.escapeHTML(String(text ?? ""));
    const items = (owner?.items?.contents ?? []).filter(i => i.system.activities?.size);
    const options = items.flatMap(item => item.system.activities.contents.map(a => ({ id: a.id,
      label: (items.length > 1) ? `${item.name} — ${a.name || item.name}` : (a.name || item.name) })));
    if ( current && !options.some(o => o.id === current) ) options.push({ id: current, label: loc("TrapSections.ActivityMissing", { id: current }) });
    select.innerHTML = [`<option value="">${esc(loc("TrapSections.ActivityAuto"))}</option>`,
      ...options.map(o => `<option value="${esc(o.id)}" ${o.id === current ? "selected" : ""}>${esc(o.label)}</option>`)].join("");
    select.value = current;
  };
  const actorInput = actor ? root.querySelector(`[name="${actor}"]`) : null;
  await fill(actorInput?.value ?? null);
  // Un autre acteur : ses activités, et de nouveau « selon le niveau des cibles ».
  actorInput?.addEventListener("change", () => { select.value = ""; select.dataset.value = ""; fill(actorInput.value); });
}

/** Les sections d'un token ou d'une porte piégés (runtime/traps.mjs `trapFieldset`), même découpage. */
export const FIELDSET_SECTIONS = Object.freeze({
  Trap: { key: "Trap", icon: "fa-solid fa-burst" },
  Area: { key: "Area", icon: "fa-solid fa-bullseye" },
  Source: { key: "Source", icon: "fa-solid fa-crosshairs" },
  Trigger: { key: "Trigger", icon: "fa-solid fa-shoe-prints" },
  Arming: { key: "Arming", icon: "fa-solid fa-screwdriver-wrench" }
});
