import { MODULE_ID, loc, log, setting } from "../shared.mjs";
import { genericScrollSlot, spellScrollSlot, needsScrollIdentification, identificationMode,
  spellChoices, resolvedScroll } from "../adapter/random-scrolls.mjs";
import { inTurn, operation } from "../adapter/ledger.mjs";
import { askGM } from "./take.mjs";

const REQUEST = MODULE_ID + ".identifyScroll";
const ROLL = MODULE_ID + ".rollScrollIdentification";
const pending = new Set();
const t = (key, data) => loc("RandomScrolls." + key, data);
const esc = value => foundry.utils.escapeHTML(String(value ?? ""));

export async function notifyLootScrolls(actor, ids) {
  if (actor.type !== "character" || !game.user.isGM
    || !game.users.some(user => !user.isGM && actor.testUserPermission(user, "OWNER"))) return;
  const whisper = game.users.filter(user => user.isGM).map(user => user.id);
  for (const id of ids) {
    const item = actor.items.get(id);
    if (!spellScrollSlot(item)) continue;
    await ChatMessage.implementation.create({
      content: '<p>' + esc(t("Received", { actor: actor.name, item: item.name })) + '</p>'
        + '<div class="flexrow"><button type="button" data-dlo-scroll="roll">' + esc(t("Roll")) + '</button>'
        + '<button type="button" data-dlo-scroll="choose">' + esc(t("Choose")) + '</button></div>',
      whisper, flags: { [MODULE_ID]: { receivedScroll: item.uuid } }
    });
  }
}

async function writeSpell(uuid, choose, { identified = false } = {}) {
  const item = await fromUuid(uuid);
  if (!game.user.isGM || !spellScrollSlot(item) || item.pack) return false;
  if (!identified && needsScrollIdentification(item)) {
    ui.notifications.info(t("IdentifyFirst"));
    return false;
  }
  const slot = spellScrollSlot(item);
  const choices = await spellChoices(slot);
  if (!choices.length) {
    ui.notifications.warn(t("Unavailable"));
    return false;
  }
  const spell = choose ? await chooseSpell(choices) : choices[Math.floor(Math.random() * choices.length)];
  if (!spell) return false;
  const actor = item.actor;
  return inTurn([actor ?? item], async () => {
    const current = await fromUuid(uuid);
    if (!spellScrollSlot(current) || spellScrollSlot(current) !== slot
      || (!identified && needsScrollIdentification(current))) return false;
    const data = await resolvedScroll(spell, current.toObject());
    if (!data) return false;
    const quantity = current.system.quantity ?? 1;
    if (quantity < 1) return false;
    if (quantity === 1) {
      await current.update({ name: data.name, img: data.img, system: data.system, flags: data.flags },
        { recursive: false, diff: false });
    } else {
      await operation({ label: t("Roll"), journal: false }, async op => {
        const [created] = actor ? await actor.createEmbeddedDocuments("Item", [data])
          : await CONFIG.Item.documentClass.createDocuments([{ ...data, folder: current.folder?.id }]);
        if (!created) throw new Error(t("Unavailable"));
        op.did(t("Roll"), () => created.delete());
        await current.update({ "system.quantity": quantity - 1 });
      });
    }
    return true;
  });
}

async function chooseSpell(choices) {
  const options = choices.map(spell => '<option value="' + esc(spell.uuid) + '">' + esc(spell.name)
    + ' (' + spell.level + ')</option>').join("");
  const uuid = await foundry.applications.api.DialogV2.wait({
    window: { title: t("Choose") },
    content: '<select name="spell" aria-label="' + esc(t("Choose")) + '">' + options + '</select>',
    buttons: [{ action: "choose", label: t("Choose"), callback: (_event, button) => new FormData(button.form).get("spell") },
      { action: "cancel", label: t("Cancel"), callback: () => null }],
    rejectClose: false
  });
  return choices.find(spell => spell.uuid === uuid);
}

function scrollCheck(item) {
  const slot = genericScrollSlot(item);
  const level = Number(slot?.split("-")[1]) || 0;
  return { skill: "arc", ability: setting("scrollAbility"),
    target: setting("scrollDC") + setting("scrollDCPerLevel") * level };
}

async function configureCheck(item, defaults) {
  const abilities = Object.entries(CONFIG.DND5E.abilities).map(([key, ability]) =>
    '<option value="' + esc(key) + '"' + (key === defaults.ability ? " selected" : "") + '>' + esc(ability.label) + '</option>').join("");
  const skills = Object.entries(CONFIG.DND5E.skills).map(([key, skill]) =>
    '<option value="' + esc(key) + '"' + (key === defaults.skill ? " selected" : "") + '>' + esc(skill.label) + '</option>').join("");
  return foundry.applications.api.DialogV2.wait({
    window: { title: t("Identify") },
    content: '<p>' + esc(item.name) + '</p>'
      + '<div class="form-group"><label>' + esc(t("Check")) + '</label><select name="skill"><option value="">' + esc(t("AbilityCheck"))
      + '</option>' + skills + '</select></div>'
      + '<div class="form-group"><label>' + esc(t("Ability")) + '</label><select name="ability">' + abilities + '</select></div>'
      + '<div class="form-group"><label>' + esc(t("DC")) + '</label><input name="target" type="number" required min="1" value="' + defaults.target + '"></div>',
    buttons: [{ action: "roll", label: t("Identify"), callback: (_event, button) => {
      const form = new FormData(button.form);
      return { ability: form.get("ability"), skill: form.get("skill"), target: Number(form.get("target")) };
    } }, { action: "cancel", label: t("Cancel"), callback: () => null }],
    rejectClose: false
  });
}

async function identificationRoll({ actor: uuid, check, nonce }, { user }) {
  if (!user?.isGM) return false;
  const actor = await fromUuid(uuid);
  if (!actor?.isOwner) return false;
  const options = { ability: check.ability, target: check.target };
  const message = { data: { flags: { [MODULE_ID]: { scrollCheck: nonce } } } };
  const dialog = { configure: true, options: { chooseAbility: false } };
  const rolls = check.skill ? await actor.rollSkill({ ...options, skill: check.skill }, dialog, message)
    : await actor.rollAbilityCheck(options, dialog, message);
  return !!rolls?.length;
}

async function requestIdentification({ uuid }, { user }) {
  if (!game.user.isGM || !user?.active) return false;
  const item = await fromUuid(uuid);
  const actor = item?.actor;
  if (actor?.type !== "character" || !actor.testUserPermission(user, "OWNER") || !needsScrollIdentification(item)
    || pending.has(uuid)) return false;
  pending.add(uuid);
  try {
    const defaults = scrollCheck(item);
    const check = identificationMode() === "ask" ? await configureCheck(item, defaults) : defaults;
    if (!check || !Object.hasOwn(CONFIG.DND5E.abilities, check.ability)
      || (check.skill && !Object.hasOwn(CONFIG.DND5E.skills, check.skill))
      || !Number.isInteger(check.target) || check.target < 1) return false;
    const nonce = foundry.utils.randomID();
    const payload = { actor: actor.uuid, check, nonce };
    const didRoll = user.isSelf ? await identificationRoll(payload, { user: game.user })
      : await user.query(ROLL, payload, { timeout: 60000 });
    if (!didRoll) return false;
    const result = game.messages.contents.findLast(message => message.author?.id === user.id
      && message.getFlag(MODULE_ID, "scrollCheck") === nonce && message.getAssociatedActor?.()?.uuid === actor.uuid);
    if (!result?.rolls?.length) return false;
    if (result.rolls[0].total < check.target) {
      await ChatMessage.implementation.create({ content: '<p>' + esc(t("Failed", { actor: actor.name })) + '</p>',
        whisper: [...new Set([user.id, ...game.users.filter(u => u.isGM).map(u => u.id)])] });
      return false;
    }
    return await writeSpell(uuid, false, { identified: true });
  } finally {
    pending.delete(uuid);
  }
}

function run(action) {
  return Promise.resolve().then(action).catch(error => {
    log.warn("spell scroll", error);
    ui.notifications.warn(t("Error"));
    return false;
  });
}

export function registerScrollActions() {
  CONFIG.queries[REQUEST] = requestIdentification;
  CONFIG.queries[ROLL] = identificationRoll;
  Hooks.on(MODULE_ID + ".receivedScrolls", (actor, ids) => run(() => notifyLootScrolls(actor, ids)));

  // Both dnd5e and Tidy's item sheets dispatch this ApplicationV2 hook.
  Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    const item = app.document;
    if (!spellScrollSlot(item) || item.pack) return;
    if (needsScrollIdentification(item) && item.actor?.type === "character" && item.actor.isOwner) {
      controls.push({ action: "dloIdentifyScroll", icon: "fa-solid fa-magnifying-glass", label: t("Identify"),
        position: "header", onClick: () => askGM(REQUEST, requestIdentification, { uuid: item.uuid }, { timeout: 125000 }) });
    } else if (game.user.isGM) {
      controls.push({ action: "dloRollScroll", icon: "fa-solid fa-dice-d20", label: t("Roll"),
        position: "header", onClick: () => run(() => writeSpell(item.uuid, false)) });
    }
  });

  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (!game.user.isGM) return;
    const uuid = message.getFlag(MODULE_ID, "receivedScroll");
    if (!uuid) return;
    const buttons = [...html.querySelectorAll("button[data-dlo-scroll]")];
    for (const button of buttons) {
      button.addEventListener("click", async () => {
        buttons.forEach(control => { control.disabled = true; });
        const done = await run(() => writeSpell(uuid, button.dataset.dloScroll === "choose"));
        if (done) await run(() => message.update({ content: message.content.split('<div class="flexrow">')[0], ["flags." + MODULE_ID + ".-=receivedScroll"]: null }));
        else buttons.forEach(control => { control.disabled = false; });
      });
    }
  });
}
