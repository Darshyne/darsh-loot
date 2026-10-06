/**
 * Ce qui est caché sur une scène (SPEC §3.12, option « cachée ») : les zones DAS cachées (champ `system.hidden`) et les
 * murs cachés (porte secrète, mur éthéré : `flags.darsh-loot.hidden`). Lecture seulement : les écritures sont dans
 * runtime/hidden.mjs, chez le MJ.
 */
import { MODULE_ID } from "../shared.mjs";
import { normalizeHidden, concealed, wallKind, pointSegmentDistance, closestOnSegment, stepToward, HIDDEN_DEFAULTS }
  from "../core/hidden.mjs";
import { regionDistance } from "./dnd5e.mjs";

const fields = foundry.data.fields;

/** Le groupe de champs `hidden` d'une zone DAS (une instance par type : le cœur localise chaque champ une fois). */
export function hiddenField() {
  const d = HIDDEN_DEFAULTS;
  return new fields.SchemaField({
    enabled: new fields.BooleanField({ initial: d.enabled }),
    skill: new fields.StringField({ required: true, blank: false, initial: d.skill,
      choices: { prc: "DND5E.SkillPrc", inv: "DND5E.SkillInv" } }),
    dc: new fields.NumberField({ required: true, integer: true, min: 1, max: 40, initial: d.dc }),
    passive: new fields.NumberField({ required: true, min: 0, max: 120, initial: d.passive }),
    radius: new fields.NumberField({ required: true, min: 0, max: 120, initial: d.radius }),
    found: new fields.BooleanField({ initial: d.found }),
    text: new fields.StringField({ required: true, blank: true, initial: d.text })
  });
}

/** Les types de zones DAS (tous ont le champ `hidden`). */
const isDasZone = behavior => behavior.type?.startsWith(`${MODULE_ID}.`);

/** Une zone DAS encore cachée aux joueurs ? */
export const behaviorConcealed = behavior => isDasZone(behavior) && concealed(behavior.system?.hidden);

/** Une région porte-t-elle une zone DAS encore cachée ? */
export const regionConcealed = region => region.behaviors.some(b => !b.disabled && behaviorConcealed(b));

/** Réglages d'un mur caché (drapeaux), complets. */
export const wallHidden = wall => normalizeHidden(wall.getFlag(MODULE_ID, "hidden") ?? {});

/**
 * Un objet caché d'une scène, sous une forme commune : `{ kind, doc, hidden, tried, target(token) }`. `kind` dit ce qu'on
 * trouve (container, macro, scene, document, secret, ethereal) ; `target(token)` rend le point visé pour la ligne de vue
 * et la distance (en unités de la scène) depuis ce token.
 */
function zoneThing(behavior) {
  const region = behavior.region;
  return {
    kind: behavior.type.slice(MODULE_ID.length + 1),
    key: behavior.uuid,
    doc: behavior,
    hidden: normalizeHidden(behavior.system.hidden),
    tried: behavior.getFlag(MODULE_ID, "tried") ?? [],
    scene: region.parent,
    distance: token => regionDistance(token, region),
    // Le point de la région le plus proche du token : son centre s'il est dedans, sinon le plus proche des sommets.
    aim: token => {
      const c = tokenCenter(token);
      const b = region.bounds;
      const center = { x: b.x + (b.width / 2), y: b.y + (b.height / 2) };
      return region.polygonTree.testPoint(c) ? c : center;
    },
    level: region
  };
}

function wallThing(wall) {
  const [ax, ay, bx, by] = wall.c;
  const a = { x: ax, y: ay }, b = { x: bx, y: by };
  return {
    kind: wallKind(wall),
    key: wall.uuid,
    doc: wall,
    hidden: wallHidden(wall),
    tried: wall.getFlag(MODULE_ID, "tried") ?? [],
    scene: wall.parent,
    distance: token => {
      const scene = token.parent;
      const px = pointSegmentDistance(tokenCenter(token), a, b) - (Math.min(token._source.width, token._source.height) * scene.grid.size / 2);
      return Math.max(0, px) / scene.grid.size * scene.grid.distance;
    },
    // Juste devant le mur, du côté du token : le mur lui-même (un mur éthéré bloque la vue) ne doit pas compter.
    aim: token => {
      const c = tokenCenter(token);
      return stepToward(closestOnSegment(c, a, b), c, 4);
    },
    level: wall
  };
}

/** Tout ce qui est encore caché sur une scène. */
export function concealedThings(scene) {
  const out = [];
  if ( !scene ) return out;
  for ( const region of scene.regions ) {
    for ( const behavior of region.behaviors ) {
      if ( !behavior.disabled && behaviorConcealed(behavior) ) out.push(zoneThing(behavior));
    }
  }
  for ( const wall of scene.walls ) {
    const h = wallHidden(wall);
    if ( concealed(h) && wallKind(wall) ) out.push(wallThing(wall));
  }
  return out;
}

/** Retrouver un objet caché par son UUID (zone ou mur). */
export function thingOf(uuid) {
  const doc = fromUuidSync(uuid, { strict: false });
  if ( !doc ) return null;
  if ( doc.documentName === "Wall" ) return wallKind(doc) ? wallThing(doc) : null;
  if ( (doc.documentName === "RegionBehavior") && isDasZone(doc) ) return zoneThing(doc);
  return null;
}

/** Centre d'un token, en pixels de la scène (positions de `_source`). */
export function tokenCenter(token) {
  const size = token.parent.grid.size;
  return { x: token._source.x + (token._source.width * size / 2), y: token._source.y + (token._source.height * size / 2) };
}

/** Le même niveau ? (V14 : une région ou un mur hors du niveau du token ne se voit pas.) */
function sameLevel(token, doc) {
  const level = token._source.level;
  if ( !level || (typeof doc.includedInLevel !== "function") ) return true;
  return doc.includedInLevel(level);
}

/**
 * Le token voit-il ce point sans mur entre eux ? Testé sur le canevas du client (le MJ actif) : si sa scène affichée n'est
 * pas celle du token, on ne peut pas tester et l'on répond oui.
 */
export function lineOfSight(token, point) {
  const scene = token.parent;
  if ( canvas.scene !== scene ) return true;
  const origin = { ...tokenCenter(token), elevation: token._source.elevation ?? 0 };
  const level = scene.levels?.get?.(token._source.level) ?? canvas.level;
  try {
    return !CONFIG.Canvas.polygonBackends.sight.testCollision(origin, { ...point, elevation: origin.elevation },
      { type: "sight", mode: "any", level });
  } catch(err) {
    return true;
  }
}

/** Le token atteint-il cet objet : même niveau, à la distance donnée, et en ligne de vue ? */
export function reaches(token, thing, distance) {
  if ( thing.scene !== token.parent ) return false;
  if ( !sameLevel(token, thing.level) ) return false;
  if ( thing.distance(token) > distance ) return false;
  return lineOfSight(token, thing.aim(token));
}

/** La valeur passive d'une compétence (dnd5e : `system.skills.<id>.passive`). */
export function passiveScore(actor, skill) {
  return actor?.system?.skills?.[skill]?.passive ?? 0;
}

/** Les tuiles posées dans une région (leur point d'ancrage dans son polygone) : elles se cachent et se révèlent avec elle. */
export function tilesIn(region) {
  return region.parent.tiles.filter(t => region.polygonTree.testPoint({ x: t.x, y: t.y }) && sameLevelDoc(t, region));
}

function sameLevelDoc(tile, region) {
  const levels = tile.levels;
  if ( !levels?.size || (typeof region.includedInLevel !== "function") ) return true;
  return [...levels].some(id => region.includedInLevel(id));
}

/** Un personnage de joueur (un token qu'un joueur possède) : c'est lui qui découvre. */
export const playerToken = token => !!token?.actor?.hasPlayerOwner;
