/**
 * A refusal the player may override (suite rule: « a refused action can be forced »). Only the message of an error crosses from
 * the GM client to the player, so a refusal that can be forced carries an invisible mark at its end. Pure.
 */

/** Zero-width space + word joiner: never typed, never shown. */
export const FORCE_MARK = "​⁠";

/** The error to throw at the GM client for a refusal the player may force. */
export function forceableRefusal(reason) {
  return new Error(`${reason}${FORCE_MARK}`);
}

/** Does this refusal message say it may be forced? */
export function isForceable(message) {
  return String(message ?? "").includes(FORCE_MARK);
}

/** The reason alone, as it should be shown. */
export function plainReason(message) {
  return String(message ?? "").split(FORCE_MARK).join("");
}
