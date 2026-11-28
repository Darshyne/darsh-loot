/**
 * The « Rewards » window (lot 2, 2026-11-27) — GM only. A view of one encounter record (adapter/xp.mjs): the creatures overcome
 * (ticked when defeated; a GM ticks one that fled or surrendered — the DMG counts them), the characters (who receives), the NPC
 * allies (who takes a share), a bonus for a noncombat challenge or a milestone, how the XP divides, and « Give ».
 * Every change is saved in the record at once: closed and reopened, after a reload, it is all there. It decides nothing: what
 * it does goes through the handlers received at opening (runtime/rewards.mjs).
 * Lot 3 (2026-11-27): a « Loot » part — the corpses of the encounter (held until the GM validates), individual or grouped (one
 * encounter chest), « keep the special weapons », the custom tables, « Distribute the loot ». With DAS's XP off, the window shows the
 * loot alone (and is named after it).
 */
import { MODULE_ID, loc, setting } from "../shared.mjs";
import { planAward, challengeFor, xpOffReason, xpOffText } from "../adapter/xp.mjs";
import { DIFFICULTIES, XP_SPLIT } from "../core/xp.mjs";
import { LOOT_MODES, titleKey, endLootSwitch } from "../core/end-loot.mjs";

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
      openSheet: RewardsWindow.#onOpenSheet,
      distribute: RewardsWindow.#onDistribute,
      lootRules: RewardsWindow.#onLootRules,
      openChest: RewardsWindow.#onOpenChest
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
    return game.i18n.localize(titleKey(!xpOffReason(), lootOn()));
  }

  /** The record shown: the one chosen, else the most recent pending one. */
  #record() {
    return (this.recordId && this.handlers.get(this.recordId)) || this.handlers.current();
  }

  async _prepareContext() {
    const offReason = xpOffReason();
    // With DAS's XP off, only the encounters that have loot are listed (a record without it has nothing to show here).
    const loot = lootOn();
    const xpView = !offReason || !loot;
    const records = this.handlers.list().filter(r => xpView || hasLoot(r));
    let record = this.#record();
    if ( record && !xpView && !hasLoot(record) ) record = records[0] ?? null;
    if ( record ) this.recordId = record.id;
    const plan = record ? planAward(record) : null;
    const shares = new Map((plan?.shares ?? []).map(s => [s.uuid, s.xp]));
    return { records, record, plan, shares, enabled: !offReason, offReason, mode: record?.split ?? setting("xpSplit"), loot };
  }

  async _renderHTML(context) {
    const root = document.createElement("form");
    root.className = "dlo-body dlo-rewards-body";
    root.addEventListener("submit", event => event.preventDefault());
    const { record, plan, records, enabled, offReason, mode, shares, loot } = context;
    // Lot 3: with the end-of-combat loot on and DAS's XP off, the XP part is not shown at all.
    const showXP = enabled || !loot;

    const picker = `
      <div class="dlo-rw-top">
        <select name="record" aria-label="${loc("Rewards.Encounter")}">
          ${records.map(r => `<option value="${r.id}" ${r.id === record?.id ? "selected" : ""}>${escape(r.name)} — ${recordStatus(r, showXP)}</option>`).join("")}
        </select>
        ${showXP ? `<button type="button" data-action="create" data-tooltip="${loc("Rewards.NewHint")}"><i class="fa-solid fa-plus"></i> ${loc("Rewards.New")}</button>` : ""}
      </div>`;
    const off = (enabled || !showXP) ? "" : `<p class="dlo-blocked"><i class="fa-solid fa-circle-info"></i> ${xpOffText(offReason)}</p>`;
    if ( !record ) {
      root.innerHTML = `${records.length ? picker : ""}${off}<p class="dlo-empty">${loc(showXP ? "Rewards.None" : "EndLoot.None")}</p>`;
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

    const xpParts = `${off}
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
      </section>`;
    root.innerHTML = `${picker}${showXP ? xpParts : ""}${lootSection(record)}
      <footer class="dlo-foot">
        <button type="button" data-action="dismiss"><i class="fa-solid fa-xmark"></i> ${loc("Rewards.Dismiss")}</button>
        ${showXP ? `<button type="button" class="dlo-on" data-action="award" ${enabled ? "" : "disabled"}><i class="fa-solid fa-trophy"></i> ${loc("Rewards.Give")}</button>` : ""}
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
      case "lootMode": if ( record.loot && LOOT_MODES.includes(el.value) ) record.loot.mode = el.value; break;
      case "keepSpecial": if ( record.loot ) record.loot.keepSpecial = el.checked; break;
      case "corpse": { const c = record.loot?.corpses.find(x => x.key === key); if ( c ) c.include = el.checked; break; }
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

  static async #onDistribute(event, target) {
    const record = this.#record();
    if ( !record?.loot ) return;
    target.disabled = true;
    try { await this.handlers.distribute(record.id, { mode: record.loot.mode, keepSpecial: !!record.loot.keepSpecial }); }
    finally { if ( this.rendered ) this.render(); }
  }

  static #onLootRules() {
    this.handlers.rules();
  }

  static #onOpenChest() {
    this.handlers.openChest(this.#record());
  }

  static #onOpenSheet(event, target) {
    fromUuidSync(target.dataset.uuid, { strict: false })?.sheet?.render(true);
  }
}

/** A record that has end-of-combat loot to show (waiting, distributed or set aside). */
const hasLoot = record => !endLootSwitch.withdrawn && !!record?.loot && (record.loot.status !== "none");

/** The GM's end-of-combat loot is on (`lootManage`). */
function lootOn() {
  if ( endLootSwitch.withdrawn ) return false;
  try { return (setting("lootManage") !== false) && (setting("corpseLoot") !== false); } catch { return false; }
}

/** A record's state in the picker: its XP state, and its loot state when it has one. */
function recordStatus(record, showXP) {
  const parts = [];
  if ( showXP && (record.status !== "none") ) parts.push(loc(`Rewards.Status.${record.status}`));
  if ( hasLoot(record) ) parts.push(loc(`EndLoot.Status.${record.loot.status}`));
  return parts.join(" · ") || loc("EndLoot.Status.none");
}

/** A corpse's line: its state now (gone, treasure already rolled, released by a forced search). */
function corpseTag(c) {
  const token = fromUuidSync(c.key, { strict: false });
  if ( c.released ) return loc("EndLoot.Released", { user: c.released });
  if ( !token?.actor ) return loc("EndLoot.Gone");
  return token.actor.getFlag(MODULE_ID, "rolled") ? loc("EndLoot.Rolled") : loc("EndLoot.ToRoll");
}

/** The « Loot » part of the window. */
function lootSection(record) {
  const loot = record?.loot;
  if ( !hasLoot(record) ) return "";
  const head = `<h3><i class="fa-solid fa-sack-dollar"></i> ${loc("EndLoot.Section")}</h3>`;
  if ( loot.status === "dismissed" ) {
    return `<section class="dlo-rw-section dlo-rw-loot">${head}<p class="dlo-hint">${loc("EndLoot.Dismissed")}</p></section>`;
  }
  if ( loot.status === "done" ) {
    const chest = loot.chest ? fromUuidSync(loot.chest.behavior, { strict: false }) : null;
    const how = loc(`EndLoot.Done.${loot.mode}`, { count: loot.done?.corpses?.length ?? 0, by: loot.done?.by ?? "?" });
    const chestLine = (loot.mode !== "grouped") ? ""
      : (chest ? `<button type="button" data-action="openChest"><i class="fa-solid fa-box-open"></i> ${loc("EndLoot.OpenChest")}</button>`
        : `<span class="dlo-muted">${loc("EndLoot.ChestGone")}</span>`);
    return `<section class="dlo-rw-section dlo-rw-loot">${head}
      <p class="dlo-rw-done-line"><i class="fa-solid fa-check"></i> ${escape(how)} ${chestLine}</p></section>`;
  }
  const rows = loot.corpses.map(c => `
      <li class="dlo-rw-row ${c.released ? "dlo-rw-done" : ""}">
        <input type="checkbox" data-field="corpse" data-key="${escape(c.key)}" ${c.include ? "checked" : ""} ${c.released ? "disabled" : ""}>
        <img src="${escape(c.img)}" alt="">
        <span class="dlo-rw-name">${escape(c.name)}</span>
        <span class="dlo-rw-tag">${escape(corpseTag(c))}</span>
      </li>`).join("");
  return `
      <section class="dlo-rw-section dlo-rw-loot">
        ${head}
        <div class="dlo-rw-loot-mode">
          ${LOOT_MODES.map(m => `<label class="dlo-rw-choice"><input type="radio" name="lootMode" value="${m}" ${loot.mode === m ? "checked" : ""}>
            <span>${loc(`EndLoot.Mode.${m}`)}</span></label>`).join("")}
        </div>
        <p class="dlo-hint">${loc(`EndLoot.ModeHint.${loot.mode}`)}</p>
        ${rows ? `<ul class="dlo-rw-list">${rows}</ul>` : `<p class="dlo-empty">${loc("EndLoot.NoCorpses")}</p>`}
        <label class="dlo-rw-check"><input type="checkbox" name="keepSpecial" ${loot.keepSpecial ? "checked" : ""}> ${loc("EndLoot.KeepSpecial")}</label>
        <p class="dlo-hint">${loc("EndLoot.HeldHint")}</p>
        <div class="dlo-rw-loot-actions">
          <button type="button" data-action="lootRules"><i class="fa-solid fa-table-list"></i> ${loc("EndLoot.Rules.Button")}</button>
          <button type="button" class="dlo-on" data-action="distribute" ${loot.corpses.some(c => c.include) ? "" : "disabled"}>
            <i class="fa-solid fa-sack-dollar"></i> ${loc(`EndLoot.Distribute.${loot.mode}`)}</button>
        </div>
      </section>`;
}
