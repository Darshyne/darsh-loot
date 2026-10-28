/**
 * Option « cachée » (SPEC §3.12) : cachettes, leviers et passages secrets, portes secrètes et murs éthérés.
 *
 * - Une zone DAS cachée et pas encore trouvée n'existe pas pour les joueurs (adapter/container-behavior.mjs,
 *   zone-behaviors.mjs, contrôles du MJ) ; sa région cache aussi **ses tuiles** et **désactive ses comportements du cœur**
 *   (une trappe : « Téléporter le token »), et les rend à la découverte. Les valeurs d'origine sont notées sur la
 *   région (`flags.darsh-loot.concealed`) : recacher remet tout.
 * - Un mur caché (réglages sur le mur) est révélé à la découverte : porte secrète → porte ordinaire, mur éthéré → il
 *   cesse de bloquer la vue et la lumière (valeurs d'origine en `flags.darsh-loot.revealed`).
 * - Découverte par la **Perception passive** d'un personnage qui bouge (chez le MJ, jamais montrée) ou par une **fouille
 *   active** (« Fouiller les environs », jet caché au joueur, un essai par objet et par personnage). Elle arrête tous les
 *   déplacements de la scène.
 */
import { MODULE_ID, loc, log, setting, sceneSetting } from "../shared.mjs";
import { feetToSceneUnits } from "../core/units.mjs";
import { route } from "./router.mjs";
import { askGM } from "./take.mjs";
import { passiveFinds, searchReach, searchWait, alreadyTried, withTry, revealWall, discoveryKey, normalizeHidden } from "../core/hidden.mjs";
import { concealedThings, regionConcealed, reaches, passiveScore, tilesIn, playerToken, wallHidden } from "../adapter/hidden.mjs";
import { TOKEN_MENU_HOOK, engineStopWalks, engineBudgetIssues, engineSpend } from "../adapter/engine.mjs";
import { concealedTraps, regionHiddenByTraps, tilesHiddenByTraps } from "../adapter/trapped.mjs";
import { feedbackCard, playForAll, SOUNDS } from "./feedback.mjs";
import { waitForDice, newRollMessage } from "../adapter/dice.mjs";

/** 0.17.2 : le bruit d'une fouille en cours (le froissement d'un objet posé), entendu de tous. */
const RUMMAGE_SOUND = SOUNDS.rummage;

/** Tout ce qui est encore caché sur une scène : zones et murs cachés, et pièges de coffre ou de porte (0.16.0). */
const hiddenThings = scene => [...concealedThings(scene), ...concealedTraps(scene)];

const SEARCH_QUERY = `${MODULE_ID}.search`;
const HALT_QUERY = `${MODULE_ID}.halt`;

const isActiveGM = () => game.users.activeGM?.isSelf === true;
const isDasZone = behavior => behavior?.type?.startsWith(`${MODULE_ID}.`);

/* -------------------------------------------- */
/*  Une région cachée : ses tuiles, ses comportements du cœur   */
/* -------------------------------------------- */

const syncing = new Set();

/**
 * Chez le MJ : met la région d'accord avec ses zones DAS. Cachée (une zone cachée pas trouvée) : ses tuiles cachées, ses
 * comportements du cœur désactivés, valeurs d'origine notées. Plus cachée : tout remis comme avant.
 */
async function syncRegion(region) {
  if ( !region?.parent || syncing.has(region.uuid) ) return;
  syncing.add(region.uuid);
  try {
    const memo = region.getFlag(MODULE_ID, "concealed");
    const hide = regionConcealed(region) || regionHiddenByTraps(region);
    if ( hide && !memo ) {
      const tiles = tilesIn(region);
      const cores = region.behaviors.filter(b => !isDasZone(b));
      await region.setFlag(MODULE_ID, "concealed", {
        tiles: Object.fromEntries(tiles.map(t => [t.id, t.hidden])),
        behaviors: Object.fromEntries(cores.map(b => [b.id, b.disabled]))
      });
      if ( tiles.length ) await region.parent.updateEmbeddedDocuments("Tile", tiles.map(t => ({ _id: t.id, hidden: true })));
      if ( cores.length ) await region.updateEmbeddedDocuments("RegionBehavior", cores.map(b => ({ _id: b.id, disabled: true })));
    } else if ( !hide && memo ) {
      const tiles = Object.entries(memo.tiles ?? {}).filter(([id]) => region.parent.tiles.has(id));
      const cores = Object.entries(memo.behaviors ?? {}).filter(([id]) => region.behaviors.has(id));
      if ( tiles.length ) await region.parent.updateEmbeddedDocuments("Tile", tiles.map(([id, hidden]) => ({ _id: id, hidden })));
      if ( cores.length ) await region.updateEmbeddedDocuments("RegionBehavior", cores.map(([id, disabled]) => ({ _id: id, disabled })));
      await region.unsetFlag(MODULE_ID, "concealed");
    }
  } catch(err) {
    log.warn("hidden region:", err.message);
  } finally {
    syncing.delete(region.uuid);
  }
}

/**
 * Chez le MJ : les pièges de la scène ont changé (0.17.0) — les régions de déclencheur et de source qu'ils cachent encore (ou plus)
 * suivent, et les tuiles sources aussi (cachées tant que la source ne l'est pas ; valeur d'origine en `flags.darsh-loot.concealedTile`).
 */
export async function syncTrapParts(scene) {
  if ( !scene ) return;
  for ( const region of scene.regions ) {
    if ( region.getFlag(MODULE_ID, "concealed") || regionHiddenByTraps(region) ) await syncRegion(region);
  }
  const hide = new Set(tilesHiddenByTraps(scene));
  const updates = [];
  for ( const tile of scene.tiles ) {
    const memo = tile.getFlag(MODULE_ID, "concealedTile");
    if ( hide.has(tile) && (memo === undefined) ) updates.push({ _id: tile.id, hidden: true, [`flags.${MODULE_ID}.concealedTile`]: tile.hidden });
    else if ( !hide.has(tile) && (memo !== undefined) ) updates.push({ _id: tile.id, hidden: memo === true, [`flags.${MODULE_ID}.-=concealedTile`]: null });
  }
  try { if ( updates.length ) await scene.updateEmbeddedDocuments("Tile", updates); }
  catch(err) { log.warn("trap source tiles:", err.message); }
}

/** Une zone DAS change : recachée par le MJ (« trouvée » décoché), ses essais s'effacent ; puis la région suit. */
function onUpdateBehavior(behavior, changes) {
  if ( !isActiveGM() || !isDasZone(behavior) ) return;
  // Un piège (ou un coffre piégé) : sa source recachée efface ses essais ; ses régions et tuiles suivent.
  const sourceHidden = foundry.utils.getProperty(changes, "system.source.hidden") ?? foundry.utils.getProperty(changes, "system.trap.source.hidden");
  if ( sourceHidden && ((sourceHidden.found === false) || (sourceHidden.enabled === false)) && behavior.getFlag(MODULE_ID, "sourceTried") ) {
    behavior.unsetFlag(MODULE_ID, "sourceTried");
  }
  if ( foundry.utils.hasProperty(changes, "system.trap") || [`${MODULE_ID}.trap`, `${MODULE_ID}.trapTrigger`].includes(behavior.type) ) {
    syncTrapParts(behavior.parent?.parent);
  }
  // Le piège d'un coffre recaché : ses essais s'effacent (ceux du coffre lui-même restent).
  const trapHidden = foundry.utils.getProperty(changes, "system.trap.hidden");
  if ( trapHidden && ((trapHidden.found === false) || (trapHidden.enabled === false)) && behavior.getFlag(MODULE_ID, "trapTried") ) {
    behavior.unsetFlag(MODULE_ID, "trapTried");
  }
  const hidden = foundry.utils.getProperty(changes, "system.hidden");
  if ( hidden === undefined ) return;
  if ( (hidden.found === false) || (hidden.enabled === false) ) {
    if ( behavior.getFlag(MODULE_ID, "tried") ) behavior.unsetFlag(MODULE_ID, "tried");
  }
  syncRegion(behavior.parent);
}

/* -------------------------------------------- */
/*  Un mur caché                                */
/* -------------------------------------------- */

/** Chez le MJ : un mur caché trouvé est révélé ; recaché (« trouvé » décoché), il reprend ses valeurs d'origine. */
async function syncWall(wall) {
  const h = wallHidden(wall);
  const revealed = wall.getFlag(MODULE_ID, "revealed");
  try {
    if ( h.enabled && h.found && !revealed ) {
      const change = revealWall(wall);
      if ( change ) await wall.update({ ...change.update, [`flags.${MODULE_ID}.revealed`]: change.original });
    } else if ( revealed && (!h.enabled || !h.found) ) {
      await wall.update({ ...revealed, [`flags.${MODULE_ID}.-=revealed`]: null, [`flags.${MODULE_ID}.-=tried`]: null });
    }
  } catch(err) {
    log.warn("hidden wall:", err.message);
  }
}

function onUpdateWall(wall, changes) {
  if ( !isActiveGM() ) return;
  // Le piège d'une porte recaché : ses essais s'effacent.
  const trapHidden = foundry.utils.getProperty(changes, `flags.${MODULE_ID}.trap.hidden`);
  if ( trapHidden && ((trapHidden.found === false) || (trapHidden.enabled === false)) && wall.getFlag(MODULE_ID, "trapTried") ) {
    wall.unsetFlag(MODULE_ID, "trapTried");
  }
  const sourceHidden = foundry.utils.getProperty(changes, `flags.${MODULE_ID}.trap.source.hidden`);
  if ( sourceHidden && ((sourceHidden.found === false) || (sourceHidden.enabled === false)) && wall.getFlag(MODULE_ID, "sourceTried") ) {
    wall.unsetFlag(MODULE_ID, "sourceTried");
  }
  if ( foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.trap`) ) syncTrapParts(wall.parent);
  if ( foundry.utils.getProperty(changes, `flags.${MODULE_ID}.hidden`) === undefined ) return;
  syncWall(wall);
}

/* -------------------------------------------- */
/*  Découverte                                  */
/* -------------------------------------------- */

/** Les utilisateurs qui lisent le message de découverte : les joueurs du personnage, et les MJ. */
function readersOf(actor) {
  return game.users.filter(u => u.isGM || (!u.isGM && actor?.testUserPermission(u, "OWNER"))).map(u => u.id);
}

/** Chez le MJ : l'objet est trouvé par ce personnage — révélé, message, et tous les déplacements de la scène s'arrêtent. */
async function reveal(thing, finder) {
  await thing.markFound();
  const text = thing.hidden.text || loc(`Hidden.Found.${discoveryKey(thing.kind)}`);
  const ChatMessage = foundry.documents.ChatMessage.implementation;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token: finder }),
    content: `<p>${foundry.utils.escapeHTML(text)}</p>`,
    whisper: readersOf(finder.actor)
  });
  log.info(`${finder.name} finds ${thing.key}`);
  haltScene(finder.parent);
}

/** Les distances d'un objet caché (détection passive, rayon de fouille), écrites en pieds, dans l'unité de cette scène. */
function inSceneUnits(hidden, scene) {
  const h = normalizeHidden(hidden);
  const units = scene?.grid?.units;
  return { ...h, passive: feetToSceneUnits(h.passive, units), radius: feetToSceneUnits(h.radius, units) };
}

/**
 * Chez le MJ : un personnage de joueur a bougé — sa Perception (ou Investigation) passive trouve-t-elle quelque chose ?
 * Rien n'est montré tant que rien n'est trouvé.
 */
async function onMoveToken(token, changes) {
  if ( !isActiveGM() || !playerToken(token) ) return;
  if ( !["x", "y", "elevation", "level"].some(k => k in changes) ) return;
  let found = 0;
  for ( const thing of hiddenThings(token.parent) ) {
    // Distances de l'objet écrites en pieds, comparées dans l'unité de la scène (darsh-loot#1).
    const h = inSceneUnits(thing.hidden, token.parent);
    if ( !passiveFinds(h, thing.distance(token), passiveScore(token.actor, h.skill)) ) continue;
    if ( !reaches(token, thing, h.passive) ) continue;
    await reveal(thing, token);
    found++;
  }
  // 2026-10-28 (retour de l'utilisateur) : trouvé en passant, la table le voit et l'entend aussi — « remarque quelque chose », comme la
  // fouille ; ce qui est trouvé reste dit au seul joueur du personnage (`reveal`).
  if ( found ) await feedbackCard(token, loc("Hidden.FoundCard", { name: token.name }), { kind: "gain", icon: "fa-solid fa-eye",
    sound: SOUNDS.discover, float: loc("Hidden.FloatFound") });
}

/* -------------------------------------------- */
/*  Fouille active                              */
/* -------------------------------------------- */

/**
 * « Fouiller les environs » pour ce token : chez le MJ, chaque objet caché à portée (rayon arrêté par les murs) est testé
 * avec sa compétence, jet caché au joueur ; le joueur ne reçoit que « Vous remarquez … » ou « Vous ne remarquez rien de
 * spécial ».
 */
export async function requestSearch(token) {
  if ( !token ) { ui.notifications.warn(loc("Window.NoLooter")); return null; }
  // 0.14.5 : ce qui refuserait la fouille se dit avant d'attendre (le MJ revérifie tout ensuite) ; puis le chat, le ping autour du
  // token et, hors combat, la barre de la durée de la fouille — un déplacement l'interrompt.
  const refusal = searchRefusal(token);
  if ( refusal ) { ui.notifications.warn(refusal); return null; }
  await announceSearch(token);
  // 2026-10-28 (retour de l'utilisateur) : le MJ reçoit la fouille dès le début de sa durée ; il lance les dés avant la fin, pour qu'ils
  // s'arrêtent avec la barre (`handleSearch`), et conclut à la fin. Bouger pendant la fouille l'interrompt, des deux côtés.
  const delayMs = searchDuration() * 1000;
  const [result, done] = await Promise.all([
    askGM(SEARCH_QUERY, handleSearch, { token: token.uuid, delayMs }, { timeout: delayMs + 20000 }),
    searchDelay(token)
  ]);
  if ( !done || result?.interrupted ) { ui.notifications.info(loc("Hidden.Interrupted", { name: token.name })); return null; }
  if ( result && !result.found ) ui.notifications.info(loc("Hidden.Nothing"));
  return result;
}

/** La durée d'une fouille, en secondes réelles : le réglage hors combat, rien en combat (l'action suffit). */
const searchDuration = () => ((game.combat?.started === true) ? 0 : Math.max(0, Number(setting("searchDuration")) || 0));

/** 0.16.1 : les deux horloges du délai de fouille (`searchWait`) : temps du monde et temps réel. */
const searchClock = () => ({ world: game.time.worldTime, real: Date.now() });

/** Ce qui refuse la fouille de ce token, en clair (même règle que chez le MJ, `handleSearch`), ou null. */
function searchRefusal(token) {
  const actor = token.actor;
  if ( !actor ) return loc("Refus.Introuvable");
  const issues = engineBudgetIssues(actor, "action");
  if ( issues.length ) return loc("Notice.Refused", { reason: loc(`Hidden.Budget.${issues[0]}`, { name: actor.name }) });
  if ( game.combat?.started === true ) return null;
  const wait = searchWait(actor.getFlag(MODULE_ID, "lastSearch"), searchClock(), setting("searchCooldown"));
  return (wait > 0) ? loc("Notice.Refused", { reason: loc("Hidden.Cooldown", { name: actor.name, minutes: Math.ceil(wait / 60) }) }) : null;
}

/** Le message public « X fouille les environs », et un ping de la taille du rayon de fouille autour du token (vu de tous). */
async function announceSearch(token) {
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ token, actor: token.actor }),
    content: `<p><i class="fa-solid fa-magnifying-glass"></i> ${foundry.utils.escapeHTML(loc("Hidden.Searching", { name: token.name }))}</p>`
  });
  pingAround(token);
}

/**
 * Un ping « pulse » autour du token, du diamètre de la fouille. `canvas.ping` le diffuse à tous les clients
 * (client/canvas/board.mjs:1871-1891) ; style et `pull` forcés, pour qu'une touche tenue n'en fasse ni une alerte ni un recentrage.
 */
function pingAround(token) {
  const placeable = token.object;
  if ( !placeable || !canvas.ready ) return;
  const size = Math.max(canvas.grid.size, 2 * sceneSetting("searchRadius", placeable.document.parent) * canvas.dimensions.distancePixels);
  canvas.ping(placeable.center, { style: CONFIG.Canvas.pings.types.PULSE, pull: false, size, duration: 1500, rings: 2 })
    .catch(() => {});
}

/**
 * Hors combat, la durée de la fouille (réglage `searchDuration`, en secondes réelles) : une barre de progression chez le joueur
 * (ui.notifications, `progress` : client/applications/ui/notifications.mjs:23-27) et un ping toutes les 2,5 s. Rend false si le
 * token a bougé entre-temps (fouille interrompue). En combat, rien à attendre : l'action Fouille suffit.
 */
async function searchDelay(token) {
  const seconds = searchDuration();
  if ( seconds <= 0 ) return true;
  const start = { x: token._source.x, y: token._source.y, elevation: token._source.elevation };
  const bar = ui.notifications.info(loc("Hidden.SearchingBar", { name: token.name }), { progress: true });
  const began = Date.now();
  let lastPing = began;
  const moved = () => !token.parent || (token._source.x !== start.x) || (token._source.y !== start.y) || (token._source.elevation !== start.elevation);
  try {
    while ( (Date.now() - began) < (seconds * 1000) ) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if ( moved() ) return false;
      bar.update({ pct: Math.min(1, (Date.now() - began) / (seconds * 1000)) });
      if ( (Date.now() - lastPing) >= 2500 ) { lastPing = Date.now(); pingAround(token); playForAll(RUMMAGE_SOUND, 0.4); }
    }
    return true;
  } finally {
    bar.update({ pct: 1 });
    bar.remove?.();
  }
}

/**
 * Combien de temps les dés 3D mettent à s'arrêter chez ce MJ (mesuré à chaque fouille, 2,5 s au départ) : la fouille lance ses dés
 * d'autant avant la fin de sa durée. Sans Dice So Nice, ou fenêtre masquée : aucun délai.
 */
let diceLeadMs = 2500;
const diceShown = () => !!game.modules.get("dice-so-nice")?.active && !!game.dice3d && !document.hidden;

async function handleSearch({ token: uuid, delayMs=0 }, { user }) {
  const token = fromUuidSync(uuid, { strict: false });
  if ( !token?.actor ) throw new Error(loc("Refus.Introuvable"));
  if ( !token.actor.testUserPermission(user, "OWNER") ) throw new Error(loc("Refus.PasAToi"));
  const actor = token.actor;
  // En combat, la fouille est l'action Observation (PHB 2024) : le moteur dit si elle est possible et la décompte.
  const issues = engineBudgetIssues(actor, "action");
  if ( issues.length ) throw new Error(loc(`Hidden.Budget.${issues[0]}`, { name: actor.name }));
  // 0.14.4 : hors combat, une fouille prend du temps — délai en minutes de temps du monde (réglage `searchCooldown`), par
  // personnage ; en combat, l'action Fouille suffit.
  const inCombat = game.combat?.started === true;
  const wait = inCombat ? 0 : searchWait(actor.getFlag(MODULE_ID, "lastSearch"), searchClock(), setting("searchCooldown"));
  if ( wait > 0 ) throw new Error(loc("Hidden.Cooldown", { name: actor.name, minutes: Math.ceil(wait / 60) }));
  await engineSpend(actor, "action");
  const deadline = Date.now() + Math.min(Math.max(0, Number(delayMs) || 0), 60000);
  const start = { x: token._source.x, y: token._source.y, elevation: token._source.elevation };
  const moved = () => !token.parent || (token._source.x !== start.x) || (token._source.y !== start.y) || (token._source.elevation !== start.elevation);
  const worldRadius = sceneSetting("searchRadius", token.parent);
  const things = hiddenThings(token.parent).filter(thing => !alreadyTried(thing.tried, actor.id)
    && reaches(token, thing, searchReach(inSceneUnits(thing.hidden, token.parent), worldRadius)));
  // 2026-10-28 (retour de l'utilisateur) : **toujours** un jet — Perception, plus Investigation si un objet à portée se trouve ainsi —,
  // même quand rien n'est caché : ni l'absence de dés ni un verdict plus rapide ne trahissent qu'il n'y a rien. Un jet par compétence,
  // comparé au DD de chaque objet. Lancé pour que les dés 3D s'arrêtent à la fin de la durée de la fouille.
  const skills = [...new Set(["prc", ...things.map(t => t.hidden.skill)])];
  const lead = diceShown() ? diceLeadMs : 0;
  await new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - lead - Date.now())));
  if ( moved() ) return { interrupted: true, found: 0 };
  // Jet chez le MJ, caché au joueur : mode de message « gm » (V14, CONFIG.ChatMessage.modes). Pas l'ancien
  // CONST.DICE_ROLL_MODES.BLIND (« blindroll », déprécié en V14) : dnd5e 6 le passe tel quel en `messageMode`
  // (dice/basic-roll.mjs:271), le cœur ne le reconnaît pas et le jet devenait public (vu le 2026-10-06).
  const rolled = Date.now();
  const totals = {}, messages = [];
  for ( const skill of skills ) {
    const known = new Set(game.messages.keys());
    const rolls = await actor.rollSkill({ skill }, { configure: false }, { rollMode: "gm" });
    totals[skill] = rolls?.[0]?.total ?? -Infinity;
    messages.push(newRollMessage(known));
  }
  await Promise.all(messages.map(m => waitForDice(m)));   // 0.17.2 (règles DAS) : rien n'apparaît avant la fin des dés 3D
  if ( diceShown() ) diceLeadMs = Math.min(6000, Math.max(500, Date.now() - rolled));
  await new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - Date.now())));
  if ( moved() ) return { interrupted: true, found: 0 };
  if ( !inCombat ) await actor.setFlag(MODULE_ID, "lastSearch", searchClock());
  let found = 0;
  for ( const thing of things ) {
    if ( totals[thing.hidden.skill] >= thing.hidden.dc ) { await reveal(thing, token); found++; }
    else await thing.doc.setFlag(MODULE_ID, thing.triedFlag, withTry(thing.tried, actor.id));
  }
  // 0.17.2 (règles DAS du 2026-10-27) : l'issue se voit et s'entend chez tous — « remarque quelque chose » ou « rien » ; ce qui est
  // trouvé reste dit au seul joueur du personnage (`reveal`).
  await feedbackCard(token, loc(found ? "Hidden.FoundCard" : "Hidden.NothingCard", { name: token.name }), {
    kind: found ? "gain" : "ended", icon: "fa-solid fa-magnifying-glass", sound: found ? SOUNDS.discover : null,
    float: loc(found ? "Hidden.FloatFound" : "Hidden.FloatNothing") });
  return { found };
}

/* -------------------------------------------- */
/*  Tout s'arrête                               */
/* -------------------------------------------- */

/**
 * Chez le MJ : tous les déplacements de cette scène s'arrêtent, sur tous les clients. Seul le client qui a lancé un
 * déplacement peut l'arrêter (`TokenDocument#stopMovement`, documents/token.mjs:762) : chacun arrête les siens.
 */
export function haltScene(scene) {
  for ( const user of game.users.filter(u => u.active) ) {
    if ( user.isSelf ) handleHalt({ scene: scene.uuid });
    else user.query(HALT_QUERY, { scene: scene.uuid }, { timeout: 5000 }).catch(err => log.warn("movement halt:", err.message));
  }
}

/** Chez chacun : arrêter les marches du moteur et les déplacements qu'on a lancés sur cette scène. */
function handleHalt({ scene: uuid }) {
  const scene = fromUuidSync(uuid, { strict: false });
  if ( !scene ) return false;
  engineStopWalks();
  for ( const token of scene.tokens ) {
    const movement = token.movement;
    if ( movement?.user?.isSelf && ["pending", "paused"].includes(movement.state) ) {
      try { token.stopMovement(); } catch(err) { log.warn(`stopping ${token.name}:`, err.message); }
    }
  }
  return true;
}

/* -------------------------------------------- */
/*  Gestes : HUD du token, menu du moteur        */
/* -------------------------------------------- */

/** Bouton « Fouiller les environs » dans le HUD de son propre token (joueur ou MJ), hors combat comme en combat. */
function onRenderTokenHUD(hud, html) {
  const token = hud.document;
  if ( !token?.isOwner || !token.actor ) return;
  const column = html.querySelector(".col.left");
  if ( !column || column.querySelector(".dlo-search") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon dlo-hud dlo-search";
  button.dataset.tooltip = loc("Hidden.Search");
  button.setAttribute("aria-label", button.dataset.tooltip);
  button.innerHTML = `<i class="fa-solid fa-magnifying-glass" inert></i>`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    requestSearch(token);
  });
  column.append(button);
}

/** Entrée « Fouiller les environs » du menu contextuel du moteur, sur son propre token. */
function onTokenMenu(entries, { token, target }) {
  if ( !token || (target?.document ?? target) !== (token?.document ?? token) ) return;
  if ( setting("searchMenu") === false ) return;
  const doc = token.document ?? token;
  entries.push({ icon: "fa-solid fa-magnifying-glass", label: loc("Hidden.Search"), run: () => requestSearch(doc) });
}

/* -------------------------------------------- */
/*  Réglages d'un mur caché                     */
/* -------------------------------------------- */

/** Champs « caché » ajoutés à la fenêtre de configuration d'un mur (porte secrète ou mur éthéré), chez le MJ. */
function onRenderWallConfig(app, html) {
  if ( !game.user.isGM ) return;
  const root = (html instanceof HTMLElement) ? html : app.element;
  if ( !root || root.querySelector(".dlo-wall-hidden") ) return;
  const h = normalizeHidden(app.document?.getFlag(MODULE_ID, "hidden") ?? {});
  const name = key => `flags.${MODULE_ID}.hidden.${key}`;
  const L = key => loc(`Hidden.Wall.${key}`);
  const esc = text => foundry.utils.escapeHTML(String(text ?? ""));
  const fieldset = document.createElement("fieldset");
  fieldset.className = "dlo-wall-hidden";
  fieldset.innerHTML = `
    <legend>${esc(L("Legend"))}</legend>
    <p class="hint">${esc(L("Hint"))}</p>
    <div class="form-group"><label>${esc(L("Enabled"))}</label><div class="form-fields"><input type="checkbox" name="${name("enabled")}" ${h.enabled ? "checked" : ""}></div></div>
    <div class="form-group"><label>${esc(L("Skill"))}</label><div class="form-fields"><select name="${name("skill")}">
      <option value="prc" ${h.skill === "prc" ? "selected" : ""}>${esc(game.i18n.localize("DND5E.SkillPrc"))}</option>
      <option value="inv" ${h.skill === "inv" ? "selected" : ""}>${esc(game.i18n.localize("DND5E.SkillInv"))}</option></select></div></div>
    <div class="form-group"><label>${esc(L("Dc"))}</label><div class="form-fields"><input type="number" min="1" max="40" step="1" name="${name("dc")}" value="${h.dc}" data-dtype="Number"></div></div>
    <div class="form-group"><label>${esc(L("Passive"))}</label><div class="form-fields"><input type="number" min="0" step="5" name="${name("passive")}" value="${h.passive}" data-dtype="Number"></div></div>
    <div class="form-group"><label>${esc(L("Radius"))}</label><div class="form-fields"><input type="number" min="0" step="5" name="${name("radius")}" value="${h.radius}" data-dtype="Number"></div></div>
    <div class="form-group"><label>${esc(L("Found"))}</label><div class="form-fields"><input type="checkbox" name="${name("found")}" ${h.found ? "checked" : ""}></div></div>
    <div class="form-group"><label>${esc(L("Text"))}</label><div class="form-fields"><input type="text" name="${name("text")}" value="${esc(h.text)}"></div></div>`;
  const footer = root.querySelector(".form-footer");
  if ( footer ) footer.before(fieldset);
  else root.append(fieldset);
  app.setPosition?.({ height: "auto" });
}

/* -------------------------------------------- */
/*  Inscription                                 */
/* -------------------------------------------- */

export function registerHiddenInit() {
  CONFIG.queries[SEARCH_QUERY] = handleSearch;
  CONFIG.queries[HALT_QUERY] = handleHalt;
}

export function registerHidden() {
  route("updateRegionBehavior", "hidden zone", onUpdateBehavior);
  route("createRegionBehavior", "hidden zone", behavior => { if ( isActiveGM() && isDasZone(behavior) ) syncRegion(behavior.parent); });
  route("createRegion", "hidden zone", region => { if ( isActiveGM() ) syncRegion(region); });
  route("deleteRegionBehavior", "hidden zone", behavior => {
    if ( !isActiveGM() || !isDasZone(behavior) ) return;
    syncRegion(behavior.parent);
    syncTrapParts(behavior.parent?.parent);
  });
  route("updateWall", "hidden wall", onUpdateWall);
  route("updateToken", "passive Perception", onMoveToken);
  route("renderTokenHUD", "Search the surroundings button", onRenderTokenHUD);
  route("renderWallConfig", "hidden wall settings", onRenderWallConfig);
  route(TOKEN_MENU_HOOK, "menu: Search the surroundings", onTokenMenu);
}

/** Pour les fonctions de test (runtime/testing.mjs). */
export { reveal, onMoveToken as passiveCheck };
