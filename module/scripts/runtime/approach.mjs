/**
 * Aller fouiller (SPEC §3.9) : un clic sur un cadavre, un coffre, un tas ou des poches hors de portée fait marcher le
 * personnage jusqu'à une case d'où il l'atteint, par le chemin du **moteur de combat** (A*, portes, escaliers, budget,
 * attaques d'opportunité), puis ouvre la fenêtre à l'arrivée. Hors combat seulement (en combat, le clic est au moteur).
 * Tant que le moteur n'expose pas `api.approach` (SPEC §4), rien ne change : curseur « trop loin ».
 */
import { setting, log } from "../shared.mjs";
import { goalCells } from "../core/approach.mjs";
import { engineApproach } from "../adapter/engine.mjs";

/** Peut-on aller fouiller en marchant ? */
export function canApproach() {
  return !!engineApproach() && !game.combat?.started;
}

/** Marcher jusqu'à portée de la source. true : arrivé à portée. */
export async function approachSource(source, looter) {
  const approach = engineApproach();
  // Autre scène ou autre niveau : distance infinie, on ne marche pas.
  if ( !approach || !looter || !Number.isFinite(source.distance(looter)) ) return false;
  const scene = looter.parent;
  const size = scene.grid.size;
  const s = looter._source;
  const mover = { col: s.x / size, row: s.y / size, w: s.width, h: s.height };
  const cells = goalCells(source.box(), mover, setting("reach"), scene.grid.distance);
  if ( !cells.length ) return false;
  try {
    await approach(looter, { cells, level: s.level ?? null });
  } catch(err) {
    log.warn("walk to search:", err.message);
    return false;
  }
  return source.distance(looter) <= setting("reach");
}
