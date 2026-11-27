/**
 * Tirage du trésor à la première fouille (SPEC §3.1, étape 2) : le MJ actif tire une fois par cadavre,
 * le résultat est mémorisé sur l'acteur (`flags.darsh-loot.rolled`, dans le delta d'un token non lié).
 */
import { MODULE_ID, setting, log } from "../shared.mjs";
import { corpseToken } from "../adapter/dnd5e.mjs";
import { isRolled, rollTreasure } from "../adapter/treasure.mjs";
import { livingNPC } from "../adapter/theft.mjs";
import { heldBy, keepSpecialWeapons } from "../adapter/end-loot.mjs";

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
async function handleRoll({ corpse: uuid }, { user=null }={}) {
  const corpse = fromUuidSync(uuid);
  if ( !corpse?.actor || !(corpseToken(corpse) || livingNPC(corpse)) || isRolled(corpse.actor) ) return null;
  // Lot 3: a corpse held for the end-of-combat loot is rolled when the GM validates, not at the first search.
  if ( heldBy(corpse) ) return null;
  // D'un joueur : seulement si le MJ a laissé le tirage automatique, et avec une créature à lui sur la scène ; le contenu ne lui est
  // pas rendu (il le voit en ouvrant, comme tout le monde).
  if ( user && !user.isSelf && !user.isGM ) {
    if ( !setting("autoTreasure") || !corpse.parent?.tokens.some(t => t.actor?.testUserPermission(user, "OWNER")) ) {
      log.warn(`treasure roll query from ${user.name} refused for ${corpse.name}`);
      return null;
    }
    await handleRoll({ corpse: uuid });
    return true;
  }
  if ( !pending.has(uuid) ) {
    // Lot 3: « keep the special weapon » holds for a corpse searched without the end-of-combat step too.
    const before = (setting("keepSpecial") && corpseToken(corpse)) ? keepSpecialWeapons(corpse.actor).catch(() => 0) : Promise.resolve(0);
    const run = before.then(() => rollTreasure(corpse.actor, { pockets: setting("pockets") }))
      .then(result => { log.info(`treasure of ${corpse.name}:`, result); return result; })
      .finally(() => pending.delete(uuid));
    pending.set(uuid, run);
  }
  return pending.get(uuid);
}

export function registerTreasure() {
  CONFIG.queries[ROLL_QUERY] = handleRoll;
}
