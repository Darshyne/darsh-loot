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
 *
 * Textes : clés `DLO.Macro.ConvertItemPiles.*` des fichiers de langue du module (chargés tant que le module est actif ; sans
 * lui, seul le message qui le réclame s'affiche, en anglais).
 */
const L = (key, data) => data ? game.i18n.format(key, data) : game.i18n.localize(key);
const api = game.modules.get("darsh-loot")?.api;
if ( !api?.convertAllItemPiles ) {
  return ui.notifications.warn(game.i18n.has("DLO.Macro.ConvertItemPiles.NeedModule") ? L("DLO.Macro.ConvertItemPiles.NeedModule")
    : "DAS · Loot & Trade (darsh-loot) 0.13.0 or later is required (is the module active?).");
}
if ( !game.user.isGM ) return ui.notifications.warn(L("DLO.Macro.ConvertItemPiles.GMOnly"));

const mode = await foundry.applications.api.DialogV2.wait({
  window: { title: L("DLO.Macro.ConvertItemPiles.Title") },
  content: `<p>${L("DLO.Macro.ConvertItemPiles.Intro")}</p>`,
  buttons: [{ action: "report", label: L("DLO.Macro.ConvertItemPiles.Report"), default: true },
    { action: "convert", label: L("DLO.Macro.ConvertItemPiles.Convert") }],
  rejectClose: false
});
if ( !mode ) return;
const dry = mode !== "convert";
const report = await api.convertAllItemPiles({ dry });
if ( !report.length ) {
  ChatMessage.implementation.create({ whisper: [game.user.id], content: `<p>${L("DLO.Macro.ConvertItemPiles.NoneFound")}</p>` });
  return;
}

const abbr = k => game.i18n.localize(CONFIG.DND5E.currencies[k]?.abbreviation ?? k);
const coins = cp => {
  const gp = Math.floor(cp / 100);
  const rest = cp - (gp * 100);
  return `${gp} ${abbr("gp")}${rest ? ` ${Math.floor(rest / 10)} ${abbr("sp")} ${rest % 10} ${abbr("cp")}` : ""}`;
};
const status = r => L(r.done ? "DLO.Macro.ConvertItemPiles.StatusDone"
  : (r.todo ? "DLO.Macro.ConvertItemPiles.StatusTodo" : "DLO.Macro.ConvertItemPiles.StatusAlready"));
const rows = report.map(r => `<tr><td>${foundry.utils.escapeHTML(r.name)}</td><td>${status(r)}</td>
  <td>${r.goods}</td><td>${r.hidden}</td><td>${r.notForSale}</td><td>${r.tables}</td><td>${coins(r.till)}</td></tr>`).join("");
const counts = { count: report.filter(r => r.todo).length, total: report.length };
const columns = ["DLO.Macro.ConvertItemPiles.ColumnMerchant", "", "DLO.Macro.ConvertItemPiles.ColumnGoods",
  "DLO.Macro.ConvertItemPiles.ColumnHidden", "DLO.Macro.ConvertItemPiles.ColumnNotForSale",
  "DLO.Macro.ConvertItemPiles.ColumnTables", "DLO.Macro.ConvertItemPiles.ColumnTill"]
  .map(key => `<th>${key ? L(key) : ""}</th>`).join("");
ChatMessage.implementation.create({
  whisper: [game.user.id],
  content: `<p><strong>${L(dry ? "DLO.Macro.ConvertItemPiles.SummaryDry" : "DLO.Macro.ConvertItemPiles.Summary", counts)}</strong></p>
    <table><tr>${columns}</tr>${rows}</table>`
});
ui.notifications.info(L(dry ? "DLO.Macro.ConvertItemPiles.NotifyDry" : "DLO.Macro.ConvertItemPiles.Notify", { count: counts.count }));
