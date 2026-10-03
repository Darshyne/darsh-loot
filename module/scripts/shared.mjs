/**
 * Ce que toutes les couches (hors core/) partagent : identifiant, journal, traductions, réglages.
 */
export const MODULE_ID = "darsh-loot";

export const log = {
  info: (...args) => console.log(`${MODULE_ID} |`, ...args),
  warn: (...args) => console.warn(`${MODULE_ID} |`, ...args),
  error: (...args) => console.error(`${MODULE_ID} |`, ...args)
};

/** Texte traduit de la clé `DLO.<key>`. */
export function loc(key, data) {
  const full = `DLO.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}
