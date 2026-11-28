/**
 * Le plan de la fenêtre de réglages de DAS · Loot & Trade (runtime/settings-window.mjs) : onglets, réglages rangés, outils. Pur.
 */

import { endLootSwitch } from "./end-loot.mjs";

/** Le plan : chaque onglet, ses réglages (clés de ce module) et ses outils. */
export const TABS = Object.freeze([
  { id: "search", icon: "fa-solid fa-magnifying-glass",
    keys: ["clickToLoot", "reach", "searchMenu", "searchRadius", "searchDuration", "searchCooldown"] },
  // 2026-11-27 (user's request): searching corpses, the GM's end-of-combat loot, sharing and theft each have their own tab.
  { id: "loot", icon: "fa-solid fa-sack-dollar", keys: ["corpseLoot", "whoLoots", "autoTreasure", "pockets", "keepSpecial", "lootMark", "announce"],
    tools: [{ id: "lootRules", icon: "fa-solid fa-table-list" }] },
  // End-of-combat loot (lot 3): no tab while it is withdrawn (0.23.0, core/end-loot.mjs `endLootSwitch`).
  ...(endLootSwitch.withdrawn ? [] : [{ id: "endLoot", icon: "fa-solid fa-flag-checkered", keys: ["lootManage", "lootWhen", "lootMode"] }]),
  { id: "share", icon: "fa-solid fa-hand-holding-hand", keys: ["shareWith", "shareRemainder", "giveMode"] },
  { id: "theft", icon: "fa-solid fa-mask", keys: ["pickpocket", "theftHostile", "npcTheftNotice"] },
  { id: "containers", icon: "fa-solid fa-box-open", keys: ["objectSize", "pileFrame", "dropMode", "deleteStores", "thrownWeapons"],
    tools: [{ id: "tables", icon: "fa-solid fa-table-list" }] },
  { id: "traps", icon: "fa-solid fa-burst", keys: ["advancedTraps", "trapPause", "disarmDuration", "trapImmunities"] },
  { id: "rewards", icon: "fa-solid fa-trophy", keys: ["xpManage", "xpWhen", "xpSplit", "xpRemainder", "xpRecipients", "xpToolbar"] }
]);
