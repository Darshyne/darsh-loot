/**
 * Armes de jet (SPEC §3.10) : une arme **lancée** (action « Lancer » du moteur, ou cible hors d'allonge — voir
 * adapter/engine.mjs `thrownAttack`) quitte la main du lanceur.
 *  - Touché : une fois sur deux elle reste **plantée** dans la cible (dans son inventaire : volable, récupérable à sa
 *    mort) — sinon elle **tombe au sol** dans la case de la cible.
 *  - Raté : elle file **au-delà** de la cible (1 à 3 cases, un peu de côté) et tombe, **arrêtée par les murs**.
 * Chez le MJ actif, une fois par attaque, à la fin de la résolution du moteur (son hook public). Au sol : un tas (§3.8),
 * **sans effet de vol** (demande utilisateur : le lancer est déjà animé par le moteur), le son d'atterrissage seul ;
 * plantée : rien.
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
  const scene = thrower.parent;
  const from = centerOf(thrower);
  const at = centerOf(target.token);
  const level = target.token._source.level ?? thrower._source.level ?? null;
  const elevation = target.token._source.elevation ?? 0;

  if ( target.hit && lodges(await roll("1d2")) && target.token.actor && (target.token.actor !== thrower.actor) ) {
    // Plantée : aucun effet de notre part (le lancer est déjà animé par le moteur et ses animations).
    await moveItem(thrower.actor, target.token.actor, item.id, 1);
    log.info(`${item.name} plantée dans ${target.token.name}`);
    return;
  }
  let point = at;
  if ( !target.hit ) {
    const landing = missLanding(from, at, await roll("1d3"), (await roll("1d3")) - 2, scene.grid.size);
    point = blockedByWalls(scene, at, landing);
  }
  await putOnGround({ scene, point, level, elevation, from, item, owner: thrower.actor, quantity: 1, flight: false });
  log.info(`${item.name} ${target.hit ? "tombée aux pieds de" : "ratée, tombée au-delà de"} ${target.token.name}`);
}

export function registerThrow() {
  route(RESOLUTION_HOOK, "armes de jet", resolution => { onResolution(resolution); });
}
