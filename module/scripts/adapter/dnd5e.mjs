/**
 * Ce qui connaît dnd5e et le canevas : lecture d'un cadavre, distance, transfert d'objets (exécuté par le MJ).
 */
import { MODULE_ID } from "../shared.mjs";
import { isCorpse, gearEntries, coinsOf, hasLoot, stackTarget, edgeDistance, addCoins, COINS } from "../core/loot.mjs";

/** Le token (document) est-il un cadavre fouillable ? */
export function corpseToken(tokenDoc) {
  const actor = tokenDoc?.actor;
  if ( !actor ) return false;
  return isCorpse({ actorType: actor.type, statuses: actor.statuses });
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

/** Distance de bord à bord entre deux tokens, en unités de la scène (positions de `_source`, pas l'animation). */
export function tokenDistance(a, b) {
  const scene = a.parent;
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
 * Déplace des objets et/ou les pièces d'un cadavre ou d'un coffre (`corpse` : l'acteur source) vers un acteur.
 * À n'appeler que chez le MJ.
 * Chaque objet passe par sa version « équipement » (`asGear`, comme un glisser depuis la fiche PNJ,
 * base-actor-sheet.mjs:1762) et part avec son contenu (`createWithContents`, documents/item.mjs:1303).
 * @param {Actor} corpse
 * @param {Actor} recipient
 * @param {{ itemIds?: string[], coins?: boolean, stolen?: object|null }} what
 *   stolen : drapeau `flags.darsh-loot.stolen` à poser sur chaque objet créé (contenu compris) ; un objet volé ne
 *   s'empile jamais sur un objet honnête.
 * @returns {Promise<{ names: string[], coins: object[] }>}  Ce qui a été pris.
 */
export async function transfer(corpse, recipient, { itemIds=[], coins=false, stolen=null }={}) {
  const Item5e = CONFIG.Item.documentClass;
  const available = new Set(gearEntries(plainItems(corpse), requireGear(corpse)).map(e => e.id));
  const taken = { names: [], coins: [] };
  const toCreate = [];
  const toUpdate = [];
  const owned = recipient.items.map(i => ({ id: i.id, type: i.type, name: i.name,
    source: i._stats?.compendiumSource ?? null, container: i.system.container ?? null }));

  for ( const id of itemIds ) {
    if ( !available.has(id) ) continue;
    const item = corpse.items.get(id);
    const gear = await item.system.asGear?.() ?? item;
    const incoming = { type: gear.type, name: gear.name, source: gear._stats?.compendiumSource ?? null };
    const stackOn = ((gear.type !== "container") && !stolen) ? stackTarget(owned, incoming) : null;
    if ( stackOn ) {
      const current = recipient.items.get(stackOn);
      const pending = toUpdate.find(u => u._id === stackOn);
      if ( pending ) pending["system.quantity"] += item.system.quantity;
      else toUpdate.push({ _id: stackOn, "system.quantity": (current.system.quantity ?? 0) + item.system.quantity });
    } else {
      const created = await Item5e.createWithContents([gear]);
      if ( stolen ) for ( const data of created ) foundry.utils.setProperty(data, `flags.${MODULE_ID}.stolen`, stolen);
      toCreate.push(...created);
    }
    taken.names.push(item.system.quantity > 1 ? `${gear.name} (${item.system.quantity})` : gear.name);
  }

  if ( toCreate.length ) await Item5e.createDocuments(toCreate, { keepId: true, parent: recipient });
  if ( toUpdate.length ) await recipient.updateEmbeddedDocuments("Item", toUpdate);
  // Retirer du cadavre après la création : en cas d'échec, rien n'est perdu (au pire en double).
  const removed = itemIds.filter(id => available.has(id));
  if ( removed.length ) await corpse.deleteEmbeddedDocuments("Item", removed, { deleteContents: true });

  if ( coins ) {
    const found = coinsOf(corpse.system.currency);
    if ( found.length ) {
      const moved = Object.fromEntries(found.map(c => [c.key, c.value]));
      await recipient.update({ "system.currency": addCoins(recipient.system.currency, moved) });
      await corpse.update({ "system.currency": Object.fromEntries(COINS.map(c => [c, 0])) });
      taken.coins = found;
    }
  }
  return taken;
}
