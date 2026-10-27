/**
 * Ce qui peut être piégé (SPEC §3.12, 0.16.0) : une zone « DAS · Piège », un conteneur piégé, une porte piégée. Les trois se lisent
 * et s'écrivent ici sous une même forme, la **poignée** de piège, pour que le déclenchement, le désamorçage, la détection et le
 * dessin (runtime/traps.mjs, runtime/hidden.mjs, runtime/highlight.mjs) ne connaissent qu'elle.
 *
 * - zone : les champs du comportement (`system.*`, son option « cachée » en `system.hidden`) ;
 * - conteneur : le groupe `system.trap` du comportement « DAS · Conteneur » ;
 * - porte : le drapeau `flags.darsh-loot.trap` du mur (une porte : `door` ≠ 0), réglé dans la fenêtre du mur.
 *
 * 0.17.0 (pièges v2) : la poignée dit aussi où sont le **déclencheur** (`triggerRegion`, ou la porte), la **source** (`source.doc` :
 * une région ou une tuile ; null : le déclencheur lui-même) avec sa propre détection, et la **zone d'effet** (`effectRegion`).
 */
import { MODULE_ID } from "../shared.mjs";
import { normalizeTrap, isTrapCreatureType } from "../core/traps.mjs";
import { normalizeHidden, concealed, pointSegmentDistance, closestOnSegment, stepToward } from "../core/hidden.mjs";
import { TRAP_ZONE, TRAP_RELAY, sceneTraps } from "./trap-behavior.mjs";
import { CONTAINER_TYPE } from "./container-behavior.mjs";
import { regionDistance, tokenDistance } from "./dnd5e.mjs";
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
    if ( doc.type === TRAP_RELAY ) return trapHandle(fromUuidSync(doc.system.trap ?? "", { strict: false }));
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
  if ( isTrapToken(doc) ) {
    const raw = tokenTrapRaw(doc);
    return handle("token", doc, `flags.${MODULE_ID}.trap.`, { ...normalizeTrap({ enabled: true, ...raw }), trigger: "enter",
      height: Number(raw.height) || 0, actor: doc.actor?.uuid ?? null }, { enabled: true, ...(raw.hidden ?? {}) });
  }
  return null;
}

/* ---- 0.17.0 (étape 11 bis) : le piège porté par un acteur ---- */

/** Les réglages bruts du piège d'un token (ceux de son token prototype, recopiés à la pose, puis les siens). */
const tokenTrapRaw = token => token.getFlag(MODULE_ID, "trap") ?? {};

/**
 * Un acteur piège : un PNJ de type de créature « Trap » (les pièges du DMG 2024), ou dont le token prototype porte un piège coché. Son
 * token posé est un piège ; décoché sur le token, il n'en est plus un.
 */
export function isTrapActor(actor) {
  if ( !actor ) return false;
  const flag = actor.prototypeToken?.flags?.[MODULE_ID]?.trap?.enabled;
  if ( typeof flag === "boolean" ) return flag;
  return (actor.type === "npc") && isTrapCreatureType(actor.system?.details?.type);
}

/** Un token piège (acteur piège, réglage du token pas décoché). */
export function isTrapToken(token) {
  if ( token?.documentName !== "Token" ) return false;
  const flag = token.getFlag(MODULE_ID, "trap")?.enabled;
  return (typeof flag === "boolean") ? flag : isTrapActor(token.actor);
}

/** Les tokens pièges d'une scène. */
export const sceneTrapTokens = scene => (scene?.tokens ?? []).filter(isTrapToken);

/** La région que le module pose sous un token piège (ses cases : déclencheur et zone d'effet par défaut), s'il y en a une. */
export function autoRegionOf(token) {
  return token?.parent?.regions.find(r => r.getFlag(MODULE_ID, "trapToken") === token.id) ?? null;
}

/** Un document de la scène désigné par son UUID (région, tuile), ou null s'il n'existe pas ou est ailleurs. */
function placed(uuid, scene, types) {
  if ( !uuid ) return null;
  const doc = fromUuidSync(uuid, { strict: false });
  return (doc && types.includes(doc.documentName) && (doc.parent === scene)) ? doc : null;
}

function handle(kind, doc, prefix, trap, hidden) {
  if ( kind === "token" ) return tokenHandle(doc, prefix, trap, hidden);
  const region = (kind === "door") ? null : doc.region;
  const scene = (kind === "door") ? doc.parent : region?.parent;
  // Zone d'effet et déclencheur. Une zone 0.17.0 : sa région est la zone d'effet, le déclencheur est désigné (vide : elle-même).
  // Une zone de la 0.16.0 pas encore reprise : sa région est le déclencheur, la zone d'effet est désignée. Un coffre : il est le
  // déclencheur, la zone d'effet est désignée (vide : celui qui ouvre). Une porte : idem, sans région de déclencheur.
  const legacy = (kind === "zone") ? placed(trap.effectRegion, scene, ["Region"]) : null;
  let triggerRegion, effectRegion;
  if ( kind === "zone" ) {
    triggerRegion = legacy ? region : (placed(trap.triggerRegion, scene, ["Region"]) ?? region);
    effectRegion = legacy ?? region;
  } else {
    triggerRegion = region;
    effectRegion = placed(trap.effectRegion, scene, ["Region"]);
  }
  const sourceDoc = placed(trap.source?.uuid, scene, ["Region", "Tile"]);
  return {
    kind, doc, uuid: doc.uuid,
    scene,
    region,
    wall: (kind === "door") ? doc : null,
    triggerRegion, effectRegion,
    source: { doc: sourceDoc, hidden: normalizeHidden({ enabled: true, ...(trap.source?.hidden ?? {}) }) },
    trap: { ...trap, actor: trap.actor ?? null, activity: trap.activity ?? "", effectRegion: trap.effectRegion ?? null,
      minSize: trap.minSize ?? "sm", initiative: trap.initiative ?? 20 },
    hidden: normalizeHidden(hidden),
    name: (kind === "door") ? "" : (doc.system.displayName || region?.name || ""),
    prefix,
    /** Écrire des champs du piège : `{ armed: false, "hidden.found": true }`. */
    update: changes => doc.update(Object.fromEntries(Object.entries(changes).map(([k, v]) => [prefix + k, v])))
  };
}

/**
 * La poignée d'un token piège. Par défaut, la région que le module pose sous lui (`autoRegionOf`) est son déclencheur et sa zone
 * d'effet, et le token est le déclencheur même (une seule détection). Un déclencheur désigné ailleurs (une dalle) fait du token la
 * **source** (les orifices, la statue), avec sa propre détection ; une source désignée (région, tuile) passe avant.
 */
function tokenHandle(token, prefix, trap, hidden) {
  const scene = token.parent;
  const auto = autoRegionOf(token);
  const trigger = placed(trap.triggerRegion, scene, ["Region"]);
  const sourceDoc = placed(trap.source?.uuid, scene, ["Region", "Tile"]) ?? (trigger ? token : null);
  return {
    kind: "token", doc: token, uuid: token.uuid,
    scene,
    region: auto,
    wall: null,
    token,
    triggerRegion: trigger ?? auto,
    effectRegion: placed(trap.effectRegion, scene, ["Region"]) ?? auto,
    source: { doc: sourceDoc, hidden: normalizeHidden({ enabled: true, ...(trap.source?.hidden ?? {}) }) },
    trap: { ...trap, activity: trap.activity ?? "", minSize: trap.minSize ?? "sm", initiative: trap.initiative ?? 20 },
    hidden: normalizeHidden(hidden),
    name: token.name ?? "",
    prefix,
    update: changes => token.update(Object.fromEntries(Object.entries(changes).map(([k, v]) => [prefix + k, v])))
  };
}

/** Le déclencheur repéré (trouvé, ou jamais caché) et pas désamorcé : il se montre en rouge et se désamorce. */
export const handleKnown = h => !!h && !concealed(h.hidden) && !h.trap.disarmed;

/**
 * La source repérée (0.17.0), et pas désamorcée : elle se montre en rouge, et la zone d'effet avec elle. Sans source à part, c'est le
 * déclencheur qui compte.
 */
export const sourceKnown = h => !!h && !h.trap.disarmed && (h.source.doc ? !concealed(h.source.hidden) : !concealed(h.hidden));

/** Le piège est-il repéré, par son déclencheur ou par sa source ? */
export const anyKnown = h => handleKnown(h) || sourceKnown(h);

/** Tous les pièges d'une scène, sous forme de poignées : zones, coffres, portes, et (0.17.0) tokens pièges. */
export function allTraps(scene) {
  if ( !scene ) return [];
  return [...sceneTraps(scene).map(trapHandle).filter(Boolean), ...trappedThings(scene), ...sceneTrapTokens(scene).map(trapHandle)];
}

/** Distance d'un token à une tuile (sa boîte), en unités de la scène. */
export function tileDistance(token, tile) {
  const scene = token.parent;
  if ( tile.parent !== scene ) return Infinity;
  const size = scene.grid.size;
  const c = tokenCenter(token);
  const dx = Math.max(tile.x - c.x, 0, c.x - (tile.x + tile.width));
  const dy = Math.max(tile.y - c.y, 0, c.y - (tile.y + tile.height));
  const px = Math.hypot(dx, dy) - (Math.min(token._source.width, token._source.height) * size / 2);
  return Math.max(0, px) / size * scene.grid.distance;
}

/** Distance d'un token à une région, une tuile ou un token (piège). */
export function placeDistance(token, doc) {
  if ( doc.documentName === "Tile" ) return tileDistance(token, doc);
  if ( doc.documentName === "Token" ) return (doc.parent === token.parent) ? tokenDistance(token, doc) : Infinity;
  return regionDistance(token, doc);
}

/** Le point visé dans une région, une tuile ou un token, pour la ligne de vue : le centre du token s'il est dedans, sinon le centre de la forme. */
function aimAt(doc, token) {
  if ( doc.documentName === "Tile" ) return { x: doc.x + (doc.width / 2), y: doc.y + (doc.height / 2) };
  if ( doc.documentName === "Token" ) return tokenCenter(doc);
  const c = tokenCenter(token);
  const r = doc.bounds;
  return doc.polygonTree.testPoint(c) ? c : { x: r.x + (r.width / 2), y: r.y + (r.height / 2) };
}

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

/** Distance d'un token au déclencheur (sa région, ou la porte). */
export function handleDistance(token, h) {
  if ( h.wall ) return wallDistance(token, h.wall);
  const region = h.triggerRegion ?? h.region;
  if ( !region ) return h.token ? placeDistance(token, h.token) : Infinity;
  return regionDistance(token, region);
}

/** Distance d'un token au piège pour le désamorcer : au plus proche de ce qui en est repéré, déclencheur ou source. */
export function trapDistance(token, h) {
  const parts = [];
  if ( handleKnown(h) || !h.source.doc ) parts.push(handleDistance(token, h));
  if ( h.source.doc && sourceKnown(h) ) parts.push(placeDistance(token, h.source.doc));
  return parts.length ? Math.min(...parts) : handleDistance(token, h);
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
  // Une zone garde ses essais où la 0.16.0 les notait (`tried`) ; un coffre ou une porte, à part (`trapTried`).
  const triedFlag = (h.kind === "zone") ? "tried" : "trapTried";
  const base = {
    kind: "trap", key: `${h.uuid}#trap`, doc: h.doc, hidden: h.hidden, scene: h.scene,
    tried: h.doc.getFlag(MODULE_ID, triedFlag) ?? [],
    triedFlag,
    markFound: () => h.update({ "hidden.found": true }),
    distance: token => handleDistance(token, h)
  };
  if ( h.wall ) {
    const [a, b] = wallEnds(h.wall);
    return { ...base, level: h.wall, aim: token => stepToward(closestOnSegment(tokenCenter(token), a, b), tokenCenter(token), 4) };
  }
  const region = h.triggerRegion ?? h.region;
  return { ...base, level: region, aim: token => aimAt(region, token) };
}

/**
 * La source encore cachée d'un piège (0.17.0), sous la même forme : elle se trouve à part, avec sa compétence et son DD. Ses essais
 * ratés sont notés à part (`sourceTried`).
 */
export function sourceThing(h) {
  const doc = h.source.doc;
  return {
    kind: "trapSource", key: `${h.uuid}#source`, doc: h.doc, hidden: h.source.hidden, scene: h.scene,
    tried: h.doc.getFlag(MODULE_ID, "sourceTried") ?? [],
    triedFlag: "sourceTried",
    markFound: () => h.update({ "source.hidden.found": true }),
    distance: token => placeDistance(token, doc),
    level: doc,
    aim: token => aimAt(doc, token)
  };
}

/**
 * Ce qui est encore caché des pièges d'une scène (ni trouvé ni désamorcé) : leurs déclencheurs et leurs sources à part. Les zones
 * « DAS · Piège » en font partie depuis la 0.17.0 (leur déclencheur peut être ailleurs que leur région).
 */
export function concealedTraps(scene) {
  const out = [];
  for ( const h of allTraps(scene) ) {
    if ( h.trap.disarmed ) continue;
    if ( concealed(h.hidden) && (h.wall || h.triggerRegion || h.region) ) out.push(trapThing(h));
    if ( h.source.doc && concealed(h.source.hidden) ) out.push(sourceThing(h));
  }
  return out;
}

/**
 * Une région que les pièges cachent encore (0.17.0) : le déclencheur d'une zone « DAS · Piège » pas encore repéré, ou une source
 * pas encore repérée. Ses tuiles restent cachées et ses comportements du cœur désactivés (runtime/hidden.mjs), comme une zone cachée.
 * Le coffre piégé lui-même reste visible : seul son piège est caché.
 */
export function regionHiddenByTraps(region) {
  for ( const h of allTraps(region.parent) ) {
    if ( h.trap.disarmed ) continue;
    if ( ["zone", "token"].includes(h.kind) && (h.triggerRegion === region) && concealed(h.hidden) ) return true;
    if ( (h.source.doc === region) && concealed(h.source.hidden) ) return true;
  }
  return false;
}

/** Les tuiles sources que les pièges cachent encore. */
export function tilesHiddenByTraps(scene) {
  return allTraps(scene).filter(h => !h.trap.disarmed && (h.source.doc?.documentName === "Tile") && concealed(h.source.hidden))
    .map(h => h.source.doc);
}
