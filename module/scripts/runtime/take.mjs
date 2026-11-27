/**
 * Prendre dans une source de butin (cadavre ou conteneur, SPEC §3.1–3.2) : le joueur demande, le MJ actif vérifie
 * et exécute (le joueur n'a aucun droit sur la source). Requête du cœur V14 : `User#query`, le gestionnaire reçoit
 * l'utilisateur qui demande (documents/collections/users.mjs:230).
 */
import { MODULE_ID, loc, setting, sceneSetting, log } from "../shared.mjs";
import { transferNow } from "../adapter/dnd5e.mjs";
import { inTurn } from "../adapter/ledger.mjs";
import { resolveSource } from "../adapter/sources.mjs";
import { stolenFlag } from "../core/theft.mjs";
import { clearIfEmpty } from "../adapter/drop.mjs";
import { behaviorConcealed, boxInSight } from "../adapter/hidden.mjs";
import { playForAll, SOUNDS } from "./feedback.mjs";
import { forceableRefusal } from "../core/force.mjs";
import { heldBy } from "../adapter/end-loot.mjs";

const TAKE_QUERY = `${MODULE_ID}.take`;

/** Les sources où l'on prend (SPEC §3.1–3.2). */
export const TAKE_KINDS = ["corpse", "container"];

/** Ce qui voyage dans une requête pour désigner une source. */
export const sourceRef = source => ({ kind: source.kind, uuid: source.uuid });

/**
 * Envoie une requête au MJ actif (ou l'exécute si l'on est lui). Un refus devient un avertissement, jamais une erreur. `timeout` :
 * pour une requête qui attend exprès (la fouille, qui conclut à la fin de sa durée).
 * `onRefusal(err)` (lot 1): called with a refusal before it is shown; returning `true` means the caller deals with it (a refusal
 * the player may force, runtime/force.mjs) and nothing is notified here.
 */
export async function askGM(name, handler, payload, { timeout=15000, onRefusal=null }={}) {
  const gm = game.users.activeGM;
  if ( !gm ) { ui.notifications.warn(loc("Notice.NoGM")); return null; }
  if ( gm.isSelf ) {
    try { return await handler(payload, { user: game.user }); }
    catch(err) { return refused(name, err, onRefusal); }
  }
  // Lot 0 (audit of 2026-11-26, defect 7): the query used to give up after `timeout` and say « refused » while the GM client,
  // merely slow (a compendium to load, a queue of gestures), carried it out anyway. Now: after `timeout` the player is told the
  // GM has not answered yet, and the wait goes on until the real answer — up to `GM_PATIENCE_MS`, after which the message says
  // the truth: no answer, the gesture may still be done.
  let waiting = null;
  const slow = setTimeout(() => { waiting = ui.notifications.info(loc("Notice.StillWaiting"), { permanent: true }); }, timeout);
  try {
    return await gm.query(name, payload, { timeout: Math.max(timeout, GM_PATIENCE_MS) });
  } catch(err) {
    if ( !/timed? ?out/i.test(err.message) ) return refused(name, err, onRefusal);
    log.warn(`${name}: no answer from the GM client`, err.message);
    ui.notifications.warn(loc("Notice.NoAnswer"));
    return null;
  } finally {
    clearTimeout(slow);
    if ( waiting ) ui.notifications.remove?.(waiting);
  }
}

/** How long a request waits for the GM client before saying it got no answer (ms). */
const GM_PATIENCE_MS = 90000;

/** A refusal: the reason the GM client gave, as a warning — never a console error (the Core scenarios count them). */
function refused(name, err, onRefusal=null) {
  log.warn(`${name} refused:`, err.message);
  if ( onRefusal?.(err) === true ) return null;
  ui.notifications.warn(loc("Notice.Refused", { reason: err.message }));
  return null;
}

/**
 * Les contrôles communs chez le MJ : la source et le personnage existent, le joueur le possède, il est à portée.
 * Lot 1 — `canForce`: for a gesture whose « too far » and « a wall is in the way » may be overridden by the player (suite rule).
 * The refusal then carries the mark of core/force.mjs; sent again with `force: true`, the gesture goes on and `forced` gives
 * the reason that was overridden, for the caller to tell the GM. Ownership, a hidden container and « GM only » are never forced.
 * @returns {{ source: object, looter: TokenDocument, forced?: string }}
 */
export function checkAccess({ source: ref, looter: looterUuid, force=false }, user, { canForce=false }={}) {
  const source = resolveSource(ref);
  const looter = fromUuidSync(looterUuid, { strict: false });
  if ( !source || !looter?.actor || !source.exists() ) throw new Error(loc("Refus.Introuvable"));
  if ( !looter.actor.testUserPermission(user, "OWNER") ) throw new Error(loc("Refus.PasAToi"));
  if ( user.isGM ) return { source, looter };
  if ( ["container", "zone"].includes(source.kind) && behaviorConcealed(source.doc) ) throw new Error(loc("Refus.Introuvable"));
  if ( (source.kind === "corpse") && (setting("whoLoots") === "gm") ) throw new Error(loc("Refus.MJSeul"));
  // Lot 0 (defect 16): within reach is not enough — no wall between the character and what it searches.
  const obstacle = (source.distance(looter) > sceneSetting("reach", looter.parent)) ? loc("Refus.Loin")
    : (!boxInSight(looter, source.box()) ? loc("Refus.Mur") : null);
  if ( !obstacle ) return { source, looter };
  if ( !canForce ) throw new Error(obstacle);
  if ( !force ) throw forceableRefusal(obstacle);
  return { source, looter, forced: obstacle };
}

/**
 * Demande au MJ actif de déplacer des objets de la source vers le personnage du token qui agit.
 * @param {object} source
 * @param {TokenDocument} looter
 * @param {{ itemIds?: string[], coins?: boolean, quantities?: Record<string, number> }} what
 *   quantities (lot 1): how many of a stack, by item id; the whole stack without it.
 */
export function requestTake(source, looter, what) {
  return askGM(TAKE_QUERY, handleTake,
    { source: sourceRef(source), looter: looter.uuid, itemIds: what.itemIds ?? [], coins: !!what.coins,
      ...(what.quantities ? { quantities: what.quantities } : {}) });
}

/** Chez le MJ : contrôle puis transfert. Une erreur levée ici revient au joueur comme refus. */
async function handleTake(payload, { user }) {
  const { source, looter } = checkAccess(payload, user);
  // Prendre ne vaut que pour un cadavre ou un conteneur : un marchand se paie (`shopDeal`), des poches se volent (`steal`)
  // (journal, 2026-11-18 ; refus non forçable).
  if ( !user.isGM && !TAKE_KINDS.includes(source.kind) ) throw new Error(loc("Refus.Introuvable"));
  if ( source.locked() ) throw new Error(loc("Lock.Locked"));
  if ( !source.actor ) throw new Error(loc("Refus.Introuvable"));
  // Lot 3: a corpse held for the end-of-combat loot is not taken from before the GM validates (forcing goes through the search).
  if ( !user.isGM && (source.kind === "corpse") && heldBy(source.doc) ) throw new Error(loc("EndLoot.Held"));
  const owner = (source.kind === "container") ? source.doc.system.owner : "";
  const stolen = owner ? stolenFlag({ from: owner, fromUuid: source.uuid, place: source.doc.parent?.parent?.name,
    time: game.time.worldTime }) : null;
  // Deux prises à la même source (deux joueurs sur « Tout prendre ») passent l'une après l'autre : la seconde ne voit que
  // ce que la première a laissé.
  const taken = await inTurn([source.actor, looter.actor], async () => {
    // Le tour venu, la source a pu disparaître : un tas vidé par la prise d'avant est parti avec sa région.
    if ( !source.exists() ) throw new Error(loc("Refus.Introuvable"));
    const quantities = (payload.quantities && (typeof payload.quantities === "object")) ? payload.quantities : null;
    const moved = await transferNow(source.actor, looter.actor, { itemIds: payload.itemIds, coins: payload.coins, stolen, quantities });
    if ( source.kind === "container" ) await clearIfEmpty(source.doc.parent);   // un tas au sol vidé disparaît (§3.8)
    return moved;
  });
  announce(looter, source, taken, !!stolen);
  if ( taken.names.length || taken.coins.length ) playForAll(SOUNDS.coins, 0.6);   // 2026-10-28 : prendre s'entend (les pièces)
  return taken;
}

/** Message de ce qui a été pris, au MJ seulement ou à tous (réglage `announce`). Le vrai nom de la source, côté MJ. */
export function announce(looter, source, taken, stolen=false) {
  const mode = setting("announce");
  if ( (mode === "none") || (!taken.names.length && !taken.coins.length) ) return;
  const coins = taken.coins.map(c => `${c.value} ${CONFIG.DND5E.currencies[c.key]?.abbreviation ?? c.key}`);
  const content = `<p>${loc(stolen ? "Chat.Stole" : "Chat.Took", { looter: looter.name, corpse: source.name,
    what: [...taken.names, ...coins].join(", ") })}</p>`;
  const whisper = (mode === "gm") ? game.users.filter(u => u.isGM).map(u => u.id) : [];
  ChatMessage.implementation.create({ content, whisper, speaker: ChatMessage.implementation.getSpeaker({ token: looter }),
    flags: { [MODULE_ID]: { take: true } } });
}

export function registerTake() {
  CONFIG.queries[TAKE_QUERY] = handleTake;
}
