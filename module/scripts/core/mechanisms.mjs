/**
 * Mécanismes (étape 13, SPEC §3.13) : leviers, boutons, dalles et leurs actions — règles pures, sans Foundry.
 *
 * Un « DAS · Mécanisme » se déclenche au clic, à l'entrée d'un token, ou les deux. Il fonctionne **à bascule** (deux positions :
 * chaque fois, les actions s'inversent — la porte ouverte se referme), **une fois** (puis plus rien), ou **à chaque fois** (les
 * mêmes actions). Ses actions : porte, lumière, tuile, son, piège, macro.
 */

/** Comment un mécanisme (ou un piège de zone) part : au clic, à l'entrée d'un token, ou les deux. */
export const ACTIVATIONS = Object.freeze(["click", "enter", "both"]);

/** Part-il de cette façon (`how` : « click » ou « enter ») ? Une valeur inconnue vaut « à l'entrée » pour un piège. */
export function activatesOn(activation, how) {
  const a = ACTIVATIONS.includes(activation) ? activation : "enter";
  return (a === "both") || (a === how);
}

export const MECHANISM_MODES = Object.freeze(["toggle", "once", "always"]);

/** Les types d'action, et pour chacun ses effets possibles (le premier par défaut). */
export const ACTION_MODES = Object.freeze({
  door: Object.freeze(["open", "close", "toggle", "lock", "unlock"]),
  light: Object.freeze(["on", "off", "toggle"]),
  tile: Object.freeze(["show", "hide", "toggle"]),
  sound: Object.freeze(["play"]),
  trap: Object.freeze(["fire"]),
  macro: Object.freeze(["gm", "user"])
});
export const ACTION_TYPES = Object.freeze(Object.keys(ACTION_MODES));

/** Les documents qu'une action vise (choisis sur la carte, ou par UUID). Le son vise un fichier. */
export const ACTION_TARGETS = Object.freeze({
  door: Object.freeze(["Wall"]),
  light: Object.freeze(["AmbientLight"]),
  tile: Object.freeze(["Tile"]),
  sound: Object.freeze([]),
  trap: Object.freeze(["RegionBehavior", "Token"]),
  macro: Object.freeze(["Macro"])
});

/** L'effet contraire, pour une bascule qui revient. « toggle », « play », « fire », les macros : le même. */
const OPPOSITE = Object.freeze({ open: "close", close: "open", lock: "unlock", unlock: "lock", on: "off", off: "on", show: "hide", hide: "show" });

/** Une action complète, d'après des données brutes (formulaire, document). */
export function normalizeAction(raw={}) {
  const type = ACTION_TYPES.includes(raw.type) ? raw.type : "door";
  const modes = ACTION_MODES[type];
  const text = v => ((typeof v === "string") ? v.trim() : "");
  const volume = Number(raw.volume);
  return {
    type,
    target: text(raw.target) || null,
    mode: modes.includes(raw.mode) ? raw.mode : modes[0],
    src: text(raw.src),
    volume: (Number.isFinite(volume) && (raw.volume !== "") && (raw.volume !== null)) ? Math.min(1, Math.max(0, volume)) : 0.8
  };
}

/** Une action qui a de quoi agir : une cible (un fichier pour un son). */
export function actionReady(action) {
  return (action.type === "sound") ? !!action.src : !!action.target;
}

/**
 * Ce que fait l'actionnement d'un mécanisme dans cet état : `{ run, reverse, next }` — `run` : faire ses actions ; `reverse` : à
 * rebours (une bascule qui revient) ; `next` : son nouvel état (`active`, `used`).
 */
export function actuation({ mode="toggle", active=false, used=false }={}) {
  if ( mode === "once" ) return used ? { run: false, reverse: false, next: {} } : { run: true, reverse: false, next: { used: true, active: true } };
  if ( mode === "always" ) return { run: true, reverse: false, next: {} };
  return { run: true, reverse: !!active, next: { active: !active } };
}

/** L'effet d'une action, à l'aller ou au retour d'une bascule. */
export function actionMode(action, reverse=false) {
  return reverse ? (OPPOSITE[action.mode] ?? action.mode) : action.mode;
}

/** Au retour d'une bascule, un piège ne repart pas (remettre le levier ne relance pas les fléchettes) ; le reste s'inverse. */
export function runsOnReverse(action) {
  return action.type !== "trap";
}

/**
 * Le changement d'une porte (`ds` du cœur) pour cet effet, ou null s'il n'y a rien à changer. `states` : `CONST.WALL_DOOR_STATES`
 * (CLOSED 0, OPEN 1, LOCKED 2). Ouvrir une porte verrouillée l'ouvre (le mécanisme fait jouer la serrure) ; verrouiller la ferme.
 */
export function doorChange(mode, ds, states={ CLOSED: 0, OPEN: 1, LOCKED: 2 }) {
  let next = ds;
  if ( mode === "open" ) next = states.OPEN;
  else if ( mode === "close" ) next = (ds === states.OPEN) ? states.CLOSED : ds;
  else if ( mode === "toggle" ) next = (ds === states.OPEN) ? states.CLOSED : states.OPEN;
  else if ( mode === "lock" ) next = states.LOCKED;
  else if ( mode === "unlock" ) next = (ds === states.LOCKED) ? states.CLOSED : ds;
  return (next === ds) ? null : { ds: next };
}

/** Le changement d'une lumière ou d'une tuile (`hidden`) pour cet effet, ou null. Allumer / montrer : `hidden` faux. */
export function visibilityChange(mode, hidden) {
  let next = hidden;
  if ( ["on", "show"].includes(mode) ) next = false;
  else if ( ["off", "hide"].includes(mode) ) next = true;
  else if ( mode === "toggle" ) next = !hidden;
  return (next === hidden) ? null : { hidden: next };
}

/** L'image de la tuile du mécanisme dans cette position, ou null si le MJ n'en a pas donné. */
export function imageFor(active, { imageOn="", imageOff="" }={}) {
  const src = active ? imageOn : imageOff;
  return src || null;
}
