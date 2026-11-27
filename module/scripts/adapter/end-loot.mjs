/**
 * End-of-combat loot (lot 3, 2026-11-27) — dnd5e and the canvas: the corpses of a record, « keep the special weapon », the treasure
 * roll, and the encounter chest. GM only. Rules: core/end-loot.mjs.
 */
import { MODULE_ID, loc } from "../shared.mjs";
import { corpseToken, lootView, transfer } from "./dnd5e.mjs";
import { rollTreasure } from "./treasure.mjs";
import { createPile, clearIfEmpty } from "./drop.mjs";
import { readRecords } from "./xp.mjs";
import { chestSpot, corpsesToLoot, holdingRecord } from "../core/end-loot.mjs";

/** The icon of the encounter chest (Foundry's own icons). */
export const CHEST_IMG = "icons/containers/chest/chest-reinforced-steel-oak-tan.webp";

/** A corpse's centre on its scene (from `_source`: not the animation). */
export function tokenCenter(token) {
  const size = token.parent.grid.size;
  const s = token._source;
  return { x: s.x + ((s.width * size) / 2), y: s.y + ((s.height * size) / 2) };
}

/**
 * The corpses of a record's loot part that can be looted now: ticked, their token still on its scene, dead.
 * @returns {{ entry: object, token: TokenDocument }[]}
 */
export function lootableCorpses(record) {
  return corpsesToLoot(record?.loot).map(entry => ({ entry, token: fromUuidSync(entry.key, { strict: false }) }))
    .filter(c => c.token?.parent && corpseToken(c.token));
}

/**
 * « Keep the special weapon »: the NPC's weapons leave as they are on its sheet (dnd5e's `flags.dnd5e.gear.preserve`, read by
 * `asGear`) instead of becoming the plain weapon of the compendium.
 */
export async function keepSpecialWeapons(actor) {
  const updates = actor.items.filter(i => (i.type === "weapon") && i.system.properties?.has?.("gear")
    && (i.getFlag("dnd5e", "gear")?.preserve !== true)).map(i => ({ _id: i.id, "flags.dnd5e.gear.preserve": true }));
  if ( updates.length ) await actor.updateEmbeddedDocuments("Item", updates);
  return updates.length;
}

/** Rolls a corpse's treasure now (once: a corpse already rolled keeps what it has). */
export function rollCorpse(token, { pockets=true }={}) {
  return rollTreasure(token.actor, { pockets });
}

/**
 * Creates the encounter chest in the middle of these corpses, on the scene and level of the first: a ground pile of a whole
 * square, with a chest icon, named after the encounter. Its store (a Group actor) is made by the caller (`ensureStore`).
 * @returns {Promise<{ region: RegionDocument, behavior: RegionBehavior, tile: TileDocument }>}
 */
export function createEncounterChest(tokens, record) {
  const first = tokens[0];
  const scene = first.parent;
  const center = chestSpot(tokens.filter(t => t.parent === scene).map(tokenCenter), scene.grid.size) ?? tokenCenter(first);
  return createPile(scene, center, { level: first._source.level ?? null, elevation: first._source.elevation ?? 0, img: CHEST_IMG,
    name: loc("EndLoot.ChestName"), cells: 1, shown: true, encounter: record.id });
}

/**
 * Moves everything a corpse holds (its gear, as the plain item unless kept special, and its coins) into the chest's store, then
 * makes the chest's tile show it flying in (every client, runtime/drop-fx.mjs).
 * @returns {Promise<{ names: string[], coins: object[] }>}
 */
export async function gatherInto(token, store, tile) {
  const view = lootView(token.actor);
  if ( view.empty ) return { names: [], coins: [] };
  const moved = await transfer(token.actor, store, { itemIds: view.entries.map(e => e.id), coins: true });
  const from = tokenCenter(token);
  const to = { x: tile.x, y: tile.y };
  const img = view.entries[0]?.img ?? "icons/commodities/currency/coins-plain-stack-gold.webp";
  await tile.update({ [`flags.${MODULE_ID}.lastDrop`]: { id: foundry.utils.randomID(), from, to, img, sound: "soft" } }).catch(() => {});
  return moved;
}

/** An encounter chest that ends up empty (nothing on any corpse) is removed at once. */
export async function dropIfEmpty(region) {
  await clearIfEmpty(region);
  return !region.parent?.regions.get(region.id);
}

/**
 * The record whose loot holds this corpse (token document or uuid) until the GM validates, or null — read on every client (the
 * records are a world setting).
 */
export function heldBy(token) {
  const key = (typeof token === "string") ? token : token?.uuid;
  return holdingRecord(readRecords(), key);
}
