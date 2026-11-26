/**
 * What the GM reads when a gesture made of several writes goes wrong (lot 0, audit of 2026-11-26, defect 3). The mechanics are in
 * `adapter/ledger.mjs` (`operation`); this file gives them their two outlets:
 *  - a **trace**: a chat message whispered to the GMs, saying what had been written, the error, and whether everything was put back;
 *  - a **journal**: the hidden world setting `operations` holds the gestures in progress (a trade, a deal, a corpse being raised).
 *    An entry still there when the active GM loads the world is a gesture cut short by a reload: the GM is told which one, and
 *    what it meant to write, so the sheets can be checked.
 */
import { MODULE_ID, loc, log } from "../shared.mjs";
import { setOperationSinks } from "../adapter/ledger.mjs";

const KEY = "operations";
const escape = s => foundry.utils.escapeHTML(String(s ?? ""));
const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);
const list = lines => (lines.length ? `<ul>${lines.map(l => `<li>${escape(l)}</li>`).join("")}</ul>` : "");

/** The journal is rewritten whole: one write at a time, each on what the previous one left. */
let writing = Promise.resolve();
function rewrite(change) {
  writing = writing.then(async () => {
    const next = change({ ...(game.settings.get(MODULE_ID, KEY) ?? {}) });
    await game.settings.set(MODULE_ID, KEY, next);
  });
  return writing;
}

const open = entry => rewrite(journal => ({ ...journal, [entry.id]: entry }));
const close = id => rewrite(journal => { delete journal[id]; return journal; });

/** A failed operation, after its undo. */
function report({ label, done, error, failures }) {
  const verdict = failures.length
    ? `<p><strong>${escape(loc("Op.NotUndone"))}</strong></p>${list(failures)}`
    : `<p>${escape(loc("Op.AllUndone"))}</p>`;
  return ChatMessage.implementation.create({
    whisper: gmIds(), flags: { [MODULE_ID]: { operation: true } },
    content: `<p><i class="fa-solid fa-triangle-exclamation"></i> <strong>${escape(loc("Op.Failed", { label }))}</strong></p>`
      + `<p>${escape(loc("Op.Error", { error }))}</p><p>${escape(loc("Op.Written"))}</p>${list(done)}${verdict}`
  });
}

/**
 * Active GM, at world load: gestures the journal still holds were cut short (reload, crash). Each one is told to the GMs with
 * what it meant to write, then the journal is emptied.
 * @returns {Promise<number>}  How many were found.
 */
export async function reportInterrupted() {
  const entries = Object.values(game.settings.get(MODULE_ID, KEY) ?? {});
  if ( !entries.length ) return 0;
  for ( const entry of entries ) {
    log.warn("operation interrupted by a reload:", entry.label, entry.plan);
    await ChatMessage.implementation.create({
      whisper: gmIds(), flags: { [MODULE_ID]: { operation: true, interrupted: true } },
      content: `<p><i class="fa-solid fa-triangle-exclamation"></i> <strong>${escape(loc("Op.Interrupted", { label: entry.label }))}</strong></p>`
        + `<p>${escape(loc("Op.Planned"))}</p>${list(entry.plan ?? [])}<p>${escape(loc("Op.Check"))}</p>`
    });
  }
  await rewrite(() => ({}));
  return entries.length;
}

/** Plugs the trace and the journal into `operation` (every client: only a GM ever runs one). */
export function registerOperations() {
  setOperationSinks({ report, open, close });
}
