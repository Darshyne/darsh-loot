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

export const MACRO_ZONE = `${MODULE_ID}.macro`;
export const SCENE_ZONE = `${MODULE_ID}.scene`;
export const DOCUMENT_ZONE = `${MODULE_ID}.document`;
export const ZONE_TYPES = [MACRO_ZONE, SCENE_ZONE, DOCUMENT_ZONE];

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

const ICONS = {
  [MACRO_ZONE]: "fa-solid fa-hand-pointer",
  [SCENE_ZONE]: "fa-solid fa-door-open",
  [DOCUMENT_ZONE]: "fa-solid fa-scroll"
};

export function registerZoneBehaviors() {
  CONFIG.RegionBehavior.dataModels[MACRO_ZONE] = MacroZoneType;
  CONFIG.RegionBehavior.dataModels[SCENE_ZONE] = SceneZoneType;
  CONFIG.RegionBehavior.dataModels[DOCUMENT_ZONE] = DocumentZoneType;
  for ( const [type, icon] of Object.entries(ICONS) ) CONFIG.RegionBehavior.typeIcons[type] = icon;
  // `typeHints` n'existe qu'en V14.
  const hints = CONFIG.RegionBehavior.typeHints;
  if ( hints ) {
    hints[MACRO_ZONE] = "DLO.MacroZone.Hint";
    hints[SCENE_ZONE] = "DLO.SceneZone.Hint";
    hints[DOCUMENT_ZONE] = "DLO.DocumentZone.Hint";
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
