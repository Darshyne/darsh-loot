#!/usr/bin/env node
/**
 * Passe de test de bout en bout des pièges et du butin (2026-10-28), jouée chez le MJ par le connecteur MCP : chaque partie
 * (`api.mcp.selftest`, module/scripts/runtime/selftest.mjs) pose ses documents d'essai sur un coin libre de l'arène, vérifie, et
 * retire tout.
 *
 *   node tools/selftest.mjs                    toutes les parties
 *   node tools/selftest.mjs piege-zone butin   celles-là
 *
 * Prérequis : serveur du connecteur lancé, monde `dnd-6` ouvert chez le MJ (« Outils de test » du connecteur activé), F5 du client
 * du MJ après un changement du module (`node tools/reload.mjs` dans le dépôt du moteur). Le client de connexion est celui du moteur,
 * cloné à côté de ce dépôt. Code de sortie 1 si une vérification manque.
 */
import { connect } from "../../Foundry dnd5e moteur de combat/tools/lib/connector.mjs";

const MODULE_ID = "darsh-loot";
const ARENA = "Arène de test";

async function call(mcp, fn, args={}, timeoutMs=240000) {
  const until = Date.now() + timeoutMs;
  let r = await mcp.call("call-module-api", { moduleId: MODULE_ID, fn, args, waitMs: 8000 });
  while ( !r.settled ) {
    if ( Date.now() > until ) throw new Error(`${fn} : pas de réponse après ${timeoutMs} ms`);
    r = await mcp.call("call-module-api", { callId: r.callId, waitMs: 8000 });
  }
  return r.result;
}

const mcp = await connect({ client: "darsh-loot-selftest" });
let missing = 0;
try {
  const status = await call(mcp, "status");
  if ( status.scene !== ARENA ) {
    const listed = await mcp.call("list-scenes", {});
    const scenes = Array.isArray(listed) ? listed : (listed?.scenes ?? []);
    const arena = (scenes ?? []).find(s => s.name === ARENA);
    if ( !arena ) throw new Error(`scène « ${ARENA} » introuvable`);
    await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "viewScene", args: { sceneId: arena.id }, waitMs: 8000 });
    await new Promise(resolve => setTimeout(resolve, 4000));
  }
  console.log(`darsh-loot ${status.version}, monde ${status.world}, MJ actif ${status.activeGM}`);
  const wanted = process.argv.slice(2);
  const parts = wanted.length ? wanted : (await call(mcp, "selftest", {})).parts;
  for ( const part of parts ) {
    console.log(`\n▶ ${part}`);
    const started = Date.now();
    const r = await call(mcp, "selftest", { part });
    for ( const c of r.checks ) {
      console.log(`    ${c.note ? "·" : (c.ok ? "✓" : "✗")} ${c.label}`);
      if ( !c.ok ) missing++;
    }
    if ( r.error ) { console.log(`    ✗ erreur : ${r.error}`); missing++; }
    console.log(`    (${Math.round((Date.now() - started) / 1000)} s)`);
  }
} finally {
  await mcp.close?.();
}
console.log(`\n${missing ? `${missing} vérification(s) manquée(s)` : "tout tient"}`);
process.exit(missing ? 1 : 0);
