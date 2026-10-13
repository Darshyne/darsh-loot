/**
 * Unités de distance — règles pures. Les distances de ce module (réglages, objets cachés, portées de sort) sont écrites en
 * pieds, comme les règles de D&D et les données dnd5e ; elles passent dans l'unité de la scène au moment de comparer.
 */

/** Noms d'unités de scène lus comme des mètres, sans accents (« mètres » s'y ramène). */
export const METRIC_UNITS = new Set(["m", "mt", "meter", "meters", "metre", "metres"]);

/**
 * Une distance en pieds exprimée dans les unités de la scène (pieds par défaut, mètres : 5 ft = 1,5 m). Le nom d'unité est
 * comparé sans casse ni accents : ce que le MJ a tapé, quelle que soit la langue du client.
 */
export function feetToSceneUnits(feet, units) {
  const u = String(units ?? "ft").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();
  if ( METRIC_UNITS.has(u) ) return feet * 0.3;
  return feet;
}
