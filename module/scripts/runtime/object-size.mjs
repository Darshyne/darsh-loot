/**
 * Taille des objets posés (2026-10-28, demande de l'utilisateur : « que ça respire un peu autour ») : les coffres, tas et pièges que
 * le module pose se dessinent au plus à `objectSize` % de leurs cases (réglage de monde, 80 par défaut). **Affichage seulement**, chez
 * chaque client : aucun document n'est écrit, la tuile ou le token garde sa taille, donc sa région (fouille, déclenchement) aussi.
 *
 * Le cœur redimensionne l'image à chaque rafraîchissement de taille ou d'image (`mesh.resize(width, height, { fit, scaleX, scaleY })`,
 * canvas/placeables/tile.mjs `_refreshSize`, token.mjs `_refreshMeshSizeAndScale`) ; on refait le même appel juste après, avec la
 * taille réduite — même centre (ancre au milieu), même ajustement, même miroir. Idempotent.
 *
 * Inscrit dès le chargement du script (darsh-loot.mjs), pour passer avant les voisins qui relèvent l'échelle du token dans le même
 * hook (DAS · Shadows & Ambience, perspective) : ils multiplient alors notre taille au lieu de l'écraser.
 *
 * Concernés : les tuiles de tas (`pileTile`) et de coffres posés par le module (`objectTile` — coffre glissé depuis la barre, token
 * Groupe converti), et les tokens pièges. Jamais une tuile de la carte transformée en zone (`tileToZone`) : c'est le décor du MJ.
 */
import { MODULE_ID, setting } from "../shared.mjs";
import { route } from "./router.mjs";
import { objectScale } from "../core/drop.mjs";
import { isTrapToken } from "../adapter/trapped.mjs";

const isObjectTile = doc => !!(doc?.getFlag(MODULE_ID, "pileTile") || doc?.getFlag(MODULE_ID, "objectTile"));

/** La fraction de case voulue (0,5 à 1). */
function maxFraction() {
  const v = Number(setting("objectSize"));
  return Number.isFinite(v) ? Math.min(1, Math.max(0.5, v / 100)) : 0.8;
}

function shrink(placeable, width, height) {
  const mesh = placeable.mesh;
  if ( !mesh || mesh.destroyed ) return;
  const k = objectScale(width, height, placeable.document.parent?.grid.size ?? canvas.grid.size, maxFraction());
  const { fit, scaleX, scaleY } = placeable.document.texture;
  mesh.resize(width * k, height * k, { fit, scaleX, scaleY });
}

function onRefreshTile(tile, flags) {
  if ( !(flags.refreshSize || flags.refreshMesh || flags.refreshState) || !isObjectTile(tile.document) ) return;
  const { width, height } = tile.document.shape ?? tile.document;
  shrink(tile, width, height);
}

function onRefreshToken(token, flags) {
  if ( !(flags.refreshSize || flags.refreshMesh) || !isTrapToken(token.document) ) return;
  // Un piège à anneau dynamique garde le calcul du cœur (l'anneau ajuste lui-même son sujet).
  if ( token.hasDynamicRing ) return;
  const { width, height } = token.document.getSize();
  shrink(token, width, height);
}

/** Le réglage a changé : tout ce qui est concerné se redessine. */
function redrawAll() {
  if ( !canvas.ready ) return;
  for ( const t of canvas.tiles?.placeables ?? [] ) if ( isObjectTile(t.document) ) t.renderFlags.set({ refreshSize: true });
  for ( const t of canvas.tokens?.placeables ?? [] ) if ( isTrapToken(t.document) ) t.renderFlags.set({ refreshSize: true });
}

export function registerObjectSize() {
  route("refreshTile", "object size", onRefreshTile);
  route("refreshToken", "object size", onRefreshToken);
  route(`${MODULE_ID}.objectSize`, "object size", redrawAll);
}
