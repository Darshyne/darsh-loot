/**
 * Réglages du monde.
 */
import { MODULE_ID, loc, log } from "../shared.mjs";
import { createGenericTables } from "../adapter/treasure.mjs";

/**
 * Bouton des réglages « Créer les tables génériques » : le cœur instancie la classe et appelle `render` ; on crée les
 * tables au lieu d'ouvrir une fenêtre. V14 exige une sous-classe d'ApplicationV2 (sinon `registerMenu` lève, et tout
 * le reste de `init` saute).
 */
class CreateTablesMenu extends foundry.applications.api.ApplicationV2 {
  async render() {
    await createTablesNow();
  }
}

/** Créer les tables génériques de conteneurs, avec un message : le bouton de la liste de Foundry ou l'outil de la fenêtre DAS. */
export async function createTablesNow() {
  try {
    const created = await createGenericTables();
    ui.notifications.info(loc("Tables.Created", { count: created.length }));
  } catch(err) {
    log.warn("generic tables:", err.message);
    ui.notifications.warn(loc("Tables.NeedPHB"));
  }
}

export function registerSettings() {
  game.settings.registerMenu(MODULE_ID, "createTables", {
    name: "DLO.Tables.MenuName", label: "DLO.Tables.MenuLabel", hint: "DLO.Tables.MenuHint",
    icon: "fa-solid fa-table-list", type: CreateTablesMenu, restricted: true
  });
  game.settings.register(MODULE_ID, "reach", {
    name: "DLO.Settings.Reach.Name", hint: "DLO.Settings.Reach.Hint",
    scope: "world", config: true, type: Number, default: 5,
    range: { min: 5, max: 30, step: 5 }
  });
  // Rayon de « Fouiller les environs » (SPEC §3.12) ; un objet caché peut demander moins.
  game.settings.register(MODULE_ID, "searchRadius", {
    name: "DLO.Settings.SearchRadius.Name", hint: "DLO.Settings.SearchRadius.Hint",
    scope: "world", config: true, type: Number, default: 15,
    range: { min: 5, max: 60, step: 5 }
  });
  // 2026-10-28 : le clic gauche sur un cadavre, un coffre, un marchand ou un piège repéré — jamais (par défaut, comme le
  // clic-déplacement du moteur : le clic droit propose « Fouiller »), à portée, ou y aller puis ouvrir. Réglage de chaque poste.
  game.settings.register(MODULE_ID, "clickToLoot", {
    name: "DLO.Settings.ClickToLoot.Name", hint: "DLO.Settings.ClickToLoot.Hint",
    scope: "client", config: true, type: String, default: "off",
    choices: { off: "DLO.Settings.ClickToLoot.Off", reach: "DLO.Settings.ClickToLoot.Reach", walk: "DLO.Settings.ClickToLoot.Walk" }
  });
  // 2026-11-27: how this client shows a shop — icons (« grid ») or a list by category. Changed from the shop window itself.
  game.settings.register(MODULE_ID, "shopView", {
    scope: "client", config: false, type: String, default: "grid", choices: { grid: "grid", list: "list" }
  });
  // 0.15.7 : « Fouiller les environs » proposé dans le menu du token (la Perception passive et l'API restent actives).
  game.settings.register(MODULE_ID, "searchMenu", {
    name: "DLO.Settings.SearchMenu.Name", hint: "DLO.Settings.SearchMenu.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  // 0.14.4 : délai entre deux fouilles d'un même personnage hors combat, en minutes de temps du monde (0 : aucun).
  game.settings.register(MODULE_ID, "searchCooldown", {
    name: "DLO.Settings.SearchCooldown.Name", hint: "DLO.Settings.SearchCooldown.Hint",
    scope: "world", config: true, type: Number, default: 1,
    range: { min: 0, max: 60, step: 1 }
  });
  // 0.14.5 : durée d'une fouille hors combat, en secondes réelles (barre de progression chez le joueur ; 0 : aussitôt).
  game.settings.register(MODULE_ID, "searchDuration", {
    name: "DLO.Settings.SearchDuration.Name", hint: "DLO.Settings.SearchDuration.Hint",
    scope: "world", config: true, type: Number, default: 10,
    range: { min: 0, max: 30, step: 1 }
  });
  // 0.17.1 : durée d'un désamorçage, en secondes réelles (barre de progression, ping, bruit d'outils ; 0 : aussitôt).
  game.settings.register(MODULE_ID, "disarmDuration", {
    name: "DLO.Settings.DisarmDuration.Name", hint: "DLO.Settings.DisarmDuration.Hint",
    scope: "world", config: true, type: Number, default: 5,
    range: { min: 0, max: 30, step: 1 }
  });
  // 0.17.0 : mode piège avancé — hors combat, un piège qui part met le jeu en pause et lance un combat où il a son initiative ; le
  // MJ juge ensuite chaque cible (Avantage / Désavantage) avant de le lancer. Éteint : l'effet est instantané, comme avant.
  game.settings.register(MODULE_ID, "advancedTraps", {
    name: "DLO.Settings.AdvancedTraps.Name", hint: "DLO.Settings.AdvancedTraps.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  // 2026-10-28 : en mode avancé, mettre le jeu en pause quand un piège part (éteint : seuls les déplacements s'arrêtent).
  game.settings.register(MODULE_ID, "trapPause", {
    name: "DLO.Settings.TrapPause.Name", hint: "DLO.Settings.TrapPause.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  // 2026-10-28 : un token piège est un objet — immunités aux dégâts de poison et psychiques, et aux états d'objet, ajoutées à sa pose.
  game.settings.register(MODULE_ID, "trapImmunities", {
    name: "DLO.Settings.TrapImmunities.Name", hint: "DLO.Settings.TrapImmunities.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  // 2026-10-28 : coffres, tas et pièges posés dessinés au plus à cette fraction de leurs cases (affichage seulement).
  game.settings.register(MODULE_ID, "objectSize", {
    name: "DLO.Settings.ObjectSize.Name", hint: "DLO.Settings.ObjectSize.Hint",
    scope: "world", config: true, type: Number, default: 80,
    range: { min: 50, max: 100, step: 5 },
    onChange: () => Hooks.callAll(`${MODULE_ID}.objectSize`)
  });
  // 2026-11-27: ground piles drawn as cards - rounded corners, with or without a thin gold rim (display only, runtime/pile-frame.mjs).
  game.settings.register(MODULE_ID, "pileFrame", {
    name: "DLO.Settings.PileFrame.Name", hint: "DLO.Settings.PileFrame.Hint",
    scope: "world", config: true, type: String, default: "gold",
    choices: { gold: "DLO.Settings.PileFrame.Gold", rounded: "DLO.Settings.PileFrame.Rounded", off: "DLO.Settings.PileFrame.Off" },
    onChange: () => Hooks.callAll(`${MODULE_ID}.pileFrame`)
  });
  // 2026-11-27: the « Loot » status on a corpse that still has something to take (runtime/loot-mark.mjs).
  game.settings.register(MODULE_ID, "lootMark", {
    name: "DLO.Settings.LootMark.Name", hint: "DLO.Settings.LootMark.Hint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => Hooks.callAll(`${MODULE_ID}.lootMark`)
  });
  game.settings.register(MODULE_ID, "whoLoots", {
    name: "DLO.Settings.WhoLoots.Name", hint: "DLO.Settings.WhoLoots.Hint",
    scope: "world", config: true, type: String, default: "all",
    choices: { all: "DLO.Settings.WhoLoots.All", gm: "DLO.Settings.WhoLoots.GM" }
  });
  game.settings.register(MODULE_ID, "autoTreasure", {
    name: "DLO.Settings.AutoTreasure.Name", hint: "DLO.Settings.AutoTreasure.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  // Lot 3 (2026-11-27, user's request): the GM's end-of-combat loot for the party, on or off altogether (like pickpocketing). Off:
  // nothing happens at the end of a combat, each corpse is rolled at its first search, as before.
  game.settings.register(MODULE_ID, "lootManage", {
    name: "DLO.EndLoot.Settings.Manage.Name", hint: "DLO.EndLoot.Settings.Manage.Hint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => ui.controls?.render({ reset: true })
  });
  // Lot 3: how the GM validates it — in the window (default), or at once without a window.
  game.settings.register(MODULE_ID, "lootWhen", {
    name: "DLO.EndLoot.Settings.When.Name", hint: "DLO.EndLoot.Settings.When.Hint",
    scope: "world", config: true, type: String, default: "semi",
    choices: { semi: "DLO.EndLoot.Settings.When.Semi", auto: "DLO.EndLoot.Settings.When.Auto" }
  });
  // Lot 3: where the loot goes by default (the window may change it per encounter) — on each corpse, or into one encounter chest.
  game.settings.register(MODULE_ID, "lootMode", {
    name: "DLO.EndLoot.Settings.Mode.Name", hint: "DLO.EndLoot.Settings.Mode.Hint",
    scope: "world", config: true, type: String, default: "individual",
    choices: { individual: "DLO.EndLoot.Mode.individual", grouped: "DLO.EndLoot.Mode.grouped" }
  });
  // Lot 3: an NPC's special weapon is kept as it is on its sheet instead of becoming the plain weapon (off by default: converted).
  game.settings.register(MODULE_ID, "keepSpecial", {
    name: "DLO.EndLoot.Settings.KeepSpecial.Name", hint: "DLO.EndLoot.Settings.KeepSpecial.Hint",
    scope: "world", config: true, type: Boolean, default: false
  });
  // Lot 3: custom loot tables by CR, creature type and size (« Loot tables » window), hidden.
  game.settings.register(MODULE_ID, "lootRules", {
    scope: "world", config: false, type: Object, default: { rules: [] },
    onChange: () => Hooks.callAll(`${MODULE_ID}.lootRules`)
  });
  game.settings.register(MODULE_ID, "pockets", {
    name: "DLO.Settings.Pockets.Name", hint: "DLO.Settings.Pockets.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  // 0.21.0 (issue #5) : le vol à la tire des joueurs — activé, coupé (aucune entrée, toute demande refusée chez le MJ), ou accord du MJ
  // à chaque visite des poches.
  game.settings.register(MODULE_ID, "pickpocket", {
    name: "DLO.Settings.Pickpocket.Name", hint: "DLO.Settings.Pickpocket.Hint",
    scope: "world", config: true, type: String, default: "on",
    choices: { on: "DLO.Settings.Pickpocket.On", off: "DLO.Settings.Pickpocket.Off", approval: "DLO.Settings.Pickpocket.Approval" }
  });
  // 0.21.0 (issue #5) : un vol réussi par un PNJ reste secret (le MJ seul est prévenu), sauf si ce réglage prévient le joueur.
  game.settings.register(MODULE_ID, "npcTheftNotice", {
    name: "DLO.Settings.NpcTheftNotice.Name", hint: "DLO.Settings.NpcTheftNotice.Hint",
    scope: "world", config: true, type: Boolean, default: false
  });
  game.settings.register(MODULE_ID, "theftHostile", {
    name: "DLO.Settings.TheftHostile.Name", hint: "DLO.Settings.TheftHostile.Hint",
    scope: "world", config: true, type: Boolean, default: false
  });
  game.settings.register(MODULE_ID, "dropMode", {
    name: "DLO.Settings.DropMode.Name", hint: "DLO.Settings.DropMode.Hint",
    scope: "world", config: true, type: String, default: "on",
    choices: { on: "DLO.Settings.DropMode.On", off: "DLO.Settings.DropMode.Off" }
  });
  game.settings.register(MODULE_ID, "deleteStores", {
    name: "DLO.Settings.DeleteStores.Name", hint: "DLO.Settings.DeleteStores.Hint",
    scope: "world", config: true, type: Boolean, default: false
  });
  game.settings.register(MODULE_ID, "thrownWeapons", {
    name: "DLO.Settings.ThrownWeapons.Name", hint: "DLO.Settings.ThrownWeapons.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "announce", {
    name: "DLO.Settings.Announce.Name", hint: "DLO.Settings.Announce.Hint",
    scope: "world", config: true, type: String, default: "gm",
    choices: { gm: "DLO.Settings.Announce.GM", all: "DLO.Settings.Announce.All", none: "DLO.Settings.Announce.None" }
  });
  // Lot 1 (2026-11-27): who gets a share — every player character of dnd5e's primary party, or only those with a token on the
  // scene of the loot. Without a primary party: the player-owned characters on the scene.
  game.settings.register(MODULE_ID, "shareWith", {
    name: "DLO.Share.Settings.ShareWith.Name", hint: "DLO.Share.Settings.ShareWith.Hint",
    scope: "world", config: true, type: String, default: "party",
    choices: { party: "DLO.Share.Settings.ShareWith.Party", scene: "DLO.Share.Settings.ShareWith.Scene" }
  });
  // Lot 1: the coins that do not divide stay where they are, or go to the one who shares.
  game.settings.register(MODULE_ID, "shareRemainder", {
    name: "DLO.Share.Settings.ShareRemainder.Name", hint: "DLO.Share.Settings.ShareRemainder.Hint",
    scope: "world", config: true, type: String, default: "source",
    choices: { source: "DLO.Share.Settings.ShareRemainder.Source", sharer: "DLO.Share.Settings.ShareRemainder.Sharer" }
  });
  // Lot 1: giving an item or coins to another character — handed over at once (like passing a potion at the table), only once
  // the receiver has agreed, or switched off.
  game.settings.register(MODULE_ID, "giveMode", {
    name: "DLO.Give.Settings.Mode.Name", hint: "DLO.Give.Settings.Mode.Hint",
    scope: "world", config: true, type: String, default: "direct",
    choices: { direct: "DLO.Give.Settings.Mode.Direct", ask: "DLO.Give.Settings.Mode.Ask", off: "DLO.Give.Settings.Mode.Off" }
  });
  // Lot 2 (2026-11-27, user's request): DAS handles XP at all — off by default; off, nothing happens and no shortcut shows.
  game.settings.register(MODULE_ID, "xpManage", {
    name: "DLO.Rewards.Settings.Manage.Name", hint: "DLO.Rewards.Settings.Manage.Hint",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => ui.controls?.render({ reset: true })
  });
  // Lot 2 (user's request): the XP button of the tokens toolbar, shown or hidden (the other shortcuts stay).
  game.settings.register(MODULE_ID, "xpToolbar", {
    name: "DLO.Rewards.Settings.Toolbar.Name", hint: "DLO.Rewards.Settings.Toolbar.Hint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => ui.controls?.render({ reset: true })
  });
  // Lot 2 (2026-11-27): XP rewards — when XP is given: at the end of a combat with the « Rewards » window (the GM validates), at
  // the end of a combat without it, at each hostile creature defeated, or only when the GM opens the window. Silent when dnd5e
  // levels up without XP.
  game.settings.register(MODULE_ID, "xpWhen", {
    name: "DLO.Rewards.Settings.When.Name", hint: "DLO.Rewards.Settings.When.Hint",
    scope: "world", config: true, type: String, default: "semi",
    choices: { semi: "DLO.Rewards.Settings.When.Semi", auto: "DLO.Rewards.Settings.When.Auto", kill: "DLO.Rewards.Settings.When.Kill",
      manual: "DLO.Rewards.Settings.When.Manual" }
  });
  // Lot 2: how XP divides by default (the window may change it per encounter) — equal shares (DMG), the same progression towards
  // the next level, or a coefficient per character.
  game.settings.register(MODULE_ID, "xpSplit", {
    name: "DLO.Rewards.Settings.Split.Name", hint: "DLO.Rewards.Settings.Split.Hint",
    scope: "world", config: true, type: String, default: "equal",
    choices: { equal: "DLO.Rewards.SplitMode.equal", level: "DLO.Rewards.SplitMode.level", weight: "DLO.Rewards.SplitMode.weight" }
  });
  // Lot 2: the XP that does not divide — into the XP pool of dnd5e's primary party (a Group actor), or lost like dnd5e's /award.
  game.settings.register(MODULE_ID, "xpRemainder", {
    name: "DLO.Rewards.Settings.Remainder.Name", hint: "DLO.Rewards.Settings.Remainder.Hint",
    scope: "world", config: true, type: String, default: "party",
    choices: { party: "DLO.Rewards.Settings.Remainder.Party", lost: "DLO.Rewards.Settings.Remainder.Lost" }
  });
  // Lot 2: who is ticked to receive XP after a combat — the characters who fought, or the whole party (absent ones too).
  game.settings.register(MODULE_ID, "xpRecipients", {
    name: "DLO.Rewards.Settings.Recipients.Name", hint: "DLO.Rewards.Settings.Recipients.Hint",
    scope: "world", config: true, type: String, default: "present",
    choices: { present: "DLO.Rewards.Settings.Recipients.Present", party: "DLO.Rewards.Settings.Recipients.Party" }
  });
  // Lot 2: the encounter records (adapter/xp.mjs), hidden, written by a GM. Every client redraws its window when they change.
  game.settings.register(MODULE_ID, "rewards", {
    scope: "world", config: false, type: Object, default: { records: [] },
    onChange: () => Hooks.callAll(`${MODULE_ID}.rewards`)
  });
  // Lot 0: the journal of multi-write gestures in progress (runtime/operations.mjs), hidden. Empty unless a GM reloaded mid-gesture.
  game.settings.register(MODULE_ID, "operations", { scope: "world", config: false, type: Object, default: {} });
}
