/**
 * « Choisir sur la carte » (0.17.0, SPEC §3.12) : le MJ désigne le déclencheur, la source ou la zone d'effet d'un piège d'un clic sur
 * la carte, comme Monk's Active Tiles, plutôt qu'en recopiant un UUID (le champ reste modifiable à la main).
 *
 * - Un bouton à côté de chaque champ qui désigne une région ou une tuile, dans la fenêtre d'un comportement « DAS · Piège » ou
 *   « DAS · Conteneur » (son piège), et dans les réglages d'une porte piégée.
 * - Pendant le choix, la fenêtre se réduit ; un clic gauche prend la plus petite région (du niveau affiché) ou tuile sous la souris,
 *   un clic droit ou Échap renonce. Les écouteurs sont en capture sur `window` : le clic n'atteint ni la souris du moteur, ni PIXI, ni les outils.
 */
import { MODULE_ID, loc, log } from "../shared.mjs";
import { route } from "./router.mjs";
import { TRAP_ZONE } from "../adapter/trap-behavior.mjs";
import { CONTAINER_TYPE } from "../adapter/container-behavior.mjs";

/** Les champs qui désignent un endroit, par type de comportement : nom du champ → types de documents acceptés. */
const PICKS = {
  [TRAP_ZONE]: { "system.triggerRegion": ["Region"], "system.source.uuid": ["Region", "Tile"] },
  [CONTAINER_TYPE]: { "system.trap.effectRegion": ["Region"], "system.trap.source.uuid": ["Region", "Tile"] }
};

/** Les champs d'une porte piégée (runtime/traps.mjs, fenêtre du mur). */
export const DOOR_PICKS = {
  [`flags.${MODULE_ID}.trap.effectRegion`]: ["Region"],
  [`flags.${MODULE_ID}.trap.source.uuid`]: ["Region", "Tile"]
};

/** L'aire d'une région ou d'une tuile, pour préférer la plus petite (la dalle plutôt que la salle qui la contient). */
const area = doc => ((doc.documentName === "Tile") ? (doc.width * doc.height) : (doc.bounds.width * doc.bounds.height));

/** Ce qui est sous ce point de la scène affichée, parmi ces types : la plus petite région du niveau affiché ou tuile. */
function placeAt(point, types) {
  const scene = canvas.scene;
  const found = [];
  if ( types.includes("Region") ) {
    for ( const region of scene.regions ) if ( region.viewed && region.polygonTree.testPoint(point) ) found.push(region);
  }
  if ( types.includes("Tile") ) {
    for ( const tile of scene.tiles ) {
      const viewed = !canvas.level || !tile.levels?.size || tile.levels.has(canvas.level.id);
      if ( viewed && tile.object?.bounds?.contains(point.x, point.y) ) found.push(tile);
    }
  }
  return found.sort((a, b) => area(a) - area(b))[0] ?? null;
}

/**
 * Attendre un clic sur la carte : rend l'UUID de ce qui est désigné, ou null si le MJ renonce.
 * @param {string[]} types       "Region", "Tile"
 * @param {Application} [app]    La fenêtre à réduire pendant le choix.
 */
export function pickOnMap(types, app=null) {
  if ( !canvas.ready ) return Promise.resolve(null);
  return new Promise(resolve => {
    const view = canvas.app.view;
    app?.minimize?.();
    ui.notifications.info(loc(types.includes("Tile") ? "Pick.PromptTile" : "Pick.PromptRegion"));
    // Sur `window`, en capture : avant les écouteurs du document (la souris du moteur, la nôtre), qui prendraient le clic pour eux.
    const done = uuid => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("contextmenu", block, true);
      window.removeEventListener("keydown", onKey, true);
      app?.maximize?.();
      resolve(uuid);
    };
    const block = event => {
      if ( event.target !== view ) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onDown = event => {
      if ( event.target !== view ) return;
      block(event);
      if ( event.button !== 0 ) return done(null);
      const place = placeAt(canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY }), types);
      if ( !place ) { ui.notifications.warn(loc("Pick.Nothing")); return done(null); }
      done(place.uuid);
    };
    const onKey = event => {
      if ( event.key !== "Escape" ) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      done(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("contextmenu", block, true);
    window.addEventListener("keydown", onKey, true);
  });
}

/**
 * Ajoute un bouton « Choisir sur la carte » à côté de chacun de ces champs du formulaire. Le champ reçoit l'UUID choisi (un champ
 * `document-tags` du cœur ou un champ texte) et un évènement `change`.
 */
export function addPickButtons(root, picks, app) {
  for ( const [name, types] of Object.entries(picks) ) {
    const input = root.querySelector(`[name="${name}"]`);
    if ( !input || input.parentElement?.querySelector(`.dlo-pick[data-for="${name}"]`) ) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dlo-pick icon";
    button.dataset.for = name;
    button.dataset.tooltip = loc("Pick.Button");
    button.setAttribute("aria-label", button.dataset.tooltip);
    button.innerHTML = `<i class="fa-solid fa-crosshairs" inert></i>`;
    button.addEventListener("click", async event => {
      event.preventDefault();
      const uuid = await pickOnMap(types, app);
      if ( !uuid ) return;
      try { input.value = uuid; }
      catch(err) { log.warn("pick:", err.message); return; }
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    input.after(button);
  }
}

/**
 * La fenêtre d'un comportement de région, chez le MJ : les boutons de choix, et l'ancien champ « zone d'effet » d'un piège de zone
 * masqué quand il est vide (il ne sert plus qu'à la reprise des pièges de la 0.16.0).
 */
function onRenderBehaviorConfig(app, html) {
  if ( !game.user.isGM ) return;
  const picks = PICKS[app.document?.type];
  if ( !picks ) return;
  const root = (html instanceof HTMLElement) ? html : app.element;
  if ( !root ) return;
  addPickButtons(root, picks, app);
  if ( (app.document.type === TRAP_ZONE) && !app.document.system.effectRegion ) {
    root.querySelector(`[name="system.effectRegion"]`)?.closest(".form-group")?.remove();
  }
}

export function registerPick() {
  route("renderRegionBehaviorConfig", "pick on the map", onRenderBehaviorConfig);
}
