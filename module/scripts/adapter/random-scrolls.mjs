import { MODULE_ID } from "../shared.mjs";

const read = key => game.settings.get(MODULE_ID, key);
const markerFlag = "randomScroll";
const generic = { phbagCantripScro: "cantrip", phbagSpellScroll: "level-1", dmgSpellScroll00: "any" };

const markerOf = item => item.flags?.[MODULE_ID]?.[markerFlag] ?? item.flags?.["campagne-ajustements"]?.[markerFlag];
export const isSpellScroll = item => item?.type === "consumable" && item.system?.type?.value === "scroll";
export const identificationMode = () => read("scrollIdentification");

export function genericScrollSlot(item) {
  if (!isSpellScroll(item)) return null;
  const explicit = markerOf(item);
  if (explicit?.spell) return null;
  if (explicit?.id) return explicit.id;
  if (Array.from(item.system?.activities?.values?.() ?? Object.values(item.system?.activities ?? {}))
    .some(activity => activity.type === "cast" && activity.spell?.uuid)) return null;
  if (item.flags?.["dnd5e-combat"]?.scroll?.identifier) return null;
  const source = item._stats?.compendiumSource ?? item.flags?.core?.sourceId;
  const id = source?.split(".").at(-1) ?? item.id ?? item._id;
  if (generic[id]) return generic[id];
  for (const [level, ref] of Object.entries(CONFIG.DND5E.spellScrollIds ?? {})) {
    if (id && id === ref?.split(".").at(-1)) return Number(level) ? "level-" + level : "cantrip";
  }
  return slotFromText(item.name);
}

export function slotFromText(text) {
  const label = String(text ?? "").replace(/<[^>]+>/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  if (/^(?:spell scroll|parchemin de sort)$/.test(label)) return "any";
  if (/^(?:spell scroll|parchemin de sort)\s*\(?\s*(?:cantrip|sort mineur|tour de magie|niveau 0)\s*\)?$/.test(label)) return "cantrip";
  const match = /^(?:spell scroll|parchemin de sort)\s*\(?\s*(?:(?:de )?(?:niveau|level)\s*)?([1-9])(?:st|nd|rd|th|er|e|eme)?(?:[ -]+(?:level|niveau))?\s*\)?$/.exec(label);
  return match ? "level-" + match[1] : null;
}

export function spellScrollSlot(item) {
  if (!isSpellScroll(item)) return null;
  const activities = item.system.activities;
  const cast = Array.from(activities?.values?.() ?? Object.values(activities ?? {})).find(activity => activity.type === "cast");
  const level = markerOf(item)?.level ?? cast?.spell?.level ?? item.flags?.dnd5e?.spellLevel?.value;
  return genericScrollSlot(item) ?? (level === 0 ? "cantrip" : Number(level) > 0 ? "level-" + level : "any");
}

export const needsScrollIdentification = item => identificationMode() !== "off" && !!genericScrollSlot(item);

export function tableScrollData(text, img) {
  const slot = slotFromText(text);
  if (!slot) return null;
  return { name: text.replace(/<[^>]+>/g, "").trim(), type: "consumable", img,
    system: { type: { value: "scroll" }, quantity: 1 }, flags: { [MODULE_ID]: { [markerFlag]: { id: slot } } } };
}

async function spellCatalog() {
  const groups = Array.from({ length: 10 }, () => []);
  const seen = new Set();
  const packs = read("scrollPacks").split(",").map(id => id.trim()).filter(Boolean);
  for (const id of packs) {
    const pack = game.packs.get(id);
    if (pack?.documentName !== "Item") continue;
    const entries = await pack.getIndex({ fields: ["system.level", "system.identifier", "system.source"] });
    for (const entry of entries) {
      const level = entry.system?.level;
      if (entry.type !== "spell" || !groups[level] || entry.system.source?.rules === "2014") continue;
      const key = level + ":" + (entry.system.identifier || entry.name);
      if (seen.has(key)) continue;
      seen.add(key);
      groups[level].push({ name: entry.name, level, uuid: entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}` });
    }
  }
  return groups;
}

const sample = collection => collection[Math.floor(Math.random() * collection.length)];

export async function spellChoices(slot) {
  const catalog = await spellCatalog();
  const pools = read("scrollPools");
  const groups = catalog.map((entries, level) => Array.isArray(pools[level])
    ? entries.filter(entry => pools[level].includes(entry.uuid)) : entries);
  if (slot === "any") return groups.flat();
  const level = slot === "cantrip" ? 0 : Number(/^level-([1-9])$/.exec(slot ?? "")?.[1]);
  return groups[level] ?? [];
}

export async function resolvedScroll(spell, original) {
  if (!spell) return null;
  const scroll = await CONFIG.Item.documentClass.createScrollFromCompendiumSpell(spell.uuid,
    { dialog: false, explanation: "reference" });
  if (!scroll) return null;
  const data = scroll.toObject();
  delete data._id;
  delete data.folder;
  data.flags = foundry.utils.mergeObject(original.flags ?? {}, data.flags ?? {}, { inplace: false });
  if (data.flags["campagne-ajustements"]) delete data.flags["campagne-ajustements"][markerFlag];
  data.system.quantity = 1;
  data.system.identified = true;
  for (const key of ["container", "equipped"]) if (original.system?.[key] !== undefined) data.system[key] = original.system[key];
  foundry.utils.setProperty(data, "flags.dnd5e.gear.preserve", true);
  foundry.utils.setProperty(data, "flags." + MODULE_ID + "." + markerFlag, { spell: spell.uuid, level: spell.level });
  return data;
}

export async function convertLootScrolls(items) {
  const bySlot = new Map();
  const result = [];
  for (const item of items) {
    const slot = genericScrollSlot(item);
    if (!slot) { result.push(item); continue; }
    if (needsScrollIdentification(item)) {
      foundry.utils.setProperty(item, "flags." + MODULE_ID + "." + markerFlag, { id: slot });
      // The legacy campaign converter treats an explicit marker without an id as already handled.
      if (game.modules.get("campagne-ajustements")?.active) {
        foundry.utils.setProperty(item, "flags.campagne-ajustements.randomScroll", { managedBy: MODULE_ID });
      }
      foundry.utils.setProperty(item, "system.identified", false);
      foundry.utils.setProperty(item, "system.unidentified.name", game.i18n.localize("DLO.RandomScrolls.Unknown"));
      foundry.utils.setProperty(item, "flags.dnd5e.gear.preserve", true);
      result.push(item);
      continue;
    }
    if (!read("randomScrolls")) { result.push(item); continue; }
    let remaining = item.system?.quantity ?? 1;
    try {
      if (!bySlot.has(slot)) bySlot.set(slot, await spellChoices(slot));
      const choices = bySlot.get(slot);
      while (remaining > 0) {
        const scroll = await resolvedScroll(sample(choices), item);
        if (!scroll) break;
        result.push(scroll);
        remaining--;
      }
    } catch (error) { console.warn(MODULE_ID + " | scroll conversion", error); }
    if (remaining > 0) {
      const original = foundry.utils.deepClone(item);
      original.system.quantity = remaining;
      result.push(original);
      ui.notifications.warn(game.i18n.localize("DLO.RandomScrolls.Unavailable"));
    }
  }
  return result;
}

export async function openScrollPools() {
  if (!game.user.isGM) return;
  const catalog = await spellCatalog();
  const pools = read("scrollPools");
  const escape = foundry.utils.escapeHTML;
  const t = key => game.i18n.localize("DLO.RandomScrolls." + key);
  const content = catalog.map((entries, level) => `<details><summary>${level} (${entries.length})</summary>
    <label><input type="checkbox" name="limit-${level}" ${Array.isArray(pools[level]) ? "checked" : ""}> ${t("Limit")}</label>
    ${entries.map(entry => `<div><label><input type="checkbox" name="spell-${level}" value="${escape(entry.uuid)}"
      ${pools[level]?.includes(entry.uuid) ? "checked" : ""}> ${escape(entry.name)}</label></div>`).join("")}</details>`).join("");
  return foundry.applications.api.DialogV2.wait({
    window: { title: t("Title") }, position: { width: 560 },
    content: `<div style="max-height:55vh;overflow:auto">${content}</div>`,
    buttons: [{ action: "save", label: t("Save"), callback: async (_event, button) => {
      const form = new FormData(button.form);
      const selected = {};
      for (let level = 0; level < catalog.length; level++) {
        if (form.has("limit-" + level)) selected[level] = form.getAll("spell-" + level);
      }
      await game.settings.set(MODULE_ID, "scrollPools", selected);
    }}, { action: "cancel", label: t("Cancel") }], rejectClose: false
  });
}

export function registerRandomScrolls() {
  game.settings.register(MODULE_ID, "randomScrolls", {
    scope: "world", config: true, type: Boolean, default: false, name: "DLO.RandomScrolls.Enable"
  });
  game.settings.register(MODULE_ID, "scrollPacks", {
    scope: "world", config: true, type: String, default: "dnd5e.spells24", name: "DLO.RandomScrolls.Packs"
  });
  const choices = Object.fromEntries(["off", "auto", "ask"].map(mode => [mode, "DLO.RandomScrolls.Mode." + mode]));
  game.settings.register(MODULE_ID, "scrollIdentification", {
    scope: "world", config: true, type: String, default: "off", name: "DLO.RandomScrolls.Identification", choices
  });
  game.settings.register(MODULE_ID, "scrollAbility", {
    scope: "world", config: true, type: String, default: "int", name: "DLO.RandomScrolls.Ability",
    choices: { str: "DND5E.AbilityStr", dex: "DND5E.AbilityDex", con: "DND5E.AbilityCon",
      int: "DND5E.AbilityInt", wis: "DND5E.AbilityWis", cha: "DND5E.AbilityCha" }
  });
  game.settings.register(MODULE_ID, "scrollDC", {
    scope: "world", config: true, type: Number, default: 10, name: "DLO.RandomScrolls.BaseDC", range: { min: 1, max: 30, step: 1 }
  });
  game.settings.register(MODULE_ID, "scrollDCPerLevel", {
    scope: "world", config: true, type: Number, default: 1, name: "DLO.RandomScrolls.PerLevel", range: { min: 0, max: 10, step: 1 }
  });
  game.settings.register(MODULE_ID, "scrollPools", { scope: "world", config: false, type: Object, default: {} });
}
