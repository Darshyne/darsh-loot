/**
 * Les DD d'un piège du DMG 2024, lus dans le texte de sa capacité (SPEC §3.12). Le DMG ne les range dans aucun champ : ils
 * sont dans le paragraphe « Détection et désarmement », sous forme de liens de jet de dnd5e (`[[/check prc 15]]`,
 * `[[/check DC prc 10]]`, `[[/check skill=inv dc=15]]`), qui gardent la même forme en anglais et en français.
 *
 * - **Détection** : parmi les tests de Perception ou d'Investigation, le plus petit DD (un piège peut en avoir deux : le
 *   glyphe de la statue, DD 10, et sa dalle, DD 15 — repérer l'un ou l'autre, c'est repérer le piège).
 * - **Désamorçage** : le test d'Escamotage (outils de voleur) s'il y en a un ; le DMG dit alors qu'un échec déclenche le
 *   piège (l'aiguille empoisonnée). Sans test, le piège se neutralise une fois repéré (fil à couper, pointe à caler) : DD 1,
 *   un échec ne fait rien.
 */

const DETECT = new Set(["prc", "inv"]);
const DISARM = new Set(["slt"]);

/** Les tests `[[/check …]]` d'un texte : `{ skill, dc }` (compétence en abrégé dnd5e, DD). */
export function checksIn(text) {
  const out = [];
  for ( const match of String(text ?? "").matchAll(/\[\[\/check\s+([^\]]+)\]\]/gi) ) {
    let skill = null, dc = null;
    for ( const token of match[1].trim().split(/\s+/) ) {
      const [key, value] = token.includes("=") ? token.split("=") : [null, token];
      const k = key?.toLowerCase();
      if ( (k === "dc") && /^\d+$/.test(value) ) dc = Number(value);
      else if ( ["skill", "ability"].includes(k) ) skill ??= value.toLowerCase();
      else if ( !k && /^\d+$/.test(value) ) dc ??= Number(value);
      else if ( !k && /^[a-z]{3}$/i.test(value) && (value.toLowerCase() !== "dc") ) skill ??= value.toLowerCase();
    }
    if ( skill && Number.isFinite(dc) ) out.push({ skill, dc });
  }
  return out;
}

/**
 * Les réglages d'un piège tirés de ses textes : `{ hidden: { skill, dc } | null, disarmDc, failure }` ; null si aucun test de
 * détection n'est trouvé (un acteur fait main : on ne touche à rien).
 * @param {string[]} texts  Les descriptions de ses objets (HTML).
 */
export function trapChecks(texts) {
  const checks = texts.flatMap(t => checksIn(t));
  const detect = checks.filter(c => DETECT.has(c.skill)).sort((a, b) => a.dc - b.dc)[0] ?? null;
  if ( !detect ) return null;
  const disarm = checks.find(c => DISARM.has(c.skill)) ?? null;
  return {
    hidden: { skill: detect.skill, dc: detect.dc },
    disarmDc: disarm ? disarm.dc : 1,
    failure: disarm ? "trigger" : "nothing"
  };
}
