/**
 * « Do it anyway » (suite rule, lot 1 of 2026-11-27): a gesture the GM client refuses for a reason the table may override (too
 * far, a wall in the way) comes back with the mark of core/force.mjs. The player then reads the reason in a warning window and
 * may send the gesture again, forced; the GM is told which rule was overridden, by whom.
 */
import { MODULE_ID, loc } from "../shared.mjs";
import { isForceable, plainReason } from "../core/force.mjs";
import { askGM } from "./take.mjs";

/** The warning window: the reason, « do it anyway » or give up. Resolves to true when the player forces. */
export async function confirmForce(reason) {
  const escape = foundry.utils.escapeHTML;
  return !!(await foundry.applications.api.DialogV2.confirm({
    window: { title: loc("Force.Title"), icon: "fa-solid fa-triangle-exclamation" },
    content: `<p class="dlo-force-reason">${escape(reason)}</p><p>${loc("Force.Question")}</p>`,
    yes: { label: loc("Force.Anyway"), icon: "fa-solid fa-hand-fist" },
    no: { label: loc("Force.GiveUp"), default: true },
    rejectClose: false
  }));
}

/**
 * `askGM`, for a request whose handler throws forceable refusals: on such a refusal the player is asked, and the request is
 * sent again with `force: true`. Any other refusal is shown as usual.
 */
export async function askForce(name, handler, payload, options={}) {
  let reason = null;
  const answer = await askGM(name, handler, payload, { ...options, onRefusal: err => {
    if ( !isForceable(err.message) ) return false;
    reason = plainReason(err.message);
    return true;
  } });
  if ( reason === null ) return answer;
  if ( !(await confirmForce(reason)) ) return null;
  return askGM(name, handler, { ...payload, force: true }, options);
}

/** At the active GM: a whispered note that `user` overrode a rule — what was done, and the reason that was set aside. */
export function tellForced(user, what, reason) {
  if ( !reason || user?.isGM ) return null;
  return ChatMessage.implementation.create({
    content: `<p><i class="fa-solid fa-triangle-exclamation"></i> ${foundry.utils.escapeHTML(loc("Force.Told", { user: user.name, what, reason }))}</p>`,
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    flags: { [MODULE_ID]: { forced: true } }
  });
}
