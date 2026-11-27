/**
 * The party, as dnd5e and the scene know it (lot 1, 2026-11-27): who gets a share. Rules: core/share.mjs.
 */
import { setting } from "../shared.mjs";
import { pickMembers, coinsText } from "../core/share.mjs";

/** The player characters of dnd5e's primary party (setting `dnd5e.primaryParty`, a Group actor), or none. */
export function primaryPartyCharacters() {
  try { return [...(game.actors.party?.system?.playerCharacters ?? [])].filter(Boolean); }
  catch { return []; }
}

/** The scene a source of loot is on (a corpse token, a container behavior). */
export function sceneOfSource(source) {
  const doc = source?.doc;
  if ( !doc ) return null;
  return (doc.documentName === "Token") ? doc.parent : (doc.parent?.parent ?? null);
}

/**
 * The characters who share what is found on `scene` (setting `shareWith`): the primary party's player characters — all of them,
 * or only those with a token on the scene —, without a primary party the player-owned characters with a token on the scene; and
 * always the character who shares.
 * @param {Scene|null} scene
 * @param {Actor|null} sharer
 * @returns {Actor[]}
 */
export function partyMembers(scene, sharer=null) {
  const party = primaryPartyCharacters();
  const present = new Set((scene?.tokens?.contents ?? []).map(t => t.actor?.id ?? t.actorId).filter(Boolean));
  const owned = party.length ? [] : game.actors.filter(a => (a.type === "character") && a.hasPlayerOwner);
  const byId = new Map([...party, ...owned, ...((sharer?.type === "character") ? [sharer] : [])].map(a => [a.id, a]));
  const ids = pickMembers({ party: party.map(a => a.id), present: [...present], owned: owned.map(a => a.id),
    mode: setting("shareWith"), sharer: (sharer?.type === "character") ? sharer.id : null });
  return ids.map(id => byId.get(id)).filter(Boolean);
}

/** « 3 gp, 2 sp » with dnd5e's abbreviations. */
export function coinsLabel(coins) {
  const labels = Object.fromEntries(Object.entries(CONFIG.DND5E?.currencies ?? {}).map(([k, v]) => [k, v?.abbreviation ?? k]));
  return coinsText(coins, labels);
}

/** The token of this actor on this scene (its linked token first), or null. */
export function tokenOnScene(scene, actor) {
  if ( !scene || !actor ) return null;
  return scene.tokens.find(t => t.actor === actor) ?? scene.tokens.find(t => (t.actorId === actor.id) && t.actorLink) ?? null;
}
