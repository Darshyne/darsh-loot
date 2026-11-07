/**
 * Vol à la tire (SPEC §3.3) — règles pures, testées par tests/theft.test.mjs.
 *
 * PHB 2024 : Escamotage (Dextérité) sert à « faire les poches ». Le DD de base est la Perception passive de la victime
 * (ou son jet de Perception si elle est sur ses gardes), au moins 10, majoré par la valeur et le poids de l'objet visé :
 * voler est difficile, et l'objet le plus précieux est le plus dur à subtiliser. Ce qui est porté (armure, arme en main)
 * ne se vole pas ; au-delà de 15 lb, rien ne se glisse dans une poche.
 */

/** Majoration selon la valeur en po : seuil haut exclu → bonus. */
export const VALUE_STEPS = [[10, 0], [100, 2], [1000, 5], [Infinity, 10]];

/** Majoration selon le poids en lb (pile entière) : seuil haut inclus → bonus ; au-delà du dernier, impossible. */
export const WEIGHT_STEPS = [[1, 0], [5, 2], [15, 5]];

export const MIN_DC = 10;

export function valueBonus(gp) {
  return VALUE_STEPS.find(([max]) => (Number(gp) || 0) < max)[1];
}

/** null : trop lourd pour être volé. */
export function weightBonus(lb) {
  const row = WEIGHT_STEPS.find(([max]) => (Number(lb) || 0) <= max);
  return row ? row[1] : null;
}

/**
 * Le DD pour voler un objet, ou null s'il ne peut pas l'être.
 * @param {{ perception: number, value: number, weight: number, equipped?: boolean }} data
 *   perception : Perception passive, ou le jet si la victime est sur ses gardes ; value en po, weight en lb.
 */
export function theftDC({ perception, value, weight, equipped=false }) {
  if ( equipped ) return null;
  const heavy = weightBonus(weight);
  if ( heavy === null ) return null;
  return Math.max(Number(perception) || 0, MIN_DC) + valueBonus(value) + heavy;
}

/**
 * Difficulté montrée au joueur (le DD exact reste chez le MJ) : d'après ce que l'objet ajoute à la difficulté, et la
 * vigilance connue de la victime.
 */
export function difficultyOf({ value, weight, alert=false }) {
  const extra = valueBonus(value) + (weightBonus(weight) ?? 0) + (alert ? 5 : 0);
  if ( extra <= 0 ) return "easy";
  if ( extra <= 4 ) return "medium";
  if ( extra <= 9 ) return "hard";
  return "veryHard";
}

/** Valeur en po d'un prix dnd5e (`conversion` : nombre de pièces pour 1 po, CONFIG.DND5E.currencies). */
export function priceInGp(value, conversion) {
  const c = Number(conversion) || 1;
  return (Number(value) || 0) / c;
}

/** Valeur en po d'une bourse (pièces → po, mêmes conversions). */
export function purseInGp(currency, conversions) {
  return Object.entries(currency ?? {}).reduce((sum, [key, n]) => sum + priceInGp(n, conversions[key]), 0);
}

/** Le drapeau posé sur un objet volé. */
export function stolenFlag({ from, fromUuid, place, time }) {
  return { from, fromUuid: fromUuid ?? null, place: place ?? null, time: time ?? null };
}

/* ---- 0.21.0 (issue #5) : réglage du vol à la tire, vol par un PNJ ---- */

/** Réglage de monde `pickpocket` : activé, coupé, ou chaque visite des poches demande l'accord du MJ. */
export const PICKPOCKET_MODES = Object.freeze(["on", "off", "approval"]);

/** Un mode de réglage valide (un monde ancien ou une valeur inconnue : activé). */
export function pickpocketMode(value) {
  return PICKPOCKET_MODES.includes(value) ? value : "on";
}

/**
 * L'entrée « Voler » du menu : absente (`hidden`), offerte (`ok`), ou visible mais sans effet avec sa raison (`combat`) — 2026-11-07,
 * issue #5 : un joueur ne trouvait pas l'entrée, cachée en combat.
 */
export function stealMenuState({ mode, inCombat }) {
  if ( pickpocketMode(mode) === "off" ) return "hidden";
  return inCombat ? "combat" : "ok";
}

/**
 * La poignée prise dans une bourse par un PNJ voleur : `percent` % de chaque pièce, arrondi à l'unité inférieure (jamais toute la bourse
 * d'un personnage). @returns {Record<string, number>} les pièces prises (valeurs positives seulement).
 */
export function purseHandful(currency, percent) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const taken = {};
  for ( const [key, n] of Object.entries(currency ?? {}) ) {
    const v = Math.floor(((Number(n) || 0) * p) / 100);
    if ( v > 0 ) taken[key] = v;
  }
  return taken;
}

/**
 * « Au hasard » : un objet possible et pas encore tenté, la bourse comprise (`id: "coins"`). `random` : un nombre dans [0, 1[.
 * @param {{ id: string, possible: boolean, tried: boolean }[]} entries
 * @returns {string|null}
 */
export function pickRandom(entries, random=Math.random()) {
  const open = (entries ?? []).filter(e => e && e.possible && !e.tried);
  if ( !open.length ) return null;
  return open[Math.min(open.length - 1, Math.floor(random * open.length))].id;
}

/**
 * La marque à poser sur un objet qui change de mains : un objet qui revient à celui à qui il a été volé redevient honnête (sa marque
 * saute, même si on le reprend en volant) ; sinon la nouvelle marque, ou l'ancienne.
 * @param {object|null} previous  marque `stolen` que l'objet portait
 * @param {object|null} stolen    marque du transfert (un vol, un coffre qui a un propriétaire)
 * @param {string} recipientUuid  UUID de l'acteur qui reçoit
 * @returns {object|null}
 */
export function nextStolenMark(previous, stolen, recipientUuid) {
  if ( previous?.fromUuid && (previous.fromUuid === recipientUuid) ) return null;
  return stolen ?? previous ?? null;
}
