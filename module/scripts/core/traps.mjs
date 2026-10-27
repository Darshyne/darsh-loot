/**
 * Les DD d'un piège du DMG 2024, lus dans le texte de sa capacité (SPEC §3.12). Le DMG ne les range dans aucun champ : ils
 * sont dans le paragraphe « Détection et désarmement », sous forme de liens de jet de dnd5e (`[[/check prc 15]]`,
 * `[[/check DC prc 10]]`, `[[/check skill=inv dc=15]]`), qui gardent la même forme en anglais et en français.
 *
 * - **Détection** : parmi les tests de Perception ou d'Investigation, le plus petit DD (un piège peut en avoir deux : le
 *   glyphe de la statue, DD 10, et sa dalle, DD 15 — repérer l'un ou l'autre, c'est repérer le piège).
 * - **Désamorçage** : le test d'Escamotage (outils de voleur) s'il y en a un ; le DMG dit alors qu'un échec déclenche le
 *   piège (l'aiguille empoisonnée). Sans test, le piège se neutralise une fois repéré (fil à couper, pointe à caler) : DD 1,
 *   un échec ne fait rien.
 */

const DETECT = new Set(["prc", "inv"]);
const DISARM = new Set(["slt"]);

/** Les tests `[[/check …]]` d'un texte : `{ skill, dc }` (compétence en abrégé dnd5e, DD). */
export function checksIn(text) {
  const out = [];
  for ( const match of String(text ?? "").matchAll(/\[\[\/check\s+([^\]]+)\]\]/gi) ) {
    let skill = null, dc = null;
    for ( const token of match[1].trim().split(/\s+/) ) {
      const [key, value] = token.includes("=") ? token.split("=") : [null, token];
      const k = key?.toLowerCase();
      if ( (k === "dc") && /^\d+$/.test(value) ) dc = Number(value);
      else if ( ["skill", "ability"].includes(k) ) skill ??= value.toLowerCase();
      else if ( !k && /^\d+$/.test(value) ) dc ??= Number(value);
      else if ( !k && /^[a-z]{3}$/i.test(value) && (value.toLowerCase() !== "dc") ) skill ??= value.toLowerCase();
    }
    if ( skill && Number.isFinite(dc) ) out.push({ skill, dc });
  }
  return out;
}

/**
 * Les réglages d'un piège tirés de ses textes : `{ hidden: { skill, dc } | null, disarmDc, failure }` ; null si aucun test de
 * détection n'est trouvé (un acteur fait main : on ne touche à rien).
 * @param {string[]} texts  Les descriptions de ses objets (HTML).
 */
export function trapChecks(texts) {
  const checks = texts.flatMap(t => checksIn(t));
  const detect = checks.filter(c => DETECT.has(c.skill)).sort((a, b) => a.dc - b.dc)[0] ?? null;
  if ( !detect ) return null;
  const disarm = checks.find(c => DISARM.has(c.skill)) ?? null;
  return {
    hidden: { skill: detect.skill, dc: detect.dc },
    disarmDc: disarm ? disarm.dc : 1,
    failure: disarm ? "trigger" : "nothing"
  };
}

/**
 * La tranche de niveaux qu'une activité de piège annonce dans son nom (DMG 2024 : « Déclenchement (niveaux 1 à 4) »,
 * « Trigger (Levels 5–10) ») : `{ min, max }`, ou null si le nom n'en dit rien.
 */
export function tierRange(name) {
  const match = String(name ?? "").match(/(\d+)\s*(?:–|—|-|à|a|to)\s*(\d+)/i);
  if ( !match ) return null;
  const [min, max] = [Number(match[1]), Number(match[2])];
  return (min <= max) ? { min, max } : null;
}

/**
 * L'activité d'un piège qui convient à ce niveau (SPEC §3.12) : celle dont la tranche le contient ; au-dessus de toutes, la
 * plus haute ; en dessous, la plus basse. Null si aucune activité n'annonce de tranche (piège fait main) ou sans niveau.
 * @param {{ id: string, name: string }[]} activities
 * @param {number|null} level
 */
export function pickTier(activities, level) {
  if ( !Number.isFinite(level) ) return null;
  const tiers = activities.map(a => ({ id: a.id, range: tierRange(a.name) })).filter(t => t.range)
    .sort((a, b) => a.range.min - b.range.min);
  if ( !tiers.length ) return null;
  const inside = tiers.find(t => (level >= t.range.min) && (level <= t.range.max));
  if ( inside ) return inside.id;
  return (level > tiers.at(-1).range.max) ? tiers.at(-1).id : tiers[0].id;
}

/**
 * Le niveau qui choisit la tranche, d'après les cibles : le plus haut niveau des personnages ; sans personnage parmi elles,
 * le plus haut FP des créatures (au moins 1). Null sans cible.
 * @param {{ character: boolean, level: number }[]} targets
 */
export function targetsLevel(targets) {
  const pcs = targets.filter(t => t.character && Number.isFinite(t.level));
  const pool = pcs.length ? pcs : targets.filter(t => Number.isFinite(t.level));
  if ( !pool.length ) return null;
  return Math.max(...pool.map(t => (t.character ? t.level : Math.max(1, Math.floor(t.level)))));
}

/* ---- coffres et portes piégés (0.16.0) ---- */

/**
 * Réglages d'un piège posé sur un coffre (`system.trap` du conteneur) ou une porte (`flags.darsh-loot.trap` du mur), par défaut.
 * Mêmes champs que le comportement « DAS · Piège », plus `enabled` (le coffre ou la porte est-il piégé ?) et `trigger` (quand il
 * part : à l'ouverture, au crochetage raté, ou les deux). Sans zone d'effet, il ne touche que celui qui ouvre.
 */
export const TRAP_DEFAULTS = Object.freeze({
  enabled: false, actor: null, activity: "", effectRegion: null, triggerRegion: null, trigger: "open", armed: true, rearm: "never", delay: 60,
  triggeredAt: null, disarmDc: 15, failure: "trigger", disarmed: false, minSize: "sm", initiative: 20, source: Object.freeze({ uuid: null, hidden: {} })
});

const TRIGGERS = ["open", "pick", "both"];
const REARMS = ["never", "gm", "time"];

/** Les réglages complets d'un piège de coffre ou de porte ; `hidden` passe par `normalizeHiddenTrap` (fourni par l'appelant). */
export function normalizeTrap(raw={}) {
  const d = TRAP_DEFAULTS;
  const num = (v, def, min) => (Number.isFinite(Number(v)) && (v !== null) && (v !== "") && (Number(v) >= min)) ? Number(v) : def;
  const uuid = v => ((typeof v === "string") && v.trim()) ? v.trim() : null;
  return {
    enabled: raw.enabled === true,
    actor: uuid(raw.actor),
    activity: (typeof raw.activity === "string") ? raw.activity.trim() : "",
    effectRegion: uuid(raw.effectRegion),
    triggerRegion: uuid(raw.triggerRegion),
    trigger: TRIGGERS.includes(raw.trigger) ? raw.trigger : d.trigger,
    armed: raw.armed !== false,
    rearm: REARMS.includes(raw.rearm) ? raw.rearm : d.rearm,
    delay: num(raw.delay, d.delay, 0),
    triggeredAt: (Number.isFinite(Number(raw.triggeredAt)) && (raw.triggeredAt !== null) && (raw.triggeredAt !== "")) ? Number(raw.triggeredAt) : null,
    disarmDc: Math.min(40, Math.round(num(raw.disarmDc, d.disarmDc, 1))),
    failure: (raw.failure === "nothing") ? "nothing" : "trigger",
    disarmed: raw.disarmed === true,
    minSize: SIZES.includes(raw.minSize) ? raw.minSize : d.minSize,
    initiative: normalizeInitiative(raw.initiative),
    source: { uuid: uuid(raw.source?.uuid), hidden: raw.source?.hidden ?? {} }
  };
}

/** Le piège part-il à ce moment (« open » : on ouvre ; « pick » : un crochetage raté) ? Un piège de zone n'a pas de `trigger`. */
export function triggersOn(trap, moment) {
  const trigger = trap?.trigger ?? "open";
  return (trigger === "both") || (trigger === moment);
}

/**
 * Le piège est-il armé à cet instant (temps du monde, secondes) ? Désamorcé : non ; armé : oui ; sinon, réarmé par délai si le délai
 * (minutes) est écoulé depuis son dernier déclenchement.
 */
export function armedAt(trap, now) {
  if ( !trap || trap.disarmed ) return false;
  if ( trap.armed ) return true;
  return (trap.rearm === "time") && Number.isFinite(trap.triggeredAt) && (now >= trap.triggeredAt + (trap.delay * 60));
}

/* ---- pièges v2 (étape 11) ---- */

/** Les tailles dnd5e, de la plus petite à la plus grande (`CONFIG.DND5E.actorSizes`), recopiées pour rester pur. */
export const SIZES = Object.freeze(["tiny", "sm", "med", "lg", "huge", "grg"]);

/**
 * Une créature de cette taille déclenche-t-elle un piège réglé à cette taille minimale (« sm » par défaut : un rat, un familier
 * Très petit passent) ? Une taille inconnue déclenche.
 */
export function bigEnough(size, minSize="sm") {
  const i = SIZES.indexOf(size), min = SIZES.indexOf(minSize);
  return (i < 0) || (min < 0) || (i >= min);
}

/** La taille d'un token sans acteur, d'après sa largeur en cases (½ : Très petite, 1 : Moyenne, 2 : Grande…). */
export function sizeOfSpan(cells) {
  const n = Number(cells);
  if ( !(n > 0) ) return "med";
  if ( n < 1 ) return "tiny";
  return SIZES[Math.min(5, Math.floor(n) + 1)];
}

/** L'initiative d'un piège (2026-10-27) : un entier de 1 à 40, 20 par défaut. */
export function normalizeInitiative(value) {
  const n = Number(value);
  return ((value === null) || (value === "") || !Number.isFinite(n)) ? 20 : Math.min(40, Math.max(1, Math.round(n)));
}

/**
 * La reprise d'un piège de zone de la 0.16.0 (posé sur sa dalle, la zone d'effet ailleurs) vers la 0.17.0 (posé sur sa zone
 * d'effet, la dalle désignée comme déclencheur). `system` : les données du comportement ; `regionUuid` : sa région. Null s'il n'y a
 * rien à reprendre (pas de zone d'effet à part, ou déjà repris).
 * @returns {{ effectRegion: string, system: object }|null}
 */
export function migrateZoneTrap(system, regionUuid) {
  const effect = system?.effectRegion;
  if ( !effect || (effect === regionUuid) || system.triggerRegion ) return null;
  return { effectRegion: effect, system: { ...clone(system), effectRegion: null, triggerRegion: regionUuid } };
}

const clone = o => JSON.parse(JSON.stringify(o ?? {}));

/* ---- piège porté par un acteur (étape 11 bis) ---- */

/**
 * Un acteur piège à sa nature : un PNJ au type de créature libre « Trap » (les pièges du DMG 2024 : `details.type.value` « custom »,
 * `custom` « Trap ») ou « Piège » (traduit). `type` : `system.details.type` de dnd5e.
 */
export function isTrapCreatureType(type) {
  return (type?.value === "custom") && /^(traps?|pièges?)$/i.test(String(type?.custom ?? "").trim());
}
