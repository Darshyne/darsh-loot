/**
 * L'archive à installer sur la Forge (ou dans un autre Foundry) : dist/darsh-loot-v<version>.zip (SPEC §3.11).
 *
 *   npm run dist
 *
 * Le contenu de module/ tel qu'il est au dernier commit (`git archive HEAD:module`), plus les compendiums construits par
 * `npm run packs` (module/packs/, non versionné). Refuse de partir si module/ a des changements non commités : l'archive ne les
 * contiendrait pas.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
// Windows : le tar de System32 (bsdtar) — celui de Git Bash ne lit pas les chemins « C:\ » et n'écrit pas de zip.
const TAR = (process.platform === "win32") ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });

if ( git("status", "--porcelain", "--", "module").trim() ) {
  console.error("module/ a des changements non commités : committer d'abord.");
  process.exit(1);
}
execFileSync(process.execPath, [path.join(ROOT, "tools", "packs.mjs")], { cwd: ROOT, stdio: "inherit" });

const { version } = JSON.parse(git("show", "HEAD:module/module.json"));
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "darsh-loot-dist-"));
const tar = path.join(stage, "module.tar");
git("archive", "--format=tar", "-o", tar, "HEAD:module");
const content = path.join(stage, "module");
fs.mkdirSync(content);
execFileSync(TAR, ["-xf", tar, "-C", content]);
fs.cpSync(path.join(ROOT, "module", "packs"), path.join(content, "packs"), { recursive: true,
  filter: src => !/[\\/](LOCK|LOG(\.old)?)$/.test(src) });

fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
const zip = path.join(ROOT, "dist", `darsh-loot-v${version}.zip`);
fs.rmSync(zip, { force: true });
// Les entrées du dossier, nommées une à une : « . » donnerait des chemins en « ./module.json ». Windows : bsdtar écrit un zip aux
// chemins en « / » ; ailleurs, zip.
const entries = fs.readdirSync(content);
if ( process.platform === "win32" ) execFileSync(TAR, ["-a", "-c", "-f", zip, "-C", content, ...entries]);
else execFileSync("zip", ["-qr", zip, ...entries], { cwd: content });
fs.rmSync(stage, { recursive: true, force: true });
console.log(`  ✓ ${path.relative(ROOT, zip)}`);
