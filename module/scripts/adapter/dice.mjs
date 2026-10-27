/**
 * Dice So Nice (règle DAS, 2026-10-27) : un résultat qui suit un jet n'apparaît qu'une fois les dés 3D arrêtés. Même règle que le
 * moteur (`waitForDice`, dnd5e-combat runtime/shared.mjs) : attente bornée — `waitFor3DAnimationByMessageID` ne rend la main qu'au
 * hook `diceSoNiceRollComplete` du message, qui ne vient jamais si le rendu est suspendu (fenêtre en arrière-plan).
 */

import { log } from "../shared.mjs";

export const DICE_WAIT_MAX_MS = 8000;

/** Les messages de jet de ce client créés depuis `known` (ensemble d'ids relevé avant le jet) : le dernier, ou null. */
export function newRollMessage(known) {
  return game.messages.contents.findLast(m => !known.has(m.id) && m.isAuthor && m.rolls?.length) ?? null;
}

/** Attend la fin de l'animation des dés 3D de ce message (rien sans Dice So Nice, ni fenêtre masquée ; au plus `maxMs`). */
export async function waitForDice(message, maxMs=DICE_WAIT_MAX_MS) {
  if ( !message || !game.modules.get("dice-so-nice")?.active || !game.dice3d ) return;
  if ( document.hidden ) return log.info("3D dice: continuing without waiting (window in the background)");
  const pending = game.dice3d.waitFor3DAnimationByMessageID(message.id);
  if ( !pending ) return;
  const late = await Promise.race([pending.then(() => false), new Promise(resolve => setTimeout(() => resolve(true), maxMs))]);
  if ( late ) log.info(`3D dice: continuing without waiting (over ${maxMs} ms)`);
}
