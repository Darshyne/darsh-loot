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
    try {
      const created = await createGenericTables();
      ui.notifications.info(loc("Tables.Created", { count: created.length }));
    } catch(err) {
      log.warn("tables génériques :", err.message);
      ui.notifications.warn(loc("Tables.NeedPHB"));
    }
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
