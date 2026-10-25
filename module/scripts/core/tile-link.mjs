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
