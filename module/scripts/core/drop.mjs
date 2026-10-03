/**
 * Poser un objet au sol (SPEC §3.8) — règles pures, testées par tests/drop.test.mjs : où tombe le tas, quel son,
 * quelle trajectoire pour l'effet de lancer « à la Diablo ».
 */

/** Taille d'un tas, en fraction de case (décision utilisateur 2026-09-30 : une demi-case). */
export const PILE_FRACTION = 0.5;

/**
 * Où se pose le tas d'une case : dans son **quart haut-gauche** (décision utilisateur 2026-09-30 : ainsi on le voit
 * même quand une créature est sur la case). Centre du tas = coin de la case + un quart de case.
 * @param {{x: number, y: number}} cellTopLeft  Coin haut-gauche de la case.
 * @param {number} size                        Taille d'une case en pixels.
 */
export function pileSpot(cellTopLeft, size) {
  const offset = (size * PILE_FRACTION) / 2;
  return { x: cellTopLeft.x + offset, y: cellTopLeft.y + offset };
}

/** Durée du vol, en millisecondes. */
export const FLIGHT_MS = 520;

/** Types d'équipement qui sonnent comme du métal (CONFIG.DND5E.armorTypes, bouclier compris). */
const METAL_EQUIPMENT = new Set(["light", "medium", "heavy", "shield"]);

/**
 * Le son d'atterrissage d'un objet : « metal » (armes, armures), « glass » (potions), « coins » (pièces, gemmes, objets
 * d'art), « soft » sinon.
 * @param {{ type: string, subtype?: string }} item  Type dnd5e et `system.type.value`.
 */
export function soundKind({ type, subtype }) {
  if ( type === "coins" ) return "coins";
  if ( type === "weapon" ) return "metal";
  if ( (type === "equipment") && METAL_EQUIPMENT.has(subtype) ) return "metal";
  if ( (type === "consumable") && (subtype === "potion") ) return "glass";
  if ( (type === "loot") && ((subtype === "gem") || (subtype === "art")) ) return "coins";
  return "soft";
}

/** Ramène un point à une distance maximale d'un centre (un objet ne se lance pas à l'autre bout de la salle). */
export function clampDrop(center, point, maxDist) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const dist = Math.hypot(dx, dy);
  if ( dist <= maxDist ) return { x: point.x, y: point.y };
  const k = maxDist / dist;
  return { x: center.x + (dx * k), y: center.y + (dy * k) };
}

/**
 * Pousse le centre d'un tas hors d'un rectangle (le token de celui qui pose) : un tas sous son propre token ne se
 * cliquerait pas. `margin` : demi-taille du tas. Sort par le côté le plus proche ; au centre exact, vers la droite.
 * @param {{ x: number, y: number, w: number, h: number }} rect
 */
export function outsideRect(rect, point, margin) {
  const left = rect.x - margin;
  const right = rect.x + rect.w + margin;
  const top = rect.y - margin;
  const bottom = rect.y + rect.h + margin;
  if ( (point.x <= left) || (point.x >= right) || (point.y <= top) || (point.y >= bottom) ) return { ...point };
  const exits = [
    { d: point.x - left, p: { x: left, y: point.y } },
    { d: right - point.x, p: { x: right, y: point.y } },
    { d: point.y - top, p: { x: point.x, y: top } },
    { d: bottom - point.y, p: { x: point.x, y: bottom } }
  ];
  // À égalité (centre exact), la droite l'emporte : ordre de préférence droite, bas, gauche, haut.
  const order = [1, 3, 0, 2];
  const best = order.reduce((a, i) => (exits[i].d < exits[a].d ? i : a), order[0]);
  return exits[best].p;
}

/**
 * La position de l'objet en vol à l'instant t (0 → 1) : arc de parabole, un tour sur lui-même, petit écrasement à
 * l'atterrissage.
 * @returns {{ x: number, y: number, rotation: number, scaleX: number, scaleY: number }}
 */
export function flight(from, to, t) {
  const u = Math.min(Math.max(t, 0), 1);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const height = Math.max(40, dist * 0.6);
  const x = from.x + ((to.x - from.x) * u);
  const y = from.y + ((to.y - from.y) * u) - (4 * height * u * (1 - u));
  // Un tour complet, fini pendant le vol (85 %) : l'objet se pose droit, sans saut d'angle.
  const rotation = Math.min(u / 0.85, 1) * Math.PI * 2;
  // Les 15 derniers pour cent : écrasé à l'impact, puis revenu à sa forme.
  const land = u > 0.85 ? (u - 0.85) / 0.15 : 0;
  const squash = land > 0 ? Math.sin(land * Math.PI) * 0.25 : 0;
  return { x, y, rotation, scaleX: 1 + squash, scaleY: 1 - squash };
}
