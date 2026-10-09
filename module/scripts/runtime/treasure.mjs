/**
 * Tirage du trésor à la première fouille (SPEC §3.1, étape 2) : le MJ actif tire une fois par cadavre,
 * le résultat est mémorisé sur l'acteur (`flags.darsh-loot.rolled`, dans le delta d'un token non lié).
 */
import { MODULE_ID, setting, log } from "../shared.mjs";
import { corpseToken } from "../adapter/dnd5e.mjs";
import { isRolled, rollTreasure } from "../adapter/treasure.mjs";
import { livingNPC } from "../adapter/theft.mjs";

const ROLL_QUERY = `${MODULE_ID}.roll`;

/** Tirages en cours chez le MJ, par UUID de token : deux fouilles simultanées n'en font qu'un. */
const pending = new Map();

/** Avant d'ouvrir la fenêtre : s'assurer que le cadavre a été tiré. Ne lève jamais. */
export async function ensureRolled(corpse) {
  if ( !setting("autoTreasure") || !corpse.actor || isRolled(corpse.actor) ) return;
  const gm = game.users.activeGM;
  if ( !gm ) return;
  try {
    if ( gm.isSelf ) await handleRoll({ corpse: corpse.uuid });
    else await gm.query(ROLL_QUERY, { corpse: corpse.uuid }, { timeout: 15000 });
  } catch(err) {
    log.warn("could not roll treasure:", err.message);
  }
}

/** Chez le MJ. Un PNJ mort (fouille) ou vivant (vol à la tire, §3.3) : le trésor tiré de son vivant ne l'est pas deux fois. */
async function handleRoll({ corpse: uuid }) {
  const corpse = fromUuidSync(uuid);
  if ( !corpse?.actor || !(corpseToken(corpse) || livingNPC(corpse)) || isRolled(corpse.actor) ) return null;
  if ( !pending.has(uuid) ) {
    const run = rollTreasure(corpse.actor, { pockets: setting("pockets") })
      .then(result => { log.info(`treasure of ${corpse.name}:`, result); return result; })
      .finally(() => pending.delete(uuid));
    pending.set(uuid, run);
  }
  return pending.get(uuid);
}

export function registerTreasure() {
  CONFIG.queries[ROLL_QUERY] = handleRoll;
}
