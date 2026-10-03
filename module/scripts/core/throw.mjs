/**
 * Armes de jet (SPEC §3.10, demande utilisateur 2026-09-30) — règles pures, testées par tests/throw.test.mjs.
 * Une arme lancée quitte la main : si elle touche, une fois sur deux elle reste plantée dans la cible (dans son
 * inventaire, récupérable à sa mort), sinon elle tombe à ses pieds ; si elle rate, elle file au-delà de la cible et
 * tombe à quelques cases, arrêtée par les murs.
 */

/** Un touché : l'arme reste-t-elle plantée ? (d2 : 1 = plantée, 50 %). */
export function lodges(d2) {
  return d2 === 1;
}

/**
 * Où tombe une arme ratée : au-delà de la cible, dans l'axe du lancer, de `beyond` cases, décalée de `lateral` cases
 * sur le côté (négatif : à gauche).
 * @param {{x: number, y: number}} from    Centre du lanceur.
 * @param {{x: number, y: number}} target  Centre de la cible.
 * @param {number} beyond   Cases au-delà de la cible (1 à 3).
 * @param {number} lateral  Cases de côté (-1, 0 ou 1).
 * @param {number} size     Taille d'une case en pixels.
 */
export function missLanding(from, target, beyond, lateral, size) {
  let dx = target.x - from.x;
  let dy = target.y - from.y;
  const len = Math.hypot(dx, dy);
  if ( len < 1e-6 ) { dx = 1; dy = 0; }
  else { dx /= len; dy /= len; }
  return {
    x: target.x + (dx * beyond * size) + (-dy * lateral * size),
    y: target.y + (dy * beyond * size) + (dx * lateral * size)
  };
}

/** Un point ramené d'une demi-case en arrière d'un obstacle, vers `origin` (l'arme s'arrête devant le mur). */
export function stopBefore(origin, obstacle, size) {
  const dx = obstacle.x - origin.x;
  const dy = obstacle.y - origin.y;
  const len = Math.hypot(dx, dy);
  if ( len <= (size / 2) ) return { x: origin.x, y: origin.y };
  const k = (len - (size / 2)) / len;
  return { x: origin.x + (dx * k), y: origin.y + (dy * k) };
}
