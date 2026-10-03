/**
 * Effet de lancer « à la Diablo » (SPEC §3.8), joué par chaque client, sans rien écrire : quand une tuile de tas
 * naît ou reçoit un objet (`flags.darsh-loot.lastDrop`, posé par le MJ), un sprite de l'objet vole en arc du personnage
 * au tas en faisant un tour sur lui-même, s'écrase un peu à l'arrivée, puis le son d'atterrissage joue (canal
 * Interface : suit le volume de chaque joueur). Trajectoire : core/drop.mjs. Rien ne se voit ni ne s'entend si le point
 * d'arrivée est hors de vue du joueur.
 */
import { MODULE_ID } from "../shared.mjs";
import { route } from "./router.mjs";
import { FLIGHT_MS, flight } from "../core/drop.mjs";

const SOUNDS = {
  metal: `modules/${MODULE_ID}/assets/sounds/drop-metal.mp3`,
  coins: `modules/${MODULE_ID}/assets/sounds/drop-coins.mp3`,
  glass: `modules/${MODULE_ID}/assets/sounds/drop-glass.mp3`,
  soft: `modules/${MODULE_ID}/assets/sounds/drop-soft.mp3`
};
const VOLUME = 0.6;

/** Le son d'atterrissage. */
export function landingSound(kind) {
  return game.audio.play(SOUNDS[kind] ?? SOUNDS.soft, { context: game.audio.interface, volume: VOLUME });
}

/** Le joueur voit-il ce point ? (Toujours pour le MJ, et sur une scène sans vision de token.) */
function visible(point) {
  if ( game.user.isGM || !canvas.visibility?.tokenVision ) return true;
  return canvas.visibility.testVisibility(point, { tolerance: canvas.grid.size / 4 });
}

/**
 * Le vol d'un objet vers un tas (tuile) ou une créature (token : arme plantée, §3.10), puis le son.
 * @param {TileDocument|TokenDocument} doc
 */
export async function playDrop(doc, drop) {
  if ( !canvas.ready || (doc.parent !== canvas.scene) || !drop?.to ) return;
  if ( !visible(drop.to) ) return;
  // Arme de jet (§3.10) : pas de vol (le moteur anime déjà le lancer), le son seul.
  if ( drop.noFlight ) return landingSound(drop.sound);
  const texture = await foundry.canvas.loadTexture(drop.img).catch(() => null);
  if ( texture ) {
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.eventMode = "none";
    const width = (doc.documentName === "Tile") ? doc.width : doc.parent.grid.size * 0.5;
    const base = width / Math.max(texture.width, texture.height, 1);
    canvas.interface.addChild(sprite);
    const start = performance.now();
    await new Promise(resolve => {
      const tick = () => {
        const t = (performance.now() - start) / FLIGHT_MS;
        const f = flight(drop.from, drop.to, t);
        sprite.position.set(f.x, f.y);
        sprite.rotation = f.rotation;
        sprite.scale.set(base * f.scaleX, base * f.scaleY);
        if ( t >= 1 ) done();
      };
      // Un onglet caché ne fait pas tourner le ticker : la fin arrive quand même, par la minuterie.
      const timer = setTimeout(() => done(), FLIGHT_MS + 250);
      let finished = false;
      function done() {
        if ( finished ) return;
        finished = true;
        clearTimeout(timer);
        canvas.app.ticker.remove(tick);
        resolve();
      }
      canvas.app.ticker.add(tick);
    });
    sprite.destroy();
  }
  await landingSound(drop.sound);
}

function onCreateTile(tile) {
  const drop = tile.getFlag(MODULE_ID, "lastDrop");
  if ( drop ) playDrop(tile, drop);
}

/**
 * Le diff d'une mise à jour ne porte que les sous-champs modifiés (même tas : `from` et `to` inchangés n'y sont pas) :
 * on ne s'en sert que pour savoir qu'un objet vient d'arriver, et on lit le drapeau complet sur le document.
 */
function onUpdateTile(tile, changes) {
  if ( !foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.lastDrop`) ) return;
  playDrop(tile, tile.getFlag(MODULE_ID, "lastDrop"));
}

export function registerDropFx() {
  route("createTile", "effet de lancer", onCreateTile);
  route("updateTile", "effet de lancer", onUpdateTile);
}
