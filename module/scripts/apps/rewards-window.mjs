/**
 * The « Rewards » window (lot 2, 2026-11-27) — GM only. A view of one encounter record (adapter/xp.mjs): the creatures overcome
 * (ticked when defeated; a GM ticks one that fled or surrendered — the DMG counts them), the characters (who receives), the NPC
 * allies (who takes a share), a bonus for a noncombat challenge or a milestone, how the XP divides, and « Give ».
 * Every change is saved in the record at once: closed and reopened, after a reload, it is all there. It decides nothing: what
 * it does goes through the handlers received at opening (runtime/rewards.mjs). Lot 3 (loot) is meant to add a section here.
 */
import { MODULE_ID, loc, setting } from "../shared.mjs";
import { planAward, challengeFor, xpOffReason, xpOffText } from "../adapter/xp.mjs";
import { DIFFICULTIES, XP_SPLIT } from "../core/xp.mjs";

const { ApplicationV2 } = foundry.applications.api;
const escape = s => foundry.utils.escapeHTML(String(s ?? ""));
const number = n => (Number(n) || 0).toLocaleString(game.i18n.lang);

export class RewardsWindow extends ApplicationV2 {
  /** @param {{ recordId: string|null, handlers: object }} options */
  constructor({ recordId=null, handlers, ...options }) {
    super({ id: `${MODULE_ID}-rewards`, ...options });
    this.recordId = recordId;
    this.handlers = handlers;
  }

  static DEFAULT_OPTIONS = {
    classes: ["dlo-loot", "dnd5e2", "titlebar", "dlo-rewards"],
    window: { icon: "fa-solid fa-trophy", resizable: true },
    position: { width: 520, height: "auto" },
    actions: {
      award: RewardsWindow.#onAward,
      dismiss: RewardsWindow.#onDismiss,
      create: RewardsWindow.#onCreate,
      challenge: RewardsWindow.#onChallenge,
      openSheet: RewardsWindow.#onOpenSheet
    }
  };

  /** The open window (one per client). */
  static instance = null;

  /** Opens the window (or brings it forward), on a record id or the most recent pending one. */
  static show(recordId, handlers) {
    const app = RewardsWindow.instance ?? new RewardsWindow({ recordId, handlers });
    RewardsWindow.instance = app;
    if ( recordId ) app.recordId = recordId;
    // A window not drawn yet has no element to bring forward (the first opening threw, seen on the bench).
    const shown = app.rendered;
    app.render({ force: true });
    if ( shown ) app.bringToFront();
    return app;
  }

  /** The record changed somewhere (this client or another GM): redraw. */
  static refresh() {
    const app = RewardsWindow.instance;
    if ( app?.rendered ) app.render();
  }

  get title() {
    return loc("Rewards.Title");
  }

  /** The record shown: the one chosen, else the most recent pending one. */
  #record() {
    return (this.recordId && this.handlers.get(this.recordId)) || this.handlers.current();
  }

  async _prepareContext() {
    const records = this.handlers.list();
    const record = this.#record();
    if ( record ) this.recordId = record.id;
    const plan = record ? planAward(record) : null;
    const shares = new Map((plan?.shares ?? []).map(s => [s.uuid, s.xp]));
    const offReason = xpOffReason();
    return { records, record, plan, shares, enabled: !offReason, offReason, mode: record?.split ?? setting("xpSplit") };
  }

  async _renderHTML(context) {
    const root = document.createElement("form");
    root.className = "dlo-body dlo-rewards-body";
    root.addEventListener("submit", event => event.preventDefault());
    const { record, plan, records, enabled, offReason, mode, shares } = context;

    const picker = `
      <div class="dlo-rw-top">
        <select name="record" aria-label="${loc("Rewards.Encounter")}">
          ${records.map(r => `<option value="${r.id}" ${r.id === record?.id ? "selected" : ""}>${escape(r.name)} — ${loc(`Rewards.Status.${r.status}`)}</option>`).join("")}
        </select>
        <button type="button" data-action="create" data-tooltip="${loc("Rewards.NewHint")}"><i class="fa-solid fa-plus"></i> ${loc("Rewards.New")}</button>
      </div>`;
    const off = enabled ? "" : `<p class="dlo-blocked"><i class="fa-solid fa-circle-info"></i> ${xpOffText(offReason)}</p>`;
    if ( !record ) {
      root.innerHTML = `${picker}${off}<p class="dlo-empty">${loc("Rewards.None")}</p>`;
      return root;
    }

    const foes = record.foes.map(f => `
      <li class="dlo-rw-row ${f.awarded ? "dlo-rw-done" : ""}">
        <input type="checkbox" data-field="foe" data-key="${escape(f.key)}" ${f.include ? "checked" : ""} ${f.awarded ? "disabled" : ""}>
        <img src="${escape(f.img)}" alt="">
        <span class="dlo-rw-name">${escape(f.name)}</span>
        <span class="dlo-rw-tag">${f.awarded ? `<i class="fa-solid fa-check"></i> ${loc("Rewards.Given")}`
          : (f.defeated ? loc("Rewards.Defeated") : loc("Rewards.NotDefeated"))}</span>
        <span class="dlo-rw-xp">${number(f.xp)} XP</span>
      </li>`).join("");

    const weights = mode === "weight";
    const members = record.members.map(m => {
      const actor = fromUuidSync(m.uuid, { strict: false });
      const level = actor?.system?.details?.level ?? "?";
      return `
      <li class="dlo-rw-row">
        <input type="checkbox" data-field="member" data-key="${escape(m.uuid)}" ${m.include ? "checked" : ""}>
        <img src="${escape(m.img)}" alt="">
        <a class="dlo-rw-name" data-action="openSheet" data-uuid="${escape(m.uuid)}">${escape(m.name)}</a>
        <span class="dlo-rw-tag">${loc("Rewards.Level", { level })}${m.present ? "" : ` · ${loc("Rewards.Absent")}`}</span>
        ${weights ? `<input type="number" class="dlo-rw-weight" data-field="weight" data-key="${escape(m.uuid)}" min="0" step="0.25"
          value="${Number(m.weight ?? 1)}" data-tooltip="${loc("Rewards.WeightHint")}">` : ""}
        <span class="dlo-rw-xp">${m.include ? `+${number(shares.get(m.uuid) ?? 0)} XP` : "—"}</span>
      </li>`;
    }).join("");

    const allies = record.allies.map(a => `
      <li class="dlo-rw-row">
        <input type="checkbox" data-field="ally" data-key="${escape(a.uuid)}" ${a.include ? "checked" : ""}>
        <img src="${escape(a.img)}" alt="">
        <span class="dlo-rw-name">${escape(a.name)}</span>
        <span class="dlo-rw-tag">${loc("Rewards.AllyTag")}</span>
      </li>`).join("");

    const rest = [
      plan.toParty ? loc("Rewards.ToParty", { xp: number(plan.toParty) }) : "",
      plan.lost ? loc("Rewards.Lost", { xp: number(plan.lost) }) : ""
    ].filter(Boolean).join(" · ");

    root.innerHTML = `${picker}${off}
      <section class="dlo-rw-section">
        <h3><i class="fa-solid fa-skull"></i> ${loc("Rewards.Foes")}</h3>
        ${foes ? `<ul class="dlo-rw-list">${foes}</ul>` : `<p class="dlo-empty">${loc("Rewards.NoFoes")}</p>`}
        <p class="dlo-hint">${loc("Rewards.FoesHint")}</p>
      </section>
      <section class="dlo-rw-section">
        <h3><i class="fa-solid fa-star"></i> ${loc("Rewards.Bonus")}</h3>
        <div class="dlo-rw-bonus">
          <input type="number" name="bonus" min="0" step="1" value="${Number(record.bonus) || 0}" aria-label="${loc("Rewards.Bonus")}">
          ${DIFFICULTIES.map(d => `<button type="button" data-action="challenge" data-difficulty="${d}"
            data-tooltip="${loc("Rewards.ChallengeHint")}">${loc(`Rewards.Challenge.${d}`)}</button>`).join("")}
        </div>
        <input type="text" name="reason" value="${escape(record.reason)}" placeholder="${loc("Rewards.Reason")}">
      </section>
      <section class="dlo-rw-section">
        <h3><i class="fa-solid fa-users"></i> ${loc("Rewards.Members")}</h3>
        ${members ? `<ul class="dlo-rw-list">${members}</ul>` : `<p class="dlo-empty">${loc("Rewards.NoMembers")}</p>`}
        ${allies ? `<h4>${loc("Rewards.Allies")}</h4><ul class="dlo-rw-list">${allies}</ul><p class="dlo-hint">${loc("Rewards.AlliesHint")}</p>` : ""}
      </section>
      <section class="dlo-rw-section dlo-rw-sum">
        <label>${loc("Rewards.Split")}
          <select name="split">${XP_SPLIT.map(s => `<option value="${s}" ${s === mode ? "selected" : ""}>${loc(`Rewards.SplitMode.${s}`)}</option>`).join("")}</select>
        </label>
        <p class="dlo-rw-total"><strong>${loc("Rewards.Total", { xp: number(plan.xp) })}</strong>${rest ? ` <span class="dlo-muted">(${rest})</span>` : ""}</p>
      </section>
      <footer class="dlo-foot">
        <button type="button" data-action="dismiss"><i class="fa-solid fa-xmark"></i> ${loc("Rewards.Dismiss")}</button>
        <button type="button" class="dlo-on" data-action="award" ${enabled ? "" : "disabled"}><i class="fa-solid fa-trophy"></i> ${loc("Rewards.Give")}</button>
      </footer>`;
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelector("form.dlo-rewards-body")?.addEventListener("change", event => this.#onChange(event));
  }

  _onClose(options) {
    super._onClose(options);
    if ( RewardsWindow.instance === this ) RewardsWindow.instance = null;
  }

  /** A field changed: the record is updated and saved (the redraw follows the saved record). */
  async #onChange(event) {
    const el = event.target;
    if ( el.name === "record" ) { this.recordId = el.value; return this.render(); }
    const record = this.#record();
    if ( !record ) return;
    const key = el.dataset.key;
    switch ( el.dataset.field ?? el.name ) {
      case "foe": { const f = record.foes.find(x => x.key === key); if ( f ) f.include = el.checked; break; }
      case "member": { const m = record.members.find(x => x.uuid === key); if ( m ) m.include = el.checked; break; }
      case "ally": { const a = record.allies.find(x => x.uuid === key); if ( a ) a.include = el.checked; break; }
      case "weight": { const m = record.members.find(x => x.uuid === key); if ( m ) m.weight = Math.max(0, Number(el.value) || 0); break; }
      case "bonus": record.bonus = Math.max(0, Math.floor(Number(el.value) || 0)); break;
      case "reason": record.reason = String(el.value ?? "").slice(0, 200); break;
      case "split": record.split = XP_SPLIT.includes(el.value) ? el.value : null; break;
      default: return;
    }
    await this.handlers.save(record);
  }

  static async #onChallenge(event, target) {
    const record = this.#record();
    if ( !record ) return;
    record.bonus = challengeFor(record, target.dataset.difficulty);
    if ( !record.reason ) record.reason = loc(`Rewards.Challenge.${target.dataset.difficulty}`);
    await this.handlers.save(record);
  }

  static async #onAward(event, target) {
    const record = this.#record();
    if ( !record ) return;
    target.disabled = true;
    try { await this.handlers.award(record.id); }
    finally { if ( this.rendered ) this.render(); }
  }

  static async #onDismiss() {
    const record = this.#record();
    if ( !record ) return;
    await this.handlers.dismiss(record.id);
    this.recordId = null;
    this.render();
  }

  static async #onCreate() {
    const record = await this.handlers.create();
    this.recordId = record?.id ?? null;
    this.render();
  }

  static #onOpenSheet(event, target) {
    fromUuidSync(target.dataset.uuid, { strict: false })?.sheet?.render(true);
  }
}
