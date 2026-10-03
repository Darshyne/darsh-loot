/**
 * Aller fouiller (SPEC §3.9) — règle pure, testée par tests/approach.test.mjs : les cases d'où un personnage atteint
 * ce qu'il veut fouiller. Le chemin et la marche elle-même appartiennent au moteur de combat (SPEC §4).
 */
import { edgeDistance } from "./loot.mjs";

/**
 * Les cases (coin haut-gauche du token, en cases entières) d'où un token de `mover` cases atteint la cible à `reach`
 * ou moins, sans la chevaucher — les plus proches du token d'abord.
 * @param {{ col: number, row: number, w: number, h: number }} target  La cible, en cases (fractions admises : un tas).
 * @param {{ col: number, row: number, w: number, h: number }} mover   Le token qui marche, en cases.
 * @param {number} reach          Portée, en unités de la scène.
 * @param {number} cellDistance   Distance d'une case.
 * @returns {{ i: number, j: number }[]}  i : ligne, j : colonne (convention de la grille du cœur).
 */
export function goalCells(target, mover, reach, cellDistance) {
  const span = Math.ceil(reach / cellDistance) + Math.max(mover.w, mover.h);
  const cells = [];
  for ( let row = Math.floor(target.row) - span; row <= Math.ceil(target.row + target.h) + span; row++ ) {
    for ( let col = Math.floor(target.col) - span; col <= Math.ceil(target.col + target.w) + span; col++ ) {
      const box = { col, row, w: mover.w, h: mover.h };
      const overlapX = (col < target.col + target.w) && (target.col < col + mover.w);
      const overlapY = (row < target.row + target.h) && (target.row < row + mover.h);
      if ( overlapX && overlapY ) continue;   // sur la cible elle-même
      if ( edgeDistance(box, target, cellDistance) > reach ) continue;
      cells.push({ i: row, j: col, d: Math.hypot(col - mover.col, row - mover.row) });
    }
  }
  return cells.sort((a, b) => a.d - b.d).map(({ i, j }) => ({ i, j }));
}
