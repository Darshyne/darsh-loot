/**
 * Nécromancie (SPEC §3.4) : relever un cadavre d'humanoïde en Squelette ou en Zombi, au service du lanceur.
 *
 * Chez le MJ :
 *  1. le trésor du mort est tiré s'il ne l'a pas été, puis **ses affaires tombent au sol** : un conteneur (région d'une
 *     case, §3.2) posé à sa place reçoit son équipement et ses pièces ;
 *  2. le token du mort est **remplacé** par le mort-vivant : un acteur du monde créé depuis le Monster Manual (nom
 *     traduit par Babele), « Squelette (Bandit) », token lié, propriété des joueurs du lanceur, même disposition que lui.
 * Seule exception à « le token d'un mort reste sur la scène » (SPEC §2), voulue.
 */
import { MODULE_ID, loc, log } from "../shared.mjs";
import { route } from "./router.mjs";
import { askGM } from "./take.mjs";
import { ensureRolled } from "./treasure.mjs";
import { ensureStore } from "./containers.mjs";
import { corpseToken, tokenDistance, transfer, lootView } from "../adapter/dnd5e.mjs";
import { createPile, pileAt, MIXED_PILE_IMG } from "../adapter/drop.mjs";
import { pileSpot } from "../core/drop.mjs";
import { UNDEAD, SPELL_RANGE_FT, canAnimate, feetToSceneUnits } from "../core/necromancy.mjs";

const ANIMATE_QUERY = `${MODULE_ID}.animate`;
const MM_ACTORS = "dnd-monster-manual.actors";
const FOLDER_FLAG = "undead";

/** Ce cadavre peut-il être relevé ? */
export function raisable(tokenDoc) {
  const actor = tokenDoc?.actor;
  if ( !actor || !corpseToken(tokenDoc) ) return false;
  return canAnimate({ type: actor.system.details?.type?.value, size: actor.system.traits?.size });
}

/**
 * Relever un cadavre.
 * @param {TokenDocument} corpse
 * @param {{ kind: "skeleton"|"zombie", caster?: TokenDocument|null }} options
 */
export function requestAnimate(corpse, { kind, caster=null }) {
  return askGM(ANIMATE_QUERY, handleAnimate, { corpse: corpse.uuid, caster: caster?.uuid ?? null, kind });
}

async function handleAnimate({ corpse: corpseUuid, caster: casterUuid, kind }, { user }) {
  const corpse = fromUuidSync(corpseUuid, { strict: false });
  const caster = casterUuid ? fromUuidSync(casterUuid, { strict: false }) : null;
  if ( !corpse || !UNDEAD[kind] ) throw new Error(loc("Refus.Introuvable"));
  if ( !raisable(corpse) ) throw new Error(loc("Necro.NotRaisable"));
  if ( !user.isGM ) {
    if ( !caster?.actor?.testUserPermission(user, "OWNER") ) throw new Error(loc("Refus.PasAToi"));
    const range = feetToSceneUnits(SPELL_RANGE_FT, corpse.parent.grid.units);
    if ( (caster.parent !== corpse.parent) || (tokenDistance(caster, corpse) > range) ) throw new Error(loc("Refus.Loin"));
  }
  const pack = game.packs.get(MM_ACTORS);
  if ( !pack ) throw new Error(loc("Necro.NeedMM"));

  const remains = await dropBelongings(corpse);
  const undead = await createUndead(pack, kind, corpse, caster);
  const place = { x: corpse._source.x, y: corpse._source.y, elevation: corpse._source.elevation, level: corpse._source.level };
  const disposition = caster?.disposition ?? CONST.TOKEN_DISPOSITIONS.FRIENDLY;
  const scene = corpse.parent;
  const corpseName = corpse.name;
  await corpse.delete();
  const tokenData = (await undead.getTokenDocument({ ...place, actorLink: true, disposition })).toObject();
  const [token] = await scene.createEmbeddedDocuments("Token", [tokenData]);

  ChatMessage.implementation.create({
    content: `<p>${loc("Necro.Chat", { caster: caster?.name ?? loc("Necro.Someone"), corpse: corpseName, undead: undead.name })}</p>`,
    speaker: caster ? ChatMessage.implementation.getSpeaker({ token: caster }) : undefined,
    flags: { [MODULE_ID]: { animate: true } }
  });
  log.info(`${corpseName} raised:`, undead.name, remains ? `(belongings: ${remains.name})` : "");
  return { undead: undead.uuid, token: token.uuid, remains: remains?.uuid ?? null };
}

/**
 * Les affaires du mort au sol : un tas (§3.8) dans le quart haut-gauche de sa case — celui qui y est déjà, sinon un nouveau, visible
 * tout de suite (pas d'effet de lancer) — rempli de son équipement et de ses pièces.
 */
async function dropBelongings(corpse) {
  await ensureRolled(corpse);
  const view = lootView(corpse.actor);
  if ( view.empty ) return null;
  const scene = corpse.parent;
  const s = corpse._source;
  const size = scene.grid.size;
  const center = pileSpot(scene.grid.getTopLeftPoint({ x: s.x + (size / 2), y: s.y + (size / 2) }), size);
  let region = pileAt(scene, center, s.level);
  if ( !region ) {
    const created = await createPile(scene, center, { level: s.level, elevation: s.elevation ?? 0,
      img: MIXED_PILE_IMG, name: loc("Necro.Remains", { name: corpse.name }), lastDrop: null });
    await created.tile.update({ alpha: 1 });
    region = created.region;
  }
  const store = await ensureStore(region.behaviors.contents[0]);
  await transfer(corpse.actor, store, { itemIds: view.entries.map(e => e.id), coins: true });
  return region;
}

/** Le dossier « Morts-vivants animés », créé au besoin. */
async function undeadFolder() {
  const found = game.folders.find(f => (f.type === "Actor") && f.getFlag(MODULE_ID, FOLDER_FLAG));
  return found ?? Folder.implementation.create({ name: loc("Necro.Folder"), type: "Actor", color: "#3f4a3a",
    flags: { [MODULE_ID]: { [FOLDER_FLAG]: true } } });
}

/** L'acteur du mort-vivant : copie du Monster Manual, au nom du mort, propriété des joueurs du lanceur. */
async function createUndead(pack, kind, corpse, caster) {
  const folder = await undeadFolder();
  const owners = caster?.actor
    ? game.users.filter(u => !u.isGM && caster.actor.testUserPermission(u, "OWNER")).map(u => u.id) : [];
  const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
    ...Object.fromEntries(owners.map(id => [id, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER])) };
  const source = await pack.getDocument(UNDEAD[kind]);
  // Pas `importFromCompendium` : il efface la propriété (`clearOwnership`), garde le dossier du compendium et bascule
  // la barre latérale (client/documents/abstract/world-collection.mjs:80).
  const data = game.actors.fromCompendium(source);
  const name = loc("Necro.Name", { undead: source.name, name: corpse.name });
  data.name = name;
  data.folder = folder.id;
  data.ownership = ownership;
  foundry.utils.setProperty(data, "prototypeToken.name", name);
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.raised`, { kind, from: corpse.name, by: caster?.actor?.uuid ?? null });
  return Actor.implementation.create(data);
}

/* ---- HUD du token (MJ) ---- */

async function chooseAndAnimate(corpse) {
  const caster = canvas.tokens.controlled.map(t => t.document).find(t => t !== corpse) ?? null;
  const kind = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("Necro.DialogTitle", { name: corpse.name }), icon: "fa-solid fa-skull" },
    content: `<p>${caster ? loc("Necro.DialogCaster", { name: foundry.utils.escapeHTML(caster.name) }) : loc("Necro.DialogNoCaster")}</p>`,
    buttons: [
      { action: "skeleton", label: loc("Necro.Skeleton"), icon: "fa-solid fa-skull" },
      { action: "zombie", label: loc("Necro.Zombie"), icon: "fa-solid fa-person-rays" }
    ],
    rejectClose: false
  });
  if ( kind ) await requestAnimate(corpse, { kind, caster });
}

function onRenderTokenHUD(hud, html) {
  const tokenDoc = hud.document;
  if ( !game.user.isGM || !raisable(tokenDoc) ) return;
  const column = html.querySelector(".col.left");
  if ( !column || column.querySelector(".dlo-necro") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon dlo-necro";
  button.dataset.tooltip = loc("Necro.Hud");
  button.innerHTML = `<i class="fa-solid fa-skull"></i>`;
  button.addEventListener("click", () => chooseAndAnimate(tokenDoc));
  column.append(button);
}

export function registerNecromancyInit() {
  CONFIG.queries[ANIMATE_QUERY] = handleAnimate;
}

export function registerNecromancy() {
  route("renderTokenHUD", "Raise button", onRenderTokenHUD);
}
