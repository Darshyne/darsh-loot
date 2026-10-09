/**
 * Tirage du trésor d'un cadavre (SPEC §3.1, étape 2), une fois, chez le MJ, à la première fouille.
 * Règles : core/treasure.mjs. Sources : DMG 2024 (tables et objets génériques de trésor), PHB 2024 (équipement,
 * babioles) ; un module absent retire seulement ce qu'il fournit.
 */
import { MODULE_ID } from "../shared.mjs";
import {
  hasTreasure, individualRow, shapeTreasure, POCKETS, POCKETS_FORMULA, POCKET_TYPES, pickRange, shortName, linkedItemUuid,
  HOARDS, rarityFor, themeFor
} from "../core/treasure.mjs";
import { addCoins } from "../core/loot.mjs";
import { GENERIC_TABLES } from "../core/tables.mjs";

const DMG = "dnd-dungeon-masters-guide";
const PHB = "dnd-players-handbook";
const TRINKET_IMG = "icons/commodities/treasure/box-jade-tassel.webp";

/** Objets génériques et tables de noms du DMG, par valeur (ids du pack `equipment` et du pack `tables`). */
const GEM = {
  10: ["dmgGemstone10GP0", "dmg10GpGemstones"], 50: ["dmgGemstone50GP0", "dmg50GpGemstones"],
  100: ["dmgGemstone100GP", "dmg100GpGemstone"], 500: ["dmgGemstone500GP", "dmg500GpGemstone"],
  1000: ["dmgGemstone1000G", "dmg1000GpGemston"], 5000: ["dmgGemstone5000G", "dmg5000GpGemston"]
};
const ART = {
  25: ["dmgJewelry25GP00", "dmg25GpArtObject"], 250: ["dmgJewelry250GP0", "dmg250GpArtObjec"],
  750: ["dmgJewelry750GP0", "dmg750GpArtObjec"], 2500: ["dmgJewelry2500GP", "dmg2500GpArtObje"],
  7500: ["dmgJewelry7500GP", "dmg7500GpArtObje"]
};

/** Tables d'objets magiques du DMG par thème et rareté (pack `tables`, « Arcana - Common »…). */
const MAGIC_TABLES = {
  arcana: { common: "dmgArcanaCommon0", uncommon: "dmgArcanaUncommo", rare: "dmgArcanaRare000",
    veryRare: "dmgArcanaVeryRar", legendary: "dmgArcanaLegenda" },
  armaments: { common: "dmgArmamentsComm", uncommon: "dmgArmamentsUnco", rare: "dmgArmamentsRare",
    veryRare: "dmgArmamentsVery", legendary: "dmgArmamentsLege" },
  implements: { common: "dmgImplementsCom", uncommon: "dmgImplementsUnc", rare: "dmgImplementsRar",
    veryRare: "dmgImplementsVer", legendary: "dmgImplementsLeg" },
  relics: { common: "dmgRelicsCommon0", uncommon: "dmgRelicsUncommo", rare: "dmgRelicsRare000",
    veryRare: "dmgRelicsVeryRar", legendary: "dmgRelicsLegenda" }
};

const active = id => !!game.modules.get(id)?.active;
const rollTotal = async formula => (await new Roll(formula).evaluate({ allowInteractive: false })).total;
const itemUuid = (pack, id) => `Compendium.${pack}.Item.${id}`;
const tableUuid = (pack, id) => `Compendium.${pack}.RollTable.${id}`;

/** Le cadavre a-t-il déjà été tiré ? */
export function isRolled(actor) {
  return !!actor.getFlag(MODULE_ID, "rolled");
}

/**
 * Peut-il y avoir quelque chose à tirer (pour le curseur avant la première fouille) ?
 * Une préférence de trésor, des poches, ou une table propre au PNJ.
 */
export function mayHaveTreasure(actor) {
  if ( isRolled(actor) ) return false;
  const details = actor.system.details ?? {};
  return hasTreasure(details.treasure?.value) || POCKET_TYPES.has(details.type?.value)
    || !!actor.getFlag(MODULE_ID, "table");
}

/** Données d'un objet de compendium, prêtes à créer (null si introuvable). */
async function fromPack(uuid, changes={}) {
  const item = await fromUuid(uuid).catch(() => null);
  if ( !(item instanceof Item) ) return null;
  const data = game.items.fromCompendium(item);
  return foundry.utils.mergeObject(data, changes);
}

/** Un résultat de table tiré sans message de chat, en texte (vide si la table manque). */
async function drawText(uuid) {
  const table = await fromUuid(uuid).catch(() => null);
  if ( !table ) return "";
  const { results } = await table.roll();
  const result = results[0];
  return result?.description || result?.name || result?.text || "";
}

/** Une gemme ou un objet d'art du DMG, nommé d'après sa table (« Hématite »), la précision en description. */
async function valuable(kind, value, count) {
  const [itemId, tableId] = (kind === "gem" ? GEM : ART)[value];
  const out = [];
  for ( let i = 0; i < count; i++ ) {
    const text = await drawText(tableUuid(`${DMG}.tables`, tableId));
    const data = await fromPack(itemUuid(`${DMG}.equipment`, itemId), { "system.quantity": 1 });
    if ( !data ) continue;
    if ( text ) {
      data.name = shortName(text);
      // Sans ce drapeau, asGear() rendrait au joueur l'objet générique du compendium (physical-item.mjs:372).
      foundry.utils.setProperty(data, "flags.dnd5e.gear.preserve", true);
      data.system.description ??= {};
      data.system.description.value = `<p>${text}</p>${data.system.description.value ?? ""}`;
    }
    out.push(data);
  }
  return out;
}

/**
 * Un résultat de table devenu objet : document lié, lien @UUID dans le texte, ou objet « butin » nommé d'après le
 * texte. Une case « rien » des tables génériques (`flags.darsh-loot.nothing`) ne donne rien.
 */
async function itemFromResult(result) {
  if ( result.flags?.[MODULE_ID]?.nothing ) return null;
  const uuid = (result.type === "document" ? result.documentUuid : null) ?? linkedItemUuid(result.description ?? result.text);
  if ( uuid ) {
    const data = await fromPack(uuid);
    if ( data ) return data;
    // Un résultat qui désigne un document introuvable (compendium absent de ce monde) ne donne rien : mieux que de
    // fabriquer un objet « butin » au nom du sort attendu (vu le 2026-10-01 sur les tables de sorts de la campagne).
    if ( result.type === "document" ) {
      console.warn(`${MODULE_ID} | table: document not found, result skipped —`, uuid);
      return null;
    }
  }
  const text = result.description || result.name || result.text;
  if ( !text ) return null;
  return { name: shortName(text), type: "loot", img: result.img || TRINKET_IMG,
    system: { quantity: 1, description: { value: `<p>${text}</p>` } } };
}

/**
 * Tire le trésor d'un cadavre : pièces du trésor individuel (sous forme de gemmes / objets d'art selon son thème),
 * poches d'un humanoïde, table propre au PNJ (`flags.darsh-loot.table`, une UUID de table). À appeler chez le MJ.
 * @returns {Promise<{ items: object[], coins: object }>}  Ce qui a été ajouté (pour les journaux et les tests).
 */
export async function rollTreasure(actor, { pockets=true, individual=true }={}) {
  const details = actor.system.details ?? {};
  const preferences = details.treasure?.value ?? [];
  const items = [];
  let coins = {};

  if ( individual && hasTreasure(preferences) ) {
    const row = individualRow(details.cr);
    const roll = await new Roll(row.dice).evaluate({ allowInteractive: false });
    const shaped = shapeTreasure(roll.total * row.mult, row.denom, active(DMG) ? preferences : []);
    coins = shaped.coins;
    for ( const g of shaped.gems ) items.push(...await valuable("gem", g.value, g.count));
    for ( const a of shaped.art ) items.push(...await valuable("art", a.value, a.count));
  }

  if ( pockets && POCKET_TYPES.has(details.type?.value) && active(PHB) ) {
    const roll = await new Roll(POCKETS_FORMULA).evaluate({ allowInteractive: false });
    const row = pickRange(POCKETS, roll.total);
    for ( const entry of row?.items ?? [] ) {
      const quantity = (typeof entry.quantity === "string")
        ? (await new Roll(entry.quantity).evaluate({ allowInteractive: false })).total : entry.quantity;
      const data = await fromPack(itemUuid(`${PHB}.equipment`, entry.id), { "system.quantity": quantity });
      if ( data ) items.push(data);
    }
    if ( row?.trinket ) {
      const text = await drawText(tableUuid(`${PHB}.tables`, "phbStartingTrink"));
      if ( text ) items.push({ name: shortName(text), type: "loot", img: TRINKET_IMG,
        system: { quantity: 1, description: { value: `<p>${text}</p>` } } });
    }
  }

  const own = actor.getFlag(MODULE_ID, "table");
  if ( own ) items.push(...await drawItems(own, 1));

  if ( items.length ) await actor.createEmbeddedDocuments("Item", items);
  const update = { [`flags.${MODULE_ID}.rolled`]: true };
  if ( Object.keys(coins).length ) update["system.currency"] = addCoins(actor.system.currency, coins);
  await actor.update(update);
  return { items: items.map(i => i.name), coins };
}

/**
 * Crée dans le monde les tables génériques de conteneurs (core/tables.mjs), dans le dossier « Butin — tables », sans
 * doublon (une table déjà créée, reconnue par son drapeau, est laissée telle que le MJ l'a modifiée). À appeler chez le MJ.
 * @returns {Promise<RollTable[]>}  Les tables créées cette fois-ci.
 */
export async function createGenericTables() {
  if ( !active(PHB) ) throw new Error("dnd-players-handbook");
  let folder = game.folders.find(f => (f.type === "RollTable") && f.getFlag(MODULE_ID, "tables"));
  folder ??= await Folder.implementation.create({ name: game.i18n.localize("DLO.Tables.Folder"), type: "RollTable",
    color: "#6b5634", flags: { [MODULE_ID]: { tables: true } } });
  const nothing = game.i18n.localize("DLO.Tables.Nothing");
  const created = [];
  for ( const def of GENERIC_TABLES ) {
    if ( game.tables.find(t => t.getFlag(MODULE_ID, "generic") === def.key) ) continue;
    const results = [];
    for ( const [from, to, id] of def.results ) {
      const base = { range: [from, to], weight: to - from + 1 };
      if ( !id ) { results.push({ ...base, type: "text", description: nothing, flags: { [MODULE_ID]: { nothing: true } } }); continue; }
      const uuid = itemUuid(`${PHB}.equipment`, id);
      const item = await fromUuid(uuid).catch(() => null);
      if ( !item ) continue;
      results.push({ ...base, type: "document", documentUuid: uuid, name: item.name, img: item.img });
    }
    const [table] = await RollTable.implementation.createDocuments([{
      name: game.i18n.localize(`DLO.Tables.${def.key}`), formula: def.formula, img: def.img, replacement: true,
      displayRoll: false, folder: folder.id, results, flags: { [MODULE_ID]: { generic: def.key } }
    }]);
    created.push(table);
  }
  return created;
}

/** Les objets tirés sur une table (UUID), `draws` fois. */
export async function drawItems(uuid, draws) {
  const table = await fromUuid(uuid).catch(() => null);
  const items = [];
  if ( !table ) return items;
  for ( let i = 0; i < draws; i++ ) {
    const { results } = await table.roll();
    for ( const result of results ) {
      const data = await itemFromResult(result);
      if ( data ) items.push(data);
    }
  }
  return items;
}

/**
 * Un objet magique du DMG pour un repaire : thème (celui du conteneur, ou 1d4), rareté selon la tranche (d100),
 * puis la table « <thème> - <rareté> ». null si la table ne donne pas d'objet (texte seul).
 */
async function magicItem(band, theme) {
  const chosen = themeFor(theme, await rollTotal("1d4"));
  const rarity = rarityFor(band, await rollTotal("1d100"));
  const tableId = MAGIC_TABLES[chosen][rarity];
  const table = await fromUuid(tableUuid(`${DMG}.tables`, tableId)).catch(() => null);
  if ( !table ) return null;
  const { results } = await table.roll();
  return results[0] ? itemFromResult(results[0]) : null;
}

/**
 * Tire le contenu d'un conteneur (SPEC §3.2), une fois, chez le MJ : sa table (`draws` tirages), puis son trésor de
 * repaire (DMG 2024 « Random Treasure Hoard » : pièces selon la tranche de FP, mises en forme selon le thème, et
 * objets magiques par thème et rareté). Les objets vont dans l'acteur du coffre ; le comportement est marqué `rolled`.
 * @param {RegionBehavior} behavior
 * @param {Actor} actor  L'acteur Groupe du coffre.
 */
export async function rollContainer(behavior, actor) {
  const { table, draws, hoard, theme } = behavior.system;
  const items = [];
  let coins = {};
  if ( table && (draws > 0) ) items.push(...await drawItems(table, draws));

  if ( (hoard !== "") && HOARDS[hoard] ) {
    const band = Number(hoard);
    const row = HOARDS[band];
    const amount = (await rollTotal(row.dice)) * row.mult;
    const dmg = active(DMG);
    const shaped = shapeTreasure(amount, "gp", dmg ? [theme] : []);
    coins = shaped.coins;
    for ( const g of shaped.gems ) items.push(...await valuable("gem", g.value, g.count));
    for ( const a of shaped.art ) items.push(...await valuable("art", a.value, a.count));
    if ( dmg ) {
      const count = Math.max(0, await rollTotal(row.magic));
      for ( let i = 0; i < count; i++ ) {
        const data = await magicItem(band, theme);
        if ( data ) items.push(data);
      }
    }
  }

  if ( items.length ) await actor.createEmbeddedDocuments("Item", items);
  if ( Object.keys(coins).length ) await actor.update({ "system.currency": addCoins(actor.system.currency, coins) });
  await behavior.update({ "system.rolled": true });
  return { items: items.map(i => i.name), coins };
}
