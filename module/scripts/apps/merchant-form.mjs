/**
 * The merchant settings form (SPEC §3.7), shared by the settings window (apps/merchant-config.mjs) and the « Settings » tab of the
 * GM's shop window (apps/shop-window.mjs): name, open or closed, open from anywhere, owner, description, prices, stolen goods,
 * stock and till, restock tables, factors per item type, attitude and discount per character. It writes nothing: the caller gets
 * the flag (`readMerchantForm`) and passes it to its `save` action.
 */
import { loc } from "../shared.mjs";
import { merchantOf } from "../adapter/shop.mjs";
import { ATTITUDES, STOLEN_POLICIES } from "../core/shop.mjs";

const escape = s => foundry.utils.escapeHTML(String(s ?? ""));

/** The item types a merchant can price apart (dnd5e physical types). */
export const ITEM_TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container"];

/** The player characters, for the attitude and discount of each. */
function characters() {
  return game.actors.filter(a => (a.type === "character") && a.hasPlayerOwner).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What the form shows. `tables`: the restock tables being edited (kept by the caller between two renders).
 * @returns {Promise<object>}
 */
export async function merchantFormContext(actor, tables) {
  const merchant = merchantOf(actor);
  const rows = [];
  for ( const t of tables ) {
    const doc = t.uuid ? await fromUuid(t.uuid).catch(() => null) : null;
    rows.push({ ...t, name: doc?.name ?? loc("Merchant.TableMissing") });
  }
  return { actor, merchant, tables: rows, characters: characters() };
}

/** The form's fields, as HTML (without the `<form>` itself and without its submit button). */
export function merchantFormHTML({ actor, merchant, tables, characters }) {
  const check = (name, value) => `<input type="checkbox" name="${name}" ${value ? "checked" : ""}>`;
  const number = (name, value, step="0.05") => `<input type="number" name="${name}" value="${value}" min="0" step="${step}">`;
  const options = (keys, current, label) => keys.map(k => `<option value="${k}" ${k === current ? "selected" : ""}>${label(k)}</option>`).join("");
  const attitudes = current => options(Object.keys(ATTITUDES), current, k => loc(`Merchant.Attitude.${k}`));
  const row = (label, field, hint="") => `
    <div class="form-group dlo-field"><label>${label}</label><div class="form-fields dlo-field-input">${field}</div>${hint ? `<p class="hint dlo-hint">${hint}</p>` : ""}</div>`;
  return `
    <fieldset>
      <legend>${loc("Merchant.Shop")}</legend>
      ${row(loc("Merchant.Name"), `<input type="text" name="name" value="${escape(actor.name)}" required>`)}
      ${row(loc("Merchant.Enabled"), check("enabled", merchant.enabled), loc("Merchant.EnabledHint"))}
      ${row(loc("Merchant.ClosedField"), check("closed", merchant.closed))}
      ${row(loc("Merchant.Remote"), check("remote", merchant.remote), loc("Merchant.RemoteHint"))}
      ${row(loc("Merchant.Owner"), `<input type="text" name="owner" value="${escape(merchant.owner)}">`, loc("Merchant.OwnerHint"))}
      ${row(loc("Merchant.Description"), `<textarea name="description" rows="3">${escape(merchant.description)}</textarea>`)}
    </fieldset>
    <fieldset>
      <legend>${loc("Merchant.Prices")}</legend>
      ${row(loc("Merchant.Buy"), number("buy", merchant.buy), loc("Merchant.BuyHint"))}
      ${row(loc("Merchant.Sell"), number("sell", merchant.sell), loc("Merchant.SellHint"))}
      ${row(loc("Merchant.AttitudeField"), `<select name="attitude">${attitudes(merchant.attitude)}</select>`, loc("Merchant.AttitudeHint"))}
      ${row(loc("Merchant.Stolen"), `<select name="stolen">${options(STOLEN_POLICIES, merchant.stolen, k => loc(`Merchant.StolenPolicy.${k}`))}</select>`)}
      ${row(loc("Merchant.FenceRate"), number("fenceRate", merchant.fenceRate), loc("Merchant.FenceRateHint"))}
    </fieldset>
    <fieldset>
      <legend>${loc("Merchant.Stock")}</legend>
      ${row(loc("Merchant.InfiniteStock"), check("infiniteStock", merchant.infiniteStock))}
      ${row(loc("Merchant.InfiniteCoins"), check("infiniteCoins", merchant.infiniteCoins))}
      <div class="dlo-merchant-tables">
        <p class="dlo-hint">${loc("Merchant.TablesHint")}</p>
        <ol>${tables.map((t, i) => `
          <li data-index="${i}">
            <span class="dlo-merchant-table-name">${escape(t.name)}</span>
            <input type="text" class="dlo-merchant-rolls" data-index="${i}" value="${escape(t.rolls)}" data-tooltip="${loc("Merchant.Rolls")}">
            <button type="button" data-action="removeTable" data-index="${i}" data-tooltip="${loc("Merchant.RemoveTable")}"><i class="fa-solid fa-xmark"></i></button>
          </li>`).join("")}</ol>
        <div class="dlo-merchant-drop">${loc("Merchant.DropTable")}</div>
      </div>
      <button type="button" data-action="memorize" data-tooltip="${loc("Merchant.MemorizeHint")}"><i class="fa-solid fa-thumbtack"></i> ${loc("Merchant.Memorize")}</button>
    </fieldset>
    <fieldset>
      <legend>${loc("Merchant.Types")}</legend>
      <p class="dlo-hint">${loc("Merchant.TypesHint")}</p>
      <table class="dlo-merchant-grid">
        <tr><th></th><th>${loc("Merchant.Buy")}</th><th>${loc("Merchant.Sell")}</th></tr>
        ${ITEM_TYPES.map(t => {
          const v = merchant.types[t] ?? { buy: 1, sell: 1 };
          return `<tr><td>${escape(game.i18n.localize(CONFIG.Item.typeLabels[t] ?? t))}</td>
            <td>${number(`types.${t}.buy`, v.buy)}</td><td>${number(`types.${t}.sell`, v.sell)}</td></tr>`;
        }).join("")}
      </table>
    </fieldset>
    <fieldset>
      <legend>${loc("Merchant.Characters")}</legend>
      <p class="dlo-hint">${loc("Merchant.CharactersHint")}</p>
      ${characters.length ? `<table class="dlo-merchant-grid">
        <tr><th></th><th>${loc("Merchant.AttitudeField")}</th><th>${loc("Merchant.Discount")}</th></tr>
        ${characters.map(c => {
          const v = merchant.characters[c.id] ?? { attitude: null, discount: 0 };
          return `<tr><td>${escape(c.name)}</td>
            <td><select name="characters.${c.id}.attitude"><option value="">${loc("Merchant.SameAttitude")}</option>${attitudes(v.attitude)}</select></td>
            <td><input type="number" name="characters.${c.id}.discount" value="${v.discount}" min="-100" max="100" step="5"></td></tr>`;
        }).join("")}
      </table>` : `<p class="dlo-empty">${loc("Merchant.NoCharacters")}</p>`}
    </fieldset>`;
}

/**
 * The form read back: the merchant flag (types and characters always written in full) and the name.
 * @param {object} data     `expandObject(formData.object)`.
 * @param {Array<{ uuid, rolls }>} tables
 * @param {object} [previous]  The flag as it was (keeps what the form does not show: the till reference).
 * @returns {{ flag: object, name: string }}
 */
export function readMerchantForm(data, tables, previous={}) {
  const num = (v, fallback) => (Number.isFinite(Number(v)) && (Number(v) >= 0) ? Number(v) : fallback);
  const flag = {
    ...(previous.purse ? { purse: previous.purse } : {}),
    enabled: !!data.enabled,
    closed: !!data.closed,
    remote: !!data.remote,
    owner: String(data.owner ?? "").trim(),
    description: String(data.description ?? ""),
    buy: num(data.buy, 1),
    sell: num(data.sell, 0.5),
    attitude: data.attitude,
    stolen: data.stolen,
    fenceRate: num(data.fenceRate, 0.5),
    infiniteStock: !!data.infiniteStock,
    infiniteCoins: !!data.infiniteCoins,
    tables: tables.map(t => ({ uuid: t.uuid, rolls: t.rolls })),
    types: Object.fromEntries(ITEM_TYPES.map(t => [t, { buy: num(data.types?.[t]?.buy, 1), sell: num(data.types?.[t]?.sell, 1) }])),
    characters: Object.fromEntries(Object.entries(data.characters ?? {}).map(([id, v]) => [id,
      { attitude: v.attitude || null, discount: Number(v.discount) || 0 }]))
  };
  return { flag, name: String(data.name ?? "").trim() };
}

/**
 * Wire the tables part of a rendered form: the number of rolls kept between renders, a RollTable dropped on the list added.
 * @param {HTMLElement} root
 * @param {Array<{ uuid, rolls }>} tables  Edited in place.
 * @param {Function} rerender
 */
export function wireTables(root, tables, rerender) {
  root.querySelectorAll(".dlo-merchant-rolls").forEach(input => input.addEventListener("change", () => {
    const t = tables[Number(input.dataset.index)];
    if ( t ) t.rolls = input.value.trim() || "1";
  }));
  const drop = root.querySelector(".dlo-merchant-tables");
  drop?.addEventListener("dragover", event => event.preventDefault());
  drop?.addEventListener("drop", event => {
    event.preventDefault();
    event.stopPropagation();
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if ( (data?.type !== "RollTable") || !data.uuid || tables.some(t => t.uuid === data.uuid) ) return;
    tables.push({ uuid: data.uuid, rolls: "1" });
    rerender();
  });
}
