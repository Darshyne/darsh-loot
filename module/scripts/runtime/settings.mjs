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
  game.settings.register(MODULE_ID, "whoLoots", {
    name: "DLO.Settings.WhoLoots.Name", hint: "DLO.Settings.WhoLoots.Hint",
    scope: "world", config: true, type: String, default: "all",
    choices: { all: "DLO.Settings.WhoLoots.All", gm: "DLO.Settings.WhoLoots.GM" }
  });
  game.settings.register(MODULE_ID, "autoTreasure", {
    name: "DLO.Settings.AutoTreasure.Name", hint: "DLO.Settings.AutoTreasure.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "pockets", {
    name: "DLO.Settings.Pockets.Name", hint: "DLO.Settings.Pockets.Hint",
    scope: "world", config: true, type: Boolean, default: true
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
}
