/**
 * Le compendium « Outils du MJ » de darsh-loot (pack `outils`, SPEC §3.11) : les macros d'initialisation d'un monde. Les fichiers
 * `.js` de ce dossier en sont la source ; `npm run packs` construit le compendium, `npm run dist` l'archive pour la Forge. Toute
 * macro de ce dossier doit figurer ici (`tests/macros.test.mjs`).
 */
export const MACROS = [
  { file: "reprendre-marchands-item-piles.js", name: "Import Item Piles merchants",
    img: "icons/commodities/currency/coins-assorted-mix-copper-silver-gold.webp" },
  { file: "marchands-objets-invendables.js", name: "List merchants' items that cannot be sold",
    img: "icons/sundries/documents/document-sealed-signatures-red.webp" },
  { file: "recompenses.js", name: "Rewards (XP)", img: "icons/commodities/treasure/cup-trophy-gold.webp" }
];
