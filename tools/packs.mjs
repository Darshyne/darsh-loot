/**
 * Construit les compendiums du module (module/packs/, non versionné) depuis leurs sources versionnées (SPEC §3.11).
 *
 *   npm run packs
 *
 * Aujourd'hui un seul : `outils`, les macros de tools/macros/ (liste et ordre : tools/macros/index.mjs). Les ids sont tirés du nom de
 * fichier : une macro garde le même id d'une version à l'autre. À lancer Foundry fermé, ou le module inactif dans le monde ouvert
 * (Foundry garde un verrou exclusif sur une base ouverte).
 */
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { ClassicLevel } from "classic-level";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MACROS } from "./macros/index.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module", "module.json"), "utf8"));

/** Un `_id` Foundry stable : 16 caractères alphanumériques tirés du nom. */
export function stableId(name) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return [...createHash("sha256").update(name).digest()].slice(0, 16).map(b => chars[b % chars.length]).join("");
}

/** Les documents du pack `outils`. */
export function macroDocuments() {
  return MACROS.map(({ file, name, img }, i) => {
    const _id = stableId(`darsh-loot.outils.${file}`);
    return {
      _id, _key: `!macros!${_id}`, name, type: "script", img, scope: "global", folder: null, sort: (i + 1) * 100000,
      command: fs.readFileSync(path.join(ROOT, "tools", "macros", file), "utf8").replace(/\r\n/g, "\n"),
      author: null, ownership: { default: 0 }, flags: { "darsh-loot": { source: `tools/macros/${file}` } }
    };
  });
}

const SOURCES = { outils: macroDocuments };

/** Une base ouverte par Foundry est verrouillée : on le vérifie AVANT de toucher au dossier (sinon il serait à moitié effacé). */
async function assertUnlocked(dir) {
  if ( !fs.existsSync(dir) ) return;
  const db = new ClassicLevel(dir);
  try { await db.open(); }
  catch(err) {
    console.error(`  ✗ ${path.relative(ROOT, dir)} est ouvert par Foundry : fermer le monde (ou désactiver le module), puis relancer.`);
    process.exit(1);
  }
  await db.close();
}

if ( import.meta.main ?? (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) ) {
  for ( const pack of manifest.packs ?? [] ) {
    const documents = SOURCES[pack.name]?.();
    if ( !documents ) throw new Error(`pas de source pour le compendium ${pack.name}`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `darsh-loot-${pack.name}-`));
    for ( const doc of documents ) fs.writeFileSync(path.join(tmp, `${doc._id}.json`), JSON.stringify(doc, null, 2));
    const dst = path.join(ROOT, "module", pack.path);
    await assertUnlocked(dst);
    fs.rmSync(dst, { recursive: true, force: true });
    await compilePack(tmp, dst);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`  ✓ ${pack.name} : ${documents.length} document(s) → module/${pack.path}`);
  }
}
