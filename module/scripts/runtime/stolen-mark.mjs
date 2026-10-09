/**
 * Marque des objets volés dans les fiches dnd5e (SPEC §3.3) : un masque à côté du nom, « Volé à … » au survol.
 * Les lignes d'inventaire de dnd5e 6 portent `data-item-id` (templates/inventory/inventory.hbs:88). Le hook
 * `renderActorSheetV2` est tiré pour toute fiche d'acteur V2 (hooks de la chaîne de classes d'ApplicationV2).
 */
import { MODULE_ID, loc } from "../shared.mjs";
import { route } from "./router.mjs";

function markStolen(sheet, html) {
  const actor = sheet.document;
  if ( !actor?.items ) return;
  for ( const item of actor.items ) {
    const stolen = item.getFlag(MODULE_ID, "stolen");
    if ( !stolen ) continue;
    const name = html.querySelector(`li.item[data-item-id="${item.id}"] .item-name`);
    if ( !name || name.querySelector(".dlo-stolen-mark") ) continue;
    const mark = document.createElement("i");
    mark.className = "fa-solid fa-mask dlo-stolen-mark";
    mark.dataset.tooltip = loc("Steal.StolenFrom", { name: foundry.utils.escapeHTML(stolen.from ?? "?") });
    name.append(mark);
  }
}

export function registerStolenMark() {
  route("renderActorSheetV2", "stolen item mark", markStolen);
}
