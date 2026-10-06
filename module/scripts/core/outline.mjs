/**
 * Contour d'une image (outil « tuile → zone », SPEC §3.12) : masque alpha → plus grande tache → contour → polygone
 * simplifié. Repris de `coc7-dialogues` (scripts/tile-to-region.js, même auteur, MIT) ; ici sans rien du canevas :
 * adapter/tile-outline.mjs lit les pixels et projette le résultat sur la scène.
 */

/**
 * Masque binaire d'une image RGBA, bordé d'un pixel vide (le traceur ne sort jamais du masque).
 * @param {Uint8ClampedArray|number[]} rgba  Pixels RGBA, `w × h × 4`.
 * @returns {{ mask: Uint8Array, W: number, H: number, count: number }}
 */
export function alphaMask(rgba, w, h, threshold=48) {
  const W = w + 2, H = h + 2;
  const mask = new Uint8Array(W * H);
  let count = 0;
  for ( let y = 0; y < h; y++ ) {
    for ( let x = 0; x < w; x++ ) {
      if ( rgba[((y * w) + x) * 4 + 3] > threshold ) { mask[((y + 1) * W) + x + 1] = 1; count++; }
    }
  }
  return { mask, W, H, count };
}

/**
 * Contour extérieur (voisinage de Moore) de la plus grande tache 4-connexe du masque.
 * @returns {number[][]|null}  Points `[x, y]` du masque, dans l'ordre du contour.
 */
export function largestContour(mask, W, H) {
  const label = new Int32Array(W * H);
  let best = 0, bestSize = 0, next = 1;
  const stack = [];
  for ( let i = 0; i < mask.length; i++ ) {
    if ( !mask[i] || label[i] ) continue;
    let size = 0;
    stack.push(i);
    label[i] = next;
    while ( stack.length ) {
      const p = stack.pop();
      size++;
      const x = p % W, y = (p / W) | 0;
      for ( const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] ) {
        const nx = x + dx, ny = y + dy;
        if ( (nx < 0) || (ny < 0) || (nx >= W) || (ny >= H) ) continue;
        const q = (ny * W) + nx;
        if ( mask[q] && !label[q] ) { label[q] = next; stack.push(q); }
      }
    }
    if ( size > bestSize ) { bestSize = size; best = next; }
    next++;
  }
  if ( !best ) return null;
  largestContour.lastSize = bestSize;
  const inside = (x, y) => (x >= 0) && (y >= 0) && (x < W) && (y < H) && (label[(y * W) + x] === best);

  // Départ : le pixel le plus haut puis le plus à gauche de la tache (ordre de balayage).
  let sx = -1, sy = -1;
  for ( let i = 0; i < label.length; i++ ) if ( label[i] === best ) { sx = i % W; sy = (i / W) | 0; break; }

  // Voisinage de Moore, dans le sens des aiguilles d'une montre depuis l'ouest.
  const N = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const contour = [[sx, sy]];
  let cx = sx, cy = sy, back = 0;
  const maxSteps = (bestSize * 4) + 8;
  for ( let steps = 0; steps < maxSteps; steps++ ) {
    let found = false;
    for ( let k = 0; k < 8; k++ ) {
      const dir = (back + k) % 8;
      const nx = cx + N[dir][0], ny = cy + N[dir][1];
      if ( inside(nx, ny) ) {
        back = (dir + 6) % 8;
        cx = nx; cy = ny;
        found = true;
        break;
      }
    }
    if ( !found ) break;                          // pixel isolé
    if ( (cx === sx) && (cy === sy) ) break;      // boucle fermée
    contour.push([cx, cy]);
  }
  return contour;
}

/**
 * Enveloppe convexe (chaîne monotone d'Andrew) des pixels visibles du masque, coins de pixels compris : la forme d'une
 * image faite de morceaux séparés (un levier : manche et socle), dont le plus gros seul ne dirait rien.
 * @returns {number[][]|null}
 */
export function opaqueHull(mask, W, H) {
  const pts = [];
  for ( let y = 0; y < H; y++ ) {
    let first = -1, last = -1;
    for ( let x = 0; x < W; x++ ) if ( mask[(y * W) + x] ) { if ( first < 0 ) first = x; last = x; }
    // Les extrémités de chaque ligne suffisent pour l'enveloppe.
    if ( first >= 0 ) pts.push([first, y], [last + 1, y], [first, y + 1], [last + 1, y + 1]);
  }
  if ( pts.length < 3 ) return null;
  pts.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => ((a[0] - o[0]) * (b[1] - o[1])) - ((a[1] - o[1]) * (b[0] - o[0]));
  const lower = [], upper = [];
  for ( const p of pts ) {
    while ( (lower.length >= 2) && (cross(lower.at(-2), lower.at(-1), p) <= 0) ) lower.pop();
    lower.push(p);
  }
  for ( const p of pts.toReversed() ) {
    while ( (upper.length >= 2) && (cross(upper.at(-2), upper.at(-1), p) <= 0) ) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Aire de la boîte englobante de points `[x, y]` de pixels (bornes comprises). */
function boxArea(points) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1);
}

/**
 * Le polygone d'une image : le contour de sa plus grande tache si elle **est** l'image — au moins `share` des pixels
 * visibles **et** de l'étendue (boîte englobante) de l'image —, sinon l'enveloppe convexe de tous ses pixels visibles.
 * Vu le 2026-10-06 : l'icône du levier (`icons/svg/lever.svg`) donnait seulement l'arc de son socle, 63 × 28 px d'une
 * tuile de 140, le manche détaché étant plus petit en pixels mais pas en étendue.
 * @returns {number[][]|null}  Points du masque (bordé d'un pixel).
 */
export function outlinePolygon(mask, W, H, count, { share=0.8, eps=1.25 }={}) {
  const contour = largestContour(mask, W, H);
  const opaque = [];
  for ( let i = 0; i < mask.length; i++ ) if ( mask[i] ) opaque.push([i % W, (i / W) | 0]);
  const whole = contour && (contour.length >= 3) && (largestContour.lastSize >= share * count)
    && (boxArea(contour) >= share * boxArea(opaque));
  if ( whole ) {
    const points = simplify(contour, eps);
    if ( points.length >= 3 ) return points;
  }
  return opaqueHull(mask, W, H);
}

/** Douglas-Peucker sur une chaîne ouverte (le polygone fermé part de son premier point). */
export function simplify(points, eps=1.25) {
  if ( points.length <= 3 ) return points;
  const sq = eps * eps;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while ( stack.length ) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len2 = (dx * dx) + (dy * dy) || 1;
    for ( let i = a + 1; i < b; i++ ) {
      const [px, py] = points[i];
      const t = Math.max(0, Math.min(1, (((px - ax) * dx) + ((py - ay) * dy)) / len2));
      const ex = ax + (t * dx) - px, ey = ay + (t * dy) - py;
      const d = (ex * ex) + (ey * ey);
      if ( d > maxD ) { maxD = d; idx = i; }
    }
    if ( (maxD > sq) && (idx > 0) ) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Rectangle d'une tuile, polygone absolu à plat `[x, y, …]`. En V14, `x/y` d'une tuile sont son **point d'ancrage**
 * (`texture.anchorX/Y`), pas son coin ; la rotation se fait autour de ce point.
 */
export function footprint({ x, y, width: w, height: h, rotation=0, anchorX=0, anchorY=0 }) {
  const left = x - (anchorX * w), top = y - (anchorY * h);
  const corners = [[left, top], [left + w, top], [left + w, top + h], [left, top + h]];
  if ( !rotation ) return corners.flat().map(v => Math.round(v));
  const rad = rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  return corners.flatMap(([px, py]) => {
    const dx = px - x, dy = py - y;
    return [Math.round(x + (dx * cos) - (dy * sin)), Math.round(y + (dx * sin) + (dy * cos))];
  });
}

/** Un nom lisible tiré du nom de fichier d'une image (« chest_open-02.webp » → « Chest Open 02 »). */
export function prettyName(src) {
  if ( !src ) return "";
  let base = String(src).split("/").pop() ?? "";
  try { base = decodeURIComponent(base); } catch(err) { /* nom laissé tel quel */ }
  base = base.replace(/\.[a-z0-9]+$/i, "");
  return base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/(^|\s)\S/g, c => c.toUpperCase());
}
