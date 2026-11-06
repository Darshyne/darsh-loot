/**
 * Zones interactives « DAS · … » (SPEC §3.12), reprises de `coc7-dialogues` : Macro au clic, Vers une scène, Ouvrir un
 * document. Comme le Conteneur, elles ne réagissent à aucun évènement de région : le clic est lu par
 * runtime/pointer.mjs, et ce qu'il fait par runtime/zones.mjs.
 *
 * ⚠️ Pas de champ nommé `scene`, `region` ni `behavior` : la classe de base a des getters de ce nom qui le masqueraient
 * (vu dans `coc7-dialogues` 0.9.2 : `system.scene` rendait la scène courante).
 */
import { MODULE_ID } from "../shared.mjs";
import { hiddenField, behaviorConcealed } from "./hidden.mjs";
import { ACTIVATIONS, MECHANISM_MODES, ACTION_TYPES } from "../core/mechanisms.mjs";
import { SIZES } from "../core/traps.mjs";

export const MACRO_ZONE = `${MODULE_ID}.macro`;
export const SCENE_ZONE = `${MODULE_ID}.scene`;
export const DOCUMENT_ZONE = `${MODULE_ID}.document`;
/** Étape 13 (SPEC §3.13) : un levier, un bouton, une dalle, et ses actions. */
export const MECHANISM_ZONE = `${MODULE_ID}.mechanism`;
export const ZONE_TYPES = [MACRO_ZONE, SCENE_ZONE, DOCUMENT_ZONE, MECHANISM_ZONE];

const fields = foundry.data.fields;

/** Champs communs : un nom, et la portée exigée ou non (une sortie de carte, un levier : oui ; une affiche lue de loin : non). */
const commonFields = () => ({
  label: new fields.StringField({ required: true, blank: true, initial: "" }),
  reach: new fields.BooleanField({ initial: true }),
  // Option « cachée » (SPEC §3.12) : un levier secret, un passage, une inscription.
  hidden: hiddenField()
});

class ZoneBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static events = {};

  /** Le document visé, s'il est connu de ce client (un joueur ne reçoit pas un journal sans droit). */
  get target() { return null; }

  /** Nom montré : le libellé, sinon le nom du document visé, sinon celui de la région. */
  get displayName() {
    return this.label || this.target?.name || this.region?.name || "";
  }
}

export class MacroZoneType extends ZoneBehaviorType {
  static LOCALIZATION_PREFIXES = ["DLO.Zone", "DLO.Hidden", "DLO.MacroZone"];

  static defineSchema() {
    return {
      ...commonFields(),
      macro: new fields.DocumentUUIDField({ type: "Macro", nullable: true, initial: null })
    };
  }

  get target() { return this.macro ? fromUuidSync(this.macro, { strict: false }) : null; }
}

export class SceneZoneType extends ZoneBehaviorType {
  static LOCALIZATION_PREFIXES = ["DLO.Zone", "DLO.Hidden", "DLO.SceneZone"];

  static defineSchema() {
    return {
      ...commonFields(),
      targetScene: new fields.DocumentUUIDField({ type: "Scene", nullable: true, initial: null }),
      // MJ seulement : activer la scène pour toute la table au lieu de la regarder seul.
      activateForAll: new fields.BooleanField({ initial: false })
    };
  }

  get target() { return this.targetScene ? fromUuidSync(this.targetScene, { strict: false }) : null; }
}

export class DocumentZoneType extends ZoneBehaviorType {
  static LOCALIZATION_PREFIXES = ["DLO.Zone", "DLO.Hidden", "DLO.DocumentZone"];

  static defineSchema() {
    return {
      ...commonFields(),
      // Un journal ou une de ses pages : vérifié au clic (pas de `type` unique ici).
      document: new fields.DocumentUUIDField({ nullable: true, initial: null }),
      // Le MJ actif accorde Observateur à celui qui clique s'il n'a pas le droit de lire.
      grant: new fields.BooleanField({ initial: true })
    };
  }

  get target() { return this.document ? fromUuidSync(this.document, { strict: false }) : null; }
}

/**
 * « DAS · Mécanisme » (étape 13, SPEC §3.13) : un levier, un bouton ou une dalle. Il part au clic (une zone comme les autres : curseur,
 * portée, option « cachée », surbrillance), à l'entrée d'un token (une dalle), ou les deux ; ses actions sont faites par le MJ actif
 * (runtime/mechanisms.mjs) : porte, lumière, tuile, son, piège, macro. À bascule, il a deux positions, et la tuile qui le montre peut
 * changer d'image avec elles. Les actions sont une liste, réglée dans sa fenêtre (apps/mechanism-config.mjs).
 */
export class MechanismZoneType extends ZoneBehaviorType {
  static LOCALIZATION_PREFIXES = ["DLO.Zone", "DLO.Hidden", "DLO.MechanismZone"];

  static defineSchema() {
    const choices = (list, prefix) => Object.fromEntries(list.map(k => [k, `DLO.MechanismZone.${prefix}.${k}`]));
    return {
      ...commonFields(),
      activation: new fields.StringField({ required: true, blank: false, initial: "click", choices: choices(ACTIVATIONS, "Activation") }),
      // La plus petite créature qui enfonce la dalle (comme un piège : un rat passe).
      minSize: new fields.StringField({ required: true, blank: false, initial: "sm",
        choices: () => Object.fromEntries(SIZES.map(k => [k, CONFIG.DND5E?.actorSizes?.[k]?.label ?? k])) }),
      mode: new fields.StringField({ required: true, blank: false, initial: "toggle", choices: choices(MECHANISM_MODES, "Mode") }),
      // L'état : la position du levier (à bascule), déjà servi (une fois).
      active: new fields.BooleanField({ initial: false }),
      used: new fields.BooleanField({ initial: false }),
      // La tuile qui montre le levier, et son image dans chaque position (vide : elle ne change pas).
      tile: new fields.DocumentUUIDField({ type: "Tile", nullable: true, initial: null }),
      imageOff: new fields.FilePathField({ categories: ["IMAGE"], required: false, nullable: true, initial: null }),
      imageOn: new fields.FilePathField({ categories: ["IMAGE"], required: false, nullable: true, initial: null }),
      // Le son de l'actionnement, entendu de tous (vide : le son de levier par défaut).
      sound: new fields.FilePathField({ categories: ["AUDIO"], required: false, nullable: true, initial: null }),
      actions: new fields.ArrayField(new fields.SchemaField({
        type: new fields.StringField({ required: true, blank: false, initial: "door", choices: Object.fromEntries(ACTION_TYPES.map(k => [k, k])) }),
        target: new fields.StringField({ required: false, nullable: true, blank: true, initial: null }),
        mode: new fields.StringField({ required: true, blank: false, initial: "open" }),
        src: new fields.StringField({ required: false, blank: true, initial: "" }),
        volume: new fields.NumberField({ required: false, nullable: true, min: 0, max: 1, initial: 0.8 })
      }))
    };
  }

  /** Fourni par runtime/mechanisms.mjs : `(behavior, event) => void`. */
  static onEnter = null;

  static async #onTokenMoveIn(event) {
    return MechanismZoneType.onEnter?.(this.parent, event);
  }

  static events = {
    [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: this.#onTokenMoveIn
  };
}

const ICONS = {
  [MACRO_ZONE]: "fa-solid fa-hand-pointer",
  [SCENE_ZONE]: "fa-solid fa-door-open",
  [DOCUMENT_ZONE]: "fa-solid fa-scroll",
  [MECHANISM_ZONE]: "fa-solid fa-gears"
};

export function registerZoneBehaviors() {
  CONFIG.RegionBehavior.dataModels[MACRO_ZONE] = MacroZoneType;
  CONFIG.RegionBehavior.dataModels[SCENE_ZONE] = SceneZoneType;
  CONFIG.RegionBehavior.dataModels[DOCUMENT_ZONE] = DocumentZoneType;
  CONFIG.RegionBehavior.dataModels[MECHANISM_ZONE] = MechanismZoneType;
  for ( const [type, icon] of Object.entries(ICONS) ) CONFIG.RegionBehavior.typeIcons[type] = icon;
  // `typeHints` n'existe qu'en V14.
  const hints = CONFIG.RegionBehavior.typeHints;
  if ( hints ) {
    hints[MACRO_ZONE] = "DLO.MacroZone.Hint";
    hints[SCENE_ZONE] = "DLO.SceneZone.Hint";
    hints[DOCUMENT_ZONE] = "DLO.DocumentZone.Hint";
    hints[MECHANISM_ZONE] = "DLO.MechanismZone.Hint";
  }
}

/** Les zones actives d'une scène, visibles pour l'utilisateur (région cachée, zone pas encore trouvée : MJ seulement). */
export function sceneZones(scene) {
  const out = [];
  if ( !scene ) return out;
  const types = new Set(ZONE_TYPES);
  for ( const region of scene.regions ) {
    if ( region.hidden && !game.user.isGM ) continue;
    for ( const behavior of region.behaviors ) {
      if ( !types.has(behavior.type) || behavior.disabled ) continue;
      if ( !game.user.isGM && behaviorConcealed(behavior) ) continue;
      out.push(behavior);
    }
  }
  return out;
}
