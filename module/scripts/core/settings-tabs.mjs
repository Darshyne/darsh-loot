/**
 * Le plan de la fenêtre de réglages de DAS · Loot & Trade (runtime/settings-window.mjs) : onglets, réglages rangés, outils. Pur.
 */

/** Le plan : chaque onglet, ses réglages (clés de ce module) et ses outils. */
export const TABS = Object.freeze([
  { id: "search", icon: "fa-solid fa-magnifying-glass",
    keys: ["clickToLoot", "reach", "searchMenu", "searchRadius", "searchDuration", "searchCooldown"] },
  { id: "loot", icon: "fa-solid fa-sack-dollar", keys: ["whoLoots", "autoTreasure", "pockets", "announce", "theftHostile"] },
  { id: "containers", icon: "fa-solid fa-box-open", keys: ["objectSize", "dropMode", "deleteStores", "thrownWeapons"],
    tools: [{ id: "tables", icon: "fa-solid fa-table-list" }] },
  { id: "traps", icon: "fa-solid fa-burst", keys: ["advancedTraps", "trapPause", "disarmDuration", "trapImmunities"] }
]);
