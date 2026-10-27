/**
 * Ce que ce client voit de la carte (0.17.0) : un point dans le champ de vision de ses tokens — murs et brouillard compris,
 * le test du cœur (client/canvas/groups/visibility.mjs:843, celui que le cœur fait pour la souris, board.mjs:1254) — et pas
 * sous un toit qu'il voit. Sans quoi un joueur trouvait les coffres en promenant la souris : le curseur de fouille sortait à
 * travers le brouillard, les murs et les toits.
 *
 * Le MJ voit tout.
 */

/** L'altitude du sol d'une région (son bas, 0 s'il est ouvert). */
export function regionFloor(region) {
  const bottom = region?.elevation?.bottom;
  return Number.isFinite(bottom) ? bottom : 0;
}

/**
 * Une tuile au-dessus de ce point le cache-t-elle ? Un toit (tuile plus haute que l'objet, affichée sur ce client, pas estompée
 * parce qu'un token est dessous) dont l'image est opaque à cet endroit.
 */
export function roofOver(point, elevation=0) {
  for ( const tile of canvas.tiles?.placeables ?? [] ) {
    const mesh = tile.mesh;
    if ( !mesh || mesh.destroyed || !mesh.visible || tile.occluded ) continue;
    if ( !(tile.document.elevation > elevation) ) continue;
    if ( mesh.containsCanvasPoint(point) ) return true;
  }
  return false;
}

/** Ce point (à cette altitude) est-il vu par ce client ? */
export function pointSeen(point, elevation=0) {
  if ( game.user.isGM ) return true;
  if ( !canvas.visibility?.testVisibility({ x: point.x, y: point.y, elevation }, { tolerance: 0 }) ) return false;
  return !roofOver(point, elevation);
}

/** Au moins une case de cette région est-elle vue par ce client ? (centres de cases, au plus 400 essais) */
export function regionSeen(region) {
  if ( game.user.isGM ) return true;
  const bounds = region?.object?.bounds ?? region?.bounds;
  const tree = region?.polygonTree;
  if ( !bounds || !tree ) return false;
  const step = canvas.grid.size;
  const elevation = regionFloor(region);
  let tries = 0;
  for ( let y = bounds.y + (step / 2); y < bounds.bottom; y += step ) {
    for ( let x = bounds.x + (step / 2); x < bounds.right; x += step ) {
      if ( ++tries > 400 ) return false;
      const point = { x, y };
      if ( tree.testPoint(point) && pointSeen(point, elevation) ) return true;
    }
  }
  // Une région plus petite qu'une case : son centre.
  const center = { x: bounds.x + (bounds.width / 2), y: bounds.y + (bounds.height / 2) };
  return tree.testPoint(center) && pointSeen(center, elevation);
}

/**
 * Un endroit de piège (région, tuile, token) est-il vu par ce client ? Un token : sa visibilité du cœur ; une tuile : son
 * centre ou l'un de ses coins (un peu rentrés) ; une région : `regionSeen`.
 */
export function placeSeen(doc) {
  if ( game.user.isGM ) return true;
  if ( doc.documentName === "Token" ) return !!doc.object?.visible;
  if ( doc.documentName === "Tile" ) {
    const b = doc.object?.bounds;
    if ( !doc.object?.visible || !b ) return false;
    const ix = Math.min(b.width / 4, canvas.grid.size / 4), iy = Math.min(b.height / 4, canvas.grid.size / 4);
    const points = [{ x: b.x + (b.width / 2), y: b.y + (b.height / 2) }, { x: b.x + ix, y: b.y + iy }, { x: b.right - ix, y: b.y + iy },
      { x: b.x + ix, y: b.bottom - iy }, { x: b.right - ix, y: b.bottom - iy }];
    return points.some(p => pointSeen(p, doc.elevation ?? 0));
  }
  return regionSeen(doc);
}

/** Une porte est-elle vue par ce client ? Le test de son icône dans le cœur (door-control.mjs:111). */
export function doorSeen(wall) {
  if ( game.user.isGM ) return true;
  const control = wall.object?.doorControl;
  return control ? !!control.isVisible : false;
}
