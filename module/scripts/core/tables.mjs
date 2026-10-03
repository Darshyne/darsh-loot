/**
 * Tables génériques de conteneurs (SPEC §3.2) : données pures, créées dans le monde par `api.createTables()` (le MJ
 * les modifie ensuite à sa guise). `id` : objet du pack `dnd-players-handbook.equipment` ; sans `id`, la case ne donne
 * rien. Testé par tests/tables.test.mjs (chaque valeur du dé a sa case, identifiants de 16 caractères).
 */
export const GENERIC_TABLES = [
  { key: "chest", formula: "1d20", img: "icons/containers/chest/chest-reinforced-steel-oak-tan.webp", results: [
    [1, 4], [5, 6, "phbagRations0000"], [7, 7, "phbagTorch000000"], [8, 8, "phbagCandle00000"],
    [9, 9, "phbagRope0000000"], [10, 10, "phbagBlanket0000"], [11, 11, "phbagClothesTrav"], [12, 12, "phbagClothesFine"],
    [13, 13, "phbagBook0000000"], [14, 14, "phbagLamp0000000"], [15, 15, "phbwepDagger0000"], [16, 16, "phbagPotionofHea"],
    [17, 17, "phbagPerfume0000"], [18, 18, "phbagManacles000"], [19, 19, "phbagCantripScro"], [20, 20, "phbagSpellScroll"]
  ] },
  { key: "barrel", formula: "1d20", img: "icons/containers/barrels/barrel-oak-banded-tan.webp", results: [
    [1, 10], [11, 14, "phbagRations0000"], [15, 16, "phbagOil00000000"], [17, 17, "phbagJug00000000"],
    [18, 18, "phbagTorch000000"], [19, 19, "phbagRope0000000"], [20, 20, "phbagAlchemistsF"]
  ] },
  { key: "crate", formula: "1d20", img: "icons/containers/boxes/crate-reinforced-brown.webp", results: [
    [1, 6], [7, 8, "phbamoArrows0000"], [9, 9, "phbamoBolts00000"], [10, 10, "phbamoBulletsSli"],
    [11, 11, "phbagRope0000000"], [12, 12, "phbagCrowbar0000"], [13, 13, "phbagShovel00000"], [14, 14, "phbagHuntingTrap"],
    [15, 15, "phbagCaltrops000"], [16, 16, "phbagBallBearing"], [17, 17, "phbagTent0000000"], [18, 18, "phbagChain000000"],
    [19, 19, "phbwepSpear00000"], [20, 20, "phbagHealersKit0"]
  ] },
  { key: "bookshelf", formula: "1d20", img: "icons/sundries/books/book-stack.webp", results: [
    [1, 8], [9, 12, "phbagBook0000000"], [13, 14, "phbagPaper000000"], [15, 16, "phbagParchment00"],
    [17, 17, "phbagInk00000000"], [18, 18, "phbagMap00000000"], [19, 19, "phbagCaseMaporSc"], [20, 20, "phbagSpellScroll"]
  ] },
  { key: "desk", formula: "1d20", img: "icons/tools/scribal/ink-quill-red.webp", results: [
    [1, 6], [7, 8, "phbagInkPen00000"], [9, 10, "phbagParchment00"], [11, 11, "phbagPaper000000"],
    [12, 12, "phbagInk00000000"], [13, 13, "phbagCandle00000"], [14, 14, "phbagMap00000000"], [15, 15, "phbagPerfume0000"],
    [16, 16, "phbagBell0000000"], [17, 17, "phbagPouch000000"], [18, 18, "phbagBook0000000"], [19, 19, "phbwepDagger0000"],
    [20, 20, "phbagCantripScro"]
  ] },
  { key: "altar", formula: "1d20", img: "icons/sundries/lights/candle-lit-yellow.webp", results: [
    [1, 8], [9, 11, "phbagCandle00000"], [12, 13, "phbagHolyWater00"], [14, 14, "phbhsyEmblemborn"],
    [15, 15, "phbhsyAmuletworn"], [16, 16, "phbhsyReliquaryh"], [17, 17, "phbagPerfume0000"], [18, 18, "phbagPotionofHea"],
    [19, 19, "phbagBook0000000"], [20, 20, "phbagHolyWater00"]
  ] },
  { key: "camp", formula: "1d20", img: "icons/containers/bags/sack-cloth-orange.webp", results: [
    [1, 5], [6, 8, "phbagRations0000"], [9, 9, "phbagTorch000000"], [10, 10, "phbagBedroll0000"],
    [11, 11, "phbagBlanket0000"], [12, 12, "phbagRope0000000"], [13, 13, "phbwepDagger0000"], [14, 14, "phbwepHandaxe000"],
    [15, 15, "phbwepShortsword"], [16, 16, "phbagManacles000"], [17, 17, "phbamoArrows0000"], [18, 18, "phbagAntitoxin00"],
    [19, 19, "phbagHealersKit0"], [20, 20, "phbagPotionofHea"]
  ] }
];

/** Nombre de faces du dé d'une formule « 1dN ». */
export function dieFaces(formula) {
  const match = /^1d(\d+)$/.exec(String(formula).replace(/\s+/g, ""));
  return match ? Number(match[1]) : null;
}
