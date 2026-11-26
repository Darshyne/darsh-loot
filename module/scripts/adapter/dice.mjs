/**
 * Dés 3D — Dice So Nice, Dicer… (règle DAS, 2026-10-27) : un résultat qui suit un jet n'apparaît qu'une fois les dés 3D arrêtés. Même règle que le
 * moteur (`waitForDice`, dnd5e-combat runtime/shared.mjs) : attente bornée — `waitFor3DAnimationByMessageID` ne rend la main qu'au
 * hook `diceSoNiceRollComplete` du message, qui ne vient jamais si le rendu est suspendu (fenêtre en arrière-plan).
 */

import { log } from "../shared.mjs";

export const DICE_WAIT_MAX_MS = 8000;

/**
 * #286 (dnd5e-combat): 3D dice come from whatever module provides Dice So Nice's API (`game.dice3d`): Dice So Nice, Dicer… Recognised
 * by the function, not by the module id — Dicer cannot run beside Dice So Nice, so a `dice-so-nice` check never waited for it.
 */
const dice3d = () => globalThis.game?.dice3d;

/** Do 3D dice roll on this client right now: an API that can wait for them, and a visible window. */
export const diceShown = () => !!dice3d()?.waitFor3DAnimationByMessageID && !document.hidden;

/** Les messages de jet de ce client créés depuis `known` (ensemble d'ids relevé avant le jet) : le dernier, ou null. */
export function newRollMessage(known) {
  return game.messages.contents.findLast(m => !known.has(m.id) && m.isAuthor && m.rolls?.length) ?? null;
}

/** Attend la fin de l'animation des dés 3D de ce message (rien sans dés 3D, ni fenêtre masquée ; au plus `maxMs`). */
export async function waitForDice(message, maxMs=DICE_WAIT_MAX_MS) {
  if ( !message || !dice3d()?.waitFor3DAnimationByMessageID ) return;
  if ( document.hidden ) return log.info("3D dice: continuing without waiting (window in the background)");
  const pending = dice3d().waitFor3DAnimationByMessageID(message.id);
  if ( !pending ) return;
  const late = await Promise.race([pending.then(() => false), new Promise(resolve => setTimeout(() => resolve(true), maxMs))]);
  if ( late ) log.info(`3D dice: continuing without waiting (over ${maxMs} ms)`);
}

/**
 * 0.21.0 (issue #5) : un jet secret sans message de chat (le cœur montre aux joueurs qu'un jet caché a eu lieu : « X lance des dés
 * en privé » trahirait un vol). Les dés 3D roulent chez ce client seul (`showForRoll`, sans synchroniser), au plus `maxMs`.
 */
export async function showDiceLocally(roll, maxMs=DICE_WAIT_MAX_MS) {
  if ( !roll || !dice3d()?.showForRoll ) return;
  if ( document.hidden ) return log.info("3D dice: continuing without waiting (window in the background)");
  const shown = Promise.resolve(dice3d().showForRoll(roll, game.user, false)).catch(() => {});
  const late = await Promise.race([shown.then(() => false), new Promise(resolve => setTimeout(() => resolve(true), maxMs))]);
  if ( late ) log.info(`3D dice: continuing without waiting (over ${maxMs} ms)`);
}
