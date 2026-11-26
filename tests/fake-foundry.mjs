/**
 * Un faux Foundry, juste assez pour jouer sous Node les gestes du MJ (adapter/, runtime/) : des acteurs et des objets
 * en mémoire, dont **chaque écriture n'arrive qu'après un délai**, comme un aller-retour au serveur. C'est ce délai qui
 * fait apparaître les croisements : deux gestes lancés ensemble lisent tous les deux avant que l'un ait écrit.
 * Rien ici ne vérifie de droits : ce n'est pas un modèle du serveur.
 */

/** Durée d'une écriture, en ms. */
const LATENCY = 2;
export const tick = (ms=LATENCY) => new Promise(resolve => setTimeout(resolve, ms));

/** Tout ce que le module nomme sans s'en servir dans ces tests (classes de base des fenêtres, champs de données…). */
const anything = () => new Proxy(function() {}, {
  get(target, key) {
    if ( key === "prototype" ) return target.prototype;
    if ( (key === "then") || (typeof key === "symbol") ) return undefined;
    return (target[key] ??= anything());
  },
  apply: () => anything(),
  construct: () => ({})
});

let lastId = 0;
const randomID = () => `id${++lastId}`;
const getProperty = (object, path) => path.split(".").reduce((o, k) => o?.[k], object);
const hasProperty = (object, path) => getProperty(object, path) !== undefined;
function setProperty(object, path, value) {
  const keys = path.split(".");
  let o = object;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}
function applyUpdate(doc, update) {
  for ( const [path, value] of Object.entries(update) ) {
    if ( path !== "_id" ) setProperty(doc, path, (value && (typeof value === "object")) ? structuredClone(value) : value);
  }
}

/**
 * Write failures on demand (lot 0): `faults.fail("delete", doc => doc.name === "Sword")` makes the next matching write throw,
 * like a server error in the middle of a gesture. Kinds: update, delete, create, updateEmbedded, deleteEmbedded.
 */
export const faults = {
  rules: [],
  fail(kind, match=() => true, times=1) { this.rules.push({ kind, match, times }); },
  clear() { this.rules.length = 0; },
  check(kind, doc, arg) {
    const rule = this.rules.find(r => (r.kind === kind) && (r.times > 0) && r.match(doc, arg));
    if ( !rule ) return;
    rule.times--;
    throw new Error(`fake server error (${kind})`);
  }
};

/** Chat messages created by the module, in order. */
export const chat = [];

/** Une collection de documents : une Map avec les quelques méthodes de tableau dont le module se sert. */
export class FakeCollection extends Map {
  get contents() { return [...this.values()]; }
  map(fn) { return this.contents.map(fn); }
  filter(fn) { return this.contents.filter(fn); }
  find(fn) { return this.contents.find(fn); }
  some(fn) { return this.contents.some(fn); }
}

/** Everything stored in this container, at any depth. */
function containedIn(actor, id) {
  const direct = actor.items.filter(i => i.system.container === id);
  return direct.flatMap(i => [i, ...containedIn(actor, i.id)]);
}

export class FakeItem {
  constructor(data, parent) {
    Object.assign(this, structuredClone(data));
    this.id = data._id ?? randomID();
    this.parent = parent;
    this.flags ??= {};
    this.system.properties = new Set(data.system.properties ?? []);
  }

  getFlag(scope, key) { return getProperty(this.flags, `${scope}.${key}`); }

  toObject() {
    const system = { ...structuredClone({ ...this.system, properties: undefined }), properties: [...this.system.properties] };
    return { _id: this.id, name: this.name, type: this.type, img: this.img, flags: structuredClone(this.flags), system };
  }

  async update(changes) {
    await tick();
    faults.check("update", this, changes);
    applyUpdate(this, changes);
    return this;
  }

  async delete({ deleteContents=false }={}) {
    await tick();
    faults.check("delete", this);
    if ( !this.parent.items.has(this.id) ) throw new Error(`Item "${this.id}" does not exist!`);
    this.parent.items.delete(this.id);
    if ( deleteContents ) for ( const inside of containedIn(this.parent, this.id) ) this.parent.items.delete(inside.id);
    return this;
  }
}

export class FakeActor {
  constructor({ id, name, type="character", currency={}, items=[], flags={}, owners=[] }) {
    Object.assign(this, { id, name, type, flags, owners, uuid: `Actor.${id}`, documentName: "Actor" });
    this.system = { currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...currency }, attributes: { hp: { value: 10 } } };
    this.statuses = new Set();
    this.items = new FakeCollection();
    for ( const data of items ) {
      const item = new FakeItem(data, this);
      this.items.set(item.id, item);
    }
    documents.set(this.uuid, this);
  }

  getFlag(scope, key) { return getProperty(this.flags, `${scope}.${key}`); }

  testUserPermission(user) { return user.isGM || this.owners.includes(user.id); }

  /** Combien d'exemplaires d'un objet de ce nom, toutes piles confondues. */
  count(name) { return this.items.filter(i => i.name === name).reduce((sum, i) => sum + (i.system.quantity ?? 1), 0); }

  async setFlag(scope, key, value) {
    await tick();
    faults.check("update", this, { [`flags.${scope}.${key}`]: value });
    setProperty(this.flags, `${scope}.${key}`, value);
    return this;
  }

  async update(changes) {
    await tick();
    faults.check("update", this, changes);
    applyUpdate(this, changes);
    return this;
  }

  async createEmbeddedDocuments(_type, data) {
    await tick();
    faults.check("create", this, data);
    return data.map(d => { const item = new FakeItem(d, this); this.items.set(item.id, item); return item; });
  }

  async delete() {
    await tick();
    faults.check("delete", this);
    documents.delete(this.uuid);
    return this;
  }

  async updateEmbeddedDocuments(_type, updates) {
    await tick();
    faults.check("updateEmbedded", this, updates);
    for ( const u of updates ) applyUpdate(this.items.get(u._id), u);
  }

  async deleteEmbeddedDocuments(_type, ids, { deleteContents=false }={}) {
    await tick();
    faults.check("deleteEmbedded", this, ids);
    for ( const id of ids ) {
      if ( !this.items.has(id) ) throw new Error(`Item "${id}" does not exist!`);
      const inside = deleteContents ? containedIn(this, id) : [];
      this.items.delete(id);
      for ( const i of inside ) this.items.delete(i.id);
    }
  }
}

/** La classe d'objet de dnd5e, réduite aux deux appels du module. `createWithContents` rend des données neuves (nouvel id). */
const FakeItem5e = {
  async createWithContents(items) {
    const out = [];
    const walk = (item, containerId) => {
      const data = { ...item.toObject(), _id: randomID() };
      data.system.container = containerId;
      out.push(data);
      for ( const inside of (item.parent?.items?.filter(i => i.system.container === item.id) ?? []) ) walk(inside, data._id);
    };
    for ( const item of items ) walk(item, null);
    return out;
  },
  async createDocuments(data, { parent }) {
    await tick();
    faults.check("create", parent, data);
    for ( const d of data ) {
      const item = new FakeItem(d, parent);
      parent.items.set(item.id, item);
    }
  }
};

/** Ce que `fromUuidSync` retrouve : les acteurs s'y inscrivent seuls, un test y ajoute ses tokens et ses régions. */
export const documents = new Map();

/** Les réglages du module lus par les gestes joués ici. */
export const settings = { reach: 5, announce: "none", whoLoots: "all", pickpocket: "on" };

/** Pose les globales de Foundry. À appeler avant d'importer un fichier du module (plusieurs les lisent au chargement). */
export function installFakeFoundry() {
  documents.clear();
  faults.clear();
  chat.length = 0;
  const stored = {};
  const users = Object.assign([], { get(id) { return this.find(u => u.id === id); }, activeGM: null });
  Object.assign(globalThis, {
    Actor: FakeActor,
    foundry: anything(),
    Hooks: { on() {}, once() {}, call() {}, callAll() {} },
    canvas: {},
    ui: { notifications: { info() {}, warn() {}, error() {} } },
    CONFIG: { queries: {}, Item: { documentClass: FakeItem5e }, DND5E: { currencies: { gp: { conversion: 1 } } } },
    CONST: { TOKEN_DISPLAY_MODES: {}, REGION_EVENTS: {}, DOCUMENT_OWNERSHIP_LEVELS: {}, WALL_DOOR_STATES: {},
      TOKEN_DISPOSITIONS: {}, REGION_VISIBILITY: {} },
    ChatMessage: { implementation: { create(data) { chat.push(data); return Promise.resolve(data); }, getSpeaker: () => ({}) } },
    fromUuidSync: uuid => documents.get(uuid) ?? null,
    fromUuid: async uuid => documents.get(uuid) ?? null,
    game: {
      settings: { get: (_module, key) => (key in stored ? stored[key] : settings[key]),
        set: async (_module, key, value) => { await tick(); stored[key] = structuredClone(value); return value; } },
      i18n: { localize: key => key, format: key => key, lang: "en" },
      users,
      actors: { get: id => documents.get(`Actor.${id}`) },
      time: { worldTime: 0 },
      modules: { get: () => null },
      packs: { get: () => null },
      messages: new Map(),
      combat: null,
      user: { id: "gm", isGM: true, name: "MJ" }
    }
  });
  Object.assign(foundry.utils, { getProperty, setProperty, hasProperty, randomID, escapeHTML: text => text });
}
