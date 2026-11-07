/**
 * Vol à la tire (SPEC §3.3) : ce que la victime porte, la difficulté de chaque objet, le DD (chez le MJ).
 * Règles : core/theft.mjs.
 */
import { MODULE_ID } from "../shared.mjs";
import { isTrapToken } from "./trapped.mjs";
import { engineObjectToken } from "./engine.mjs";
import { gearEntries, coinsOf } from "../core/loot.mjs";
import { theftDC, difficultyOf, priceInGp, purseInGp, purseHandful } from "../core/theft.mjs";


/** Un PNJ vivant, qu'on peut voler. */
export function livingNPC(tokenDoc) {
  const actor = tokenDoc?.actor;
  if ( !actor || (actor.type !== "npc") ) return false;
  if ( actor.statuses.has("dead") ) return false;
  // 0.17.0 : un piège (acteur ou token) ou un objet du moteur n'a pas de poches.
  if ( isTrapToken(tokenDoc) || engineObjectToken(tokenDoc) ) return false;
  return (actor.system.attributes?.hp?.value ?? 1) > 0;
}

/** Une arme naturelle : type « natural », ou l'Attaque à mains nues (identifiant dnd5e). */
const naturalWeapon = item => (item.type === "weapon")
  && ((item.system.type?.value === "natural") || (item.system.identifier === "unarmed-strike"));

/** La victime est-elle sur ses gardes (après un vol raté, ou posé par le MJ) ? */
export function isAlert(actor) {
  return !!actor.getFlag(MODULE_ID, "alert");
}

/** Les objets déjà tentés par ce voleur sur cette victime (un seul essai par objet). */
export function triedBy(actor, thiefId) {
  return new Set(actor.getFlag(MODULE_ID, `tried.${thiefId}`) ?? []);
}

const conversions = () => Object.fromEntries(Object.entries(CONFIG.DND5E.currencies).map(([k, c]) => [k, c.conversion]));

/** Poids d'une pile en lb, quelle que soit l'unité du monde. */
function weightLb(item) {
  // 0.21.0 : la pile entière, contenu compris pour un sac (dnd5e `totalWeightIn`, nombre pour un objet porté par un acteur).
  try {
    const total = item.system.totalWeightIn?.("lb");
    if ( Number.isFinite(total) ) return total;
  } catch { /* repli ci-dessous */ }
  const w = item.system.weight ?? {};
  const total = (Number(w.value) || 0) * (item.system.quantity ?? 1);
  if ( !w.units || (w.units === "lb") ) return total;
  try { return dnd5e.utils.convertWeight(total, w.units, "lb"); }
  catch { return total; }
}

/** Valeur d'une pile en po. */
function valueGp(item) {
  const p = item.system.price ?? {};
  const unit = priceInGp(p.value, CONFIG.DND5E.currencies[p.denomination]?.conversion);
  return unit * (item.system.quantity ?? 1);
}

/**
 * Ce qu'on voit en faisant les poches : les objets (équipement du PNJ, `gear`) avec leur difficulté, ce qui est porté
 * (non volable), ce que ce voleur a déjà tenté ; la bourse comme un objet de plus (`id: "coins"`).
 */
export function pocketView(actor, thiefId) {
  const tried = triedBy(actor, thiefId);
  const alert = isAlert(actor);
  // 0.21.0 : une arme naturelle (Attaque à mains nues d'un personnage) n'est pas un objet qu'on porte sur soi.
  const plain = actor.items.filter(i => !naturalWeapon(i)).map(i => ({ id: i.id, type: i.type, quantity: i.system.quantity ?? 0,
    properties: Array.from(i.system.properties ?? []), container: i.system.container ?? null }));
  // 0.21.0 : les poches d'un personnage (vol par un PNJ) montrent tout objet physique ; celles d'un PNJ, son équipement (`gear`).
  const entries = gearEntries(plain, actor.type === "npc").map(e => {
    const item = actor.items.get(e.id);
    const shown = item.system.gearPresentationData?.() ?? { name: item.name };
    const value = valueGp(item);
    const weight = weightLb(item);
    const equipped = !!item.system.equipped;
    const possible = theftDC({ perception: 0, value, weight, equipped }) !== null;
    return { ...e, name: shown.name, img: item.img, equipped, possible, tried: tried.has(e.id),
      difficulty: possible ? difficultyOf({ value, weight, alert }) : null };
  });
  const coins = coinsOf(actor.system.currency);
  const purse = coins.length ? {
    id: "coins", coins, tried: tried.has("coins"), possible: true,
    difficulty: difficultyOf({ value: purseInGp(actor.system.currency, conversions()), weight: 0, alert })
  } : null;
  return { entries, purse, alert };
}

/** Chez le MJ : le DD pour voler cet objet (ou la bourse), en lançant la Perception de la victime si elle est sur ses gardes. */
export async function stealDC(actor, itemId) {
  const prc = actor.system.skills?.prc ?? {};
  let perception = prc.passive ?? 10;
  if ( isAlert(actor) ) perception = (await new Roll(`1d20 + ${Number(prc.total) || 0}`).evaluate({ allowInteractive: false })).total;
  if ( itemId === "coins" ) {
    return theftDC({ perception, value: purseInGp(actor.system.currency, conversions()), weight: 0 });
  }
  const item = actor.items.get(itemId);
  if ( !item ) return null;
  return theftDC({ perception, value: valueGp(item), weight: weightLb(item), equipped: !!item.system.equipped });
}

/* ---- 0.21.0 (issue #5) : vol par un PNJ ---- */

/** Un personnage joueur vivant (pas mort, pas une invocation), qu'un PNJ peut voler. */
export function livingPC(tokenDoc) {
  const actor = tokenDoc?.actor;
  if ( !actor || (actor.type !== "character") ) return false;
  if ( actor.statuses.has("dead") || actor.getFlag("dnd5e", "summon.origin") ) return false;
  return !isTrapToken(tokenDoc) && !engineObjectToken(tokenDoc);
}

/** La Perception passive d'une victime (au moins 10 par la règle, core/theft.mjs). */
export const passivePerception = actor => Number(actor.system.skills?.prc?.passive) || 10;

/**
 * Ce que le MJ voit des poches d'un personnage : la vue des poches, et pour chaque objet possible le DD exact (Perception passive, valeur,
 * poids) ; la bourse vaut la valeur d'une poignée moyenne (25 %).
 */
export function victimView(actor, thiefId) {
  const view = pocketView(actor, thiefId);
  const perception = passivePerception(actor);
  const entries = view.entries.map(e => {
    const item = actor.items.get(e.id);
    return { ...e, dc: e.possible ? theftDC({ perception, value: valueGp(item), weight: weightLb(item), equipped: e.equipped }) : null };
  });
  const purse = view.purse ? { ...view.purse, dc: theftDC({ perception, weight: 0,
    value: purseInGp(purseHandful(actor.system.currency, 25), conversions()) }) } : null;
  return { entries, purse, perception };
}

/** Le DD d'un vol de PNJ sur un personnage : `coins` avec la poignée tirée (`handful`), sinon l'objet. null : impossible. */
export function victimDC(actor, itemId, handful=null) {
  const perception = passivePerception(actor);
  if ( itemId === "coins" ) return theftDC({ perception, weight: 0, value: purseInGp(handful ?? {}, conversions()) });
  const item = actor.items.get(itemId);
  if ( !item ) return null;
  return theftDC({ perception, value: valueGp(item), weight: weightLb(item), equipped: !!item.system.equipped });
}

/** Chez le MJ : déplacer des pièces (`{ gp: 3, sp: 10 }`) d'un acteur à l'autre. */
export async function moveCoins(from, to, coins) {
  const cur = from.system.currency ?? {};
  const out = {};
  const add = {};
  const moved = [];
  for ( const [k, n] of Object.entries(coins) ) {
    const v = Math.min(Number(n) || 0, Number(cur[k]) || 0);
    if ( v <= 0 ) continue;
    out[`system.currency.${k}`] = (Number(cur[k]) || 0) - v;
    add[`system.currency.${k}`] = (Number(to.system.currency?.[k]) || 0) + v;
    moved.push({ key: k, value: v });
  }
  if ( !moved.length ) return [];
  // `update` ajoute `_id` à l'objet reçu : le bilan se fait avant.
  await from.update(out);
  await to.update(add);
  return moved;
}
