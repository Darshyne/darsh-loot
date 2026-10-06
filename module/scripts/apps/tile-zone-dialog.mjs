/**
 * Fenêtre de l'outil « tuile → zone » (SPEC §3.12) : le MJ choisit le type de zone et sa cible. Elle ne crée rien : elle
 * rend le choix, runtime/tile-zone.mjs crée la région. Le reste des réglages se fait ensuite dans la fenêtre de
 * configuration du comportement, ouverte d'elle-même.
 */
const esc = text => foundry.utils.escapeHTML(String(text ?? ""));
const L = key => game.i18n.localize(`DLO.TileZone.${key}`);

/**
 * @param {{ types: { id: string, kind: string }[], name: string }} options
 * @returns {Promise<{ kind: string, name: string, system: object }|null>}
 */
export async function promptTileZone({ types, name }) {
  const byName = (a, b) => a.name.localeCompare(b.name, game.i18n.lang);
  const options = (docs, empty) => [`<option value="">${esc(empty)}</option>`,
    ...docs.map(d => `<option value="${esc(d.uuid)}">${esc(d.name)}</option>`)].join("");
  const macros = game.macros.contents.sort(byName);
  const scenes = game.scenes.contents.filter(s => s !== canvas.scene).sort(byName);
  const journals = game.journal.contents.sort(byName);
  const typeOptions = types.map(t =>
    `<option value="${esc(t.kind)}">${esc(game.i18n.localize(`TYPES.RegionBehavior.${t.id}`))}</option>`).join("");

  const content = `
    <div class="form-group"><label>${L("Type")}</label><select name="kind">${typeOptions}</select></div>
    <div class="form-group"><label>${L("Name")}</label><input type="text" name="name" value="${esc(name)}"></div>
    <div class="form-group" data-for="macro"><label>${L("Macro")}</label><select name="macro">${options(macros, L("None"))}</select></div>
    <div class="form-group" data-for="scene"><label>${L("Scene")}</label><select name="targetScene">${options(scenes, L("None"))}</select></div>
    <div class="form-group" data-for="document"><label>${L("Document")}</label><select name="document">${options(journals, L("None"))}</select></div>
    <div class="form-group" data-for="document"><label>${L("DocumentUuid")}</label><input type="text" name="documentUuid" placeholder="JournalEntry.xxx.JournalEntryPage.yyy"></div>
    <div class="form-group" data-for="document"><label>${L("Grant")}</label><input type="checkbox" name="grant" checked></div>
    <p class="hint">${L("Hint")}</p>`;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: L("Title"), icon: "fa-solid fa-draw-polygon" },
    content,
    render: (event, dialog) => {
      const root = dialog.element;
      const select = root.querySelector("select[name=kind]");
      const sync = () => root.querySelectorAll("[data-for]").forEach(el => {
        el.style.display = (el.dataset.for === select.value) ? "" : "none";
      });
      select.addEventListener("change", sync);
      sync();
    },
    ok: {
      label: L("Create"),
      icon: "fa-solid fa-draw-polygon",
      callback: (event, button) => {
        const f = button.form.elements;
        const kind = f.kind.value;
        const system = {};
        if ( kind === "macro" ) system.macro = f.macro.value || null;
        if ( kind === "scene" ) system.targetScene = f.targetScene.value || null;
        if ( kind === "document" ) {
          system.document = f.documentUuid.value.trim() || f.document.value || null;
          system.grant = f.grant.checked;
        }
        return { kind, name: f.name.value.trim(), system };
      }
    },
    rejectClose: false
  });
}
