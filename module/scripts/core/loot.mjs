/**
 * Règles pures du butin (SPEC §3.1) : qui est un cadavre, ce qu'on peut y prendre, à quelle distance.
 * Aucune dépendance à Foundry : tout arrive en données simples, testé par tests/loot.test.mjs.
 */

/** Types d'objets dnd5e qui existent physiquement (dnd5e 6, data/item/). */
export const PHYSICAL_TYPES = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);

/** Types qu'on empile sur un objet identique du receveur plutôt que d'en créer un second. */
export const STACKABLE_TYPES = new Set(["consumable", "loot"]);

/** Ordre des pièces, de la plus précieuse à la moins précieuse (CONFIG.DND5E.currencies). */
export const COINS = ["pp", "gp", "ep", "sp", "cp"];

/**
 * Un cadavre fouillable : un PNJ mort.
 * @param {{ actorType: string, statuses: Iterable<string> }} data
 */
export function isCorpse({ actorType, statuses }) {
  if ( actorType !== "npc" ) return false;
  return new Set(statuses ?? []).has("dead");
}

/**
 * Ce qu'on peut prendre sur un PNJ : ses objets « équipement » (propriété `gear`, que dnd5e pose sur tout objet
 * physique non naturel d'un PNJ — data/item/templates/physical-item.mjs:297), en quantité, au premier niveau —
 * le contenu d'un sac part avec lui.
 * @param {Array<{ id: string, type: string, quantity: number, properties: Iterable<string>, container?: string|null }>} items
 * @param {boolean} [requireGear=true]  Exiger la propriété `gear` (un PNJ) ; non pour un coffre, où tout objet se prend.
 * @returns {Array<object>}  Les objets retenus, dans l'ordre reçu, avec `contents` : le nombre d'objets qu'ils contiennent.
 */
export function gearEntries(items, requireGear=true) {
  const gear = items.filter(i => PHYSICAL_TYPES.has(i.type) && (i.quantity > 0)
    && (!requireGear || new Set(i.properties ?? []).has("gear")));
  const ids = new Set(gear.map(i => i.id));
  const inside = id => items.filter(i => i.container === id).length;
  return gear
    .filter(i => !i.container || !ids.has(i.container))
    .map(i => ({ ...i, contents: (i.type === "container") ? inside(i.id) : 0 }));
}

/** Les pièces présentes (valeurs positives seulement), dans l'ordre de COINS. */
export function coinsOf(currency={}) {
  return COINS.filter(c => (Number(currency[c]) || 0) > 0).map(c => ({ key: c, value: Number(currency[c]) }));
}

/** Les pièces de `b` ajoutées à celles de `a`. */
export function addCoins(a={}, b={}) {
  const sum = { ...a };
  for ( const c of COINS ) sum[c] = (Number(a[c]) || 0) + (Number(b[c]) || 0);
  return sum;
}

/** Reste-t-il quelque chose à prendre ? */
export function hasLoot(entries, currency) {
  return (entries.length > 0) || (coinsOf(currency).length > 0);
}

/**
 * L'objet du receveur sur lequel empiler un objet reçu : même source de compendium, même nom, même type
 * empilable, hors de tout contenant. null s'il n'y en a pas.
 * @param {Array<{ id: string, type: string, name: string, source?: string|null, container?: string|null, price?: number }>} owned
 * @param {{ type: string, name: string, source?: string|null, price?: number }} incoming
 * @param {{ anyType?: boolean }} [options]
 */
export function stackTarget(owned, incoming, { anyType=false }={}) {
  // `anyType` : l'étal d'un marchand empile aussi armes et outils identiques (§3.7) — jamais un contenant.
  const stackable = anyType ? (PHYSICAL_TYPES.has(incoming.type) && (incoming.type !== "container")) : STACKABLE_TYPES.has(incoming.type);
  if ( !stackable ) return null;
  const same = owned.filter(i => (i.type === incoming.type) && (i.name === incoming.name) && !i.container);
  if ( incoming.source ) {
    const match = same.find(i => i.source === incoming.source);
    if ( match ) return match.id;
  }
  // À l'étal, des objets sans source commune (créés à la main, importés) s'empilent s'ils ont le même nom et le même prix.
  if ( anyType && Number.isFinite(incoming.price) ) {
    const match = same.find(i => (!i.source || !incoming.source) && (i.price === incoming.price));
    if ( match ) return match.id;
  }
  return null;
}

/**
 * Distance entre deux tokens sur une grille carrée, de bord à bord, en unités de la scène : deux tokens
 * côte à côte sont à une case (5 ft), deux tokens qui se chevauchent à 0. L'écart d'élévation compte comme
 * une distance de plus (le plus grand des deux l'emporte, comme les diagonales à 5 ft).
 * @param {{ col: number, row: number, w: number, h: number, elevation?: number }} a  En cases.
 * @param {{ col: number, row: number, w: number, h: number, elevation?: number }} b
 * @param {number} cellDistance  Distance d'une case (scene.grid.distance).
 */
export function edgeDistance(a, b, cellDistance) {
  const gapX = Math.max(b.col - (a.col + a.w), a.col - (b.col + b.w));
  const gapY = Math.max(b.row - (a.row + a.h), a.row - (b.row + b.h));
  const overlap = (gapX < 0) && (gapY < 0);
  // Écart en cases entières : ce qui est dans la case voisine (écart de 0 à moins d'une case) est à une case, même un
  // tas d'une demi-case posé en travers d'une case (§3.8).
  const gap = Math.floor(Math.max(gapX, gapY, 0) + 1e-9);
  const flat = overlap ? 0 : (gap + 1) * cellDistance;
  const vertical = Math.abs((a.elevation ?? 0) - (b.elevation ?? 0));
  return Math.max(flat, vertical);
}
