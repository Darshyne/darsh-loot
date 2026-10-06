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
  const actors = game.actors.contents.filter(a => a.type === "npc").sort(byName);
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
    <div class="form-group" data-for="trap"><label>${L("Actor")}</label><select name="trapActor">${options(actors, L("None"))}</select></div>
    <div class="form-group" data-for="trap"><label>${L("Activity")}</label><select name="trapActivity"><option value="">${esc(L("FirstActivity"))}</option></select></div>
    <div class="form-group"><label>${L("Hidden")}</label><input type="checkbox" name="hidden"></div>
    <div class="form-group" data-hidden><label>${L("Skill")}</label><select name="skill">
      <option value="prc">${esc(game.i18n.localize("DND5E.SkillPrc"))}</option>
      <option value="inv">${esc(game.i18n.localize("DND5E.SkillInv"))}</option></select></div>
    <div class="form-group" data-hidden><label>${L("Dc")}</label><input type="number" name="dc" value="15" min="1" max="40" step="1"></div>
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
      // Les activités de l'acteur piège choisi (un piège du DMG en a une par tranche de niveaux).
      const actorSelect = root.querySelector("select[name=trapActor]");
      const activitySelect = root.querySelector("select[name=trapActivity]");
      const fillActivities = () => {
        const actor = actorSelect.value ? fromUuidSync(actorSelect.value, { strict: false }) : null;
        const list = (actor?.items.contents ?? []).flatMap(i => (i.system.activities?.contents ?? [])
          .map(a => `<option value="${esc(a.id)}">${esc(`${i.name} — ${a.name || a.type}`)}</option>`));
        activitySelect.innerHTML = `<option value="">${esc(L("FirstActivity"))}</option>${list.join("")}`;
      };
      actorSelect.addEventListener("change", fillActivities);
      // Un piège est caché par nature : la case se coche quand on le choisit.
      select.addEventListener("change", () => { if ( select.value === "trap" ) { root.querySelector("input[name=hidden]").checked = true; root.querySelector("input[name=hidden]").dispatchEvent(new Event("change")); } });
      // Option « cachée » (SPEC §3.12) : compétence et DD seulement si elle est cochée.
      const hidden = root.querySelector("input[name=hidden]");
      const syncHidden = () => root.querySelectorAll("[data-hidden]").forEach(el => { el.style.display = hidden.checked ? "" : "none"; });
      hidden.addEventListener("change", syncHidden);
      syncHidden();
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
        if ( kind === "trap" ) {
          system.actor = f.trapActor.value || null;
          system.activity = f.trapActivity.value || "";
        }
        if ( f.hidden.checked ) system.hidden = { enabled: true, skill: f.skill.value, dc: Number(f.dc.value) || 15 };
        else if ( kind === "trap" ) system.hidden = { enabled: false };
        return { kind, name: f.name.value.trim(), system };
      }
    },
    rejectClose: false
  });
}
