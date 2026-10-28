/**
 * Passe de test de bout en bout (2026-10-28) : jouée chez le MJ par le connecteur (`api.mcp.selftest`, `tools/selftest.mjs`), sur un
 * coin libre de la scène affichée. Chaque partie pose ses propres documents d'essai (acteurs, tokens, régions, murs marqués
 * `flags.darsh-loot.test`), vérifie la cohérence de ce qui se passe — pas des valeurs de dés : trouvé ⇔ passive ≥ DD, désamorcé ou
 * parti, etc. — et retire tout ce qu'elle a créé, même en cas d'échec. Rien ici ne sert au jeu.
 */
import { MODULE_ID, setting } from "../shared.mjs";
import { TRAP_ZONE } from "../adapter/trap-behavior.mjs";
import { trapHandle, isTrapToken, autoRegionOf, anyKnown } from "../adapter/trapped.mjs";
import { engineAvoids, engineObjectToken, engineTestApi } from "../adapter/engine.mjs";
import { livingNPC } from "../adapter/theft.mjs";
import { fireTrap, requestDisarm, springTrap, knownTrapPlaces, gmTrapEntries, resetTrap } from "./traps.mjs";
import { requestSearch } from "./hidden.mjs";
import { ensureRolled } from "./treasure.mjs";
import { requestTake } from "./take.mjs";
import { corpseSource, containerSource } from "../adapter/sources.mjs";
import { openSource } from "./open.mjs";
import { requestUnlock } from "./containers.mjs";
import { requestGroundDrop } from "./drop.mjs";

const TEST = { [MODULE_ID]: { test: true } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Attendre qu'une condition soit vraie (au plus `ms`). */
async function until(test, ms=8000, step=200) {
  const end = Date.now() + ms;
  for ( ;; ) {
    let v;
    try { v = await test(); } catch { v = false; }
    if ( v ) return v;
    if ( Date.now() > end ) return v;
    await sleep(step);
  }
}

/** Le banc d'une partie : où poser, ce qui a été créé, les vérifications. */
function bench(scene, origin) {
  const G = scene.grid.size;
  const created = { Token: [], Region: [], Wall: [], actors: [], combats: [] };
  const checks = [];
  const b = {
    scene, G, created, checks, sounds: [],
    expect(ok, label) { checks.push({ ok: !!ok, label }); return !!ok; },
    note(label) { checks.push({ ok: true, label, note: true }); },
    pt: (i, j) => ({ x: origin.x + (i * G), y: origin.y + (j * G) }),
    center: (i, j) => ({ x: origin.x + ((i + 0.5) * G), y: origin.y + ((j + 0.5) * G) }),
    async actor(data) {
      const a = await Actor.implementation.create(foundry.utils.mergeObject({ flags: TEST }, data));
      created.actors.push(a.id);
      return a;
    },
    async token(actor, i, j, extra={}) {
      const proto = await actor.getTokenDocument({ ...b.pt(i, j), ...extra });
      const [t] = await scene.createEmbeddedDocuments("Token", [proto.toObject()]);
      created.Token.push(t.id);
      await sleep(400);
      return t;
    },
    async region(data) {
      const [r] = await scene.createEmbeddedDocuments("Region", [foundry.utils.mergeObject({ flags: TEST }, data)]);
      created.Region.push(r.id);
      await sleep(400);
      return r;
    },
    async wall(data) {
      const [w] = await scene.createEmbeddedDocuments("Wall", [foundry.utils.mergeObject({ flags: TEST }, data)]);
      created.Wall.push(w.id);
      await sleep(200);
      return w;
    },
    /** Poser un token sur une case, sans animation (un déplacement du cœur : les régions l'entendent). */
    async moveTo(token, i, j) {
      await token.update(b.pt(i, j), { animate: false });
      await sleep(700);
    },
    rect: (i, j, w, h) => ({ type: "rectangle", ...b.pt(i, j), width: w * G, height: h * G })
  };
  return b;
}

/** Tout retirer : combats, tokens, régions (et les régions posées sous les tokens pièges), murs, acteurs d'essai. */
async function cleanup(b) {
  const { scene, created } = b;
  for ( const id of created.combats ) await game.combats.get(id)?.delete().catch(() => {});
  const tokens = created.Token.filter(id => scene.tokens.has(id));
  if ( tokens.length ) await scene.deleteEmbeddedDocuments("Token", tokens).catch(() => {});
  // La région posée sous un token piège part avec lui (le module la retire) : on ne retire que celles qui restent ensuite.
  await sleep(1000);
  const auto = scene.regions.filter(r => created.Token.includes(r.getFlag(MODULE_ID, "trapToken"))).map(r => r.id);
  const regions = [...new Set([...created.Region, ...auto])].filter(id => scene.regions.has(id));
  if ( regions.length ) await scene.deleteEmbeddedDocuments("Region", regions).catch(() => {});
  // Coffres créés pour les régions d'essai.
  const stores = game.actors.filter(a => a.getFlag(MODULE_ID, "containerOf") && !fromUuidSync(a.getFlag(MODULE_ID, "containerOf"), { strict: false }));
  const walls = created.Wall.filter(id => scene.walls.has(id));
  if ( walls.length ) await scene.deleteEmbeddedDocuments("Wall", walls).catch(() => {});
  const actors = [...created.actors, ...stores.filter(a => a.getFlag(MODULE_ID, "test")).map(a => a.id)].filter(id => game.actors.has(id));
  if ( actors.length ) await Actor.implementation.deleteDocuments(actors).catch(() => {});
}

/** Un coin de la scène sans token, région ni mur sur `w` × `h` cases (cases entières, dans le rectangle de la carte). */
function freeArea(scene, w, h) {
  const G = scene.grid.size;
  const r = scene.dimensions.sceneRect;
  const busy = (x, y) => {
    const box = new PIXI.Rectangle(x - G, y - G, (w + 2) * G, (h + 2) * G);
    if ( scene.tokens.some(t => box.intersects(new PIXI.Rectangle(t._source.x, t._source.y, t._source.width * G, t._source.height * G))) ) return true;
    if ( scene.regions.some(reg => reg.object?.bounds && box.intersects(reg.object.bounds)) ) return true;
    return scene.walls.some(wl => box.contains(wl.c[0], wl.c[1]) || box.contains(wl.c[2], wl.c[3]));
  };
  for ( let y = r.y + G; y + ((h + 1) * G) < r.bottom; y += G ) {
    for ( let x = r.x + G; x + ((w + 1) * G) < r.right; x += G ) {
      if ( !busy(x, y) ) return { x, y };
    }
  }
  throw new Error(`no free ${w}×${h} area on ${scene.name}`);
}

/** Un personnage de joueur d'essai (Sagesse 20 : Perception passive 15), possédé par un joueur. */
async function testCharacter(b, name="Essai fouilleur") {
  const player = game.users.find(u => !u.isGM);
  return b.actor({ name, type: "character", img: "icons/svg/mystery-man.svg",
    ownership: player ? { [player.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } : {},
    system: { abilities: { wis: { value: 20 }, dex: { value: 16 } }, attributes: { hp: { value: 99, max: 99 } } },
    prototypeToken: { actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY } });
}

/** Une créature d'essai (PNJ, 999 PV) ; `size` : taille dnd5e. */
function testCreature(b, name="Essai cible", size="med") {
  return b.actor({ name, type: "npc", img: "icons/svg/mystery-man.svg",
    system: { attributes: { hp: { value: 999, max: 999 } }, traits: { size }, details: { type: { value: "humanoid" } } },
    prototypeToken: { disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE } });
}

/** Les fléchettes empoisonnées du DMG 2024, importées en acteur d'essai (null si le compendium manque). */
async function trapActor(b, name="Essai piège") {
  const pack = game.packs.find(p => (p.documentName === "Actor") && p.index.has("dmgPoisonedDarts"));
  if ( !pack ) return null;
  const doc = await pack.getDocument("dmgPoisonedDarts");
  const data = game.actors.fromCompendium(doc);
  delete data._id;
  return b.actor({ ...data, name });
}

const messagesAfter = (since, test=() => true) => game.messages.contents.filter(m => (m.timestamp > since) && test(m));
const feedbackAfter = since => messagesAfter(since, m => !!m.getFlag(MODULE_ID, "feedback"));

/** Fermer les fenêtres ouvertes depuis `before` (ids d'applications). */
async function closeNew(before) {
  for ( const app of foundry.applications.instances.values() ) {
    if ( !before.has(app.id) && app.rendered ) await app.close().catch(() => {});
  }
}

/* -------------------------------------------- */
/*  Parties                                     */
/* -------------------------------------------- */

/** Portes secrètes : détection passive en passant (retour vu et entendu), pas au-dessus du DD, fouille active. */
async function secretDoors(b) {
  const pc = await testCharacter(b);
  const searcher = await b.token(pc, 0, 0);
  const passive = pc.system.skills.prc.passive;
  b.note(`Perception passive du fouilleur : ${passive}`);
  // Deux portes secrètes verticales : une facile (DD 10) à 5 cases, une impossible (DD 30) à 7 cases.
  const easy = await b.wall({ c: [b.pt(5, 0).x, b.pt(5, 0).y, b.pt(5, 2).x, b.pt(5, 2).y], door: CONST.WALL_DOOR_TYPES.SECRET,
    flags: { [MODULE_ID]: { hidden: { enabled: true, dc: 10, passive: 10 } } } });
  const hard = await b.wall({ c: [b.pt(7, 0).x, b.pt(7, 0).y, b.pt(7, 2).x, b.pt(7, 2).y], door: CONST.WALL_DOOR_TYPES.SECRET,
    flags: { [MODULE_ID]: { hidden: { enabled: true, dc: 30, passive: 10 } } } });

  // Trop loin (passive 10 ft ; bord du token à 15 ft du mur) : rien.
  await b.moveTo(searcher, 1, 0);
  b.expect(!easy.getFlag(MODULE_ID, "hidden")?.found, "à 15 ft, la porte facile n'est pas trouvée (détection passive à 10 ft)");

  // À côté : trouvée, devient une porte ordinaire, retour à la table (carte publique « remarque quelque chose » + texte flottant).
  const since = Date.now();
  await b.moveTo(searcher, 4, 0);
  const found = await until(() => easy.getFlag(MODULE_ID, "hidden")?.found === true);
  b.expect(found === (passive >= 10), `à côté, porte DD 10 trouvée : ${!!found} (passive ${passive})`);
  if ( found ) {
    b.expect(await until(() => easy.door === CONST.WALL_DOOR_TYPES.DOOR), `révélée en porte ordinaire (door ${easy.door})`);
    const cards = await until(() => feedbackAfter(since).length && feedbackAfter(since));
    b.expect(cards?.length >= 1, `carte de retour pour toute la table : ${cards?.length ?? 0}`);
    const card = cards?.[0];
    b.expect(card && !card.whisper?.length, "la carte de retour est publique (vue de tous)");
    b.expect(b.sounds.some(s => s.src === "sounds/notify.wav" && s.broadcast), `son de découverte diffusé à tous (${b.sounds.map(s => s.src).join(", ") || "aucun"})`);
    const secret = messagesAfter(since, m => !m.getFlag(MODULE_ID, "feedback") && m.whisper?.length);
    b.expect(secret.length >= 1, "ce qui est trouvé n'est dit qu'au joueur et au MJ (message murmuré)");
  }
  await b.moveTo(searcher, 6, 0);
  b.expect(!hard.getFlag(MODULE_ID, "hidden")?.found, "porte DD 30 jamais trouvée par la passive (passive < 30)");

  // Fouille active : le jet décide ; la carte dit « remarque quelque chose » ou « rien ».
  const before = Date.now();
  const r = await requestSearch(searcher);
  const fb = await until(() => feedbackAfter(before).length && feedbackAfter(before));
  b.expect(fb?.length >= 1, `fouille active : carte de retour (${r?.found ?? "?"} trouvé)`);
  b.expect(!!hard.getFlag(MODULE_ID, "hidden")?.found === ((r?.found ?? 0) > 0), "fouille : porte DD 30 trouvée ⇔ la fouille a trouvé quelque chose");
}

/** Piège de zone : caché, repéré, menus, évitement, tir simple, réinitialisation, taille minimale, désamorçage. */
async function zoneTrap(b) {
  const actor = await trapActor(b);
  if ( !actor ) { b.note("compendium du DMG 2024 absent : partie sautée"); return; }
  const before = { advanced: setting("advancedTraps") };
  await game.settings.set(MODULE_ID, "advancedTraps", false);
  try {
    const pc = await testCharacter(b);
    const looter = await b.token(pc, 0, 0);
    const target = await b.token(await testCreature(b), 6, 3);
    const tiny = await b.token(await testCreature(b, "Essai rat", "tiny"), 6, 0);
    const region = await b.region({ name: "Essai piège zone", shapes: [b.rect(3, 2, 2, 2)],
      behaviors: [{ type: TRAP_ZONE, name: "Essai piège zone", system: { actor: actor.uuid, hidden: { enabled: true, dc: 30, passive: 0 }, disarmDc: 10 } }] });
    const behavior = region.behaviors.find(x => x.type === TRAP_ZONE);
    const h = () => trapHandle(behavior);

    b.expect(!anyKnown(h()), "caché, le piège n'est pas repéré");
    b.expect(!knownTrapPlaces(b.scene).some(p => p.h.uuid === behavior.uuid), "caché : rien de cliquable pour les joueurs");
    b.expect(!engineAvoids(region), "caché : le moteur ne l'évite pas (le chemin ne le trahit pas)");

    await behavior.update({ "system.hidden.found": true });
    await sleep(600);
    b.expect(anyKnown(h()), "trouvé : repéré");
    b.expect(knownTrapPlaces(b.scene).some(p => p.h.uuid === behavior.uuid), "trouvé : cliquable (désamorcer)");
    b.expect(await until(() => engineAvoids(region)), "trouvé : le moteur l'évite");

    const gm = gmTrapEntries(h()).map(e => e.label);
    b.expect(gm.length >= 5, `entrées du MJ : ${gm.join(" | ")}`);
    const ground = engineTestApi()?.mcp?.placeMenu?.({ tokenId: looter.id, ...b.center(3, 2) });
    b.expect(ground?.labels?.some(l => /désamorcer|disarm/i.test(l)), `menu de la case : ${ground?.labels?.join(" | ") ?? "pas de moteur"}`);

    // Une créature Très petite y passe sans le déclencher.
    await b.moveTo(tiny, 3, 2);
    await sleep(800);
    b.expect(h().trap.armed && !h().trap.triggeredAt, "une créature Très petite ne le déclenche pas (taille minimale Petite)");
    await b.moveTo(tiny, 6, 0);

    // Une créature moyenne entre : il part (mode simple, le moteur lance l'activité).
    const since = Date.now();
    await b.moveTo(target, 3, 3);
    const fired = await until(() => !h().trap.armed && h().trap.triggeredAt !== null, 10000);
    b.expect(fired, "une créature moyenne qui entre le déclenche (désarmé, heure notée)");
    const used = await until(() => messagesAfter(since, m => m.speaker?.actor === actor.id).length, 15000);
    b.expect(used, `l'activité du piège est lancée (${used || 0} message(s) du piège)`);

    // Réinitialiser (MJ) : armé, recaché.
    await resetTrap(h());
    await sleep(500);
    b.expect(h().trap.armed && !h().trap.disarmed && !anyKnown(h()), "réinitialisé : armé, pas désamorcé, de nouveau caché");

    // Désamorcer au contact (jet réel) : désamorcé, ou raté (et parti s'il le doit) — retour à la table dans les deux cas.
    await behavior.update({ "system.hidden.found": true });
    await b.moveTo(target, 6, 3);
    await b.moveTo(looter, 2, 2);
    const d0 = Date.now();
    await requestDisarm(h(), looter, { confirm: false });
    const after = h().trap;
    b.expect(after.disarmed || !after.armed || after.armed, `désamorçage : ${after.disarmed ? "désamorcé" : (after.armed ? "raté, toujours armé" : "raté, parti")}`);
    b.expect(!(after.disarmed && after.armed), "désamorcé ⇒ plus armé");
    const fb = await until(() => feedbackAfter(d0).length);
    b.expect(fb, "désamorçage : carte de retour pour la table");
    const took = Date.now() - d0;
    b.expect(took >= (setting("disarmDuration") * 1000) - 500, `le désamorçage prend ses ${setting("disarmDuration")} s (${Math.round(took / 100) / 10} s)`);
  } finally {
    await game.settings.set(MODULE_ID, "advancedTraps", before.advanced);
  }
}

/** Mode avancé : le combat d'un piège ne prend que les personnages de la scène et qui l'a déclenché ; pause selon le réglage. */
async function advancedTrap(b) {
  const actor = await trapActor(b);
  if ( !actor ) { b.note("compendium du DMG 2024 absent : partie sautée"); return; }
  if ( game.combats.some(c => c.started && c.scene?.id === b.scene.id) ) { b.note("un combat est en cours sur la scène : partie sautée"); return; }
  const before = { advanced: setting("advancedTraps"), pause: setting("trapPause"), paused: game.paused };
  await game.settings.set(MODULE_ID, "advancedTraps", true);
  const surprised = [];
  try {
    for ( const pause of [false, true] ) {
      await game.settings.set(MODULE_ID, "trapPause", pause);
      if ( game.paused ) game.togglePause(false, { broadcast: true });
      const triggerer = await b.token(await testCreature(b, "Essai déclencheur"), 0, pause ? 4 : 0);
      const npc = await b.token(await testCreature(b, "Essai spectateur"), 8, pause ? 4 : 0);
      const region = await b.region({ name: "Essai piège avancé", shapes: [b.rect(3, pause ? 4 : 0, 2, 2)],
        behaviors: [{ type: TRAP_ZONE, name: "Essai piège avancé", system: { actor: actor.uuid, hidden: { enabled: true, dc: 30, passive: 0 } } }] });
      const windows = new Set(foundry.applications.instances.keys());
      await b.moveTo(triggerer, 3, pause ? 4 : 0);
      const combat = await until(() => game.combats.find(c => c.scene?.id === b.scene.id && !b.created.combats.includes(c.id) && c.started), 15000);
      b.expect(combat, `mode avancé (pause ${pause ? "oui" : "non"}) : un combat commence`);
      if ( combat ) {
        b.created.combats.push(combat.id);
        const tokens = combat.combatants.filter(c => c.token).map(c => c.token);
        const pcs = b.scene.tokens.filter(t => t.actor?.hasPlayerOwner && (t.actor.type !== "group") && !t.actor.statuses?.has("dead")
          && !engineObjectToken(t) && !isTrapToken(t));
        b.expect(tokens.some(t => t.id === triggerer.id), "le déclencheur est dans le combat");
        b.expect(!tokens.some(t => t.id === npc.id), "un PNJ de la scène qui ne l'a pas déclenché n'y est pas");
        b.expect(tokens.every(t => (t.id === triggerer.id) || pcs.some(p => p.id === t.id)), `seulement les personnages des joueurs et le déclencheur (${tokens.length} / ${pcs.length + 1})`);
        surprised.push(...tokens.filter(t => t.actor?.statuses?.has("surprised")));
      }
      await sleep(800);
      b.expect(game.paused === pause, `réglage « pause » ${pause ? "allumé : jeu en pause" : "éteint : pas de pause"} (en pause : ${game.paused})`);
      // Laisser le combat commencer pour de bon (le tour du piège) avant de le retirer : supprimé trop tôt, dnd5e et le moteur
      // écrivent encore sur un combat parti (erreurs du test, pas du jeu).
      await sleep(3000);
      await closeNew(windows);
      if ( combat ) await combat.delete().catch(() => {});
    }
  } finally {
    for ( const t of surprised ) await t.actor?.toggleStatusEffect("surprised", { active: false }).catch(() => {});
    await game.settings.set(MODULE_ID, "advancedTraps", before.advanced);
    await game.settings.set(MODULE_ID, "trapPause", before.pause);
    if ( game.paused !== before.paused ) game.togglePause(before.paused, { broadcast: true });
  }
}

/** Piège porté par un acteur : un token posé est le piège ; ni bloquant, ni entendu, ni « Voler » ; part quand on marche dessus. */
async function tokenTrap(b) {
  const actor = await trapActor(b, "Essai piège token");
  if ( !actor ) { b.note("compendium du DMG 2024 absent : partie sautée"); return; }
  const before = { advanced: setting("advancedTraps") };
  await game.settings.set(MODULE_ID, "advancedTraps", false);
  try {
    const pc = await testCharacter(b);
    const walker = await b.token(pc, 0, 1);
    const trap = await b.token(actor, 3, 1);
    b.expect(isTrapToken(trap), "un PNJ de type « Trap » posé est un piège");
    b.expect(await until(() => autoRegionOf(trap)), "une région est posée sous lui (déclencheur et zone d'effet)");
    b.expect(!livingNPC(trap), "pas de « Voler » sur un piège");
    const engine = engineTestApi();
    if ( engine?.canHear ) b.expect(!engine.canHear(walker.object ?? walker, trap.object ?? trap), "un piège ne s'entend pas");
    const menu = engine?.mcp?.menu?.({ tokenId: walker.id, targetId: trap.id });
    if ( menu ) {
      b.expect(!menu.labels.some(l => /suivre|follow|voler|pickpocket/i.test(l)), `menu du piège sans « Suivre » ni « Voler » : ${menu.labels.join(" | ")}`);
      b.expect(gmTrapEntries(trapHandle(trap)).length >= 5, "entrées du MJ sur le token piège");
    }
    // Le chemin du moteur ne le contourne pas et peut finir sur sa case (intangible).
    const plan = engine?.mcp?.plan?.({ tokenId: walker.id, point: b.center(5, 1), maxCost: 999 });
    if ( plan ) {
      const ends = plan.waypoints?.at(-1);
      const via = (plan.waypoints ?? []).some(w => (Math.abs(w.x - b.pt(3, 1).x) < 2) && (Math.abs(w.y - b.pt(3, 1).y) < 2));
      b.expect(!!ends, `chemin trouvé à travers le piège (${plan.waypoints?.length ?? 0} points${via ? ", par sa case" : ""})`);
    }
    // On marche dessus : il part.
    const h = () => trapHandle(trap);
    await b.moveTo(walker, 3, 1);
    b.expect(await until(() => !h().trap.armed && h().trap.triggeredAt !== null, 10000), "marcher sur sa case le déclenche");
  } finally {
    await game.settings.set(MODULE_ID, "advancedTraps", before.advanced);
  }
}

/** Coffre et porte piégés : ouvrir les fait partir une fois ; désamorcer. */
async function trappedThings(b) {
  const actor = await trapActor(b, "Essai piège coffre");
  if ( !actor ) { b.note("compendium du DMG 2024 absent : partie sautée"); return; }
  const before = { advanced: setting("advancedTraps") };
  await game.settings.set(MODULE_ID, "advancedTraps", false);
  try {
    const looter = await b.token(await testCharacter(b), 1, 1);
    const region = await b.region({ name: "Essai coffre piégé", shapes: [b.rect(2, 1, 1, 1)],
      behaviors: [{ type: `${MODULE_ID}.container`, name: "Essai coffre piégé", system: { trap: { enabled: true, actor: actor.uuid,
        hidden: { enabled: true, dc: 30, passive: 0 }, disarmDc: 10 } } }] });
    const chest = region.behaviors.contents[0];
    b.expect(trapHandle(chest)?.kind === "container", "le coffre porte un piège");
    b.expect(await springTrap(chest, looter, "open"), "ouvrir le coffre fait partir son piège");
    b.expect(!(await springTrap(chest, looter, "open")), "une seconde ouverture ne le refait pas partir (pas de réarmement)");

    const door = await b.wall({ c: [b.pt(5, 0).x, b.pt(5, 0).y, b.pt(5, 2).x, b.pt(5, 2).y], door: CONST.WALL_DOOR_TYPES.DOOR,
      flags: { [MODULE_ID]: { trap: { enabled: true, actor: actor.uuid, hidden: { enabled: true, dc: 30, passive: 0 }, disarmDc: 10 } } } });
    b.expect(trapHandle(door)?.kind === "door", "la porte porte un piège");
    await trapHandle(door).update({ "hidden.found": true });
    const menu = engineTestApi()?.mcp?.placeMenu?.({ tokenId: looter.id, wallId: door.id });
    b.expect(menu?.labels?.some(l => /désamorcer|disarm/i.test(l)), `menu de la porte piégée repérée : ${menu?.labels?.join(" | ") ?? "pas de moteur"}`);
    await b.moveTo(looter, 4, 1);
    await requestDisarm(trapHandle(door), looter, { confirm: false });
    const t = trapHandle(door)?.trap;
    b.expect(t && (t.disarmed || t.armed || t.triggeredAt), `porte : ${t?.disarmed ? "désamorcée" : (t?.armed ? "raté, toujours armée" : "ratée, partie")}`);
  } finally {
    await game.settings.set(MODULE_ID, "advancedTraps", before.advanced);
  }
}

/** Butin : un cadavre fouillé (trésor tiré une fois, objet pris), un objet posé au sol. */
async function loot(b) {
  const looter = await b.token(await testCharacter(b), 0, 0);
  const victim = await b.actor({ name: "Essai cadavre", type: "npc", img: "icons/svg/skull.svg",
    system: { attributes: { hp: { value: 10, max: 10 } }, details: { type: { value: "humanoid" }, cr: 2 }, currency: { gp: 0 } },
    items: [{ name: "Essai dague", type: "weapon", system: { quantity: 1, properties: ["gear"], type: { value: "simpleM", baseItem: "dagger" } } }] });
  const corpse = await b.token(victim, 1, 0);
  await corpse.actor.toggleStatusEffect("dead", { active: true, overlay: true });
  await sleep(500);
  const engine = engineTestApi();
  const menu = engine?.mcp?.menu?.({ tokenId: looter.id, targetId: corpse.id });
  if ( menu ) b.expect(menu.labels.some(l => /fouiller|search|loot/i.test(l)), `menu du cadavre : ${menu.labels.join(" | ")}`);
  await ensureRolled(corpse);
  const rolled = corpse.actor.getFlag(MODULE_ID, "treasure") ?? corpse.actor.getFlag(MODULE_ID, "rolled") ?? null;
  const count = corpse.actor.items.size;
  await ensureRolled(corpse);
  b.expect(corpse.actor.items.size === count, `trésor tiré une seule fois (${count} objets, ${setting("autoTreasure") ? "trésor auto" : "trésor auto éteint"}${rolled ? "" : ""})`);
  const source = corpseSource(corpse);
  const item = corpse.actor.items.find(i => i.name === "Essai dague");
  if ( source && item ) {
    await requestTake(source, looter, { itemIds: [item.id] });
    await sleep(500);
    b.expect(looter.actor.items.some(i => i.name === "Essai dague"), "l'objet pris passe au personnage");
    b.expect(!corpse.actor.items.has(item.id), "et quitte le cadavre");
  }
  b.expect(b.scene.tokens.has(corpse.id), "le token du mort reste sur la scène (abri pour le moteur)");

  // Un objet posé au sol (MJ) : un tas, tuile + conteneur.
  const pack = game.packs.get("dnd5e.items");
  const torch = pack?.index.find(e => /^torch$/i.test(e.name));
  if ( torch ) {
    const { region: uuid } = await requestGroundDrop(torch.uuid, b.center(4, 0));
    const pile = fromUuidSync(uuid);
    if ( pile ) { b.created.Region.push(pile.id); await pile.setFlag(MODULE_ID, "test", true); }
    b.expect(pile?.behaviors.some(x => x.type === `${MODULE_ID}.container`), "un objet posé au sol devient un tas (conteneur)");
  } else b.note("torche du SRD introuvable : dépôt au sol non testé");
}

/** Sons (2026-10-28) : coffre ouvert (son de porte choisi, bois par défaut), serrure, fouille d'un cadavre, objet pris, tas au sol muet. */
async function sounds(b) {
  const looter = await b.token(await testCharacter(b), 0, 0);
  const played = since => b.sounds.slice(since).filter(s => s.broadcast).map(s => s.src);
  const wood = CONFIG.Wall.doorSounds.woodBasic;
  const windows = new Set(foundry.applications.instances.keys());
  try {
    // Un coffre neuf : son « porte en bois » par défaut ; ouvert, il grince ; on y prend une pièce, les pièces sonnent.
    const region = await b.region({ name: "Essai coffre sonore", shapes: [b.rect(1, 0, 1, 1)],
      behaviors: [{ type: `${MODULE_ID}.container`, name: "Essai coffre sonore", system: { rolled: true } }] });
    const chest = region.behaviors.contents[0];
    b.expect(chest.system.sound === "woodBasic", `son par défaut d'un coffre : ${chest.system.sound}`);
    let n = b.sounds.length;
    await openSource(containerSource(chest), looter);
    await sleep(400);
    b.expect(played(n).includes(wood.open), `ouvrir le coffre : son d'ouverture de la porte en bois (${played(n).join(", ") || "aucun"})`);
    const store = fromUuidSync(chest.system.actor, { strict: false });
    if ( store ) {
      await store.update({ "system.currency.gp": 3 });
      n = b.sounds.length;
      await requestTake(containerSource(chest), looter, { coins: true });
      await sleep(400);
      b.expect(played(n).some(s => /drop-coins/.test(s)), `prendre : bruit de pièces (${played(n).join(", ") || "aucun"})`);
    } else b.note("coffre sans contenu : prendre non testé");
    // Un autre jeu de sons, et une serrure : le crochetage dit « déverrouillé » ou « résiste » avec ses sons.
    await chest.update({ "system.sound": "metal", "system.locked": true, "system.dc": 10 });
    await sleep(300);
    n = b.sounds.length;
    const r = await requestUnlock(containerSource(chest), looter, "pick");
    await sleep(600);
    const metal = CONFIG.Wall.doorSounds.metal;
    const wanted = (r?.ok ? metal.unlock : metal.test);
    b.expect(played(n).includes(wanted), `serrure ${r?.ok ? "crochetée" : "qui résiste"} : son du jeu « métal » (${played(n).join(", ") || "aucun"})`);
    await chest.update({ "system.sound": "", "system.locked": false });
    n = b.sounds.length;
    await openSource(containerSource(chest), looter);
    await sleep(400);
    b.expect(!played(n).some(s => s.startsWith("sounds/doors/")), "son « Aucun » : le coffre s'ouvre en silence");

    // Fouiller un cadavre : le bruissement.
    const corpse = await b.token(await b.actor({ name: "Essai cadavre sonore", type: "npc", img: "icons/svg/skull.svg",
      system: { attributes: { hp: { value: 10, max: 10 } }, details: { type: { value: "humanoid" }, cr: 1 } } }), 3, 0);
    await corpse.actor.toggleStatusEffect("dead", { active: true, overlay: true });
    await sleep(400);
    n = b.sounds.length;
    await openSource(corpseSource(corpse), looter);
    await sleep(400);
    b.expect(played(n).some(s => /drop-soft/.test(s)), `fouiller un cadavre : bruissement (${played(n).join(", ") || "aucun"})`);

    // Un tas posé au sol n'a pas de son de coffre.
    const torch = game.packs.get("dnd5e.items")?.index.find(e => /^torch$/i.test(e.name));
    if ( torch ) {
      const { region: uuid } = await requestGroundDrop(torch.uuid, b.center(5, 0));
      const pile = fromUuidSync(uuid);
      if ( pile ) { b.created.Region.push(pile.id); await pile.setFlag(MODULE_ID, "test", true); }
      b.expect(pile?.behaviors.contents[0]?.system.sound === "", "un tas au sol n'a pas de son de coffre");
    }
  } finally {
    await closeNew(windows);
  }
}

/** Fouille (2026-10-28) : toujours un jet, même sans rien à trouver ; le verdict tombe à la fin de la durée, dés 3D compris. */
async function search(b) {
  const searcher = await b.token(await testCharacter(b), 1, 1);
  const seconds = Number(setting("searchDuration")) || 0;
  const rollsOf = since => messagesAfter(since, m => m.rolls?.length && (m.speaker?.actor === searcher.actor.id));
  // Rien de caché autour : un jet quand même, et le verdict à la fin de la durée.
  let since = Date.now();
  let r = await requestSearch(searcher);
  let took = (Date.now() - since) / 1000;
  b.expect(rollsOf(since).length >= 1, `rien à trouver : un jet quand même (${rollsOf(since).length})`);
  b.expect(r && !r.found, "rien à trouver : « rien de spécial »");
  b.expect(Math.abs(took - seconds) < 1.5, `verdict à la fin de la durée : ${took.toFixed(1)} s pour ${seconds} s`);
  // Une cachette DD 1 à portée : trouvée, dans le même temps.
  await searcher.actor.unsetFlag(MODULE_ID, "lastSearch");
  const region = await b.region({ name: "Essai cachette", shapes: [b.rect(3, 1, 1, 1)],
    behaviors: [{ type: `${MODULE_ID}.container`, name: "Essai cachette", system: { rolled: true, sound: "", hidden: { enabled: true, dc: 1, passive: 0 } } }] });
  since = Date.now();
  r = await requestSearch(searcher);
  took = (Date.now() - since) / 1000;
  b.expect(r?.found === 1, `une cachette DD 1 à portée : trouvée (${r?.found ?? "?"})`);
  b.expect(region.behaviors.contents[0].system.hidden.found === true, "et marquée trouvée");
  b.expect(Math.abs(took - seconds) < 1.5, `même temps avec quelque chose à trouver : ${took.toFixed(1)} s pour ${seconds} s`);
  await searcher.actor.unsetFlag(MODULE_ID, "lastSearch");
}

const PARTS = { "portes-secretes": [secretDoors, 9, 3], "piege-zone": [zoneTrap, 8, 6], "piege-avance": [advancedTrap, 10, 7],
  "piege-token": [tokenTrap, 7, 3], "coffre-porte": [trappedThings, 7, 3], butin: [loot, 6, 2], sons: [sounds, 7, 2], fouille: [search, 5, 3] };

/** Une partie (ou la liste). Rend `{ part, checks, error }`. */
export async function selftest({ part=null }={}) {
  if ( !game.user.isGM ) throw new Error("GM only");
  if ( !part ) return { parts: Object.keys(PARTS) };
  const def = PARTS[part];
  if ( !def ) throw new Error(`unknown part ${part} (${Object.keys(PARTS).join(", ")})`);
  const [fn, w, h] = def;
  const scene = canvas.scene;
  const b = bench(scene, freeArea(scene, w, h));
  let error = null;
  // Les sons joués pendant la partie (diffusés ou non), relevés sans les empêcher.
  const Audio = foundry.audio.AudioHelper;
  const play = Audio.play;
  Audio.play = function(data, socketOptions) { b.sounds.push({ src: data?.src, broadcast: !!socketOptions }); return play.call(this, data, socketOptions); };
  try { await fn(b); }
  catch(err) { error = `${err.message}`; console.error(`${MODULE_ID} | selftest ${part}`, err); }
  finally {
    Audio.play = play;
    await cleanup(b).catch(err => { error ??= `cleanup: ${err.message}`; });
  }
  return { part, scene: scene.name, checks: b.checks, error };
}
