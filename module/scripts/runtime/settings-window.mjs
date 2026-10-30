/**
 * La fenêtre de réglages de DAS · Loot & Trade (2026-10-30) : la même que celle de DAS · Core, déclarée par son API publique
 * `api.settings.registerWindow` (moteur ≥ 0.241.0). Quatre onglets ; le bouton « Créer les tables » y devient un outil du MJ. Au
 * `setup`, quand tous les modules ont posé leur API : avec un moteur plus ancien, rien ne change — les réglages restent dans la liste
 * de Foundry, avec le bouton des tables.
 */
import { MODULE_ID } from "../shared.mjs";
import { route } from "./router.mjs";
import { engineSettingsWindow } from "../adapter/engine.mjs";
import { TABS } from "../core/settings-tabs.mjs";
import { createTablesNow } from "./settings.mjs";

const OPEN = Object.freeze({ tables: () => createTablesNow() });

export function registerSettingsWindow() {
  route("setup", "settings window", () => {
    const register = engineSettingsWindow();
    if ( !register ) return;
    register({
      namespace: MODULE_ID, title: "DLO.SettingsWindow.Title",
      menu: { name: "DLO.SettingsWindow.Menu.Name", label: "DLO.SettingsWindow.Menu.Label", hint: "DLO.SettingsWindow.Menu.Hint" },
      tabs: TABS.map(t => ({ ...t, label: `DLO.SettingsWindow.Tab.${t.id}`,
        tools: (t.tools ?? []).map(tool => ({ ...tool, name: `DLO.SettingsWindow.Tool.${tool.id}.Name`,
          hint: `DLO.SettingsWindow.Tool.${tool.id}.Hint`, button: `DLO.SettingsWindow.Tool.${tool.id}.Button`, open: OPEN[tool.id] })) }))
    });
    // Le bouton des tables passe dans la fenêtre (onglet Conteneurs) : il quitte la liste de Foundry.
    game.settings.menus.delete(`${MODULE_ID}.createTables`);
  });
}
