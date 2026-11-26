/**
 * Pacing of work done in answer to very frequent events (lot 0, audit of 2026-11-26, defects 22–23): the mouse moving over the
 * map, documents updated in bursts. Pure, tested by tests/pace.test.mjs.
 */

/**
 * Runs `fn` at most once per `wait` ms: at once when nothing ran recently, then once more at the end of the window with the
 * **latest** arguments — the last position of the mouse is never lost.
 * @param {(...args: any[]) => void} fn
 * @param {number} wait  ms
 */
export function throttleLatest(fn, wait) {
  let timer = null;
  let pending = null;
  let last = -Infinity;
  const run = args => { last = Date.now(); fn(...args); };
  return (...args) => {
    const since = Date.now() - last;
    if ( !timer && (since >= wait) ) return run(args);
    pending = args;
    timer ??= setTimeout(() => { timer = null; const latest = pending; pending = null; run(latest); }, Math.max(0, wait - since));
    return undefined;
  };
}

/**
 * Merges a burst of calls into one: `fn` runs once, `wait` ms after the first call of the burst. Unlike a debounce, a steady
 * stream of calls cannot postpone it for ever.
 * @param {() => void} fn
 * @param {number} wait  ms
 */
export function coalesce(fn, wait) {
  let timer = null;
  return () => { timer ??= setTimeout(() => { timer = null; fn(); }, wait); };
}
