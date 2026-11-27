/**
 * Pure rules of giving (lot 1, 2026-11-27): who may receive, when the receiver is asked first. Tested by tests/give.test.mjs.
 */

/** The values of the `giveMode` setting: handed over at once, the receiver agrees first, or the gesture is switched off. */
export const GIVE_MODES = ["direct", "ask", "off"];

/**
 * May this actor receive a gift? Another actor than the giver's; a player gives to a player character or to a creature a
 * player owns (a companion) — never to an ordinary NPC, where the item would vanish into the GM's hands; a GM gives to any
 * character or NPC.
 * @param {{ same: boolean, type: string, playerOwned: boolean, byGM: boolean }} data
 */
export function canReceive({ same, type, playerOwned, byGM }) {
  if ( same ) return false;
  if ( byGM ) return ["character", "npc"].includes(type);
  return (type === "character") || !!playerOwned;
}

/**
 * Is the receiver asked before anything moves? Only in « ask » mode, and not when the one who gives also holds the receiver
 * (a player with two characters) or is the GM.
 * @param {{ mode: string, byGM: boolean, ownsReceiver: boolean }} data
 */
export function needsConsent({ mode, byGM, ownsReceiver }) {
  return (mode === "ask") && !byGM && !ownsReceiver;
}
