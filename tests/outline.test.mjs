import { describe, it, expect } from "vitest";
import { alphaMask, largestContour, simplify, footprint, prettyName } from "../module/scripts/core/outline.mjs";

/** Image RGBA w × h, opaque là où `opaque(x, y)` est vrai. */
function image(w, h, opaque) {
  const px = new Uint8ClampedArray(w * h * 4);
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) if ( opaque(x, y) ) px[((y * w) + x) * 4 + 3] = 255;
  return px;
}

describe("contour d'une image", () => {
  it("masque bordé d'un pixel, seuil alpha", () => {
    const px = image(3, 2, (x, y) => (x === 1) && (y === 0));
    const { mask, W, H, count } = alphaMask(px, 3, 2);
    expect([W, H, count]).toEqual([5, 4, 1]);
    expect(mask[(1 * W) + 2]).toBe(1);
  });

  it("un carré plein donne ses quatre coins", () => {
    const { mask, W, H } = alphaMask(image(10, 10, (x, y) => (x >= 2) && (x <= 7) && (y >= 2) && (y <= 7)), 10, 10);
    const poly = simplify(largestContour(mask, W, H));
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    // Masque bordé d'un pixel : le carré va de 3 à 8.
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([3, 8, 3, 8]);
    expect(poly.length).toBeGreaterThanOrEqual(4);
    expect(poly.length).toBeLessThanOrEqual(5);
  });

  it("garde la plus grande tache", () => {
    const { mask, W, H } = alphaMask(image(12, 6, (x, y) => (x === 0 && y === 0) || ((x >= 5) && (x <= 10) && (y >= 1) && (y <= 4))), 12, 6);
    const xs = largestContour(mask, W, H).map(p => p[0]);
    expect(Math.min(...xs)).toBe(6);
  });

  it("image vide : rien", () => {
    const { mask, W, H } = alphaMask(image(4, 4, () => false), 4, 4);
    expect(largestContour(mask, W, H)).toBeNull();
  });
});

describe("rectangle d'une tuile", () => {
  it("ancre au centre (V14 : x/y = point d'ancrage)", () => {
    expect(footprint({ x: 100, y: 100, width: 50, height: 20, anchorX: 0.5, anchorY: 0.5 }))
      .toEqual([75, 90, 125, 90, 125, 110, 75, 110]);
  });

  it("rotation autour du point d'ancrage", () => {
    const p = footprint({ x: 0, y: 0, width: 10, height: 10, rotation: 90 });
    expect(p).toEqual([0, 0, 0, 10, -10, 10, -10, 0]);
  });
});

describe("nom tiré du fichier", () => {
  it("met en forme", () => {
    expect(prettyName("assets/tiles/chest_open-02.webp")).toBe("Chest Open 02");
    expect(prettyName("a/Coffre%20%C3%A0%20bijoux.png")).toBe("Coffre À Bijoux");
    expect(prettyName("")).toBe("");
  });
});
