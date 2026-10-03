/**
 * Macro de MJ (darsh-loot ≥ 0.13.0) : reprend tous les marchands d'Item Piles du monde — étape 9 du SPEC.
 *
 * Pour chaque PNJ marchand d'Item Piles : ses réglages deviennent ceux de darsh-loot (coefficients, tables de réassort,
 * présentation, caisse finie ou non), les drapeaux « caché » / « pas à vendre » de ses objets sont repris, et son stock
 * présent devient la référence du réassort. Les drapeaux d'Item Piles restent en place : rien n'est perdu, et un marchand
 * déjà repris n'est pas refait. Deux choix : « Rapport » (n'écrit rien, dit ce qui serait repris) ou « Reprendre ». Le bilan
 * est chuchoté au MJ.
 *
 * À lancer une fois, Item Piles encore installé ou non (ses drapeaux suffisent). Ensuite, désactiver Item Piles : tant
 * qu'il est actif, ses propres fenêtres s'ouvrent aussi sur ces marchands.
 */
const api = game.modules.get("darsh-loot")?.api;
if ( !game.user.isGM ) return ui.notifications.warn("Réservé au MJ.");
if ( !api?.convertAllItemPiles ) return ui.notifications.warn("darsh-loot 0.13.0 ou plus récent est requis (module actif ?).");

const mode = await foundry.applications.api.DialogV2.wait({
  window: { title: "Reprise des marchands d'Item Piles" },
  content: "<p>« Rapport » ne modifie rien : il dit quels marchands seraient repris.</p>",
  buttons: [{ action: "report", label: "Rapport", default: true }, { action: "convert", label: "Reprendre" }],
  rejectClose: false
});
if ( !mode ) return;
const dry = mode !== "convert";
const report = await api.convertAllItemPiles({ dry });
if ( !report.length ) {
  ChatMessage.implementation.create({ whisper: [game.user.id], content: "<p><strong>Marchands d'Item Piles</strong> : aucun dans ce monde, rien à faire.</p>" });
  return;
}

const coins = cp => {
  const gp = Math.floor(cp / 100);
  const rest = cp - (gp * 100);
  return `${gp} po${rest ? ` ${Math.floor(rest / 10)} pa ${rest % 10} pc` : ""}`;
};
const rows = report.map(r => `<tr><td>${foundry.utils.escapeHTML(r.name)}</td><td>${r.done ? "repris" : (r.todo ? "à reprendre" : "déjà fait")}</td>
  <td>${r.goods}</td><td>${r.hidden}</td><td>${r.notForSale}</td><td>${r.tables}</td><td>${coins(r.till)}</td></tr>`).join("");
ChatMessage.implementation.create({
  whisper: [game.user.id],
  content: `<p><strong>Marchands d'Item Piles ${dry ? "— rapport, rien n'a été modifié : à reprendre" : "repris"} : ${report.filter(r => r.todo).length} sur ${report.length}</strong></p>
    <table><tr><th>Marchand</th><th></th><th>Étal</th><th>Cachés</th><th>Exposés</th><th>Tables</th><th>Caisse</th></tr>${rows}</table>`
});
ui.notifications.info(`${report.filter(r => r.todo).length} marchand(s) ${dry ? "à reprendre" : "repris"} — bilan dans le chat.`);
