/**
 * The encounter records (lot 2 XP, lot 3 loot) are one world setting: this client's writes to it go one after the other, so that
 * two gestures (an award and a loot distribution, several creatures dying at once) never write over each other.
 */
let queue = Promise.resolve();

/** Runs `fn` once the record writes before it are done. */
export function serial(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}
