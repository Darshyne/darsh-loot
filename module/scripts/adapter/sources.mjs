/**
 * Une « source » de butin : ce qu'on fouille. Un cadavre (token d'un PNJ mort), un conteneur (comportement de
 * région), les poches d'un PNJ vivant, la boutique d'un marchand. La fenêtre, la prise et les contrôles du MJ ne connaissent que cette forme commune.
 */
import { loc } from "../shared.mjs";
import { corpseToken, tokenDistance, regionDistance } from "./dnd5e.mjs";
import { CONTAINER_TYPE } from "./container-behavior.mjs";
import { livingNPC } from "./theft.mjs";
import { merchantToken, merchantAlive } from "./shop.mjs";

/** Emprise d'un token, en cases (positions de `_source`). */
function tokenBox(token) {
  const size = token.parent.grid.size;
  return { col: token._source.x / size, row: token._source.y / size, w: token._source.width, h: token._source.height };
}

/** Emprise d'une région (sa boîte englobante), en cases : un tas d'une demi-case donne des fractions. */
function regionBox(region) {
  const size = region.parent.grid.size;
  const b = region.bounds;
  return { col: b.x / size, row: b.y / size, w: b.width / size, h: b.height / size };
}

/** @param {TokenDocument} token */
export function corpseSource(token) {
  return {
    kind: "corpse",
    uuid: token.uuid,
    key: `corpse-${token.id}`,
    doc: token,
    get actor() { return token.actor; },
    get name() {
      const shown = [CONST.TOKEN_DISPLAY_MODES.HOVER, CONST.TOKEN_DISPLAY_MODES.ALWAYS].includes(token.displayName);
      return (game.user.isGM || shown) ? token.name : loc("Window.Corpse");
    },
    get img() { return token.texture?.src; },
    exists: () => !!token.parent?.tokens.get(token.id) && corpseToken(token),
    locked: () => false,
    box: () => tokenBox(token),
    distance: looter => ((looter.parent === token.parent) ? tokenDistance(looter, token) : Infinity)
  };
}

/** @param {RegionBehavior} behavior */
export function containerSource(behavior) {
  return {
    kind: "container",
    uuid: behavior.uuid,
    key: `container-${behavior.id}`,
    doc: behavior,
    get actor() { return behavior.system.actor ? fromUuidSync(behavior.system.actor, { strict: false }) : null; },
    get name() { return behavior.system.displayName || loc("Window.Container"); },
    get img() { return null; },
    // La région elle-même encore sur sa scène (un tas vidé est supprimé avec sa région : ses objets locaux restent).
    exists: () => !!behavior.parent?.parent?.regions.get(behavior.parent.id)
      && !!behavior.parent.behaviors.get(behavior.id) && !behavior.disabled,
    locked: () => !!behavior.system.locked,
    box: () => regionBox(behavior.region),
    distance: looter => regionDistance(looter, behavior.region)
  };
}

/** Les poches d'un PNJ vivant (vol à la tire, SPEC §3.3). @param {TokenDocument} token */
export function pocketSource(token) {
  return {
    kind: "pocket",
    uuid: token.uuid,
    key: `pocket-${token.id}`,
    doc: token,
    get actor() { return token.actor; },
    get name() {
      const shown = [CONST.TOKEN_DISPLAY_MODES.HOVER, CONST.TOKEN_DISPLAY_MODES.ALWAYS].includes(token.displayName);
      return (game.user.isGM || shown) ? token.name : loc("Steal.Someone");
    },
    exists: () => !!token.parent?.tokens.get(token.id) && livingNPC(token),
    locked: () => false,
    box: () => tokenBox(token),
    distance: looter => ((looter.parent === token.parent) ? tokenDistance(looter, token) : Infinity)
  };
}

/**
 * La boutique d'un marchand vivant (SPEC §3.7) : son token sur une scène, ou — une boutique sans token, que le MJ montre
 * aux joueurs — l'acteur lui-même, qui n'a ni place ni portée.
 * @param {TokenDocument|Actor} token
 */
export function merchantSource(token) {
  if ( token instanceof Actor ) {
    const actor = token;
    return {
      kind: "merchant",
      uuid: actor.uuid,
      key: `merchant-${actor.id}`,
      doc: actor,
      get actor() { return actor; },
      get name() { return actor.name; },
      get img() { return actor.img; },
      exists: () => !!game.actors.get(actor.id) && merchantAlive(actor),
      locked: () => false,
      box: () => null,
      distance: () => 0
    };
  }
  return {
    kind: "merchant",
    uuid: token.uuid,
    key: `merchant-${token.id}`,
    doc: token,
    get actor() { return token.actor; },
    get name() { return token.name; },
    get img() { return token.actor?.img || token.texture?.src; },
    exists: () => !!token.parent?.tokens.get(token.id) && merchantToken(token),
    locked: () => false,
    box: () => tokenBox(token),
    distance: looter => ((looter.parent === token.parent) ? tokenDistance(looter, token) : Infinity)
  };
}

/** Retrouver une source depuis ce qui voyage dans une requête. */
export function resolveSource({ kind, uuid }) {
  const doc = fromUuidSync(uuid, { strict: false });
  if ( !doc ) return null;
  if ( (kind === "corpse") && (doc.documentName === "Token") ) return corpseSource(doc);
  if ( (kind === "pocket") && (doc.documentName === "Token") ) return pocketSource(doc);
  if ( (kind === "merchant") && ["Token", "Actor"].includes(doc.documentName) ) return merchantSource(doc);
  if ( (kind === "container") && (doc.type === CONTAINER_TYPE) ) return containerSource(doc);
  return null;
}
