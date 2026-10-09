/**
 * Nécromancie (SPEC §3.4) — règles pures, testées par tests/necromancy.test.mjs.
 *
 * *Animation des morts* (PHB 2024) : « un tas d'ossements ou le cadavre d'un humanoïde de taille Petite ou Moyenne », à
 * 10 ft, devient un Squelette ou un Zombi (Monster Manual 2024) sous le contrôle du lanceur. *Doigt de mort* relève un
 * humanoïde tué en Zombi. Le module fournit l'acte ; le moteur annonce le sort lancé sur sa cible (hook générique
 * `dnd5e-combat.summonOnTargets`, son §118) et ce module relève le cadavre (runtime/necromancy.mjs).
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

/**
 * Les sorts qui relèvent un cadavre, par identifiant dnd5e (PHB 2024, activités « summon ») :
 *  - *Animation des morts* : profils Squelette et Zombi, 10 ft, humanoïde Petit ou Moyen ;
 *  - *Doigt de mort* : activité « Relever un zombi », portée « n'importe laquelle » (le sort a tué la cible), un humanoïde de
 *    toute taille.
 * `rangeFt` null : pas de limite de portée.
 */
export const RAISING_SPELLS = Object.freeze({
  "animate-dead": Object.freeze({ kinds: Object.freeze(["skeleton", "zombie"]), rangeFt: SPELL_RANGE_FT, sizes: RAISABLE_SIZES }),
  "finger-of-death": Object.freeze({ kinds: Object.freeze(["zombie"]), rangeFt: null, sizes: null })
});

/**
 * Ce cadavre peut-il être relevé ? Un humanoïde de taille Petite ou Moyenne (Animation des morts, et le bouton du MJ) ; par
 * `spell`, les règles de ce sort.
 */
export function canAnimate({ type, size }, spell=null) {
  const sizes = spell ? (RAISING_SPELLS[spell]?.sizes ?? null) : RAISABLE_SIZES;
  if ( spell && !RAISING_SPELLS[spell] ) return false;
  return (type === "humanoid") && (!sizes || sizes.has(size));
}

/**
 * Le mort-vivant qu'un sort relève, d'après le profil d'invocation choisi chez le joueur (fenêtre de dnd5e) : un sort à un seul
 * mort-vivant le donne ; sinon le profil se lit par l'acteur qu'il désigne (`…phbmobSkeleton00`, quelle que soit la langue),
 * puis par son nom. null : aucun.
 * @param {string} spell                                  Identifiant dnd5e du sort.
 * @param {{uuid?: string, name?: string}|null} profile
 */
export function undeadKindOf(spell, profile) {
  const kinds = RAISING_SPELLS[spell]?.kinds;
  if ( !kinds ) return null;
  if ( kinds.length === 1 ) return kinds[0];
  for ( const text of [profile?.uuid, profile?.name] ) {
    const found = kinds.find(kind => new RegExp(kind, "i").test(String(text ?? "")));
    if ( found ) return found;
  }
  return null;
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
