/**
 * The GM's writes, one at a time, and what to do when one of them fails.
 *
 * `inTurn` — moving an item or coins means reading both sheets, waiting for the server (create, update, delete), then writing
 * again: two requests that cross would read the same state — the item taken twice, the stack losing a quantity. Each gesture
 * therefore waits for the end of those touching the same actors, and reads only once its turn has come.
 *
 * `operation` — a gesture made of several writes (a trade, a deal, raising a corpse) registers, after each write, how to undo
 * it. When a later write fails, what was done is undone in reverse order and the GM gets a trace (lot 0, audit of 2026-11-26,
 * defects 3 and 4). An operation that asks for it is also noted in a journal before its first write and cleared at its end: a
 * GM who reloads in the middle finds it at the next load (`runtime/operations.mjs`).
 */
import { loc, log } from "../shared.mjs";

/** Per actor (UUID), the end of the last registered gesture. */
const tails = new Map();

/** How long a gesture may hold its actors before the next ones stop waiting for it (ms). */
export const TURN_PATIENCE_MS = 60000;

/**
 * Runs `fn` once every gesture already registered on one of these actors has finished (succeeded or not). Registration is
 * immediate and covers all actors at once: a gesture only waits for those registered before it, never the reverse — no crossed
 * wait. Do not call `inTurn` again on the same actors from `fn`: it would wait for itself.
 * A gesture that never ends (a write the server never answers) does not freeze its actors for ever: after `patience` ms the
 * next gestures go on without it (defect 9) — it keeps running, and a warning is logged.
 * @param {(Actor|null)[]} actors
 * @param {() => Promise<any>} fn    To read **inside** `fn`: everything the gesture depends on (quantities, purses, existence).
 * @param {{ patience?: number }} [options]
 * @returns {Promise<any>}           What `fn` returns (or its error).
 */
export function inTurn(actors, fn, { patience=TURN_PATIENCE_MS }={}) {
  const keys = [...new Set(actors.map(a => a?.uuid).filter(Boolean))];
  const run = Promise.all(keys.map(k => tails.get(k))).then(fn);
  let timer = null;
  const settled = run.then(() => {}, () => {});
  const tail = Promise.race([
    settled,
    new Promise(resolve => { timer = setTimeout(() => { log.warn("a gesture is still running after", patience, "ms: the next ones no longer wait for it", keys); resolve(); }, patience); })
  ]);
  settled.then(() => clearTimeout(timer));
  for ( const k of keys ) tails.set(k, tail);
  tail.then(() => { for ( const k of keys ) if ( tails.get(k) === tail ) tails.delete(k); });
  return run;
}

/* -------------------------------------------- */
/*  Operations: undo and trace                  */
/* -------------------------------------------- */

/** What `runtime/operations.mjs` plugs in: where failures are reported and where running operations are noted. */
const sinks = { report: null, open: null, close: null };

/**
 * @param {{ report?: Function, open?: Function, close?: Function }} given
 *   report({ label, done, error, failures }) — a failed operation, after its undo ; open(entry) / close(id) — the journal.
 */
export function setOperationSinks(given={}) {
  Object.assign(sinks, { report: null, open: null, close: null }, given);
}

/** Runs the undo steps in reverse order; a step that fails does not stop the others. Returns what could not be undone. */
export async function rollback(undos) {
  const failures = [];
  for ( const step of [...undos].reverse() ) {
    try { await step.undo(); }
    catch(err) { failures.push(`${step.text} (${err.message})`); }
  }
  return failures;
}

/** An error already explained to the GM by a trace: handlers pass it on to the player as a plain refusal. */
export class OperationError extends Error {
  constructor(message, { cause, undone }) {
    super(message);
    this.name = "OperationError";
    this.cause = cause;
    this.undone = undone;
  }
}

let lastOperation = 0;

/**
 * Runs a gesture made of several writes. `fn(op)` calls `op.did(text, undo)` after each successful write: `text` says what was
 * written (shown to the GM), `undo` puts it back. Nothing to undo and an error (a refusal before the first write): the error
 * passes through untouched. Otherwise the writes are undone, the GM gets the trace, and an `OperationError` is thrown.
 * @param {{ label: string, plan?: string[], journal?: boolean }} info
 *   label : the gesture in a few words (GM's language) ; plan : what it intends to write, for the journal ; journal : note it
 *   before the first write (`false` for a single move, where a reload leaves at worst one duplicate).
 * @param {(op: { did: (text: string, undo: () => Promise<any>) => void }) => Promise<any>} fn
 */
export async function operation({ label, plan=[], journal=true }, fn) {
  const steps = [];
  const op = { did: (text, undo) => { steps.push({ text, undo }); } };
  const id = `${Date.now()}-${++lastOperation}`;
  let noted = false;
  if ( journal && sinks.open ) {
    try { await sinks.open({ id, label, plan, time: Date.now() }); noted = true; }
    catch(err) { log.warn("operation journal:", err.message); }
  }
  try {
    return await fn(op);
  } catch(err) {
    if ( !steps.length ) throw err;
    const failures = await rollback(steps);
    log.warn(`${label} failed after ${steps.length} write(s):`, err.message, failures.length ? `— not undone: ${failures.join(" ; ")}` : "— all undone");
    try { await sinks.report?.({ label, done: steps.map(s => s.text), error: err.message, failures }); }
    catch(reportErr) { log.warn("operation report:", reportErr.message); }
    throw new OperationError(loc(failures.length ? "Op.FailedPartly" : "Op.FailedUndone"), { cause: err, undone: !failures.length });
  } finally {
    if ( noted ) {
      try { await sinks.close?.(id); }
      catch(err) { log.warn("operation journal:", err.message); }
    }
  }
}
