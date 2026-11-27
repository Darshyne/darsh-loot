/**
 * Ce qui connaît dnd5e et le canevas : lecture d'un cadavre, distance, transfert d'objets (exécuté par le MJ).
 */
import { MODULE_ID, loc, setting } from "../shared.mjs";
import { isCorpse, gearEntries, coinsOf, hasLoot, stackTarget, edgeDistance, addCoins, takenQuantity, COINS } from "../core/loot.mjs";
import { sizeOfSpan } from "../core/traps.mjs";
import { nextStolenMark } from "../core/theft.mjs";
import { inTurn, operation } from "./ledger.mjs";

/** Le token (document) est-il un cadavre fouillable ? */
export function corpseToken(tokenDoc) {
  const actor = tokenDoc?.actor;
  if ( !actor ) return false;
  return isCorpse({ actorType: actor.type, statuses: actor.statuses });
}

/**
 * A corpse the players may search: a dead NPC, while searching corpses is on (world setting `corpseLoot`, user's request of
 * 2026-11-27: « like pickpocketing », off = no menu, cursor, treasure or « Loot » status on corpses). Necromancy still uses
 * `corpseToken`: raising the dead does not depend on looting them.
 */
export function searchableCorpse(tokenDoc) {
  let on = true;
  try { on = setting("corpseLoot") !== false; } catch { on = true; }
  return on && corpseToken(tokenDoc);
}

/** Sur un PNJ, seul l'équipement (`gear`) se prend ; dans un coffre (acteur Groupe), tout objet physique. */
const requireGear = actor => actor.type === "npc";

/** Les objets de l'acteur en données simples, pour core/loot.mjs. */
function plainItems(actor) {
  return actor.items.map(i => ({
    id: i.id, type: i.type, name: i.name,
    quantity: i.system.quantity ?? 0,
    properties: Array.from(i.system.properties ?? []),
    container: i.system.container ?? null
  }));
}

/**
 * Ce qu'on voit en fouillant : objets (nom et image de leur version « équipement ») et pièces.
 * @returns {{ entries: object[], coins: {key: string, value: number}[], empty: boolean }}
 */
export function lootView(actor) {
  const entries = gearEntries(plainItems(actor), requireGear(actor)).map(e => {
    const item = actor.items.get(e.id);
    // Nom affiché comme la fiche PNJ de dnd5e (npc-sheet.mjs:327) : « Cimeterre » plutôt que l'attaque du PNJ.
    const shown = item.system.gearPresentationData?.() ?? { name: item.name };
    return { ...e, name: shown.name, img: item.img };
  });
  const coins = coinsOf(actor.system.currency);
  return { entries, coins, empty: !hasLoot(entries, actor.system.currency) };
}

/** Le token qui agit : le seul token contrôlé et possédé, sinon celui du personnage du joueur sur la scène. */
export function actingToken() {
  const controlled = canvas.tokens?.controlled ?? [];
  if ( (controlled.length === 1) && controlled[0].document.isOwner ) return controlled[0].document;
  const character = game.user.character;
  if ( !character ) return null;
  return canvas.scene?.tokens.find(t => t.actorId === character.id) ?? null;
}

/**
 * Distance de bord à bord entre deux tokens, en unités de la scène (positions de `_source`, pas l'animation).
 * Lot 0 (audit of 2026-11-26, defect 17): two tokens on two different V14 levels are out of reach of each other (Infinity),
 * like a token and a region of another level (`regionDistance`) — elevation alone used to count, so a corpse or a merchant on the
 * floor above could be « within reach ». A token without a level (scene without levels) is measured as before.
 */
export function tokenDistance(a, b) {
  const scene = a.parent;
  const levelA = a._source.level, levelB = b._source.level;
  if ( levelA && levelB && (levelA !== levelB) ) return Infinity;
  const size = scene.grid.size;
  const box = t => ({ col: t._source.x / size, row: t._source.y / size, w: t._source.width, h: t._source.height,
    elevation: t._source.elevation ?? 0 });
  return edgeDistance(box(a), box(b), scene.grid.distance);
}

/**
 * Distance d'un token à une région (sa boîte englobante), en unités de la scène ; Infinity si la région n'est pas
 * sur la scène ou le niveau du token (V14 : `includedInLevel`, client/documents/abstract/canvas-document.mjs:97).
 * L'élévation compte hors de la tranche de la région.
 */
export function regionDistance(token, region) {
  const scene = token.parent;
  if ( region.parent !== scene ) return Infinity;
  const level = token._source.level;
  if ( level && !region.includedInLevel(level) ) return Infinity;
  const size = scene.grid.size;
  const b = region.bounds;
  const elevation = token._source.elevation ?? 0;
  const { bottom = -Infinity, top = Infinity } = region.elevation ?? {};
  const box = {
    col: b.x / size, row: b.y / size, w: Math.max(b.width / size, 0), h: Math.max(b.height / size, 0),
    elevation: Math.min(Math.max(elevation, bottom), top)
  };
  const me = { col: token._source.x / size, row: token._source.y / size, w: token._source.width,
    h: token._source.height, elevation };
  return edgeDistance(me, box, scene.grid.distance);
}

/** La taille dnd5e d'un token (`system.traits.size`), ou, sans acteur, celle que donne sa largeur (core/traps.mjs `sizeOfSpan`). */
export function creatureSize(token) {
  return token?.actor?.system?.traits?.size ?? sizeOfSpan(token?._source?.width ?? token?.width);
}

/** Le niveau d'une créature pour un piège : niveau de personnage, ou FP d'un PNJ (core/traps.mjs `targetsLevel`). */
export function trapLevelOf(actor) {
  if ( actor?.type === "character" ) return { character: true, level: Number(actor.system.details?.level) };
  return { character: false, level: Number(actor?.system?.details?.cr) };
}

/** L'acteur possède-t-il des outils de voleur (objet d'outil de base « thief », CONFIG.DND5E.tools) ? */
export function hasThievesTools(actor) {
  return actor.items.some(i => (i.type === "tool") && (i.system.type?.baseItem === "thief"));
}

/** L'objet-clé qui ouvre une serrure : un objet du personnage portant ce nom (sans tenir compte de la casse). */
export function keyItem(actor, keyName) {
  const wanted = String(keyName ?? "").trim().toLocaleLowerCase();
  if ( !wanted ) return null;
  return actor.items.find(i => i.name.trim().toLocaleLowerCase() === wanted) ?? null;
}

/* -------------------------------------------- */
/*  Transfert (côté MJ)                         */
/* -------------------------------------------- */

/**
 * Moves items and/or the coins of a corpse or a chest (`corpse`: the source actor) to an actor. GM only.
 * Each item goes through its « gear » version (`asGear`, like a drag from the NPC sheet, base-actor-sheet.mjs:1762) and leaves
 * with its contents (`createWithContents`, documents/item.mjs:1303).
 * @param {Actor} corpse
 * @param {Actor} recipient
 * @param {{ itemIds?: string[], coins?: boolean, stolen?: object|null, quantities?: Record<string, number> }} what
 *   stolen: the `flags.darsh-loot.stolen` flag to put on each created item (contents included); a stolen item never stacks on
 *   an honest one.
 *   quantities (lot 1): how many of a stack to take, by item id — the rest stays at the source. Missing, zero or not a
 *   number: the whole stack, as before. Never more than what is there; a bag always leaves whole.
 * @returns {Promise<{ names: string[], coins: object[] }>}  What was taken.
 */
export function transfer(corpse, recipient, what={}) {
  return inTurn([corpse, recipient], () => transferNow(corpse, recipient, what));
}

/** An item and everything stored in it (any depth), as creation data that keeps its ids: what puts it back after a failure. */
export function snapshotWithContents(actor, id) {
  const item = actor.items.get(id);
  if ( !item ) return [];
  const inside = actor.items.filter(i => i.system.container === id).flatMap(i => snapshotWithContents(actor, i.id));
  return [item.toObject(), ...inside];
}

/**
 * An item that changes hands is no longer attuned (lot 0, defect 14): dnd5e keeps `system.attuned` in the copied data, so a
 * traded, sold or dropped ring arrived attuned to its new owner. Creation data, changed in place.
 */
export function clearAttunement(data) {
  if ( data?.system?.attuned === true ) data.system.attuned = false;
  return data;
}

/**
 * The transfer itself, for a gesture that already holds its turn on both actors (`inTurn`, adapter/ledger.mjs): what is left at
 * the source is read here, once the turn has come — a take that arrived just before may have emptied it.
 * Lot 0 (audit of 2026-11-26, defect 4): each write registers its undo. Without `op` the transfer is its own operation: a
 * failure half-way (the source cannot be emptied) removes what was created and gives the coins back, and the GM gets a trace —
 * before, the item stayed on both sides. With `op`, the caller's operation undoes it with the rest.
 */
export function transferNow(corpse, recipient, what={}) {
  if ( what.op ) return transferSteps(corpse, recipient, what);
  return operation({ label: loc("Op.Take", { from: corpse.name, to: recipient.name }), journal: false },
    op => transferSteps(corpse, recipient, { ...what, op }));
}

async function transferSteps(corpse, recipient, { itemIds=[], coins=false, stolen=null, quantities=null, op }) {
  // A repeated id creates one item only (journal, 2026-11-18).
  itemIds = [...new Set(itemIds ?? [])];
  const Item5e = CONFIG.Item.documentClass;
  const available = new Set(gearEntries(plainItems(corpse), requireGear(corpse)).map(e => e.id));
  const taken = { names: [], coins: [] };
  const toCreate = [];
  const toUpdate = [];
  // Lot 1 (audit defect 21): stacks taken in part — what leaves, what stays.
  const whole = [];
  const partial = [];
  const owned = recipient.items.map(i => ({ id: i.id, type: i.type, name: i.name,
    source: i._stats?.compendiumSource ?? null, container: i.system.container ?? null }));

  for ( const id of itemIds ) {
    if ( !available.has(id) ) continue;
    const item = corpse.items.get(id);
    const gear = await item.system.asGear?.() ?? item;
    const have = item.system.quantity ?? 1;
    const moved = (gear.type === "container") ? have : takenQuantity(have, quantities?.[id]);
    if ( moved < have ) partial.push({ _id: id, moved });
    else whole.push(id);
    const incoming = { type: gear.type, name: gear.name, source: gear._stats?.compendiumSource ?? null };
    const stackOn = ((gear.type !== "container") && !stolen) ? stackTarget(owned, incoming) : null;
    if ( stackOn ) {
      const current = recipient.items.get(stackOn);
      const pending = toUpdate.find(u => u._id === stackOn);
      if ( pending ) { pending.quantity += moved; pending.added += moved; }
      else toUpdate.push({ _id: stackOn, quantity: (current.system.quantity ?? 0) + moved, added: moved });
    } else {
      const created = await Item5e.createWithContents([gear]);
      if ( moved < have ) foundry.utils.setProperty(created[0], "system.quantity", moved);
      // 0.21.0 (issue #5): an item that comes back to the one it was stolen from loses its mark, even taken back by stealing.
      for ( const data of created ) {
        const mark = nextStolenMark(foundry.utils.getProperty(data, `flags.${MODULE_ID}.stolen`) ?? null, stolen, recipient.uuid);
        if ( mark ) foundry.utils.setProperty(data, `flags.${MODULE_ID}.stolen`, mark);
        else if ( data.flags?.[MODULE_ID] ) delete data.flags[MODULE_ID].stolen;
        clearAttunement(data);
      }
      toCreate.push({ top: created[0]._id, data: created });
    }
    taken.names.push(((moved > 1) || (moved < have)) ? `${gear.name} (${moved})` : gear.name);
  }
  const what = taken.names.join(", ");

  if ( toCreate.length ) {
    await Item5e.createDocuments(toCreate.flatMap(c => c.data), { keepId: true, parent: recipient });
    op.did(loc("Op.Step.Received", { who: recipient.name, what }), async () => {
      const ids = toCreate.map(c => c.top).filter(id => recipient.items.has(id));
      if ( ids.length ) await recipient.deleteEmbeddedDocuments("Item", ids, { deleteContents: true });
    });
  }
  if ( toUpdate.length ) {
    await recipient.updateEmbeddedDocuments("Item", toUpdate.map(u => ({ _id: u._id, "system.quantity": u.quantity })));
    op.did(loc("Op.Step.Received", { who: recipient.name, what }), () => recipient.updateEmbeddedDocuments("Item", toUpdate
      .filter(u => recipient.items.has(u._id))
      .map(u => ({ _id: u._id, "system.quantity": Math.max(0, (recipient.items.get(u._id).system.quantity ?? 0) - u.added) }))));
  }
  // Removed from the source after the creation: a failure here is undone above (what was created leaves the recipient).
  const removed = whole;
  if ( partial.length ) {
    await corpse.updateEmbeddedDocuments("Item", partial.map(p => ({ _id: p._id, "system.quantity": (corpse.items.get(p._id).system.quantity ?? 1) - p.moved })));
    op.did(loc("Op.Step.Removed", { who: corpse.name, what }), () => corpse.updateEmbeddedDocuments("Item", partial
      .filter(p => corpse.items.has(p._id))
      .map(p => ({ _id: p._id, "system.quantity": (corpse.items.get(p._id).system.quantity ?? 0) + p.moved }))));
  }
  if ( removed.length ) {
    const snapshot = removed.flatMap(id => snapshotWithContents(corpse, id));
    await corpse.deleteEmbeddedDocuments("Item", removed, { deleteContents: true });
    op.did(loc("Op.Step.Removed", { who: corpse.name, what }),
      () => Item5e.createDocuments(snapshot.filter(d => !corpse.items.has(d._id)), { keepId: true, parent: corpse }));
  }

  if ( coins ) {
    const found = coinsOf(corpse.system.currency);
    if ( found.length ) {
      const moved = Object.fromEntries(found.map(c => [c.key, c.value]));
      const back = Object.fromEntries(found.map(c => [c.key, -c.value]));
      await recipient.update({ "system.currency": addCoins(recipient.system.currency, moved) });
      op.did(loc("Op.Step.CoinsIn", { who: recipient.name }), () => recipient.update({ "system.currency": addCoins(recipient.system.currency, back) }));
      await corpse.update({ "system.currency": Object.fromEntries(COINS.map(c => [c, 0])) });
      op.did(loc("Op.Step.CoinsOut", { who: corpse.name }), () => corpse.update({ "system.currency": addCoins(corpse.system.currency, moved) }));
      taken.coins = found;
    }
  }
  return taken;
}
