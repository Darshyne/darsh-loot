/**
 * Comportement de région « Conteneur » (SPEC §3.2) : `darsh-loot.container`, déclaré dans module.json
 * (`documentTypes.RegionBehavior.container`). Il ne réagit à aucun évènement de région : le clic est lu par
 * runtime/pointer.mjs (les comportements de région ne reçoivent pas de clic, et la couche des régions n'est jamais
 * active chez un joueur — même constat que tile-companions).
 *
 * Le contenu vit dans un acteur **Groupe** de dnd5e (inventaire et bourse natifs, le MJ y glisse des objets depuis sa
 * fiche), créé par le MJ à la création du comportement, rangé dans le dossier « Butin — conteneurs », droit « Limité »
 * pour tous : les joueurs reçoivent ainsi ses objets et ses mises à jour.
 */
import { MODULE_ID } from "../shared.mjs";

export const CONTAINER_TYPE = `${MODULE_ID}.container`;

const fields = foundry.data.fields;

export class ContainerBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["DLO.ContainerBehavior"];

  static defineSchema() {
    return {
      label: new fields.StringField({ required: true, blank: true, initial: "" }),
      actor: new fields.DocumentUUIDField({ type: "Actor", nullable: true, initial: null }),
      table: new fields.DocumentUUIDField({ type: "RollTable", nullable: true, initial: null }),
      draws: new fields.NumberField({ required: true, integer: true, min: 0, max: 20, initial: 1 }),
      hoard: new fields.StringField({ required: true, blank: true, initial: "",
        choices: { "": "DLO.ContainerBehavior.Hoard.None", 0: "DLO.ContainerBehavior.Hoard.B0",
          5: "DLO.ContainerBehavior.Hoard.B5", 11: "DLO.ContainerBehavior.Hoard.B11", 17: "DLO.ContainerBehavior.Hoard.B17" } }),
      theme: new fields.StringField({ required: true, blank: false, initial: "any",
        choices: { any: "DND5E.Treasure.Categories.Any", arcana: "DND5E.Treasure.Categories.Arcana",
          armaments: "DND5E.Treasure.Categories.Armaments", implements: "DND5E.Treasure.Categories.Implements",
          relics: "DND5E.Treasure.Categories.Relics" } }),
      rolled: new fields.BooleanField({ initial: false }),
      locked: new fields.BooleanField({ initial: false }),
      dc: new fields.NumberField({ required: true, integer: true, min: 1, max: 40, initial: 15 }),
      key: new fields.StringField({ required: true, blank: true, initial: "" }),
      // Propriétaire du contenu (une personne, une maison) : ce qu'on y prend est marqué volé (SPEC §3.3).
      owner: new fields.StringField({ required: true, blank: true, initial: "" })
    };
  }

  static events = {};

  /** Nom montré au joueur : le libellé, sinon le nom de la région. */
  get displayName() {
    return this.label || this.region?.name || "";
  }
}

export function registerContainerBehavior() {
  CONFIG.RegionBehavior.dataModels[CONTAINER_TYPE] = ContainerBehaviorType;
  CONFIG.RegionBehavior.typeIcons[CONTAINER_TYPE] = "fa-solid fa-treasure-chest";
}

/** Les conteneurs actifs d'une scène, visibles pour l'utilisateur. */
export function sceneContainers(scene) {
  const out = [];
  if ( !scene ) return out;
  for ( const region of scene.regions ) {
    if ( region.hidden && !game.user.isGM ) continue;
    for ( const behavior of region.behaviors ) {
      if ( (behavior.type === CONTAINER_TYPE) && !behavior.disabled ) out.push(behavior);
    }
  }
  return out;
}
