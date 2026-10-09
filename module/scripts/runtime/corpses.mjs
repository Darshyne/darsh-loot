/**
 * Cadavres (SPEC §3.1) : ouverture et bouton « Fouiller » du HUD de token pour le MJ. Survol et clic : runtime/pointer.mjs.
 */
import { route } from "./router.mjs";
import { openSource } from "./open.mjs";
import { corpseToken, actingToken } from "../adapter/dnd5e.mjs";
import { corpseSource } from "../adapter/sources.mjs";

/** Ouvre la fenêtre de fouille de ce cadavre pour le token qui agit. */
export function openLoot(corpse, looter=actingToken()) {
  if ( !corpseToken(corpse) ) return null;
  return openSource(corpseSource(corpse), looter);
}

function onRenderTokenHUD(hud, html) {
  const tokenDoc = hud.document;
  if ( !game.user.isGM || !corpseToken(tokenDoc) ) return;
  const column = html.querySelector(".col.left");
  if ( !column || column.querySelector(".dlo-hud") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon dlo-hud";
  button.dataset.tooltip = game.i18n.localize("DLO.Hud.Search");
  button.innerHTML = `<i class="fa-solid fa-sack"></i>`;
  button.addEventListener("click", () => openLoot(tokenDoc));
  column.append(button);
}

export function registerCorpses() {
  route("renderTokenHUD", "Search button", onRenderTokenHUD);
}
