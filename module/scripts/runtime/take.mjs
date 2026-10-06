/**
 * Prendre dans une source de butin (cadavre ou conteneur, SPEC §3.1–3.2) : le joueur demande, le MJ actif vérifie
 * et exécute (le joueur n'a aucun droit sur la source). Requête du cœur V14 : `User#query`, le gestionnaire reçoit
 * l'utilisateur qui demande (documents/collections/users.mjs:230).
 */
import { MODULE_ID, loc, setting, log } from "../shared.mjs";
import { transfer } from "../adapter/dnd5e.mjs";
import { resolveSource } from "../adapter/sources.mjs";
import { stolenFlag } from "../core/theft.mjs";
import { clearIfEmpty } from "../adapter/drop.mjs";
import { behaviorConcealed } from "../adapter/hidden.mjs";

const TAKE_QUERY = `${MODULE_ID}.take`;

/** Ce qui voyage dans une requête pour désigner une source. */
export const sourceRef = source => ({ kind: source.kind, uuid: source.uuid });

/** Envoie une requête au MJ actif (ou l'exécute si l'on est lui). Un refus devient un avertissement, jamais une erreur. */
export async function askGM(name, handler, payload) {
  const gm = game.users.activeGM;
  if ( !gm ) { ui.notifications.warn(loc("Notice.NoGM")); return null; }
  try {
    return gm.isSelf ? await handler(payload, { user: game.user }) : await gm.query(name, payload, { timeout: 15000 });
  } catch(err) {
    log.warn(`${name} refusé :`, err.message);
    ui.notifications.warn(loc("Notice.Refused", { reason: err.message }));
    return null;
  }
}

/**
 * Les contrôles communs chez le MJ : la source et le personnage existent, le joueur le possède, il est à portée.
 * @returns {{ source: object, looter: TokenDocument }}
 */
export function checkAccess({ source: ref, looter: looterUuid }, user) {
  const source = resolveSource(ref);
  const looter = fromUuidSync(looterUuid, { strict: false });
  if ( !source || !looter?.actor || !source.exists() ) throw new Error(loc("Refus.Introuvable"));
  if ( !looter.actor.testUserPermission(user, "OWNER") ) throw new Error(loc("Refus.PasAToi"));
  if ( user.isGM ) return { source, looter };
  if ( ["container", "zone"].includes(source.kind) && behaviorConcealed(source.doc) ) throw new Error(loc("Refus.Introuvable"));
  if ( (source.kind === "corpse") && (setting("whoLoots") === "gm") ) throw new Error(loc("Refus.MJSeul"));
  if ( source.distance(looter) > setting("reach") ) throw new Error(loc("Refus.Loin"));
  return { source, looter };
}

/**
 * Demande au MJ actif de déplacer des objets de la source vers le personnage du token qui agit.
 * @param {object} source
 * @param {TokenDocument} looter
 * @param {{ itemIds?: string[], coins?: boolean }} what
 */
export function requestTake(source, looter, what) {
  return askGM(TAKE_QUERY, handleTake,
    { source: sourceRef(source), looter: looter.uuid, itemIds: what.itemIds ?? [], coins: !!what.coins });
}

/** Chez le MJ : contrôle puis transfert. Une erreur levée ici revient au joueur comme refus. */
async function handleTake(payload, { user }) {
  const { source, looter } = checkAccess(payload, user);
  if ( source.locked() ) throw new Error(loc("Lock.Locked"));
  if ( !source.actor ) throw new Error(loc("Refus.Introuvable"));
  const owner = (source.kind === "container") ? source.doc.system.owner : "";
  const stolen = owner ? stolenFlag({ from: owner, fromUuid: source.uuid, place: source.doc.parent?.parent?.name,
    time: game.time.worldTime }) : null;
  const taken = await transfer(source.actor, looter.actor, { itemIds: payload.itemIds, coins: payload.coins, stolen });
  announce(looter, source, taken, !!stolen);
  if ( source.kind === "container" ) await clearIfEmpty(source.doc.parent);   // un tas au sol vidé disparaît (§3.8)
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
