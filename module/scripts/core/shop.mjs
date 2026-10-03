/**
 * Marchands (SPEC §3.7, étape 8) — règles pures, testées par tests/shop.test.mjs : prix, monnaie, solde d'un troc,
 * objets volés, réassort, reprise des marchands d'Item Piles.
 *
 * Tout se compte en **pièces de cuivre** (entiers) : pas d'arrondi flottant sur un prix en po.
 * Vocabulaire : « acheter » et « vendre » sont dits du côté du **joueur** — `buy` : ce que le joueur paie au marchand,
 * `sell` : ce que le marchand lui donne pour un objet.
 */
import { PHYSICAL_TYPES } from "./loot.mjs";

/** Valeur d'une pièce en pc (dnd5e : 1 pp = 10 po, 1 po = 2 pe = 10 pa = 100 pc). */
export const CP_PER = Object.freeze({ pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 });

/** Les pièces dans lesquelles on rend la monnaie et on paie une vente : ni platine ni électrum. */
const CHANGE = ["gp", "sp", "cp"];
/** Ordre de paiement : de la plus grosse pièce à la plus petite. */
const LARGEST_FIRST = ["pp", "gp", "ep", "sp", "cp"];

/** Attitudes d'un marchand (PHB 2024 : amical, indifférent, hostile) et ce qu'elles font aux prix. */
export const ATTITUDES = Object.freeze({
  friendly: { buy: 0.9, sell: 1.1 },
  indifferent: { buy: 1, sell: 1 },
  hostile: { buy: 1.2, sell: 0.8 }
});

/** Ce qu'un marchand fait d'un objet volé : « own » ne refuse que ce qu'on lui a volé, « refuse » tout, « fence » rachète à bas prix. */
export const STOLEN_POLICIES = Object.freeze(["own", "refuse", "fence"]);

/** Un marchand par défaut : il vend au prix, rachète à moitié prix (PHB 2024, « Selling Equipment »). */
export const DEFAULT_MERCHANT = Object.freeze({
  enabled: false,
  buy: 1,
  sell: 0.5,
  attitude: "indifferent",
  types: {},
  characters: {},
  infiniteStock: false,
  infiniteCoins: false,
  stolen: "own",
  fenceRate: 0.5,
  owner: "",
  description: "",
  tables: [],
  closed: false
});

const factor = (value, fallback) => {
  const n = Number(value);
  return (Number.isFinite(n) && (n >= 0)) ? n : fallback;
};

/** La configuration complète d'un marchand, d'après son drapeau (valeurs absentes ou fausses → défauts). */
export function normalizeMerchant(flag) {
  const f = flag ?? {};
  const pairs = (map, read) => Object.fromEntries(Object.entries(map ?? {}).filter(([, v]) => v && (typeof v === "object")).map(([k, v]) => [k, read(v)]));
  return {
    enabled: f.enabled === true,
    buy: factor(f.buy, DEFAULT_MERCHANT.buy),
    sell: factor(f.sell, DEFAULT_MERCHANT.sell),
    attitude: (f.attitude in ATTITUDES) ? f.attitude : DEFAULT_MERCHANT.attitude,
    types: pairs(f.types, v => ({ buy: factor(v.buy, 1), sell: factor(v.sell, 1) })),
    characters: pairs(f.characters, v => ({
      attitude: (v.attitude in ATTITUDES) ? v.attitude : null,
      discount: Math.max(-100, Math.min(100, Number(v.discount) || 0))
    })),
    infiniteStock: f.infiniteStock === true,
    infiniteCoins: f.infiniteCoins === true,
    stolen: STOLEN_POLICIES.includes(f.stolen) ? f.stolen : DEFAULT_MERCHANT.stolen,
    fenceRate: factor(f.fenceRate, DEFAULT_MERCHANT.fenceRate),
    owner: String(f.owner ?? ""),
    description: String(f.description ?? ""),
    tables: (Array.isArray(f.tables) ? f.tables : []).filter(t => t && t.uuid)
      .map(t => ({ uuid: String(t.uuid), rolls: String(t.rolls ?? "1") || "1" })),
    closed: f.closed === true
  };
}

/* -------------------------------------------- */
/*  Prix                                        */
/* -------------------------------------------- */

/** Un prix dnd5e (`value`, `denomination`) en pc — fractions gardées (« Billes : 0,1 pc »). */
export function toCp(value, denomination="gp") {
  return (Number(value) || 0) * (CP_PER[denomination] ?? CP_PER.gp);
}

/**
 * Les deux coefficients du marchand pour ce type d'objet et ce personnage : marchand × type × attitude × remise.
 * La remise d'un personnage (en %, positive : en sa faveur) baisse ce qu'il paie et monte ce qu'on lui donne.
 * @returns {{ buy: number, sell: number }}
 */
export function modifiersFor(merchant, { type=null, characterId=null }={}) {
  const perType = merchant.types?.[type] ?? { buy: 1, sell: 1 };
  const own = merchant.characters?.[characterId] ?? null;
  const attitude = ATTITUDES[own?.attitude ?? merchant.attitude] ?? ATTITUDES.indifferent;
  const discount = (own?.discount ?? 0) / 100;
  return {
    buy: merchant.buy * perType.buy * attitude.buy * (1 - discount),
    sell: merchant.sell * perType.sell * attitude.sell * (1 + discount)
  };
}

/** Ce que le joueur paie pour `quantity` exemplaires : arrondi au pc supérieur sur la ligne, jamais moins d'un pc. */
export function buyPrice(baseCp, quantity, modifiers) {
  const raw = baseCp * quantity * modifiers.buy;
  return (raw > 0) ? Math.max(1, Math.ceil(raw - 1e-9)) : 0;
}

/**
 * Ce que le marchand donne pour `quantity` exemplaires : arrondi au pc inférieur, jamais plus que son propre prix de
 * vente (on ne gagne rien à lui racheter ce qu'on vient de lui vendre). `rate` : décote d'un receleur.
 */
export function sellPrice(baseCp, quantity, modifiers, rate=1) {
  const raw = baseCp * quantity * modifiers.sell * rate;
  return Math.max(0, Math.min(Math.floor(raw + 1e-9), buyPrice(baseCp, quantity, modifiers)));
}

/* -------------------------------------------- */
/*  Marchandises                                */
/* -------------------------------------------- */

/**
 * Ce qu'un marchand vend : ses objets physiques de premier niveau (un sac part avec son contenu), en stock, qui ont un
 * prix (un objet sans prix n'est pas une marchandise), non cachés — le MJ voit tout.
 * @param {Array<{ id, type, quantity, baseCp, container?, hidden?, notForSale? }>} items
 * @param {{ gm?: boolean, infiniteStock?: boolean }} [options]
 */
export function goodsOf(items, { gm=false, infiniteStock=false }={}) {
  const physical = items.filter(i => PHYSICAL_TYPES.has(i.type));
  const ids = new Set(physical.map(i => i.id));
  return physical
    .filter(i => !i.container || !ids.has(i.container))
    .filter(i => gm || (!i.hidden && (i.baseCp > 0) && (infiniteStock || (i.quantity > 0))))
    .map(i => ({ ...i, contents: (i.type === "container") ? items.filter(x => x.container === i.id).length : 0 }));
}

/**
 * Ce qu'un personnage peut proposer à la vente : ses objets physiques de premier niveau, non équipés, en quantité, qui
 * ont un prix.
 * @param {Array<{ id, type, quantity, baseCp, container?, equipped? }>} items
 */
export function wares(items) {
  // Sans prix, pas une marchandise (une attaque à mains nues, un objet de règle posé sur la fiche).
  const physical = items.filter(i => PHYSICAL_TYPES.has(i.type) && (i.quantity > 0) && !i.equipped && (i.baseCp > 0));
  const ids = new Set(items.filter(i => PHYSICAL_TYPES.has(i.type)).map(i => i.id));
  return physical
    .filter(i => !i.container || !ids.has(i.container))
    .map(i => ({ ...i, contents: (i.type === "container") ? items.filter(x => x.container === i.id).length : 0 }));
}

/**
 * Le sort d'un objet volé chez ce marchand : « ok » (pas volé, ou il s'en moque), « refuse », « fence » (racheté avec
 * la décote du receleur). Celui à qui l'objet a été volé le refuse toujours, receleur ou non.
 * @param {object} merchant                                   Configuration normalisée.
 * @param {{ from?: string, fromUuid?: string }|null} stolen  Le drapeau de l'objet.
 * @param {{ names?: string[], uuids?: string[] }} identity   Sous quels noms et UUID le marchand est connu.
 */
export function stolenVerdict(merchant, stolen, identity={}) {
  if ( !stolen ) return "ok";
  const lower = s => String(s ?? "").trim().toLocaleLowerCase();
  const names = new Set([...(identity.names ?? []), merchant.owner].map(lower).filter(Boolean));
  const mine = (!!stolen.fromUuid && (identity.uuids ?? []).includes(stolen.fromUuid)) || names.has(lower(stolen.from));
  if ( mine || (merchant.stolen === "refuse") ) return "refuse";
  return (merchant.stolen === "fence") ? "fence" : "ok";
}

/* -------------------------------------------- */
/*  Monnaie                                     */
/* -------------------------------------------- */

const count = n => Math.max(0, Math.floor(Number(n) || 0));

/** Valeur d'une bourse en pc. */
export function purseValue(purse={}) {
  return LARGEST_FIRST.reduce((sum, k) => sum + (count(purse[k]) * CP_PER[k]), 0);
}

/** Un montant en pc, en pièces d'or, d'argent et de cuivre (les plus grosses d'abord). */
export function coinsFor(amountCp) {
  let left = count(amountCp);
  const out = {};
  for ( const k of CHANGE ) {
    const n = Math.floor(left / CP_PER[k]);
    if ( n > 0 ) out[k] = n;
    left -= n * CP_PER[k];
  }
  return out;
}

/** La bourse augmentée d'un montant en pc (versé en po, pa, pc). */
export function receive(purse={}, amountCp) {
  const out = Object.fromEntries(LARGEST_FIRST.map(k => [k, count(purse[k])]));
  for ( const [k, n] of Object.entries(coinsFor(amountCp)) ) out[k] += n;
  return out;
}

/**
 * La bourse après avoir payé un montant en pc, ou null si elle ne le couvre pas. On donne d'abord l'appoint avec les
 * plus grosses pièces qui ne dépassent pas le dû ; s'il reste un dû, **une** pièce plus grosse est cassée et la
 * monnaie rendue (en po, pa, pc). Les petites pièces ne sont pas raflées pour payer un prix en or.
 */
export function pay(purse={}, amountCp) {
  const amount = count(amountCp);
  if ( purseValue(purse) < amount ) return null;
  const out = Object.fromEntries(LARGEST_FIRST.map(k => [k, count(purse[k])]));
  let due = amount;
  for ( const k of LARGEST_FIRST ) {
    const n = Math.min(out[k], Math.floor(due / CP_PER[k]));
    out[k] -= n;
    due -= n * CP_PER[k];
  }
  if ( due > 0 ) {
    // Toute pièce restante vaut plus que le dû : la plus petite d'entre elles suffit.
    const k = [...LARGEST_FIRST].reverse().find(c => out[c] > 0);
    out[k] -= 1;
    return receive(out, CP_PER[k] - due);
  }
  return out;
}

/* -------------------------------------------- */
/*  Troc                                        */
/* -------------------------------------------- */

/**
 * Le solde d'un troc et les bourses après : le joueur prend pour `buyTotal` (pc), donne pour `sellTotal` (pc) ; l'or
 * comble l'écart. `net` > 0 : le joueur paie ; < 0 : le marchand paie (sa bourse, sauf pièces infinies).
 * @returns {{ ok: boolean, reason?: "playerFunds"|"merchantFunds", net: number, player: object, merchant: object }}
 */
export function settle({ buyTotal=0, sellTotal=0, playerPurse={}, merchantPurse={}, infiniteCoins=false }) {
  const net = count(buyTotal) - count(sellTotal);
  const same = { player: playerPurse, merchant: merchantPurse };
  if ( net > 0 ) {
    const player = pay(playerPurse, net);
    if ( !player ) return { ok: false, reason: "playerFunds", net, ...same };
    return { ok: true, net, player, merchant: infiniteCoins ? merchantPurse : receive(merchantPurse, net) };
  }
  if ( net < 0 ) {
    const merchant = infiniteCoins ? merchantPurse : pay(merchantPurse, -net);
    if ( !merchant ) return { ok: false, reason: "merchantFunds", net, ...same };
    return { ok: true, net, player: receive(playerPurse, -net), merchant };
  }
  return { ok: true, net, ...same };
}

/**
 * Un panier propre : `{ id, quantity }` fusionnés, quantités entières positives, plafonnées à ce qui est disponible
 * (`available` : `{ [id]: quantité }`, Infinity pour un stock infini ; un objet absent est retiré).
 */
export function cleanCart(lines=[], available={}) {
  const merged = new Map();
  for ( const { id, quantity } of lines ) {
    const q = Math.floor(Number(quantity) || 0);
    if ( !id || (q <= 0) || (available[id] === undefined) ) continue;
    merged.set(id, Math.min((merged.get(id) ?? 0) + q, available[id]));
  }
  return [...merged].filter(([, q]) => q > 0).map(([id, quantity]) => ({ id, quantity }));
}

/* -------------------------------------------- */
/*  Réassort                                    */
/* -------------------------------------------- */

/**
 * Ce qu'un réassort fait du stock : les objets tirés sur table et ceux rachetés aux joueurs partent (`remove`), les
 * objets du stock fixe reviennent à leur quantité de référence (`restore`). Les tables sont retirées ensuite.
 * @param {Array<{ id, quantity, base?: number|null, rolled?: boolean, bought?: boolean }>} items
 */
export function restockPlan(items) {
  const remove = items.filter(i => i.rolled || i.bought).map(i => i.id);
  const restore = items.filter(i => !i.rolled && !i.bought && Number.isFinite(i.base) && (i.base !== i.quantity))
    .map(i => ({ id: i.id, quantity: i.base }));
  return { remove, restore };
}

/* -------------------------------------------- */
/*  Item Piles                                  */
/* -------------------------------------------- */

/**
 * La configuration d'un marchand d'Item Piles (`flags["item-piles"].data`, type « merchant ») dans la nôtre.
 * Leurs coefficients par type d'objet sont relatifs (multipliés) ou absolus (`override`) : un absolu est ramené au
 * coefficient du marchand. Les modificateurs par acteur deviennent une remise sur l'achat.
 * @param {object} data
 * @returns {object|null}  Un drapeau `merchant` (à normaliser), ou null si ce n'est pas un marchand.
 */
export function fromItemPiles(data) {
  if ( !data || (data.enabled !== true) || (data.type !== "merchant") ) return null;
  const buy = factor(data.buyPriceModifier, 1);
  const sell = factor(data.sellPriceModifier, 0.5);
  const relative = (value, base, override) => {
    const v = factor(value, override ? base : 1);
    return (override && (base > 0)) ? v / base : v;
  };
  const types = {};
  for ( const t of data.itemTypePriceModifiers ?? [] ) {
    if ( !t?.type || (t.type === "custom") ) continue;
    types[t.type] = { buy: relative(t.buyPriceModifier, buy, t.override), sell: relative(t.sellPriceModifier, sell, t.override) };
  }
  const characters = {};
  for ( const a of data.actorPriceModifiers ?? [] ) {
    const id = String(a?.actorUuid ?? "").split(".").pop() || a?.actor;
    if ( !id ) continue;
    const ratio = relative(a.buyPriceModifier, buy, a.override);
    characters[id] = { attitude: null, discount: Math.round((1 - ratio) * 100) };
  }
  return {
    enabled: true,
    buy,
    sell,
    types,
    characters,
    infiniteStock: data.infiniteQuantity === true,
    infiniteCoins: data.infiniteCurrencies !== false,
    description: String(data.description ?? ""),
    tables: (data.tablesForPopulate ?? []).filter(t => t?.uuid).map(t => ({ uuid: t.uuid, rolls: String(t.timesToRoll ?? "1") })),
    closed: data.closed === true
  };
}
