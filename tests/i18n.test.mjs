/**
 * Garde des traductions : en.json et fr.json ont les mêmes clés et les mêmes {jokers} ; toute clé que le code demande
 * (littérale, ou construite depuis une liste connue) existe dans les deux ; aucune clé n'est le préfixe d'une autre (Foundry
 * range les clés pointées en arbre : « A.B » texte et « A.B.C » ne peuvent pas coexister).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ATTITUDES, STOLEN_POLICIES } from "../module/scripts/core/shop.mjs";
import { GENERIC_TABLES } from "../module/scripts/core/tables.mjs";
import { discoveryKey } from "../module/scripts/core/hidden.mjs";
import { difficultyOf } from "../module/scripts/core/theft.mjs";

const ROOT = join(import.meta.dirname, "..");
const lang = l => JSON.parse(readFileSync(join(ROOT, "module", "lang", `${l}.json`), "utf8"));
const manifest = JSON.parse(readFileSync(join(ROOT, "module", "module.json"), "utf8"));

/** Les feuilles d'un fichier de langue, en clés pointées (une clé contenant déjà un point, ex. TYPES, reste telle quelle). */
function flatten(obj, prefix="", out={}) {
  for ( const [k, v] of Object.entries(obj) ) {
    const key = prefix ? `${prefix}.${k}` : k;
    if ( v && (typeof v === "object") ) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const EN = flatten(lang("en"));
const FR = flatten(lang("fr"));
const LANGS = { en: EN, fr: FR };

/** Une clé est une branche (pour LOCALIZATION_PREFIXES) si une feuille commence par elle. */
const isBranch = (flat, key) => Object.keys(flat).some(k => k.startsWith(`${key}.`));

function files(dir, re) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p, re) : re.test(p) ? [p] : [];
  });
}
const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const SOURCES = [
  ...files(join(ROOT, "module", "scripts"), /\.mjs$/),
  ...files(join(ROOT, "tools", "macros"), /\.js$/)
].map(p => ({ path: relative(ROOT, p).split(sep).join("/"), code: strip(readFileSync(p, "utf8")) }));

/** Les préfixes de clés construites (`loc(\`X.${…}\`)`) que ce test sait énumérer ci-dessous. */
const DYNAMIC = {
  "DLO.Tables": GENERIC_TABLES.map(t => t.key),
  "DLO.Merchant.Attitude": Object.keys(ATTITUDES),
  "DLO.Merchant.StolenPolicy": [...STOLEN_POLICIES],
  "DLO.Steal.Difficulty": [...new Set([0, 1, 5, 10, 50, 1000, 100000].map(value => difficultyOf({ value, weight: 0 })))
    .add(difficultyOf({ value: 0, weight: 0, alert: true }))],
  "DLO.Hidden.Found": [...new Set(["container", "macro", "scene", "document", "secret", "ethereal", "trap", "?"].map(discoveryKey))],
  // Les refus du budget du moteur de combat (son `api.budget.issues`, SPEC §102 du moteur).
  "DLO.Hidden.Budget": ["notYourTurn", "noAction", "noBonus", "noReaction"],
  "TYPES.RegionBehavior": Object.keys(manifest.documentTypes?.RegionBehavior ?? {}).map(t => `${manifest.id}.${t}`)
};
// Préfixes d'aide locale (`const L = key => … \`DLO.TileZone.${key}\``) : leurs appels L("X") sont des clés littérales.
const HELPERS = new Set(["DLO.TileZone", "DLO.Hidden.Wall"]);

/** Ce que le code demande : clés littérales, préfixes construits, LOCALIZATION_PREFIXES. */
function usage() {
  const keys = new Map();
  const add = (key, path) => { if ( !keys.has(key) ) keys.set(key, path); };
  const templates = new Set();
  const branches = new Set();
  for ( const { path, code } of SOURCES ) {
    for ( const m of code.matchAll(/LOCALIZATION_PREFIXES\s*=\s*\[([^\]]*)\]/g) ) {
      for ( const p of m[1].matchAll(/"([^"]+)"/g) ) branches.add(p[1]);
    }
    const noPrefixes = code.replace(/LOCALIZATION_PREFIXES\s*=\s*\[[^\]]*\]/g, "");
    for ( const m of noPrefixes.matchAll(/["']((?:DLO|TYPES)\.[\w.-]+)["']/g) ) add(m[1], path);
    for ( const m of code.matchAll(/\bloc\(\s*["']([\w.-]+)["']/g) ) add(`DLO.${m[1]}`, path);
    for ( const m of code.matchAll(/\bloc\([^()]*?\?\s*["']([\w.-]+)["']\s*:\s*["']([\w.-]+)["']/g) ) {
      add(`DLO.${m[1]}`, path); add(`DLO.${m[2]}`, path);
    }
    // Clés construites : `DLO.X.${…}` et loc(`X.${…}`).
    for ( const m of code.matchAll(/`((?:DLO|TYPES)\.[\w.]+)\.\$\{/g) ) templates.add(m[1]);
    for ( const m of code.matchAll(/\bloc\(\s*`([\w.]+)\.\$\{/g) ) templates.add(`DLO.${m[1]}`);
    // Aides locales L("X").
    const helper = code.match(/const L = key => [^\n]*`(?:DLO\.)?([\w.]+)\.\$\{key\}`/);
    if ( helper ) {
      const prefix = helper[1].startsWith("DLO.") ? helper[1] : `DLO.${helper[1]}`;
      for ( const m of code.matchAll(/\bL\(\s*["']([\w.-]+)["']/g) ) add(`${prefix}.${m[1]}`, path);
      templates.delete(prefix);
      expect(HELPERS.has(prefix), `${path} : aide L inconnue (${prefix})`).toBe(true);
    }
  }
  return { keys, templates, branches };
}

describe("traductions", () => {
  it("en et fr ont exactement les mêmes clés", () => {
    expect(Object.keys(FR).filter(k => !(k in EN)), "clés absentes de en.json").toEqual([]);
    expect(Object.keys(EN).filter(k => !(k in FR)), "clés absentes de fr.json").toEqual([]);
  });

  it("chaque valeur est un texte non vide, avec les mêmes {jokers} dans les deux langues", () => {
    const jokers = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    for ( const [l, flat] of Object.entries(LANGS) ) {
      for ( const [k, v] of Object.entries(flat) ) {
        expect(typeof v, `${l} ${k}`).toBe("string");
        expect(v.trim(), `${l} ${k}`).not.toBe("");
      }
    }
    for ( const k of Object.keys(EN) ) if ( k in FR ) expect(jokers(FR[k]), k).toEqual(jokers(EN[k]));
  });

  it("aucune clé n'est le préfixe d'une autre", () => {
    for ( const flat of Object.values(LANGS) ) {
      const keys = Object.keys(flat).sort();
      for ( let i = 1; i < keys.length; i++ ) expect(keys[i].startsWith(`${keys[i - 1]}.`), keys[i]).toBe(false);
    }
  });

  it("toute clé littérale du code et des macros existe dans les deux langues", () => {
    const { keys } = usage();
    expect(keys.size).toBeGreaterThan(100);
    for ( const [key, path] of keys ) {
      for ( const [l, flat] of Object.entries(LANGS) ) expect(key in flat, `${path} : ${key} absente de ${l}.json`).toBe(true);
    }
  });

  it("toute clé construite vient d'une liste connue, et chaque valeur de la liste existe", () => {
    const { templates } = usage();
    expect([...templates].filter(t => !(t in DYNAMIC)), "clé construite que ce test ne sait pas énumérer").toEqual([]);
    for ( const [prefix, values] of Object.entries(DYNAMIC) ) {
      expect(values.length, prefix).toBeGreaterThan(0);
      for ( const v of values ) {
        for ( const [l, flat] of Object.entries(LANGS) ) expect(`${prefix}.${v}` in flat, `${prefix}.${v} absente de ${l}.json`).toBe(true);
      }
    }
  });

  it("les préfixes de champs (LOCALIZATION_PREFIXES) sont des branches des deux fichiers", () => {
    const { branches } = usage();
    expect(branches.size).toBeGreaterThan(0);
    for ( const b of branches ) for ( const [l, flat] of Object.entries(LANGS) ) expect(isBranch(flat, b), `${b} (${l})`).toBe(true);
  });

  it("le libellé du compendium est une clé traduite", () => {
    for ( const pack of manifest.packs ?? [] ) {
      for ( const [l, flat] of Object.entries(LANGS) ) expect(pack.label in flat, `${pack.label} (${l})`).toBe(true);
    }
  });

  it("module.json déclare les deux langues", () => {
    expect((manifest.languages ?? []).map(l => l.lang).sort()).toEqual(["en", "fr"]);
  });
});
