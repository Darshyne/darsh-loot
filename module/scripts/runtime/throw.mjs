/**
 * Armes de jet (SPEC §3.10) : une arme **lancée** (action « Lancer » du moteur, ou cible hors d'allonge — voir
 * adapter/engine.mjs `thrownAttack`) quitte la main du lanceur.
 *  - Touché : une fois sur deux elle reste **plantée** dans la cible (dans son inventaire : volable, récupérable à sa
 *    mort) — sinon elle **tombe au sol** dans la case de la cible.
 *  - Raté : elle file **au-delà** de la cible (1 à 3 cases, un peu de côté) et tombe, **arrêtée par les murs**.
 * Chez le MJ actif, une fois par attaque, à la fin de la résolution du moteur (son hook public). Au sol : un tas (§3.8),
 * **sans effet de vol** (demande utilisateur : le lancer est déjà animé par le moteur), le son d'atterrissage seul ;
 * plantée : rien.
 *
 * 0.15.1 : dnd5e retire déjà l'unité lancée de la fiche (documents/activity/attack.mjs:191-192, sauf arme « de retour ») — on ne
 * la décompte pas une seconde fois (`copy`, `alreadySpent`). Une arme de retour (`ret`) revient dans la main : rien ne tombe.
 * D'un PNJ, l'objet qui tombe est sa version « équipement » ; une attaque de créature ne tombe pas (adapter/drop.mjs `moveItem`).
 */
import { setting, log } from "../shared.mjs";
import { route } from "./router.mjs";
import { putOnGround } from "./drop.mjs";
import { RESOLUTION_HOOK, thrownAttack } from "../adapter/engine.mjs";
import { moveItem } from "../adapter/drop.mjs";
import { lodges, missLanding, stopBefore } from "../core/throw.mjs";

/** Attaques déjà traitées (le moteur publie chaque étape, parfois deux fois la dernière). */
const handled = new Set();

const centerOf = token => {
  const size = token.parent.grid.size;
  const s = token._source;
  return { x: s.x + ((s.width * size) / 2), y: s.y + ((s.height * size) / 2) };
};

const roll = async formula => (await new Roll(formula).evaluate({ allowInteractive: false })).total;

/** Le point de chute d'une arme ratée, ramené devant le premier mur entre la cible et lui (scène affichée par le MJ). */
function blockedByWalls(scene, origin, landing) {
  if ( canvas.scene !== scene ) return landing;
  const hit = CONFIG.Canvas.polygonBackends.move.testCollision(origin, landing, { type: "move", mode: "closest" });
  return hit ? stopBefore(origin, hit, scene.grid.size) : landing;
}

async function onResolution(resolution) {
  if ( !setting("thrownWeapons") || (game.users.activeGM?.isSelf !== true) ) return;
  const attack = thrownAttack(resolution);
  if ( !attack || handled.has(attack.id) ) return;
  handled.add(attack.id);
  const { item, thrower, targets } = attack;
  const target = targets[0];
  if ( !target || !thrower.actor.items.get(item.id) ) return;
  if ( item.system.properties?.has("ret") ) return log.info(`${item.name}: a returning weapon, back in hand`);
  const scene = thrower.parent;
  const from = centerOf(thrower);
  const at = centerOf(target.token);
  const level = target.token._source.level ?? thrower._source.level ?? null;
  const elevation = target.token._source.elevation ?? 0;

  if ( target.hit && lodges(await roll("1d2")) && target.token.actor && (target.token.actor !== thrower.actor) ) {
    // Plantée : aucun effet de notre part (le lancer est déjà animé par le moteur et ses animations).
    const moved = await moveItem(thrower.actor, target.token.actor, item.id, 1, { copy: true });
    log.info(moved.kept ? `${item.name}: a creature's attack, nothing lodged` : `${item.name} lodged in ${target.token.name}`);
    return;
  }
  let point = at;
  if ( !target.hit ) {
    const landing = missLanding(from, at, await roll("1d3"), (await roll("1d3")) - 2, scene.grid.size);
    point = blockedByWalls(scene, at, landing);
  }
  const region = await putOnGround({ scene, point, level, elevation, from, item, owner: thrower.actor, quantity: 1, flight: false, alreadySpent: true });
  if ( !region ) return log.info(`${item.name}: a creature's attack, nothing on the ground`);
  log.info(`${item.name} ${target.hit ? "dropped at the feet of" : "missed, landed beyond"} ${target.token.name}`);
}

export function registerThrow() {
  route(RESOLUTION_HOOK, "thrown weapons", resolution => { onResolution(resolution); });
}
