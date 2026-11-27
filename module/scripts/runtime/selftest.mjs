/**
 * Passe de test de bout en bout (2026-10-28) : jouée chez le MJ par le connecteur (`api.mcp.selftest`, `tools/selftest.mjs`), sur un
 * coin libre de la scène affichée. Chaque partie pose ses propres documents d'essai (acteurs, tokens, régions, murs marqués
 * `flags.darsh-loot.test`), vérifie la cohérence de ce qui se passe — pas des valeurs de dés : trouvé ⇔ passive ≥ DD, désamorcé ou
 * parti, etc. — et retire tout ce qu'elle a créé, même en cas d'échec. Rien ici ne sert au jeu.
 */
import { MODULE_ID, setting, loc } from "../shared.mjs";
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
import { requestUnlock, convertGroupToken } from "./containers.mjs";
import { requestGroundDrop } from "./drop.mjs";
import { shownCursor, clickCursor } from "./pointer.mjs";
import { testActuate, clickable } from "./mechanisms.mjs";
import { MECHANISM_ZONE } from "../adapter/zone-behaviors.mjs";
import { regionHiddenByTraps } from "../adapter/trapped.mjs";
import { SOUNDS } from "./feedback.mjs";
import { npcSteal } from "./theft.mjs";
import { victimView } from "../adapter/theft.mjs";
import { TOKEN_MENU_HOOK, RESOLUTION_HOOK } from "../adapter/engine.mjs";
import { merchantSource } from "../adapter/sources.mjs";
import { stockView } from "../adapter/shop.mjs";
import { purseValue } from "../core/shop.mjs";
import { requestDeal } from "./shop.mjs";
import { requestAnimate, raisable } from "./necromancy.mjs";
import { TradeWindow } from "../apps/trade-window.mjs";
import { requestShareCoins, sharersOf } from "./share.mjs";
import { isForceable } from "../core/force.mjs";

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

// `>=`: a card created in the very millisecond `since` was taken is after it — with `>`, the mechanism card (2 ms after the click
// when measured) was missed now and then, and the part failed for nothing (bench, 2026-11-27).
const messagesAfter = (since, test=() => true) => game.messages.contents.filter(m => (m.timestamp >= since) && test(m));
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
      // Closing the trap's window passes its turn (runtime/traps.mjs `passTurn`): the combat is removed only once that write has
      // landed — deleted in between, the turn change reached a combat that was gone (a console error of the test, 2026-11-26).
      const trapTurn = combat?.combatant?.id ?? null;
      const wasTrap = !!combat?.combatant && !combat.combatant.token;
      await closeNew(windows);
      if ( combat && wasTrap ) await until(() => combat.combatant?.id !== trapTurn, 5000);
      await sleep(800);
      if ( combat ) await combat.delete().catch(() => {});
      await sleep(500);
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
    // 2026-10-28 : immunités d'objet (poison, psychique, états), sur l'acteur du token.
    const imm = await until(() => trap.actor?.system.traits.di.value.has?.("psychic") && trap.actor.system.traits.ci.value.has?.("charmed"));
    b.expect(imm && trap.actor.system.traits.di.value.has("poison") && !trap.actor.system.traits.ci.value.has("invisible"),
      `immunités d'objet : ${[...trap.actor.system.traits.di.value].join(", ")} / ${[...trap.actor.system.traits.ci.value].length} états`);
    b.expect(!game.actors.get(actor.id)?.system.traits.di.value.has("psychic") || trap.actorLink, "l'acteur du monde n'est pas touché (token non lié)");
    const hp0 = trap.actor.system.attributes.hp.value;
    await trap.actor.applyDamage([{ value: 5, type: "psychic" }, { value: 5, type: "poison" }]);
    b.expect(trap.actor.system.attributes.hp.value === hp0, `5 psychiques + 5 poison : PV inchangés (${hp0} → ${trap.actor.system.attributes.hp.value})`);
    // 2026-10-28 : dessiné au plus à `objectSize` % de sa case.
    const max = setting("objectSize") / 100;
    const m = trap.object?.mesh;
    if ( m && !trap.object.hasDynamicRing ) b.expect((Math.abs(m.width) <= (max * b.G) + 1) && (Math.abs(m.height) <= (max * b.G) + 1),
      `piège dessiné dans ${Math.round(max * 100)} % de sa case (${Math.round(Math.abs(m.width))}×${Math.round(Math.abs(m.height))} pour ${b.G})`);
    else b.note("piège non dessiné ou à anneau : taille à l'écran non vérifiée");
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

/** Un token d'acteur Groupe converti en conteneur par le MJ (2026-10-28) : menu, tuile, région, contenu copié, token retiré. */
async function groupContainer(b) {
  const looter = await b.token(await testCharacter(b), 0, 0);
  const group = await b.actor({ name: "Essai coffre groupe", type: "group", img: "icons/containers/chest/chest-worn-oak-tan.webp",
    system: { currency: { gp: 5 } }, items: [{ name: "Essai gemme", type: "loot", system: { quantity: 2 } }] });
  const token = await b.token(group, 2, 0, { width: 2, height: 1,
    texture: { src: "icons/containers/chest/chest-worn-oak-tan.webp", scaleX: -1.2, scaleY: 1.2, fit: "contain", tint: "#c08040" }, alpha: 0.8 });
  const engine = engineTestApi();
  const menu = engine?.mcp?.menu?.({ tokenId: looter.id, targetId: token.id });
  if ( menu ) b.expect(menu.labels.some(l => /conteneur|container/i.test(l)), `menu du MJ sur le token Groupe : ${menu.labels.join(" | ")}`);
  const tm = token.object?.mesh;
  // Position dans le repère de la scène (l'écran peut défiler entre deux mesures).
  const at = m => canvas.stage.toLocal(m.getGlobalPosition());
  const drawn = tm ? { w: Math.round(tm.width), h: Math.round(tm.height), x: Math.round(at(tm).x), y: Math.round(at(tm).y) } : null;
  const region = await convertGroupToken(token);
  if ( region ) b.created.Region.push(region.id);
  await sleep(500);
  b.expect(!b.scene.tokens.has(token.id), "le token est retiré");
  b.expect(game.actors.has(group.id), "l'acteur Groupe du monde reste");
  const behavior = region?.behaviors.find(x => x.type === `${MODULE_ID}.container`);
  b.expect(behavior, "une région « Conteneur » le remplace");
  const tile = b.scene.tiles.get(region?.getFlag(MODULE_ID, "tile"));
  b.expect(tile?.texture.src === token.texture.src, "une tuile à l'image du token, liée à la région");
  b.expect(tile && (tile.width === 2 * b.G) && (tile.height === b.G), "de l'emprise du token (2 × 1)");
  const same = ["fit", "scaleX", "scaleY", "anchorX", "anchorY", "tint"].filter(k => String(tile?.texture[k]) !== String(token.texture[k]));
  b.expect(tile && !same.length && (tile.alpha === token.alpha), `même visuel (échelle, miroir, ajustement, teinte, opacité)${same.length ? ` — diffère : ${same.join(", ")}` : ""}`);
  await sleep(500);
  const mesh = tile?.object?.mesh;
  if ( mesh && drawn ) {
    const now = { w: Math.round(mesh.width), h: Math.round(mesh.height), x: Math.round(at(mesh).x), y: Math.round(at(mesh).y) };
    // Même image, réduite à `objectSize` % (le token Groupe, lui, n'était pas réduit), même centre.
    const k = setting("objectSize") / 100;
    b.expect((Math.abs(now.w - (drawn.w * k)) <= 1) && (Math.abs(now.h - (drawn.h * k)) <= 1) && (Math.abs(now.x - drawn.x) <= 1) && (Math.abs(now.y - drawn.y) <= 1),
      `même image à ${Math.round(k * 100)} %, même centre : token ${drawn.w}×${drawn.h} en ${drawn.x},${drawn.y} → tuile ${now.w}×${now.h} en ${now.x},${now.y}`);
    // Le réglage change : la tuile se redessine aussitôt.
    const before = setting("objectSize");
    await game.settings.set(MODULE_ID, "objectSize", 100);
    await sleep(400);
    b.expect(Math.abs(Math.round(mesh.width) - drawn.w) <= 1, `réglage à 100 % : taille du token retrouvée (${Math.round(mesh.width)})`);
    await game.settings.set(MODULE_ID, "objectSize", before);
  } else b.note("image non dessinée (fenêtre du MJ en arrière-plan ?) : taille à l'écran non comparée");
  b.expect(behavior?.system.sound === "woodBasic", `son du coffre : ${behavior?.system.sound}`);
  const store = behavior?.system.actor ? fromUuidSync(behavior.system.actor) : null;
  if ( store ) await store.setFlag(MODULE_ID, "test", true);
  b.expect(store?.items.find(i => i.name === "Essai gemme")?.system.quantity === 2, "le coffre reçoit ses objets");
  b.expect(store?.system.currency.gp === 5, "et son argent");
  b.expect(behavior?.system.rolled, "rien n'est tiré par-dessus (contenu du groupe)");
}

/** Fouille au clic gauche (2026-10-28) : « jamais » par défaut, « à portée », « y aller » — le curseur dit ce que le clic fera. */
async function clickLoot(b) {
  const before = setting("clickToLoot");
  b.expect(game.settings.settings.get(`${MODULE_ID}.clickToLoot`)?.default === "off", "par défaut : jamais (clic droit)");
  const looter = await b.token(await testCharacter(b), 0, 0);
  const victim = await b.actor({ name: "Essai cadavre clic", type: "npc", img: "icons/svg/skull.svg",
    system: { attributes: { hp: { value: 10, max: 10 } }, details: { type: { value: "humanoid" }, cr: 1 } },
    items: [{ name: "Essai dague", type: "weapon", system: { quantity: 1, properties: ["gear"] } }] });
  const near = await b.token(victim, 1, 0);
  const far = await b.token(victim, 4, 0);
  for ( const t of [near, far] ) await t.actor.toggleStatusEffect("dead", { active: true, overlay: true });
  await sleep(500);
  looter.object?.control({ releaseOthers: true });
  try {
    const seen = {};
    for ( const mode of ["off", "reach", "walk"] ) {
      await game.settings.set(MODULE_ID, "clickToLoot", mode);
      seen[mode] = { hover: [shownCursor(corpseSource(near)), shownCursor(corpseSource(far))],
        click: [clickCursor(corpseSource(near)), clickCursor(corpseSource(far))] };
    }
    b.expect((seen.off.hover[0] === "loot") && (seen.off.hover[1] === "far"), `jamais : le survol montre toujours la fouille (${seen.off.hover})`);
    b.expect(!seen.off.click[0] && !seen.off.click[1], `jamais : le clic reste à Foundry (${seen.off.click})`);
    b.expect((seen.reach.click[0] === "loot") && (seen.reach.click[1] === "far"), `à portée : ouvre à côté, refuse de loin sans marcher (${seen.reach.click})`);
    b.expect((seen.walk.click[0] === "loot") && (seen.walk.click[1] === "go") && (seen.walk.hover[1] === "go"), `y aller : ouvre à côté, marche de loin (${seen.walk.click})`);
    const engine = engineTestApi();
    const menu = engine?.mcp?.menu?.({ tokenId: looter.id, targetId: far.id });
    if ( menu ) b.expect(menu.labels.some(l => /fouiller|search/i.test(l)), `le clic droit propose toujours la fouille : ${menu.labels.join(" | ")}`);
    looter.object?.release();
    await game.settings.set(MODULE_ID, "clickToLoot", "off");
    b.expect(clickCursor(corpseSource(far)) === "loot", "le MJ sans token sélectionné ouvre encore de loin (préparation)");
  } finally {
    await game.settings.set(MODULE_ID, "clickToLoot", before);
  }
}

/**
 * Mécanismes (étape 13, issue darsh-loot#4) : un levier à bascule (porte, lumière, son ; retour à rebours), « une seule fois », une dalle
 * (un rat ne l'enfonce pas), un levier piégé (visible, ne part pas quand on marche dessus, part au clic, le chemin ne l'évite pas).
 */
async function mechanism(b) {
  const before = { advanced: setting("advancedTraps") };
  await game.settings.set(MODULE_ID, "advancedTraps", false);
  const lights = [];
  const tiles = [];
  try {
    const looter = await b.token(await testCharacter(b), 0, 1);
    const door = await b.wall({ c: [b.pt(7, 0).x, b.pt(7, 0).y, b.pt(7, 2).x, b.pt(7, 2).y], door: 1, ds: 0 });
    const [light] = await b.scene.createEmbeddedDocuments("AmbientLight", [{ ...b.center(6, 3), hidden: true, config: { bright: 10, dim: 20 }, flags: TEST }]);
    lights.push(light.id);
    const lever = await b.region({ name: "Essai levier", shapes: [b.rect(1, 0, 1, 1)], behaviors: [{ type: MECHANISM_ZONE, name: "Essai levier",
      system: { label: "Essai levier", mode: "toggle", actions: [{ type: "door", mode: "open", target: door.uuid }, { type: "light", mode: "on", target: light.uuid },
        { type: "sound", mode: "play", src: SOUNDS.click, volume: 0.3 }] } }] });
    const m = () => lever.behaviors.find(x => x.type === MECHANISM_ZONE);
    // 2026-11-06 : deux visuels — la tuile posée dans la région est trouvée seule, son image de départ sert d'image au repos.
    const UP = "icons/commodities/tech/lever.webp", DOWN = "icons/commodities/tech/levers-colored.webp";
    const [leverTile] = await b.scene.createEmbeddedDocuments("Tile", [{ ...b.center(1, 0), width: b.G, height: b.G, texture: { src: UP }, flags: TEST }]);
    tiles.push(leverTile.id);
    await m().update({ "system.imageOn": DOWN });
    b.expect(clickable(lever), "le levier se clique");
    const d0 = Date.now();
    const s0 = b.sounds.length;
    let out = await testActuate(lever, looter);
    await sleep(500);
    b.expect(out.did && (door.ds === CONST.WALL_DOOR_STATES.OPEN) && !light.hidden && m().system.active,
      `aller : porte ouverte (${door.ds}), lumière allumée (${!light.hidden}), levier abaissé (${m().system.active})`);
    {
      // What the chat holds when the card is missing (seen once in a long pass, 2026-11-27): how many messages since the click, with
      // or without the feedback flag, and how old the newest feedback card of the log is.
      const found = await until(() => feedbackAfter(d0).length);
      const last = game.messages.contents.filter(x => !!x.getFlag(MODULE_ID, "feedback")).at(-1);
      b.expect(found, `aller : carte de retour pour la table (${messagesAfter(d0).length} message(s) depuis le clic, ${feedbackAfter(d0).length} carte(s) ; dernière carte du journal ${last ? `${last.timestamp - d0} ms après le clic, « ${last.content.replace(/<[^>]+>/g, "").trim().slice(0, 60)} »` : "aucune"} ; ${game.messages.size} messages)`);
    }
    b.expect(leverTile.texture.src === DOWN, `aller : la tuile prend l'image « actionnée » (${leverTile.texture.src})`);
    const heard = b.sounds.slice(s0);
    b.expect(heard.some(x => x.broadcast && (x.src === SOUNDS.lever)) && heard.some(x => x.src === SOUNDS.click),
      `aller : bruit de levier diffusé et son de l'action (${heard.map(x => x.src).join(", ")})`);
    out = await testActuate(lever, looter);
    await sleep(500);
    b.expect((door.ds === CONST.WALL_DOOR_STATES.CLOSED) && light.hidden && !m().system.active, "retour : porte refermée, lumière éteinte, levier relevé");
    b.expect(leverTile.texture.src === UP, `retour : la tuile revient à son image de départ (${leverTile.texture.src})`);
    await m().update({ "system.mode": "once", "system.active": false, "system.used": false });
    out = await testActuate(lever, looter);
    const again = await testActuate(lever, looter);
    await sleep(300);
    b.expect(out.did && m().system.used && !again.did, "une seule fois : sert, puis rien ne se passe");

    // Une dalle : un rat ne l'enfonce pas, une créature moyenne oui.
    await door.update({ ds: CONST.WALL_DOOR_STATES.CLOSED });
    await b.region({ name: "Essai dalle", shapes: [b.rect(3, 0, 1, 1)], behaviors: [{ type: MECHANISM_ZONE, name: "Essai dalle",
      system: { label: "Essai dalle", activation: "enter", mode: "always", actions: [{ type: "door", mode: "toggle", target: door.uuid }] } }] });
    const rat = await b.token(await testCreature(b, "Essai rat", "tiny"), 3, 2);
    await b.moveTo(rat, 3, 0);
    await sleep(800);
    b.expect(door.ds === CONST.WALL_DOOR_STATES.CLOSED, "dalle : un rat ne l'enfonce pas");
    const walker = await b.token(await testCreature(b), 2, 2);
    await b.moveTo(walker, 3, 0);
    b.expect(await until(() => door.ds === CONST.WALL_DOOR_STATES.OPEN, 6000), "dalle : une créature moyenne l'enfonce (porte ouverte)");

    // Un levier piégé : visible, ne part qu'au clic.
    const actor = await trapActor(b);
    if ( !actor ) { b.note("compendium du DMG 2024 absent : levier piégé sauté"); return; }
    const trapLever = await b.region({ name: "Essai levier piégé", shapes: [b.rect(5, 0, 1, 1)] });
    const area = await b.region({ name: "Essai couloir", shapes: [b.rect(4, 2, 2, 1)], behaviors: [{ type: TRAP_ZONE, name: "Essai levier piégé",
      system: { actor: actor.uuid, activation: "click", triggerRegion: trapLever.uuid, hidden: { enabled: true, dc: 30, passive: 0 } } }] });
    const trap = () => trapHandle(area.behaviors.find(x => x.type === TRAP_ZONE));
    b.expect(!regionHiddenByTraps(trapLever), "levier piégé : il reste visible (seul le piège est caché)");
    b.expect(clickable(trapLever), "levier piégé : il se clique");
    await b.moveTo(rat, 6, 2);
    await b.moveTo(walker, 5, 0);
    await sleep(800);
    b.expect(trap().trap.armed, "levier piégé : marcher dessus ne le fait pas partir");
    await area.behaviors.find(x => x.type === TRAP_ZONE).update({ "system.hidden.found": true });
    await sleep(800);
    b.expect(!engineAvoids(trapLever), "levier piégé repéré : le chemin du moteur ne l'évite pas");
    await b.moveTo(walker, 4, 2);
    out = await testActuate(trapLever, looter);
    b.expect(out.fired === 1 && !trap().trap.armed, `levier piégé : le clic le fait partir (${out.fired})`);
  } finally {
    if ( lights.length ) await b.scene.deleteEmbeddedDocuments("AmbientLight", lights.filter(id => b.scene.lights.has(id))).catch(() => {});
    if ( tiles.length ) await b.scene.deleteEmbeddedDocuments("Tile", tiles.filter(id => b.scene.tiles.has(id))).catch(() => {});
    await game.settings.set(MODULE_ID, "advancedTraps", before.advanced);
  }
}


/**
 * Vol par un PNJ (0.21.0, issue #5) : entrée du MJ (hors combat, puis en combat avec sa raison), objet porté impossible, échec vu de tous
 * (carte, texte flottant sur les deux tokens, son), un seul essai, réussite secrète (objet marqué volé chez le PNJ, bilan chuchoté au MJ),
 * poignée de la bourse, vrai jet caché, et l'objet repris sur le cadavre du voleur redevient honnête.
 */
async function npcTheft(b) {
  const pc = await b.token(await b.actor({ name: "Essai volé", type: "character", img: "icons/svg/mystery-man.svg",
    system: { abilities: { wis: { value: 10 } }, attributes: { hp: { value: 30, max: 30 } }, currency: { gp: 100 } },
    items: [
      { name: "Essai gemme", type: "loot", system: { quantity: 1, weight: { value: 0, units: "lb" }, price: { value: 5, denomination: "gp" } } },
      { name: "Essai fiole", type: "consumable", system: { quantity: 1, weight: { value: 1, units: "lb" }, price: { value: 1, denomination: "gp" } } },
      { name: "Essai bague", type: "loot", system: { quantity: 1, weight: { value: 0, units: "lb" }, price: { value: 1, denomination: "sp" } } },
      { name: "Essai épée portée", type: "weapon", system: { quantity: 1, equipped: true, type: { value: "martialM", baseItem: "longsword" } } }
    ], prototypeToken: { actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY } }), 0, 0);
  const thief = await b.token(await testCreature(b, "Essai voleur"), 1, 0);
  const item = name => pc.actor.items.find(i => i.name === name);

  const labels = () => { const e = []; Hooks.callAll(TOKEN_MENU_HOOK, e, { token: thief, target: pc, aggressive: false }); return e.map(x => x.label); };
  b.expect(labels().some(l => l.includes(pc.name) && !l.includes("(")), `menu du MJ hors combat : ${labels().join(" | ")}`);
  const combat = await Combat.implementation.create({ scene: b.scene.id, active: true });
  b.created.combats.push(combat.id);
  await combat.createEmbeddedDocuments("Combatant", [{ tokenId: thief.id, sceneId: b.scene.id }]);
  await combat.startCombat();
  await sleep(300);
  b.expect(labels().some(l => l.includes(pc.name) && l.includes("(")), `menu du MJ en combat, avec sa raison : ${labels().join(" | ")}`);
  const refused = await npcSteal({ thief, victim: pc, itemId: item("Essai gemme").id, total: 99 });
  b.expect(refused.ok === null, "en combat : vol refusé (sans `allowCombat`)");
  await combat.delete();
  await sleep(300);

  const view = victimView(pc.actor, thief.actor.id);
  const sword = view.entries.find(e => e.name === "Essai épée portée");
  b.expect(sword && !sword.possible, "un objet porté ne se vole pas");
  b.expect(view.entries.find(e => e.name === "Essai gemme")?.dc >= 10, `DD affiché au MJ (${view.entries.find(e => e.name === "Essai gemme")?.dc})`);

  // Échec : tout le monde le voit et l'entend.
  let since = Date.now() - 1;
  const fail = await npcSteal({ thief, victim: pc, itemId: item("Essai gemme").id, total: 1 });
  await sleep(500);
  b.expect(fail.ok === false && !!item("Essai gemme"), `échec (1 contre DD ${fail.dc}) : la gemme reste au personnage`);
  const card = feedbackAfter(since)[0];
  b.expect(card && !card.whisper.length && (card.getFlag(MODULE_ID, "feedback").also ?? []).some(o => o.token === pc.uuid),
    "échec : carte publique, texte flottant sur le voleur et sur la victime");
  b.expect(b.sounds.some(x => (x.src === SOUNDS.failure) && x.broadcast), "échec : son diffusé à tous");
  const again = await npcSteal({ thief, victim: pc, itemId: item("Essai gemme").id, total: 99 });
  b.expect(again.ok === null, "un seul essai par objet et par voleur");

  // Réussite : secret, l'objet passe marqué volé.
  since = Date.now() - 1;
  const win = await npcSteal({ thief, victim: pc, itemId: item("Essai fiole").id, total: 99 });
  await sleep(500);
  const got = thief.actor.items.find(i => i.name === "Essai fiole");
  b.expect(win.ok === true && !item("Essai fiole") && !!got, `réussite (99 contre DD ${win.dc}) : la fiole passe au voleur`);
  b.expect(got?.getFlag(MODULE_ID, "stolen")?.fromUuid === pc.actor.uuid, "elle porte la marque « volé à » le personnage");
  b.expect(got?.system.properties?.has("gear"), "elle est de l'équipement du PNJ (fouillable, volable)");
  const after = messagesAfter(since);
  b.expect(!feedbackAfter(since).length && after.some(m => m.getFlag(MODULE_ID, "npcStole") && m.whisper.length),
    "réussite : aucune carte publique, bilan chuchoté au MJ");

  // Bourse : une poignée (10 à 40 %).
  const coins = await npcSteal({ thief, victim: pc, itemId: "coins", total: 99 });
  const left = pc.actor.system.currency.gp;
  b.expect(coins.ok === true && (left >= 60) && (left <= 90), `bourse : une poignée prise (il reste ${left} po sur 100)`);
  b.expect((coins.what ?? []).join() === `${100 - left} ${CONFIG.DND5E.currencies.gp?.abbreviation ?? "gp"}`, `bourse : le bilan dit ce qui est pris (${(coins.what ?? []).join(", ")})`);

  // Un vrai jet caché : le verdict suit le total et le DD.
  const real = await npcSteal({ thief, victim: pc, itemId: item("Essai bague").id });
  b.expect((real.ok === true) === (real.total >= real.dc), `vrai jet : ${real.total} contre DD ${real.dc} → ${real.ok ? "réussi" : "raté"}`);

  // L'objet repris sur le cadavre du voleur redevient honnête.
  await thief.actor.toggleStatusEffect("dead", { active: true, overlay: true });
  await sleep(500);
  await requestTake(corpseSource(thief), pc, { itemIds: [got.id] });
  await sleep(500);
  const back = item("Essai fiole");
  b.expect(back && !back.getFlag(MODULE_ID, "stolen"), "la fiole reprise au cadavre du voleur n'est plus marquée volée");
}

/* -------------------------------------------- */
/*  Lot 0 (2026-11-26): shop, trade, necromancy, thrown weapons */
/* -------------------------------------------- */

/** GM-whispered traces of failed operations written since `since` (adapter/ledger.mjs, runtime/operations.mjs). */
const tracesAfter = since => messagesAfter(since, m => !!m.getFlag(MODULE_ID, "operation"));
/** The value of a purse in copper. */
const inCp = actor => purseValue(actor.system.currency);
/** Makes the next `update` of this document fail like a server error, once: what a write that breaks half-way looks like. */
function failNextUpdate(doc) {
  const real = doc.update;
  doc.update = async function() { doc.update = real; throw new Error("selftest: simulated server error"); };
  return () => { doc.update = real; };
}
/** A non-GM user to send requests as (the GM client only checks rights for those); null if the world has none. */
const somePlayer = () => game.users.find(u => !u.isGM) ?? null;

/** Shop: a deal moves goods and coins; an item that cannot be handed over is never charged; a failed write is undone and traced. */
async function shop(b) {
  const merchant = await b.token(await b.actor({ name: "Test merchant", type: "npc", img: "icons/svg/mystery-man.svg",
    system: { attributes: { hp: { value: 20, max: 20 } }, details: { type: { value: "humanoid" } }, currency: { gp: 50 } },
    flags: { [MODULE_ID]: { test: true, merchant: { enabled: true } } },
    items: [
      { name: "Test rope", type: "loot", system: { quantity: 3, price: { value: 10, denomination: "gp" }, properties: ["gear"] } },
      { name: "Test heirloom", type: "loot", system: { quantity: 1, price: { value: 2, denomination: "gp" } } }
    ] }), 1, 0);
  const buyerActor = await testCharacter(b, "Test buyer");
  await buyerActor.update({ "system.currency.gp": 100 });
  await buyerActor.createEmbeddedDocuments("Item", [
    { name: "Test gem", type: "loot", system: { quantity: 1, price: { value: 50, denomination: "gp" } } },
    { name: "Test ring", type: "equipment", system: { quantity: 1, price: { value: 20, denomination: "gp" }, attunement: "required", attuned: true } }]);
  const buyer = await b.token(buyerActor, 0, 0);
  const source = merchantSource(merchant);
  const stall = name => merchant.actor.items.find(i => i.name === name);
  const bag = name => buyer.actor.items.find(i => i.name === name);

  // Defect 1: the heirloom has no `gear` property — the merchant (an NPC) cannot hand it over.
  const seenByPlayer = stockView(merchant.actor, buyer.actor).map(e => e.name);
  const seenByGM = stockView(merchant.actor, buyer.actor, { gm: true });
  b.expect(seenByPlayer.includes("Test rope") && !seenByPlayer.includes("Test heirloom"), `a player is not offered what cannot be handed over (${seenByPlayer.join(", ")})`);
  b.expect(seenByGM.find(e => e.name === "Test heirloom")?.stuck === true, "the GM still sees it, marked");
  let total = inCp(buyer.actor) + inCp(merchant.actor);
  const refusedDeal = await requestDeal(source, buyer, { buy: [{ id: stall("Test heirloom").id, quantity: 1 }], sell: [] });
  b.expect(refusedDeal === null && !bag("Test heirloom") && (inCp(buyer.actor) + inCp(merchant.actor) === total) && (inCp(buyer.actor) === 10000),
    "buying it is refused before any write: nothing charged, nothing moved");

  // A normal deal: one rope bought, the gem and the attuned ring sold.
  const done = await requestDeal(source, buyer, { buy: [{ id: stall("Test rope").id, quantity: 1 }],
    sell: [{ id: bag("Test gem").id, quantity: 1 }, { id: bag("Test ring").id, quantity: 1 }] });
  await sleep(500);
  b.expect(!!done && (bag("Test rope")?.system.quantity === 1) && (stall("Test rope")?.system.quantity === 2), `deal done: one rope bought (${JSON.stringify(done)})`);
  b.expect(!bag("Test gem") && !!stall("Test gem") && (stall("Test gem").getFlag(MODULE_ID, "shop")?.bought === true), "the gem sold is on the stall, marked as bought back");
  b.expect(inCp(buyer.actor) + inCp(merchant.actor) === total, `no coin created or lost (${inCp(buyer.actor)} + ${inCp(merchant.actor)} cp)`);
  b.expect(stall("Test ring") && (stall("Test ring").system.attuned === false), "the ring sold is no longer attuned (defect 14)");

  // Defect 3: the buyer's purse cannot be written — goods go back on both sides, the GM reads why.
  const ropes = actor => actor.items.filter(i => i.name === "Test rope").reduce((n, i) => n + (i.system.quantity ?? 1), 0);
  const before = { rope: ropes(merchant.actor), mine: ropes(buyer.actor), buyer: inCp(buyer.actor), merchant: inCp(merchant.actor) };
  const since = Date.now() - 1;
  const restore = failNextUpdate(buyer.actor);
  const failed = await requestDeal(source, buyer, { buy: [{ id: stall("Test rope").id, quantity: 1 }], sell: [] });
  restore();
  await sleep(500);
  b.expect(failed === null && (ropes(merchant.actor) === before.rope) && (ropes(buyer.actor) === before.mine),
    `a purse write that fails: the rope is back on the stall (${ropes(merchant.actor)}) and not with the buyer (${ropes(buyer.actor)})`);
  b.expect((inCp(buyer.actor) === before.buyer) && (inCp(merchant.actor) === before.merchant), "and nobody paid");
  const trace = tracesAfter(since)[0];
  b.expect(trace && trace.whisper.length && trace.whisper.every(id => game.users.get(id)?.isGM), "the GM gets a whispered trace of the failed deal");
  b.expect(Object.keys(game.settings.get(MODULE_ID, "operations") ?? {}).length === 0, "the operations journal is empty afterwards");

  // Defect 10: a crafted request naming the merchant's **actor** from a player — refused unless the GM showed the shop.
  const player = somePlayer();
  if ( player ) {
    const crafted = { source: { kind: "merchant", uuid: merchant.actor.uuid }, looter: buyer.uuid, buy: [{ id: stall("Test rope").id, quantity: 1 }], sell: [] };
    const outcome = await CONFIG.queries[`${MODULE_ID}.shopDeal`](crafted, { user: player }).then(() => "accepted", err => err.message);
    b.expect(outcome !== "accepted" && (ropes(buyer.actor) === before.mine), `a shop addressed by its actor, not shown by the GM: refused (« ${outcome} »)`);
  } else b.note("no player user in this world: the actor-addressed deal is not played");
}

/** Trade: only what can be traded is offered, an agreement is bound to what was shown, the exchange is whole or undone. */
async function trade(b) {
  const player = somePlayer();
  if ( !player ) return b.note("no player user in this world: trades are not played");
  const query = name => CONFIG.queries[`${MODULE_ID}.trade${name}`];
  const before = new Set(foundry.applications.instances.keys());
  const owned = { [player.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
  const alice = await b.actor({ name: "Test Alice", type: "character", img: "icons/svg/mystery-man.svg", ownership: owned,
    system: { attributes: { hp: { value: 20, max: 20 } }, currency: { gp: 100 } } });
  const [sack] = await alice.createEmbeddedDocuments("Item", [{ name: "Test sack", type: "container", system: { quantity: 1 } }]);
  await alice.createEmbeddedDocuments("Item", [
    { name: "Test potion", type: "consumable", system: { quantity: 2, container: sack.id } },
    { name: "Test amulet", type: "equipment", system: { quantity: 1, attunement: "required", attuned: true } },
    { name: "Test armor", type: "equipment", system: { quantity: 1, equipped: true } },
    { name: "Test cantrip", type: "spell", system: { level: 0 } }]);
  const bob = await b.actor({ name: "Test Bob", type: "character", img: "icons/svg/mystery-man.svg",
    system: { attributes: { hp: { value: 20, max: 20 } }, currency: { gp: 10 } },
    items: [{ name: "Test arrows", type: "consumable", system: { quantity: 20 } }] });
  const npc = await testCreature(b, "Test bystander");
  const of = (actor, name) => actor.items.find(i => i.name === name);
  const gm = game.user;

  // Defect 13: the other side must be a player character.
  const toNpc = await query("Open")({ from: alice.uuid, to: npc.uuid }, { user: player }).then(() => "accepted", err => err.message);
  b.expect(toNpc !== "accepted", `a trade with an NPC is refused (« ${toNpc} »)`);

  const { id } = await query("Open")({ from: alice.uuid, to: bob.uuid }, { user: player });
  await sleep(600);
  const shown = () => TradeWindow.open.get(id)?.trade;
  b.expect(!!shown() && (shown().gm === gm.id), "the trade window opens at the GM, who holds the other side; the state names the GM client holding it");

  // Defects 2 and 12: the potion is inside the sack (it leaves with it), the armor is worn, the cantrip is not an object.
  const offer = ["Test sack", "Test potion", "Test amulet", "Test armor", "Test cantrip"].map(n => ({ id: of(alice, n).id, quantity: of(alice, n).system.quantity ?? 1 }));
  const answer = await query("Update")({ id, offer: { items: offer, coins: { gp: 30 } } }, { user: player });
  await sleep(300);
  const kept = shown().a.items.map(i => i.name).sort();
  b.expect(kept.join() === ["Test amulet", "Test sack"].join(), `offer kept: the sack and the amulet only (${kept.join(", ")})`);
  b.expect((answer.left ?? []).sort().join() === ["Test armor", "Test cantrip"].join(), `the player is told what was left out (${(answer.left ?? []).join(", ")})`);
  await query("Update")({ id, offer: { items: [{ id: of(bob, "Test arrows").id, quantity: 5 }], coins: {} } }, { user: gm });
  await sleep(300);

  // Defect 11: Alice agrees, then changes her offer; the GM's side agrees to the revision it was shown — refused.
  const seen = shown().rev;
  await query("Accept")({ id, value: true, rev: seen }, { user: player });
  await query("Update")({ id, offer: { items: shown().a.items.map(i => ({ id: i.id, quantity: i.quantity })), coins: { gp: 1 } } }, { user: player });
  const stale = await query("Accept")({ id, value: true, rev: seen }, { user: gm }).then(() => "accepted", err => err.message);
  b.expect(stale !== "accepted" && (alice.system.currency.gp === 100), `agreeing to an offer that changed meanwhile is refused (« ${stale} »)`);

  // Defect 3: the exchange breaks at its last write — everything goes back, both agreements fall, the GM reads why.
  await query("Update")({ id, offer: { items: shown().a.items.map(i => ({ id: i.id, quantity: i.quantity })), coins: { gp: 30 } } }, { user: player });
  await query("Accept")({ id, value: true, rev: shown().rev }, { user: player });
  let since = Date.now() - 1;
  const restore = failNextUpdate(bob);
  const broken = await query("Accept")({ id, value: true, rev: shown().rev }, { user: gm }).then(() => "accepted", err => err.message);
  restore();
  await sleep(600);
  b.expect(broken !== "accepted" && !!of(alice, "Test sack") && !of(bob, "Test sack") && (of(alice, "Test potion")?.system.container === of(alice, "Test sack")?.id),
    `a write that fails in the middle: the sack is back with its potion inside (« ${broken} »)`);
  b.expect((alice.system.currency.gp === 100) && (bob.system.currency.gp === 10) && (of(bob, "Test arrows")?.system.quantity === 20) && !of(alice, "Test arrows"),
    `coins and arrows are back too (${alice.system.currency.gp} / ${bob.system.currency.gp} gp, ${of(bob, "Test arrows")?.system.quantity} arrows)`);
  b.expect(tracesAfter(since).length === 1, "the GM gets one trace of the failed trade");
  b.expect(shown() && !shown().a.accepted && !shown().b.accepted && !shown().done, "the trade is still open, both agreements withdrawn");

  // The trade itself.
  await query("Accept")({ id, value: true, rev: shown().rev }, { user: player });
  await query("Accept")({ id, value: true, rev: shown().rev }, { user: gm });
  await sleep(800);
  const sackAtBob = of(bob, "Test sack");
  b.expect(!!sackAtBob && !of(alice, "Test sack") && (of(bob, "Test potion")?.system.container === sackAtBob?.id) && (of(bob, "Test potion")?.system.quantity === 2) && !of(alice, "Test potion"),
    "done: the sack went with its two potions inside, once (defect 2)");
  b.expect(of(bob, "Test amulet")?.system.attuned === false, "the amulet arrived unattuned (defect 14)");
  b.expect((alice.system.currency.gp === 70) && (bob.system.currency.gp === 40) && (of(alice, "Test arrows")?.system.quantity === 5) && (of(bob, "Test arrows")?.system.quantity === 15),
    `coins and arrows exchanged (${alice.system.currency.gp} / ${bob.system.currency.gp} gp)`);
  b.expect(!!of(alice, "Test armor") && !!of(alice, "Test cantrip"), "the worn armor and the cantrip never left");

  // Defect 8: a GM client that has just loaded tells the players it holds no trade — a window still open closes, with the reason.
  const again = await query("Open")({ from: alice.uuid, to: bob.uuid }, { user: player });
  await sleep(600);
  const open = !!TradeWindow.open.get(again.id);
  b.expect(CONFIG.queries[`${MODULE_ID}.tradeReset`]({}, { user: player }) === false && !!TradeWindow.open.get(again.id), "a player cannot make trade windows close");
  CONFIG.queries[`${MODULE_ID}.tradeReset`]({}, { user: gm });
  await sleep(600);
  b.expect(open && !TradeWindow.open.get(again.id), "« this GM client holds no trade »: the window of a lost trade closes instead of staying dead");
  await query("Cancel")({ id: again.id }, { user: gm }).catch(() => {});
  await closeNew(before);
}

/** Necromancy: one undead per corpse, belongings on the ground, and a raising that fails leaves the corpse. */
async function necromancy(b) {
  const corpseOf = async (name, i) => {
    const actor = await b.actor({ name, type: "npc", img: "icons/svg/skull.svg",
      system: { attributes: { hp: { value: 0, max: 10 } }, traits: { size: "med" }, details: { type: { value: "humanoid" }, cr: 0 }, currency: { gp: 7 } },
      flags: { [MODULE_ID]: { test: true, rolled: true } },
      items: [{ name: "Test dagger", type: "weapon", system: { quantity: 1, properties: ["gear"], type: { value: "simpleM", baseItem: "dagger" } } }] });
    const token = await b.token(actor, i, 0);
    await token.actor.toggleStatusEffect("dead", { active: true, overlay: true });
    await sleep(400);
    return token;
  };
  const raisedFrom = name => game.actors.filter(a => a.getFlag(MODULE_ID, "raised")?.from === name);
  const track = name => {
    for ( const a of raisedFrom(name) ) if ( !b.created.actors.includes(a.id) ) b.created.actors.push(a.id);
    for ( const t of b.scene.tokens ) if ( raisedFrom(name).includes(t.actor) && !b.created.Token.includes(t.id) ) b.created.Token.push(t.id);
    for ( const r of b.scene.regions ) {
      if ( !r.getFlag(MODULE_ID, "pile") || b.created.Region.includes(r.id) ) continue;
      b.created.Region.push(r.id);
      const store = fromUuidSync(r.behaviors.contents[0]?.system.actor ?? "", { strict: false });
      if ( store ) b.created.actors.push(store.id);
    }
  };
  const first = await corpseOf("Test corpse one", 0);
  if ( !raisable(first) ) return b.expect(false, "a dead Medium humanoid can be raised");
  const pilesBefore = b.scene.regions.filter(r => r.getFlag(MODULE_ID, "pile")).length;

  // Defect 3: the corpse cannot be removed — no undead stays, the corpse does; its belongings fell and stay in their pile.
  let since = Date.now() - 1;
  const realDelete = first.delete;
  first.delete = async function() { first.delete = realDelete; throw new Error("selftest: simulated server error"); };
  const failed = await requestAnimate(first, { kind: "skeleton" });
  first.delete = realDelete;
  await sleep(800);
  track("Test corpse one");
  if ( (failed === null) && !game.packs.get("dnd-monster-manual.actors")?.index?.size && !game.packs.get("dnd5e.actors24")?.index?.size ) {
    return b.note("neither the Monster Manual nor the SRD 2024 creatures are here: raising is not played");
  }
  b.expect(failed === null && b.scene.tokens.has(first.id), "a raising that breaks at its last write: the corpse is still on the scene");
  b.expect(raisedFrom("Test corpse one").length === 0 && !b.scene.tokens.some(t => t.actor?.getFlag(MODULE_ID, "raised")?.from === "Test corpse one"),
    "and no undead actor nor token is left behind");
  const trace = tracesAfter(since)[0];
  b.expect(!!trace && trace.whisper.every(id => game.users.get(id)?.isGM), "the GM gets a trace of the failed raising");
  const piles = b.scene.regions.filter(r => r.getFlag(MODULE_ID, "pile"));
  const store = fromUuidSync(piles.at(-1)?.behaviors.contents[0]?.system.actor ?? "", { strict: false });
  b.expect((piles.length === pilesBefore + 1) && store?.items.some(i => i.name === "Test dagger") && (store.system.currency.gp === 7),
    "its belongings are not lost: dagger and coins are in the pile at its feet (the trace says so)");

  // Defect 6: two requests on the same corpse at once — one undead, with its token, the corpse replaced.
  const second = await corpseOf("Test corpse two", 2);
  const results = await Promise.all([requestAnimate(second, { kind: "zombie" }), requestAnimate(second, { kind: "zombie" })]);
  await sleep(1000);
  track("Test corpse two");
  const undead = raisedFrom("Test corpse two");
  b.expect(results.filter(Boolean).length === 1, `two requests at once: one is carried out, the other refused (${results.map(r => (r ? "done" : "refused")).join(", ")})`);
  b.expect(undead.length === 1, `one undead actor (${undead.length})`);
  const placed = b.scene.tokens.filter(t => undead.includes(t.actor));
  b.expect((placed.length === 1) && !b.scene.tokens.has(second.id) && (placed[0]?._source.x === second._source.x) && (placed[0]?._source.y === second._source.y),
    "one token, where the corpse was; the corpse is gone");
  b.expect(Object.keys(game.settings.get(MODULE_ID, "operations") ?? {}).length === 0, "the operations journal is empty afterwards");
}

/** Thrown weapons: read from the Core's resolution — lodged or at the target's feet on a hit, beyond it on a miss. */
async function thrown(b) {
  if ( !setting("thrownWeapons") ) return b.note("thrown weapons are switched off in this world: not played");
  const thrower = await b.token(await b.actor({ name: "Test thrower", type: "character", img: "icons/svg/mystery-man.svg",
    system: { attributes: { hp: { value: 20, max: 20 } } },
    items: [
      { name: "Test javelin", type: "weapon", system: { quantity: 4, properties: ["thr"], type: { value: "simpleM", baseItem: "javelin" }, range: { value: 30, long: 120, reach: 5 },
        activities: { testthrowact0001: { _id: "testthrowact0001", type: "attack" } } } },
      { name: "Test returning axe", type: "weapon", system: { quantity: 1, properties: ["thr", "ret"], type: { value: "simpleM" }, range: { value: 20, long: 60, reach: 5 },
        activities: { testthrowact0002: { _id: "testthrowact0002", type: "attack" } } } }
    ], prototypeToken: { actorLink: true } }), 0, 1);
  const target = await b.token(await testCreature(b, "Test target"), 4, 1);
  const item = name => thrower.actor.items.find(i => i.name === name);
  const pilesNow = () => b.scene.regions.filter(r => r.getFlag(MODULE_ID, "pile"));
  const storeOf = region => fromUuidSync(region.behaviors.contents[0]?.system.actor ?? "", { strict: false });
  const track = () => { for ( const r of pilesNow() ) if ( !b.created.Region.includes(r.id) ) { b.created.Region.push(r.id); const s = storeOf(r); if ( s ) b.created.actors.push(s.id); } };
  const javelinsOnGround = () => pilesNow().reduce((sum, r) => sum + (storeOf(r)?.items.filter(i => i.name === "Test javelin").reduce((n, i) => n + (i.system.quantity ?? 1), 0) ?? 0), 0);
  const lodged = () => target.actor.items.filter(i => i.name === "Test javelin").reduce((n, i) => n + (i.system.quantity ?? 1), 0);

  /** A finished thrown attack as the Core publishes it: its attack roll carries the mode, the resolution the targets. */
  let count = 0;
  async function throwAt(weapon, hit) {
    const activity = weapon.system.activities?.contents?.[0] ?? [...(weapon.system.activities ?? [])][0];
    const roll = await new Roll("1d20", {}, { attackMode: "thrown" }).evaluate({ allowInteractive: false });
    const message = await ChatMessage.implementation.create({ content: "selftest: thrown attack", rolls: [roll], whisper: [game.user.id],
      speaker: { scene: b.scene.id, token: thrower.id, actor: thrower.actor.id }, flags: TEST });
    Hooks.callAll(RESOLUTION_HOOK, { id: `selftest-${Date.now()}-${++count}`, activity: activity?.uuid, source: thrower.actor.uuid, plan: { attack: true },
      step: hit ? "done" : "missed", attack: { messageId: message.id }, targets: [{ token: target.uuid, hit }], origin: null });
    await sleep(1800);
    track();
    await message.delete().catch(() => {});
  }
  if ( !(item("Test javelin").system.activities?.size > 0) ) return b.note("the test javelin has no attack activity in this dnd5e version: not played");

  // A miss: the javelin lands beyond the target, in a pile — never in the target, never lost.
  await throwAt(item("Test javelin"), false);
  b.expect((javelinsOnGround() === 1) && (lodged() === 0), `a miss: one javelin on the ground beyond the target (${javelinsOnGround()} on the ground, ${lodged()} lodged)`);
  const miss = pilesNow().find(r => storeOf(r)?.items.some(i => i.name === "Test javelin"));
  const G = b.G;
  const beyond = miss ? (miss.bounds.x - target._source.x) / G : null;
  b.expect(miss && (beyond > -1.5) && (beyond < 4.5), `it fell within three squares beyond the target (${beyond?.toFixed(1)} squares)`);

  // Hits: lodged in the target (its inventory) or at its feet — one javelin each time, wherever it goes.
  for ( let i = 0; i < 3; i++ ) await throwAt(item("Test javelin"), true);
  b.expect(javelinsOnGround() + lodged() === 4, `three hits: every javelin is somewhere (${javelinsOnGround()} on the ground, ${lodged()} lodged in the target)`);
  b.expect(item("Test javelin")?.system.quantity === 4, "the thrower's sheet is not decremented a second time (dnd5e already removes the thrown one)");

  // A returning weapon comes back to the hand: nothing falls.
  const before = javelinsOnGround() + pilesNow().reduce((n, r) => n + (storeOf(r)?.items.size ?? 0), 0);
  await throwAt(item("Test returning axe"), true);
  const after = javelinsOnGround() + pilesNow().reduce((n, r) => n + (storeOf(r)?.items.size ?? 0), 0);
  b.expect((after === before) && !target.actor.items.some(i => i.name === "Test returning axe"), "a returning weapon: nothing on the ground, nothing lodged");
}

/* -------------------------------------------- */
/*  Lot 1 — sharing (2026-11-27)                */
/* -------------------------------------------- */

/**
 * A primary party of test characters for the time of a part: three player characters, the third one without a token (absent).
 * Returns the tokens, the actors and `restore()`, which puts back the world's own primary party and the sharing settings.
 */
async function testParty(b) {
  const previous = { party: game.settings.get("dnd5e", "primaryParty")?.actor?.id ?? null,
    shareWith: setting("shareWith"), shareRemainder: setting("shareRemainder") };
  const pcs = [await testCharacter(b, "Test sharer"), await testCharacter(b, "Test companion"), await testCharacter(b, "Test absent")];
  const group = await b.actor({ name: "Test party", type: "group", img: "icons/svg/mystery-man.svg",
    system: { members: pcs.map(a => ({ actor: a.id })) } });
  await game.settings.set("dnd5e", "primaryParty", { actor: group.id });
  await game.settings.set(MODULE_ID, "shareWith", "party");
  await game.settings.set(MODULE_ID, "shareRemainder", "source");
  const tokens = [await b.token(pcs[0], 0, 0), await b.token(pcs[1], 0, 1)];
  return { pcs, tokens, group, async restore() {
    await game.settings.set("dnd5e", "primaryParty", { actor: previous.party });
    await game.settings.set(MODULE_ID, "shareWith", previous.shareWith);
    await game.settings.set(MODULE_ID, "shareRemainder", previous.shareRemainder);
  } };
}

/** A dead test NPC with this purse and these items, already « rolled » (no treasure added), on square (i, j). */
async function testCorpse(b, name, i, j, { currency={}, items=[] }={}) {
  const actor = await b.actor({ name, type: "npc", img: "icons/svg/skull.svg",
    system: { attributes: { hp: { value: 0, max: 10 } }, details: { type: { value: "humanoid" }, cr: 1 }, currency },
    flags: { [MODULE_ID]: { test: true, rolled: true } }, items });
  const token = await b.token(actor, i, j);
  await token.actor.toggleStatusEffect("dead", { active: true, overlay: true });
  await sleep(400);
  return token;
}

/** Share the coins: split between the party, seen and heard by all, whole or undone, forceable when too far. */
async function shareCoinsPart(b) {
  const party = await testParty(b);
  try {
    const [looter] = party.tokens;
    const purse = a => ({ gp: a.system.currency.gp ?? 0, sp: a.system.currency.sp ?? 0 });
    const golds = () => party.pcs.map(a => purse(a).gp);
    const corpse = await testCorpse(b, "Test rich corpse", 1, 0, { currency: { gp: 10, sp: 7 } });
    const source = corpseSource(corpse);

    const names = sharersOf(source, looter).map(a => a.name);
    b.expect(names.length === 3, `the party of the share: the three characters of the primary party, the absent one included (${names.join(", ")})`);
    const menu = engineTestApi()?.mcp?.menu?.({ tokenId: looter.id, targetId: corpse.id });
    if ( menu ) b.expect(menu.labels.includes(loc("Share.MenuCoins")), `right-click menu of the corpse: ${menu.labels.join(" | ")}`);
    else b.note("the Core's test API is not there: the menu entry is not read");

    let since = Date.now() - 1;
    const sounds = b.sounds.length;
    const shared = await requestShareCoins(source, looter);
    await sleep(600);
    b.expect(!!shared && golds().join() === "3,3,3" && party.pcs.every(a => purse(a).sp === 2),
      `10 gp 7 sp between three: 3 gp 2 sp each (${JSON.stringify(party.pcs.map(purse))})`);
    b.expect(purse(corpse.actor).gp === 1 && purse(corpse.actor).sp === 1, `what does not divide stays on the corpse (${JSON.stringify(purse(corpse.actor))})`);
    const card = messagesAfter(since, m => !!m.getFlag(MODULE_ID, "share"))[0];
    b.expect(card && !card.whisper.length && !!card.getFlag(MODULE_ID, "feedback"), "one public card, with the floating text over the members");
    b.expect(card?.getFlag(MODULE_ID, "shareFx")?.to?.length === 2, "the coins fly to the two members who are on the scene");
    b.expect(b.sounds.slice(sounds).some(x => x.broadcast && (x.src === SOUNDS.coins)), "the coins are heard by everyone");

    // « Only those on the scene », and the remainder to the one who shares.
    await game.settings.set(MODULE_ID, "shareWith", "scene");
    await game.settings.set(MODULE_ID, "shareRemainder", "sharer");
    const second = corpseSource(await testCorpse(b, "Test second corpse", 1, 1, { currency: { gp: 5 } }));
    await requestShareCoins(second, looter);
    await sleep(500);
    b.expect(golds().join() === "6,5,3" && purse(second.actor).gp === 0,
      `setting « on the scene » + « remainder to the sharer »: 5 gp between two present, the sharer keeps the odd one (${golds().join(", ")})`);
    await game.settings.set(MODULE_ID, "shareWith", "party");
    await game.settings.set(MODULE_ID, "shareRemainder", "source");

    // A write that fails half-way: everything goes back, the GM reads why.
    const third = corpseSource(await testCorpse(b, "Test third corpse", 2, 0, { currency: { gp: 9 } }));
    const before = golds().join();
    since = Date.now() - 1;
    const restore = failNextUpdate(party.pcs[2]);
    const failed = await requestShareCoins(third, looter);
    restore();
    await sleep(500);
    b.expect(failed === null && golds().join() === before && purse(third.actor).gp === 9, `a write that fails: every coin is back (${golds().join(", ")}, corpse ${purse(third.actor).gp} gp)`);
    b.expect(tracesAfter(since).length === 1, "the GM gets one whispered trace of the failed share");
    b.expect(Object.keys(game.settings.get(MODULE_ID, "operations") ?? {}).length === 0, "the operations journal is empty afterwards");

    // From a player: too far is refused with a reason that can be forced; forced, it is done and the GM is told.
    const player = somePlayer();
    if ( player ) {
      const far = corpseSource(await testCorpse(b, "Test far corpse", 5, 0, { currency: { gp: 6 } }));
      const payload = { source: { kind: "corpse", uuid: far.uuid }, looter: looter.uuid };
      const query = CONFIG.queries[`${MODULE_ID}.shareCoins`];
      const refusal = await query(payload, { user: player }).then(() => "accepted", err => err.message);
      b.expect(isForceable(refusal) && purse(far.actor).gp === 6, "a player four squares away: refused, with a reason that can be forced");
      since = Date.now() - 1;
      const forced = await query({ ...payload, force: true }, { user: player }).then(() => "accepted", err => err.message);
      await sleep(500);
      const told = messagesAfter(since, m => !!m.getFlag(MODULE_ID, "forced"))[0];
      b.expect(forced === "accepted" && purse(far.actor).gp === 0, `forced: done (${forced})`);
      b.expect(told && told.whisper.length && told.whisper.every(id => game.users.get(id)?.isGM), "the GM is told, in a whisper, that the rule was overridden");
    } else b.note("no player user in this world: the forced share is not played");
  } finally { await party.restore(); }
}

const PARTS = { "portes-secretes": [secretDoors, 9, 3], "piege-zone": [zoneTrap, 8, 6], "piege-avance": [advancedTrap, 10, 7],
  "piege-token": [tokenTrap, 7, 3], "coffre-porte": [trappedThings, 7, 3], butin: [loot, 6, 2], sons: [sounds, 7, 2], fouille: [search, 5, 3],
  "groupe-conteneur": [groupContainer, 5, 2], "clic-gauche": [clickLoot, 6, 2],
  mecanisme: [mechanism, 9, 4], vol: [npcTheft, 4, 2],
  // Lot 0 (2026-11-26)
  shop: [shop, 4, 2], trade: [trade, 3, 2], necromancy: [necromancy, 5, 2], thrown: [thrown, 9, 4],
  // Lot 1 (2026-11-27)
  "share-coins": [shareCoinsPart, 7, 3] };

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
