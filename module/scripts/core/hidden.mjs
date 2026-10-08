/**
 * Ce qui est caché (SPEC §3.12, option « cachée ») : règles pures — qui est encore caché, ce qu'une Perception passive
 * trouve, la portée d'une fouille, ce que la découverte d'un mur change et ce que recacher remet.
 */

/** Réglages d'un objet caché, par défaut (une zone : `system.hidden` ; un mur : `flags.darsh-loot.hidden`). */
export const HIDDEN_DEFAULTS = Object.freeze({
  enabled: false, skill: "prc", dc: 15, passive: 10, radius: 15, found: false, text: ""
});

/** Les réglages complets d'un objet caché, valeurs absentes ou invalides remplacées par les défauts. */
export function normalizeHidden(raw={}) {
  const num = (v, d, min) => (Number.isFinite(Number(v)) && (Number(v) >= min)) ? Number(v) : d;
  return {
    enabled: raw.enabled === true,
    skill: (raw.skill === "inv") ? "inv" : "prc",
    dc: num(raw.dc, HIDDEN_DEFAULTS.dc, 1),
    passive: num(raw.passive, HIDDEN_DEFAULTS.passive, 0),
    radius: num(raw.radius, HIDDEN_DEFAULTS.radius, 0),
    found: raw.found === true,
    text: typeof raw.text === "string" ? raw.text : ""
  };
}

/** Encore caché aux joueurs : l'option est cochée et personne ne l'a trouvé. */
export const concealed = raw => !!raw?.enabled && !raw.found;

/**
 * La Perception passive (ou l'Investigation passive) d'un personnage trouve-t-elle l'objet ? Il faut qu'il soit à la
 * distance de détection passive (0 : pas de détection passive) et que sa valeur passive atteigne le DD.
 */
export function passiveFinds(hidden, distance, passiveScore) {
  const h = normalizeHidden(hidden);
  return h.passive > 0 && (distance <= h.passive) && (Number(passiveScore) >= h.dc);
}

/** Le rayon d'une fouille active pour cet objet : celui du réglage du monde, ou moins si l'objet le demande. */
export function searchReach(hidden, worldRadius) {
  const h = normalizeHidden(hidden);
  return Math.min(worldRadius, h.radius || worldRadius);
}

/**
 * 0.14.4 : ce qu'il reste à attendre avant une nouvelle fouille hors combat, en secondes de temps du monde (0 : rien). `last` :
 * temps du monde de la dernière fouille du personnage (absent : jamais) ; `minutes` : délai du réglage (0 : pas de délai). Un
 * temps du monde revenu en arrière (calendrier reculé) ne bloque pas.
 */
export function searchWait(last, now, minutes) {
  const delay = (Number(minutes) || 0) * 60;
  if ( !(delay > 0) || (last === undefined) || (last === null) || !Number.isFinite(Number(last)) || (Number(now) < Number(last)) ) return 0;
  return Math.max(0, (Number(last) + delay) - Number(now));
}

/** Le personnage a-t-il déjà raté cet objet (un essai par objet et par personnage) ? */
export const alreadyTried = (tried, actorId) => Array.isArray(tried) && tried.includes(actorId);

/** La liste des essais, ce personnage ajouté (sans doublon). */
export const withTry = (tried, actorId) => [...new Set([...(Array.isArray(tried) ? tried : []), actorId])];

/* ---- murs cachés ---- */

/** Valeurs du cœur (CONST.WALL_DOOR_TYPES, CONST.EDGE_SENSE_TYPES), recopiées pour rester pur. */
export const DOOR = Object.freeze({ NONE: 0, DOOR: 1, SECRET: 2 });
export const SENSE = Object.freeze({ NONE: 0, LIMITED: 10, NORMAL: 20 });

/**
 * Le genre d'un mur qu'on peut cacher : « secret » (porte secrète) ou « ethereal » (mur éthéré : bloque la vue, se
 * traverse — `client/documents/wall.mjs:94`), sinon null.
 */
export function wallKind({ door, sight, move }) {
  if ( door === DOOR.SECRET ) return "secret";
  if ( (sight !== SENSE.NONE) && (move === SENSE.NONE) ) return "ethereal";
  return null;
}

/**
 * Révéler un mur : ce qu'il faut écrire et ce qu'il faut retenir pour le recacher. Porte secrète → porte ordinaire (son
 * état ouvert / fermé / verrouillé ne change pas) ; mur éthéré → il cesse de bloquer la vue et la lumière.
 * @returns {{ update: object, original: object }|null}
 */
export function revealWall(wall) {
  const kind = wallKind(wall);
  if ( kind === "secret" ) return { update: { door: DOOR.DOOR }, original: { door: wall.door } };
  if ( kind === "ethereal" ) {
    return { update: { sight: SENSE.NONE, light: SENSE.NONE }, original: { sight: wall.sight, light: wall.light } };
  }
  return null;
}

/* ---- textes ---- */

/** La clé du texte générique de découverte, selon ce qui est trouvé. */
export function discoveryKey(kind) {
  return { container: "Cache", macro: "Mechanism", scene: "Passage", document: "Inscription", secret: "SecretDoor",
    ethereal: "Passage", trap: "Trap" }[kind] ?? "Something";
}

/* ---- géométrie ---- */

/** Distance d'un point au segment [a, b]. */
export function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = (dx * dx) + (dy * dy);
  const t = len2 ? Math.max(0, Math.min(1, (((p.x - a.x) * dx) + ((p.y - a.y) * dy)) / len2)) : 0;
  return Math.hypot(a.x + (t * dx) - p.x, a.y + (t * dy) - p.y);
}

/** Le point du segment [a, b] le plus proche de p. */
export function closestOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = (dx * dx) + (dy * dy);
  const t = len2 ? Math.max(0, Math.min(1, (((p.x - a.x) * dx) + ((p.y - a.y) * dy)) / len2)) : 0;
  return { x: a.x + (t * dx), y: a.y + (t * dy) };
}

/** Un point avancé de `step` pixels de `from` vers `to` (pour viser juste devant un mur, du côté de celui qui regarde). */
export function stepToward(from, to, step) {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if ( !d ) return { ...from };
  return { x: from.x + ((to.x - from.x) * step / d), y: from.y + ((to.y - from.y) * step / d) };
}
