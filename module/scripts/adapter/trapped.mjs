/**
 * Ce qui peut être piégé (SPEC §3.12, 0.16.0) : une zone « DAS · Piège », un conteneur piégé, une porte piégée. Les trois se lisent
 * et s'écrivent ici sous une même forme, la **poignée** de piège, pour que le déclenchement, le désamorçage, la détection et le
 * dessin (runtime/traps.mjs, runtime/hidden.mjs, runtime/highlight.mjs) ne connaissent qu'elle.
 *
 * - zone : les champs du comportement (`system.*`, son option « cachée » en `system.hidden`) ;
 * - conteneur : le groupe `system.trap` du comportement « DAS · Conteneur » ;
 * - porte : le drapeau `flags.darsh-loot.trap` du mur (une porte : `door` ≠ 0), réglé dans la fenêtre du mur.
 */
import { MODULE_ID } from "../shared.mjs";
import { normalizeTrap } from "../core/traps.mjs";
import { normalizeHidden, concealed, pointSegmentDistance, closestOnSegment, stepToward } from "../core/hidden.mjs";
import { TRAP_ZONE } from "./trap-behavior.mjs";
import { CONTAINER_TYPE } from "./container-behavior.mjs";
import { regionDistance } from "./dnd5e.mjs";
import { tokenCenter } from "./hidden.mjs";

/** Une porte (porte ou porte secrète du cœur) ? */
export const isDoorWall = wall => (wall?.documentName === "Wall") && (Number(wall.door) > 0);

/** Les réglages bruts du piège d'une porte. */
const doorTrapRaw = wall => wall.getFlag(MODULE_ID, "trap") ?? {};

/**
 * La poignée de piège de ce document, ou null s'il ne porte pas de piège actif.
 * @returns {{ kind: "zone"|"container"|"door", doc, uuid, scene, region: RegionDocument|null, wall: WallDocument|null,
 *   trap: object, hidden: object, name: string, update: (changes: object) => Promise }|null}
 */
export function trapHandle(doc) {
  if ( !doc ) return null;
  if ( doc.documentName === "RegionBehavior" ) {
    if ( doc.disabled ) return null;
    if ( doc.type === TRAP_ZONE ) return handle("zone", doc, "system.", { ...doc.system.toObject(), trigger: "enter" }, doc.system.hidden);
    if ( (doc.type === CONTAINER_TYPE) && doc.system.trap?.enabled ) {
      return handle("container", doc, "system.trap.", foundry.utils.deepClone(doc.system.trap), doc.system.trap.hidden);
    }
    return null;
  }
  if ( isDoorWall(doc) ) {
    const raw = doorTrapRaw(doc);
    if ( raw.enabled !== true ) return null;
    // Un piège est caché par nature : sans réglage « caché » écrit, il l'est.
    return handle("door", doc, `flags.${MODULE_ID}.trap.`, normalizeTrap(raw), { enabled: true, ...(raw.hidden ?? {}) });
  }
  return null;
}

function handle(kind, doc, prefix, trap, hidden) {
  const region = (kind === "door") ? null : doc.region;
  return {
    kind, doc, uuid: doc.uuid,
    scene: (kind === "door") ? doc.parent : region?.parent,
    region,
    wall: (kind === "door") ? doc : null,
    trap: { ...trap, actor: trap.actor ?? null, activity: trap.activity ?? "", effectRegion: trap.effectRegion ?? null },
    hidden: normalizeHidden(hidden),
    name: (kind === "door") ? "" : (doc.system.displayName || region?.name || ""),
    prefix,
    /** Écrire des champs du piège : `{ armed: false, "hidden.found": true }`. */
    update: changes => doc.update(Object.fromEntries(Object.entries(changes).map(([k, v]) => [prefix + k, v])))
  };
}

/** Repéré (trouvé, ou jamais caché) et pas désamorcé : il se montre en rouge et se désamorce. */
export const handleKnown = h => !!h && !concealed(h.hidden) && !h.trap.disarmed;

/** Les deux extrémités d'un mur. */
export function wallEnds(wall) {
  const [ax, ay, bx, by] = wall.c;
  return [{ x: ax, y: ay }, { x: bx, y: by }];
}

/** Distance d'un token à un mur, en unités de la scène (de son bord au segment). */
export function wallDistance(token, wall) {
  const scene = token.parent;
  if ( wall.parent !== scene ) return Infinity;
  const size = scene.grid.size;
  const [a, b] = wallEnds(wall);
  const c = { x: token._source.x + (token._source.width * size / 2), y: token._source.y + (token._source.height * size / 2) };
  const px = pointSegmentDistance(c, a, b) - (Math.min(token._source.width, token._source.height) * size / 2);
  return Math.max(0, px) / size * scene.grid.distance;
}

/** Distance d'un token à ce qui est piégé (la région de la zone ou du coffre, ou la porte). */
export function handleDistance(token, h) {
  return h.wall ? wallDistance(token, h.wall) : regionDistance(token, h.region);
}

/** Les conteneurs et les portes piégés d'une scène (pas les zones « DAS · Piège », lues par `sceneTraps`). */
export function trappedThings(scene) {
  const out = [];
  if ( !scene ) return out;
  for ( const region of scene.regions ) {
    for ( const behavior of region.behaviors ) {
      if ( behavior.type !== CONTAINER_TYPE ) continue;
      const h = trapHandle(behavior);
      if ( h ) out.push(h);
    }
  }
  for ( const wall of scene.walls ) {
    const h = trapHandle(wall);
    if ( h ) out.push(h);
  }
  return out;
}

/**
 * Le piège encore caché d'un coffre ou d'une porte, sous la forme commune des objets cachés (adapter/hidden.mjs) : la détection
 * passive et la fouille active le trouvent comme une cachette. Les essais ratés sont notés à part (`trapTried`), pour ne pas se
 * mêler à ceux d'une cachette ou d'une porte secrète portée par le même document.
 */
export function trapThing(h) {
  const base = {
    kind: "trap", key: `${h.uuid}#trap`, doc: h.doc, hidden: h.hidden, scene: h.scene,
    tried: h.doc.getFlag(MODULE_ID, "trapTried") ?? [],
    triedFlag: "trapTried",
    markFound: () => h.update({ "hidden.found": true }),
    distance: token => handleDistance(token, h)
  };
  if ( h.wall ) {
    const [a, b] = wallEnds(h.wall);
    return { ...base, level: h.wall, aim: token => stepToward(closestOnSegment(tokenCenter(token), a, b), tokenCenter(token), 4) };
  }
  const region = h.region;
  return { ...base, level: region, aim: token => {
    const c = tokenCenter(token);
    const r = region.bounds;
    return region.polygonTree.testPoint(c) ? c : { x: r.x + (r.width / 2), y: r.y + (r.height / 2) };
  } };
}

/** Les pièges de coffre et de porte encore cachés (ni trouvés ni désamorcés) d'une scène. */
export function concealedTraps(scene) {
  return trappedThings(scene).filter(h => concealed(h.hidden) && !h.trap.disarmed).map(trapThing);
}
