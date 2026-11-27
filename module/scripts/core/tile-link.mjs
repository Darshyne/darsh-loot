/**
 * Lien d'une zone DAS à la tuile qui la montre (0.15.5) : une région faite d'une tuile (outil « tuile → zone », §3.12) épouse son
 * image ; supprimer l'une supprime l'autre. Règles pures.
 */

/**
 * Le rectangle d'une tuile : `x`/`y` sont son point d'ancrage (V14, le centre de l'image par défaut), pas son coin. La rotation
 * est ignorée.
 * @param {{ x: number, y: number, width: number, height: number, anchorX?: number, anchorY?: number }} tile
 */
export function tileRect({ x, y, width, height, anchorX=0.5, anchorY=0.5 }) {
  return { x: x - (width * anchorX), y: y - (height * anchorY), width, height };
}

/**
 * Une région faite d'une tuile avant le lien (avant la 0.15.5) ? Son contour est tracé dans l'image : il tient dans le rectangle
 * de la tuile, à `tolerance` px près, et en couvre au moins la moitié dans chaque sens — une région dessinée à la main autour
 * d'une tuile décorative est plus grande, une petite région posée sur une grande image plus petite.
 */
export function fitsTile(bounds, rect, tolerance=2) {
  const inside = (bounds.x >= rect.x - tolerance) && (bounds.y >= rect.y - tolerance)
    && (bounds.x + bounds.width <= rect.x + rect.width + tolerance)
    && (bounds.y + bounds.height <= rect.y + rect.height + tolerance);
  return inside && (bounds.width >= rect.width / 2) && (bounds.height >= rect.height / 2);
}

/**
 * A tile moved: how its zone follows (2026-11-27 — a GM who moved the tile of a container left its region, and so the click,
 * behind). `before` and `after`: the tile's `x`, `y`, `elevation`. Null when nothing moved.
 * @returns {{ dx: number, dy: number, dz: number }|null}
 */
export function tileShift(before, after) {
  const d = k => (Number(after?.[k]) || 0) - (Number(before?.[k]) || 0);
  const shift = { dx: d("x"), dy: d("y"), dz: d("elevation") };
  return (shift.dx || shift.dy || shift.dz) ? shift : null;
}

/**
 * The shapes of a region moved by `dx`, `dy`: every shape that has a position (`x`, `y`: rectangle, ellipse, circle…) and every
 * list of points (polygon: `[x0, y0, x1, y1…]`). Plain data in, new plain data out; anything else is kept as it is.
 */
export function shiftShapes(shapes, dx, dy) {
  return (shapes ?? []).map(shape => {
    const moved = { ...shape };
    if ( Number.isFinite(shape.x) && Number.isFinite(shape.y) ) { moved.x = shape.x + dx; moved.y = shape.y + dy; }
    if ( Array.isArray(shape.points) ) moved.points = shape.points.map((v, i) => v + ((i % 2) ? dy : dx));
    return moved;
  });
}

/** A region's elevation range moved by `dz`; a side without a limit (null) keeps none. */
export function shiftElevation(elevation, dz) {
  const side = v => (Number.isFinite(v) ? v + dz : (v ?? null));
  return { bottom: side(elevation?.bottom), top: side(elevation?.top) };
}

/** Do two lists of level ids name the same levels? */
export function sameLevels(a, b) {
  const x = [...(a ?? [])].sort(), y = [...(b ?? [])].sort();
  return (x.length === y.length) && x.every((id, i) => id === y[i]);
}
