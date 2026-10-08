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
import { MODULE_ID, loc, log, setting } from "../shared.mjs";
import { route } from "./router.mjs";
import { askGM } from "./take.mjs";
import { passiveFinds, searchReach, searchWait, alreadyTried, withTry, revealWall, discoveryKey, normalizeHidden } from "../core/hidden.mjs";
import { concealedThings, regionConcealed, reaches, passiveScore, tilesIn, playerToken, wallHidden } from "../adapter/hidden.mjs";
import { TOKEN_MENU_HOOK, engineStopWalks, engineBudgetIssues, engineSpend } from "../adapter/engine.mjs";

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
    const hide = regionConcealed(region);
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
    log.warn("région cachée :", err.message);
  } finally {
    syncing.delete(region.uuid);
  }
}

/** Une zone DAS change : recachée par le MJ (« trouvée » décoché), ses essais s'effacent ; puis la région suit. */
function onUpdateBehavior(behavior, changes) {
  if ( !isActiveGM() || !isDasZone(behavior) ) return;
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
    log.warn("mur caché :", err.message);
  }
}

function onUpdateWall(wall, changes) {
  if ( !isActiveGM() || (foundry.utils.getProperty(changes, `flags.${MODULE_ID}.hidden`) === undefined) ) return;
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
  if ( thing.doc.documentName === "Wall" ) await thing.doc.setFlag(MODULE_ID, "hidden", { ...thing.hidden, found: true });
  else await thing.doc.update({ "system.hidden.found": true });
  const text = thing.hidden.text || loc(`Hidden.Found.${discoveryKey(thing.kind)}`);
  const ChatMessage = foundry.documents.ChatMessage.implementation;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token: finder }),
    content: `<p>${foundry.utils.escapeHTML(text)}</p>`,
    whisper: readersOf(finder.actor)
  });
  log.info(`${finder.name} trouve ${thing.key}`);
  haltScene(finder.parent);
}

/**
 * Chez le MJ : un personnage de joueur a bougé — sa Perception (ou Investigation) passive trouve-t-elle quelque chose ?
 * Rien n'est montré tant que rien n'est trouvé.
 */
async function onMoveToken(token, changes) {
  if ( !isActiveGM() || !playerToken(token) ) return;
  if ( !["x", "y", "elevation", "level"].some(k => k in changes) ) return;
  for ( const thing of concealedThings(token.parent) ) {
    const h = thing.hidden;
    if ( !passiveFinds(h, thing.distance(token), passiveScore(token.actor, h.skill)) ) continue;
    if ( !reaches(token, thing, h.passive) ) continue;
    await reveal(thing, token);
  }
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
  const result = await askGM(SEARCH_QUERY, handleSearch, { token: token.uuid });
  if ( result && !result.found ) ui.notifications.info(loc("Hidden.Nothing"));
  return result;
}

async function handleSearch({ token: uuid }, { user }) {
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
  const wait = inCombat ? 0 : searchWait(actor.getFlag(MODULE_ID, "lastSearch"), game.time.worldTime, setting("searchCooldown"));
  if ( wait > 0 ) throw new Error(loc("Hidden.Cooldown", { name: actor.name, minutes: Math.ceil(wait / 60) }));
  await engineSpend(actor, "action");
  if ( !inCombat ) await actor.setFlag(MODULE_ID, "lastSearch", game.time.worldTime);
  const worldRadius = setting("searchRadius");
  let found = 0;
  for ( const thing of concealedThings(token.parent) ) {
    const h = thing.hidden;
    if ( !reaches(token, thing, searchReach(h, worldRadius)) ) continue;
    if ( alreadyTried(thing.tried, actor.id) ) continue;
    // Jet chez le MJ, caché au joueur : mode de message « gm » (V14, CONFIG.ChatMessage.modes). Pas l'ancien
    // CONST.DICE_ROLL_MODES.BLIND (« blindroll », déprécié en V14) : dnd5e 6 le passe tel quel en `messageMode`
    // (dice/basic-roll.mjs:271), le cœur ne le reconnaît pas et le jet devenait public (vu le 2026-10-06).
    const rolls = await actor.rollSkill({ skill: h.skill }, { configure: false }, { rollMode: "gm" });
    const total = rolls?.[0]?.total ?? -Infinity;
    if ( total >= h.dc ) { await reveal(thing, token); found++; }
    else await thing.doc.setFlag(MODULE_ID, "tried", withTry(thing.tried, actor.id));
  }
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
    else user.query(HALT_QUERY, { scene: scene.uuid }, { timeout: 5000 }).catch(err => log.warn("arrêt des déplacements :", err.message));
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
      try { token.stopMovement(); } catch(err) { log.warn(`arrêt de ${token.name} :`, err.message); }
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
  route("updateRegionBehavior", "zone cachée", onUpdateBehavior);
  route("createRegionBehavior", "zone cachée", behavior => { if ( isActiveGM() && isDasZone(behavior) ) syncRegion(behavior.parent); });
  route("createRegion", "zone cachée", region => { if ( isActiveGM() ) syncRegion(region); });
  route("deleteRegionBehavior", "zone cachée", behavior => { if ( isActiveGM() && isDasZone(behavior) ) syncRegion(behavior.parent); });
  route("updateWall", "mur caché", onUpdateWall);
  route("updateToken", "perception passive", onMoveToken);
  route("renderTokenHUD", "bouton Fouiller les environs", onRenderTokenHUD);
  route("renderWallConfig", "réglages de mur caché", onRenderWallConfig);
  route(TOKEN_MENU_HOOK, "menu : Fouiller les environs", onTokenMenu);
}

/** Pour les fonctions de test (runtime/testing.mjs). */
export { reveal, onMoveToken as passiveCheck };
