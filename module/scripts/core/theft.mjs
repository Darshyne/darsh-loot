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
