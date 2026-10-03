/**
 * Ouvrir une source de butin (cadavre ou conteneur) et tenir les fenêtres ouvertes à jour.
 */
import { route } from "./router.mjs";
import { requestTake } from "./take.mjs";
import { ensureRolled } from "./treasure.mjs";
import { ensureContainer, requestUnlock } from "./containers.mjs";
import { requestSteal, preparePocket } from "./theft.mjs";
import { actingToken } from "../adapter/dnd5e.mjs";
import { LootWindow } from "../apps/loot-window.mjs";
import { StealWindow } from "../apps/steal-window.mjs";
import { ShopWindow } from "../apps/shop-window.mjs";
import { SHOP_ACTIONS } from "./shop.mjs";
import { canApproach, approachSource } from "./approach.mjs";
import { setting } from "../shared.mjs";

const HANDLERS = { onTake: requestTake, onUnlock: requestUnlock };

/**
 * Ouvre la fenêtre d'une source pour le token qui agit : fouille (cadavre, conteneur, après le tirage la première fois),
 * vol à la tire (poches d'un PNJ vivant) ou boutique (marchand).
 */
export async function openSource(source, looter=actingToken()) {
  if ( !source?.exists() ) return null;
  if ( source.kind === "pocket" ) {
    await preparePocket(source);
    return StealWindow.show(source, looter, requestSteal);
  }
  if ( source.kind === "merchant" ) return ShopWindow.show(source, looter, SHOP_ACTIONS);
  if ( source.kind === "corpse" ) await ensureRolled(source.doc);
  else await ensureContainer(source.doc);
  return LootWindow.show(source, looter, HANDLERS);
}

/**
 * Y aller, puis ouvrir (menu « Commercer », §3.7) : hors de portée, le personnage marche d'abord par le chemin du moteur
 * (§3.9) ; la fenêtre s'ouvre de toute façon — elle dit « trop loin » s'il n'a pas pu arriver.
 */
export async function visitSource(source, looter=actingToken()) {
  if ( looter && canApproach() && (source.distance(looter) > setting("reach")) ) await approachSource(source, looter);
  return openSource(source, looter);
}

/* ---- fenêtres ouvertes ---- */

const openWindows = () => [...LootWindow.open.values(), ...StealWindow.open.values(), ...ShopWindow.open.values()];
const looterOf = app => app.looter ?? app.thief;
/** Le personnage d'une fenêtre : celui de son token, ou l'acteur lui-même (boutique sans token, §3.7). */
const looterActor = app => { const l = looterOf(app); return (l instanceof Actor) ? l : (l?.actor ?? null); };

function refreshForActor(actor) {
  for ( const app of openWindows() ) {
    if ( (app.source.actor === actor) || (looterActor(app) === actor) ) app.refresh();
  }
}

function refreshForDoc(doc) {
  for ( const app of openWindows() ) {
    if ( (app.source.doc === doc) || (looterOf(app) === doc) ) app.refresh();
  }
}

export function registerWindows() {
  for ( const hook of ["createItem", "updateItem", "deleteItem"] ) {
    route(hook, "fenêtres de fouille", item => { if ( item.parent ) refreshForActor(item.parent); });
  }
  route("updateActor", "fenêtres de fouille", actor => refreshForActor(actor));
  // L'état « mort » posé ou retiré (un soin, une résurrection) : fermer la fenêtre.
  for ( const hook of ["createActiveEffect", "deleteActiveEffect"] ) {
    route(hook, "fenêtres de fouille", effect => { if ( effect.parent instanceof Actor ) refreshForActor(effect.parent); });
  }
  route("updateToken", "fenêtres de fouille", doc => refreshForDoc(doc));
  route("deleteToken", "fenêtres de fouille", doc => refreshForDoc(doc));
  route("updateRegionBehavior", "fenêtres de fouille", doc => refreshForDoc(doc));
  route("deleteRegionBehavior", "fenêtres de fouille", doc => refreshForDoc(doc));
  // Une région supprimée (un tas vidé) ne tire que son propre hook : fermer les fenêtres de ses conteneurs.
  route("deleteRegion", "fenêtres de fouille", region => {
    for ( const app of openWindows() ) if ( app.source.doc?.parent === region ) app.refresh();
  });
  // Un combat qui commence ferme la porte au vol à la tire.
  for ( const hook of ["updateCombat", "deleteCombat"] ) {
    route(hook, "fenêtres de vol", () => { for ( const app of StealWindow.open.values() ) app.refresh(); });
  }
}
