/**
 * Comportement de région « DAS · Piège » (SPEC §3.12) : `darsh-loot.trap`, déclaré dans module.json.
 *
 * 0.17.0 (pièges v2) : la région qui le porte est la **zone d'effet**, et il porte toute la configuration. Il désigne son
 * **déclencheur** (`triggerRegion` : une autre région, la dalle ; vide : cette région) et sa **source** (`source.uuid` : une région
 * ou une tuile, d'où part l'effet ; vide : le déclencheur), chacun avec sa détection. Un déclencheur ailleurs reçoit un
 * **relais** (`darsh-loot.trapTrigger`), ajouté par le module : Foundry ne prévient d'une entrée que la région qui porte le
 * comportement. L'ancien champ `effectRegion` (0.16.0 : le piège sur sa dalle, la zone d'effet ailleurs) n'est plus lu que pour
 * la reprise des données.
 *
 * Il réagit à l'évènement du cœur « un token entre dans la région » (`tokenMoveIn`, V14 : aussi pendant un déplacement, qu'il
 * vienne de la marche du moteur ou d'un glisser), sur le modèle du comportement « Mettre en pause » du cœur
 * (client/data/region-behaviors/pause-game.mjs) : le client qui déplace arrête son token, le MJ actif fait le reste. Ce
 * reste est dans runtime/traps.mjs, qui fournit `TrapZoneType.onEnter` au démarrage (une couche `adapter/` ne connaît pas
 * `runtime/`).
 */
import { MODULE_ID } from "../shared.mjs";
import { hiddenField } from "./hidden.mjs";
import { TRAP_DEFAULTS, SIZES } from "../core/traps.mjs";

export const TRAP_ZONE = `${MODULE_ID}.trap`;
export const TRAP_RELAY = `${MODULE_ID}.trapTrigger`;

/** Les tailles minimales proposées pour déclencher (libellés de dnd5e). */
const SIZE_CHOICES = () => Object.fromEntries(SIZES.map(k => [k, CONFIG.DND5E?.actorSizes?.[k]?.label ?? k]));

/** Le groupe `source` : la région ou la tuile d'où part l'effet, et sa propre détection. */
function sourceField() {
  const hidden = hiddenField();
  hidden.fields.enabled.initial = true;
  return new fields.SchemaField({
    uuid: new fields.DocumentUUIDField({ nullable: true, initial: null }),
    hidden
  });
}

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
      // Le déclencheur : une autre région de la scène (la dalle), ou cette région (vide).
      triggerRegion: new fields.DocumentUUIDField({ type: "Region", nullable: true, initial: null }),
      // La plus petite créature qui le fait partir (2026-10-27 : Petite par défaut).
      minSize: new fields.StringField({ required: true, blank: false, initial: TRAP_DEFAULTS.minSize, choices: SIZE_CHOICES }),
      // Hauteur au-dessus du sol du déclencheur sous laquelle on déclenche (0 : seulement ce qui touche le sol).
      height: new fields.NumberField({ required: true, min: 0, initial: 0 }),
      source: sourceField(),
      // Son initiative en mode avancé (2026-10-27 : 20 par défaut ; un piège lent, moins).
      initiative: new fields.NumberField({ required: true, integer: true, min: 1, max: 40, initial: TRAP_DEFAULTS.initiative }),
      // 0.16.0 : la zone d'effet quand le piège était posé sur sa dalle. Lu seulement par la reprise des données.
      effectRegion: new fields.DocumentUUIDField({ type: "Region", nullable: true, initial: null }),
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

/**
 * Le groupe de champs `trap` d'un conteneur piégé (0.16.0) : les réglages d'un « DAS · Piège », plus `enabled` et `trigger`. Sans
 * zone d'effet, le piège ne touche que celui qui ouvre ; la zone d'effet peut être ailleurs (le mur aux fléchettes en face).
 * Son option « cachée » est la sienne : un coffre bien visible peut cacher son aiguille.
 */
export function trapField() {
  const d = TRAP_DEFAULTS;
  const hidden = hiddenField();
  hidden.fields.enabled.initial = true;
  return new fields.SchemaField({
    enabled: new fields.BooleanField({ initial: d.enabled }),
    actor: new fields.DocumentUUIDField({ type: "Actor", nullable: true, initial: null }),
    activity: new fields.StringField({ required: true, blank: true, initial: d.activity }),
    effectRegion: new fields.DocumentUUIDField({ type: "Region", nullable: true, initial: null }),
    trigger: new fields.StringField({ required: true, blank: false, initial: d.trigger,
      choices: { open: "DLO.TrappedTrap.Trigger.Open", pick: "DLO.TrappedTrap.Trigger.Pick", both: "DLO.TrappedTrap.Trigger.Both" } }),
    armed: new fields.BooleanField({ initial: d.armed }),
    rearm: new fields.StringField({ required: true, blank: false, initial: d.rearm,
      choices: { never: "DLO.TrapZone.Rearm.Never", gm: "DLO.TrapZone.Rearm.Gm", time: "DLO.TrapZone.Rearm.Time" } }),
    delay: new fields.NumberField({ required: true, min: 0, initial: d.delay }),
    triggeredAt: new fields.NumberField({ required: false, nullable: true, initial: null }),
    disarmDc: new fields.NumberField({ required: true, integer: true, min: 1, max: 40, initial: d.disarmDc }),
    failure: new fields.StringField({ required: true, blank: false, initial: d.failure,
      choices: { nothing: "DLO.TrapZone.Failure.Nothing", trigger: "DLO.TrapZone.Failure.Trigger" } }),
    disarmed: new fields.BooleanField({ initial: d.disarmed }),
    minSize: new fields.StringField({ required: true, blank: false, initial: d.minSize, choices: SIZE_CHOICES }),
    initiative: new fields.NumberField({ required: true, integer: true, min: 1, max: 40, initial: d.initiative }),
    hidden,
    source: sourceField()
  });
}

/**
 * Le relais d'un déclencheur (0.17.0) : posé par le module sur la région désignée comme déclencheur d'un « DAS · Piège » ; une
 * entrée dans sa région fait partir le piège nommé. Le MJ n'a rien à y régler.
 */
export class TrapRelayType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["DLO.TrapRelay"];

  static defineSchema() {
    // Le piège : un comportement « DAS · Piège », ou (0.17.0) un token piège.
    return { trap: new fields.DocumentUUIDField({ nullable: true, initial: null }) };
  }

  /** Fourni par runtime/traps.mjs : `(relay, event) => void`. */
  static onEnter = null;

  static async #onTokenMoveIn(event) {
    return TrapRelayType.onEnter?.(this.parent, event);
  }

  static events = {
    [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: this.#onTokenMoveIn
  };
}

export function registerTrapBehavior() {
  CONFIG.RegionBehavior.dataModels[TRAP_ZONE] = TrapZoneType;
  CONFIG.RegionBehavior.typeIcons[TRAP_ZONE] = "fa-solid fa-burst";
  if ( CONFIG.RegionBehavior.typeHints ) CONFIG.RegionBehavior.typeHints[TRAP_ZONE] = "DLO.TrapZone.Hint";
  CONFIG.RegionBehavior.dataModels[TRAP_RELAY] = TrapRelayType;
  CONFIG.RegionBehavior.typeIcons[TRAP_RELAY] = "fa-solid fa-shoe-prints";
  if ( CONFIG.RegionBehavior.typeHints ) CONFIG.RegionBehavior.typeHints[TRAP_RELAY] = "DLO.TrapRelay.Hint";
}

/** Les relais d'une région (0.17.0). */
export const relaysOf = region => (region?.behaviors ?? []).filter(b => b.type === TRAP_RELAY);

/** Les pièges d'une scène (actifs). */
export function sceneTraps(scene) {
  const out = [];
  for ( const region of scene?.regions ?? [] ) {
    for ( const behavior of region.behaviors ) if ( (behavior.type === TRAP_ZONE) && !behavior.disabled ) out.push(behavior);
  }
  return out;
}

/** Un piège dont le déclencheur est repéré (trouvé, ou jamais caché) et pas désamorcé : il se montre en rouge et se désamorce. */
export function trapKnown(behavior) {
  const h = behavior.system.hidden;
  return (!h?.enabled || h.found) && !behavior.system.disarmed;
}
