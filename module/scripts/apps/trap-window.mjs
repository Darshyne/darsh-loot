/**
 * La fenêtre du MJ quand un piège frappe en mode avancé (0.17.0, SPEC §3.12) : pas de jet automatique. Elle montre les créatures dans
 * la zone d'effet à ce moment ; pour chacune, le MJ choisit **Avantage / normal / Désavantage** selon le jeu de rôle des joueurs (à
 * sa sauvegarde ; pour un piège à jet d'attaque, la faveur se traduit sur le jet du piège contre elle), ou la retire. Il peut changer
 * de tranche de niveaux (pièges du DMG 2024), puis lance le piège, ou l'annule.
 *
 * Fenêtre seulement : ce qui se passe ensuite est l'affaire de l'appelant (runtime/traps.mjs).
 */
import { loc } from "../shared.mjs";

const esc = text => foundry.utils.escapeHTML(String(text ?? ""));

/**
 * @param {object} trap
 * @param {string} trap.name
 * @param {{ uuid: string, name: string, img: string|null }[]} trap.targets
 * @param {{ id: string, name: string }[]} trap.activities   Les activités proposées (une par tranche) ; une seule : pas de choix.
 * @param {string|null} trap.activity                         Celle choisie d'office.
 * @param {boolean} trap.attack                               Un piège à jet d'attaque (la faveur est inversée sur son jet).
 * @returns {Promise<{ fire: boolean, activity: string|null, targets: string[], modes: Record<string, "advantage"|"disadvantage"> }>}
 */
export async function askTrapResolution({ name, targets, activities, activity, attack }) {
  const modeRow = (t, i) => `
    <tr>
      <td><input type="checkbox" name="use.${i}" checked></td>
      <td class="dlo-trap-who">${t.img ? `<img src="${esc(t.img)}" alt="">` : ""}<span>${esc(t.name)}</span></td>
      <td><select name="mode.${i}">
        <option value="advantage">${esc(loc("TrapWindow.Advantage"))}</option>
        <option value="" selected>${esc(loc("TrapWindow.Normal"))}</option>
        <option value="disadvantage">${esc(loc("TrapWindow.Disadvantage"))}</option>
      </select></td>
    </tr>`;
  const tierField = (activities.length > 1) ? `
    <div class="form-group"><label>${esc(loc("TrapWindow.Tier"))}</label><div class="form-fields"><select name="activity">
      ${activities.map(a => `<option value="${esc(a.id)}" ${a.id === activity ? "selected" : ""}>${esc(a.name)}</option>`).join("")}
    </select></div></div>` : "";
  const content = `
    <p>${esc(loc(attack ? "TrapWindow.HintAttack" : "TrapWindow.HintSave"))}</p>
    ${targets.length ? `<table class="dlo-trap-targets"><tbody>${targets.map(modeRow).join("")}</tbody></table>`
      : `<p class="hint">${esc(loc("TrapWindow.Nobody"))}</p>`}
    ${tierField}`;
  const read = form => {
    const data = new foundry.applications.ux.FormDataExtended(form).object;
    const picked = [];
    const modes = {};
    targets.forEach((t, i) => {
      if ( !data[`use.${i}`] ) return;
      picked.push(t.uuid);
      if ( data[`mode.${i}`] ) modes[t.uuid] = data[`mode.${i}`];
    });
    return { activity: data.activity || activity, targets: picked, modes };
  };
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("TrapWindow.Title", { name }), icon: "fa-solid fa-burst" },
    position: { width: 480 },
    classes: ["dlo-trap-window"],
    content,
    buttons: [
      { action: "fire", label: loc("TrapWindow.Fire"), icon: "fa-solid fa-burst", default: true,
        callback: (event, button) => ({ fire: true, ...read(button.form) }) },
      { action: "cancel", label: loc("TrapWindow.Cancel"), icon: "fa-solid fa-ban",
        callback: () => ({ fire: false }) }
    ],
    rejectClose: false
  }).catch(() => null);
  return (result && (typeof result === "object")) ? result : { fire: false };
}
