/**
 * Vol à la tire (SPEC §3.3) : ce que la victime porte, la difficulté de chaque objet, le DD (chez le MJ).
 * Règles : core/theft.mjs.
 */
import { MODULE_ID } from "../shared.mjs";
import { gearEntries, coinsOf } from "../core/loot.mjs";
import { theftDC, difficultyOf, priceInGp, purseInGp } from "../core/theft.mjs";


/** Un PNJ vivant, qu'on peut voler. */
export function livingNPC(tokenDoc) {
  const actor = tokenDoc?.actor;
  if ( !actor || (actor.type !== "npc") ) return false;
  if ( actor.statuses.has("dead") ) return false;
  return (actor.system.attributes?.hp?.value ?? 1) > 0;
}

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
  const plain = actor.items.map(i => ({ id: i.id, type: i.type, quantity: i.system.quantity ?? 0,
    properties: Array.from(i.system.properties ?? []), container: i.system.container ?? null }));
  const entries = gearEntries(plain, true).map(e => {
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
