/**
 * Comportement de région « DAS · Piège » (SPEC §3.12) : `darsh-loot.trap`, déclaré dans module.json. La région qui le porte
 * est la **zone de déclenchement** ; la **zone d'effet** est une autre région (champ `effectRegion`) ou la même.
 *
 * Il réagit à l'évènement du cœur « un token entre dans la région » (`tokenMoveIn`, V14 : aussi pendant un déplacement, qu'il
 * vienne de la marche du moteur ou d'un glisser), sur le modèle du comportement « Mettre en pause » du cœur
 * (client/data/region-behaviors/pause-game.mjs) : le client qui déplace arrête son token, le MJ actif fait le reste. Ce
 * reste est dans runtime/traps.mjs, qui fournit `TrapZoneType.onEnter` au démarrage (une couche `adapter/` ne connaît pas
 * `runtime/`).
 */
import { MODULE_ID } from "../shared.mjs";
import { hiddenField } from "./hidden.mjs";

export const TRAP_ZONE = `${MODULE_ID}.trap`;

const fields = foundry.data.fields;

export class TrapZoneType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["DLO.Zone", "DLO.Hidden", "DLO.TrapZone"];

  static defineSchema() {
    const hidden = hiddenField();
    // Un piège est caché par nature : l'option est cochée d'emblée.
    hidden.fields.enabled.initial = true;
    return {
      label: new fields.StringField({ required: true, blank: true, initial: "" }),
      // L'acteur qui « lance » le piège (un piège du DMG 2024, ou fait main) et l'activité utilisée (vide : la première).
      actor: new fields.DocumentUUIDField({ type: "Actor", nullable: true, initial: null }),
      activity: new fields.StringField({ required: true, blank: true, initial: "" }),
      // Zone d'effet : une autre région de la scène (le couloir), ou la même (vide).
      effectRegion: new fields.DocumentUUIDField({ type: "Region", nullable: true, initial: null }),
      // Hauteur au-dessus du sol de la zone sous laquelle on déclenche (0 : seulement ce qui touche le sol).
      height: new fields.NumberField({ required: true, min: 0, initial: 0 }),
      armed: new fields.BooleanField({ initial: true }),
      rearm: new fields.StringField({ required: true, blank: false, initial: "never",
        choices: { never: "DLO.TrapZone.Rearm.Never", gm: "DLO.TrapZone.Rearm.Gm", time: "DLO.TrapZone.Rearm.Time" } }),
      // Délai de réarmement, en minutes de temps du monde (calendrier).
      delay: new fields.NumberField({ required: true, min: 0, initial: 60 }),
      triggeredAt: new fields.NumberField({ required: false, nullable: true, initial: null }),
      disarmDc: new fields.NumberField({ required: true, integer: true, min: 1, max: 40, initial: 15 }),
      failure: new fields.StringField({ required: true, blank: false, initial: "trigger",
        choices: { nothing: "DLO.TrapZone.Failure.Nothing", trigger: "DLO.TrapZone.Failure.Trigger" } }),
      disarmed: new fields.BooleanField({ initial: false }),
      hidden
    };
  }

  /** Fourni par runtime/traps.mjs : `(behavior, event) => void`. */
  static onEnter = null;

  static async #onTokenMoveIn(event) {
    return TrapZoneType.onEnter?.(this.parent, event);
  }

  static events = {
    [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: this.#onTokenMoveIn
  };

  get displayName() {
    return this.label || this.region?.name || "";
  }
}

export function registerTrapBehavior() {
  CONFIG.RegionBehavior.dataModels[TRAP_ZONE] = TrapZoneType;
  CONFIG.RegionBehavior.typeIcons[TRAP_ZONE] = "fa-solid fa-burst";
  if ( CONFIG.RegionBehavior.typeHints ) CONFIG.RegionBehavior.typeHints[TRAP_ZONE] = "DLO.TrapZone.Hint";
}

/** Les pièges d'une scène (actifs). */
export function sceneTraps(scene) {
  const out = [];
  for ( const region of scene?.regions ?? [] ) {
    for ( const behavior of region.behaviors ) if ( (behavior.type === TRAP_ZONE) && !behavior.disabled ) out.push(behavior);
  }
  return out;
}

/** Un piège repéré (trouvé, ou jamais caché) et pas désamorcé : il se montre en rouge et se désamorce. */
export function trapKnown(behavior) {
  const h = behavior.system.hidden;
  return (!h?.enabled || h.found) && !behavior.system.disarmed;
}
