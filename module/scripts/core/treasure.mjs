/**
 * Trésor d'un cadavre (SPEC §3.1, étape 2) — règles pures, testées par tests/treasure.test.mjs.
 *
 * DMG 2024, « Monster Treasure Preferences » (dnd-dungeon-masters-guide.content, page ur0r2zuMASyRpcr4) : « Tous » et
 * les thèmes (Arcanes, Armement, Ustensiles, Reliques) désignent le TRÉSOR DE REPAIRE ; seul le trésor individuel est
 * sur la créature. Sur un cadavre on tire donc le trésor individuel (page EBcNErEifQuAkTR5) pour toute créature qui a
 * une préférence de trésor, et son thème décide seulement de la forme : gemmes (Arcanes), objets d'art (Reliques),
 * pièces sinon (page fQpftaSbOhQlbEJK, « Treasure Themes »). Le repaire se tirera avec les conteneurs (étape 3).
 */

/** Trésor individuel aléatoire par FP (DMG 2024) : dés × multiplicateur, dans une monnaie. */
export const INDIVIDUAL_TREASURE = [
  { maxCr: 4, dice: "3d6", mult: 1, denom: "gp" },
  { maxCr: 10, dice: "2d8", mult: 10, denom: "gp" },
  { maxCr: 16, dice: "2d10", mult: 10, denom: "pp" },
  { maxCr: Infinity, dice: "2d8", mult: 100, denom: "pp" }
];

/**
 * Trésor de repaire aléatoire (DMG 2024, « Treasure Hoards », page BPBTY8qIVTjIZ9Zl), par tranche de FP :
 * pièces (dés × multiplicateur, en po) et nombre d'objets magiques.
 */
export const HOARDS = {
  0: { dice: "2d4", mult: 100, magic: "1d4 - 1" },
  5: { dice: "8d10", mult: 100, magic: "1d3" },
  11: { dice: "8d8", mult: 1000, magic: "1d4" },
  17: { dice: "6d10", mult: 10000, magic: "1d6" }
};

/** Thèmes de trésor (Monster Manual 2024) qui ont leurs tables d'objets magiques dans le DMG. */
export const THEMES = ["arcana", "armaments", "implements", "relics"];

/**
 * Rareté d'un objet magique par tranche (DMG 2024, tables « Level 1-4 » … « Level 17-20», d100) : seuil haut de
 * chaque rareté. Les tranches de niveau des personnages sont prises pour les tranches de FP du repaire.
 */
export const RARITY = {
  0: [[54, "common"], [91, "uncommon"], [100, "rare"]],
  5: [[30, "common"], [81, "uncommon"], [98, "rare"], [100, "veryRare"]],
  11: [[11, "common"], [34, "uncommon"], [70, "rare"], [93, "veryRare"], [100, "legendary"]],
  17: [[20, "rare"], [64, "veryRare"], [100, "legendary"]]
};

/** La tranche (0, 5, 11, 17) d'un FP. */
export function hoardBand(cr) {
  const value = Number(cr) || 0;
  return (value >= 17) ? 17 : (value >= 11) ? 11 : (value >= 5) ? 5 : 0;
}

/** La rareté d'un objet magique pour un d100 dans une tranche. */
export function rarityFor(band, roll) {
  return RARITY[band].find(([max]) => roll <= max)?.[1] ?? RARITY[band].at(-1)[1];
}

/** Le thème de la table d'objets magiques : celui du trésor, ou 1d4 si « Tous » / sans thème (DMG, « Random Magic Items »). */
export function themeFor(theme, d4) {
  return THEMES.includes(theme) ? theme : THEMES[Math.min(Math.max(d4, 1), 4) - 1];
}

/** Valeurs des gemmes et des objets d'art du DMG 2024 (tables « N GP Gemstones », « N GP Art Objects »). */
export const GEM_VALUES = [5000, 1000, 500, 100, 50, 10];
export const ART_VALUES = [7500, 2500, 750, 250, 25];

/** Valeur d'une pièce en po. */
const GP = { pp: 10, gp: 1, ep: 0.5, sp: 0.1, cp: 0.01 };

/** La créature a-t-elle un trésor (toute préférence, « Individuel », « Tous » ou un thème) ? */
export function hasTreasure(preferences) {
  return new Set(preferences ?? []).size > 0;
}

/** La ligne de trésor individuel d'un FP (un FP inconnu compte comme 0). */
export function individualRow(cr) {
  const value = Number(cr) || 0;
  return INDIVIDUAL_TREASURE.find(row => value <= row.maxCr);
}

/**
 * Découpe une somme en objets de valeur, du plus précieux au moins précieux, sans dépasser la somme.
 * @param {number} gp          Somme en po.
 * @param {number[]} values    Valeurs possibles, décroissantes.
 * @returns {{ pieces: {value: number, count: number}[], rest: number }}
 */
export function splitValue(gp, values) {
  let rest = Math.floor(gp);
  const pieces = [];
  for ( const value of values ) {
    const count = Math.floor(rest / value);
    if ( count > 0 ) {
      pieces.push({ value, count });
      rest -= count * value;
    }
  }
  return { pieces, rest };
}

/**
 * La forme du trésor individuel : pièces, gemmes et objets d'art.
 * Arcanes → gemmes ; Reliques → objets d'art ; les deux → moitié-moitié ; sinon (Tous, Individuel, Armement,
 * Ustensiles) → pièces. Ce qui ne fait pas une gemme ou un objet entier reste en pièces, dans la monnaie de la ligne.
 * @param {number} amount        Montant tiré, dans `denom`.
 * @param {string} denom         Monnaie de la ligne (« gp » ou « pp »).
 * @param {Iterable<string>} preferences
 * @returns {{ coins: object, gems: {value: number, count: number}[], art: {value: number, count: number}[] }}
 */
export function shapeTreasure(amount, denom, preferences) {
  const prefs = new Set(preferences ?? []);
  const total = Math.floor(amount * GP[denom]);
  let gemShare = 0;
  let artShare = 0;
  if ( prefs.has("arcana") && prefs.has("relics") ) { gemShare = Math.floor(total / 2); artShare = total - gemShare; }
  else if ( prefs.has("arcana") ) gemShare = total;
  else if ( prefs.has("relics") ) artShare = total;
  const gems = splitValue(gemShare, GEM_VALUES);
  const art = splitValue(artShare, ART_VALUES);
  const leftover = (total - gemShare - artShare) + gems.rest + art.rest;
  return { coins: toCoins(leftover, denom), gems: gems.pieces, art: art.pieces };
}

/** Une somme en po exprimée dans la monnaie de la ligne : des pp (et le reste en po), ou des po. */
export function toCoins(gp, denom) {
  if ( denom === "pp" ) return { pp: Math.floor(gp / 10), gp: gp % 10 };
  return { gp };
}

/**
 * Ce qu'un humanoïde a dans les poches (table du module, d10). `items` : identifiants d'objets du PHB
 * (`Compendium.dnd-players-handbook.equipment.Item.<id>`) et quantités ; `trinket` : une babiole de la table
 * « Trinkets » du PHB.
 */
export const POCKETS = [
  { range: [1, 4], items: [] },
  { range: [5, 5], items: [{ id: "phbagRations0000", quantity: "1d3" }] },
  { range: [6, 6], items: [{ id: "phbagCandle00000", quantity: "1d2" }] },
  { range: [7, 7], items: [{ id: "phbagTorch000000", quantity: 1 }, { id: "phbagTinderbox00", quantity: 1 }] },
  { range: [8, 8], items: [{ id: "phbgstPlayingcar", quantity: 1 }] },
  { range: [9, 9], items: [{ id: "phbagString00000", quantity: 1 }, { id: "phbagSignalWhist", quantity: 1 }] },
  { range: [10, 10], items: [], trinket: true }
];
export const POCKETS_FORMULA = "1d10";

/** Types de créature qui ont des poches. */
export const POCKET_TYPES = new Set(["humanoid"]);

/** La ligne d'une table à plages pour un résultat de dé. */
export function pickRange(table, roll) {
  return table.find(row => (roll >= row.range[0]) && (roll <= row.range[1])) ?? null;
}

/**
 * Nom court d'un résultat de table en texte : sans HTML, sans la précision entre parenthèses
 * (« Hematite (gray black) » → « Hematite »).
 */
export function shortName(text) {
  const plain = String(text ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return plain.replace(/\s*\([^)]*\)\s*$/, "").trim() || plain;
}

/** Le premier lien `@UUID[...]` vers un objet dans un texte de résultat (tables d'objets magiques du DMG). */
export function linkedItemUuid(text) {
  const match = /@UUID\[([^\]]+\.Item\.[^\].]+)\]/.exec(String(text ?? ""));
  return match?.[1] ?? null;
}
