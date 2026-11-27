/**
 * GM macro — opens the XP window of DAS · Loot & Trade (XP of the last encounters, a bonus for a noncombat challenge or a
 * milestone, how XP divides). Same as the trophy button of the tokens toolbar.
 */
if ( !game.user.isGM ) return ui.notifications.warn(game.i18n.lang === "fr" ? "Réservé au MJ." : "GM only.");
const api = game.modules.get("darsh-loot")?.api;
if ( !api?.rewards ) {
  return ui.notifications.warn(game.i18n.lang === "fr"
    ? "DAS · Loot & Trade (0.25 ou plus récent) doit être activé."
    : "DAS · Loot & Trade (0.25 or newer) must be active.");
}
api.rewards.open();
