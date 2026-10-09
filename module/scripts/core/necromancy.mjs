/**
 * Nécromancie (SPEC §3.4) — règles pures, testées par tests/necromancy.test.mjs.
 *
 * *Animation des morts* (PHB 2024) : « un tas d'ossements ou le cadavre d'un humanoïde de taille Petite ou Moyenne », à
 * 10 ft, devient un Squelette ou un Zombi (Monster Manual 2024) sous le contrôle du lanceur. *Doigt de mort* relève un
 * humanoïde tué en Zombi. Le module fournit l'acte ; le branchement sur les sorts se fera dans le moteur (§4).
 */

/** Morts-vivants que l'on relève : identifiants du pack `dnd-monster-manual.actors`. */
export const UNDEAD = {
  skeleton: "mmSkeleton000000",
  zombie: "mmZombie00000000"
};

/** Portée d'Animation des morts, en pieds. */
export const SPELL_RANGE_FT = 10;

/** Tailles admises (CONFIG.DND5E.actorSizes). */
export const RAISABLE_SIZES = new Set(["sm", "med"]);

/** Ce cadavre peut-il être relevé ? Un humanoïde de taille Petite ou Moyenne. */
export function canAnimate({ type, size }) {
  return (type === "humanoid") && RAISABLE_SIZES.has(size);
}

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
