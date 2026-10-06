/**
 * Le seul fichier qui connaît le moteur de combat `dnd5e-combat` (dépendance de ce module depuis le 2026-09-30, pas
 * l'inverse). On n'appelle que son API publique (`game.modules.get("dnd5e-combat").api`) et ses hooks publics, jamais
 * ses fichiers.
 */
import { tokenDistance } from "./dnd5e.mjs";

const ENGINE_ID = "dnd5e-combat";

/**
 * Le hook public du moteur à chaque étape d'une action (son SPEC §5.6, runtime/engine.mjs `publish`) :
 * `(resolution, event)`, résolution en lecture seule.
 */
export const RESOLUTION_HOOK = `${ENGINE_ID}.resolution`;

/**
 * Le hook par lequel le moteur demande si un module réclame un clic gauche (son SPEC §39.3, 0.145.1) : `(event)`, répondre
 * `false` pour qu'il l'ignore (ni déplacement, ni attaque). Appelé par `Hooks.call`.
 */
export const CLAIM_CLICK_HOOK = `${ENGINE_ID}.claimClick`;

/**
 * Le hook par lequel le moteur laisse les modules ajouter des entrées au menu contextuel d'un token (son SPEC §39.4,
 * 0.145.2) : `(entries, { token, target, aggressive })`, pousser `{ icon, label, run(event) }` dans `entries`.
 */
export const TOKEN_MENU_HOOK = `${ENGINE_ID}.tokenMenu`;

/**
 * Le hook par lequel le moteur propose de poser au sol ce qu'une créature lâche (Injonction « Lâche », son SPEC §40.3,
 * 0.146.0) : `(takers, { token, items })`, chez le MJ actif ; pousser dans `takers` une fonction `async () => boolean`
 * (vrai : les objets ont quitté la fiche et sont au sol).
 */
export const DROP_ITEMS_HOOK = `${ENGINE_ID}.dropItems`;

/** L'API publique du moteur, s'il est actif. */
function engineApi() {
  const engine = game.modules.get(ENGINE_ID);
  return engine?.active ? engine.api ?? null : null;
}

/**
 * La marche du moteur vers des cases (SPEC §4, demandée le 2026-09-30, pas encore écrite côté moteur) :
 * `api.approach(tokenDocument, { cells: [{ i, j }], level? }) → Promise<{ arrived: boolean, reason?: string }>`.
 * null tant que le moteur ne l'expose pas : la fouille à distance reste alors « Trop loin ».
 */
export function engineApproach() {
  const fn = engineApi()?.approach;
  return (typeof fn === "function") ? fn : null;
}

/**
 * Arrêter les marches du moteur lancées par ce client (option « cachée », SPEC §3.12 : une découverte arrête tout). Demandé
 * au moteur (SPEC §4) : tant qu'il ne l'expose pas (`api.stopWalks`), rien — l'arrêt du cœur (`stopMovement`) reste.
 */
export function engineStopWalks() {
  const fn = engineApi()?.stopWalks;
  if ( typeof fn !== "function" ) return false;
  try { fn(); return true; }
  catch(err) { return false; }
}

/**
 * Le budget du tour, tenu par le moteur (son SPEC §102, `api.budget`) : ce qui empêche une dépense (« notYourTurn »,
 * « noAction »…) et la dépense elle-même, chez le MJ actif. Sans le moteur, ou sans cette API : rien ne coûte.
 */
export function engineBudgetIssues(actor, cost="action") {
  const fn = engineApi()?.budget?.issues;
  return (typeof fn === "function") ? fn(actor, cost) : [];
}

export async function engineSpend(actor, cost="action") {
  const fn = engineApi()?.budget?.spend;
  return (typeof fn === "function") ? fn(actor, cost) : false;
}

/** Étapes finales d'une action du moteur (core/action.mjs `STEPS`). */
const FINAL_STEPS = new Set(["done", "missed"]);

/**
 * Une attaque d'arme de jet terminée, lue dans une résolution du moteur — ou null. Forme de la résolution (moteur,
 * core/action.mjs `open`) : `{ id, activity (UUID), source (UUID d'acteur), plan: { attack }, step, attack: { messageId },
 * targets: [{ token (UUID), hit }] }` ; le mode « lancer » est porté par le jet d'attaque (`rolls[0].options.attackMode`).
 * @returns {{ id: string, item: Item, thrower: TokenDocument, targets: { token: TokenDocument, hit: boolean }[] }|null}
 */
export function thrownAttack(resolution) {
  if ( !resolution?.plan?.attack || !FINAL_STEPS.has(resolution.step) || !resolution.attack?.messageId ) return null;
  const message = game.messages.get(resolution.attack.messageId);
  const rolledMode = message?.rolls?.[0]?.options?.attackMode ?? "";
  if ( !rolledMode.startsWith("thrown") ) return null;
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  const item = activity?.item;
  if ( (item?.type !== "weapon") || !item.actor ) return null;
  const speaker = message.speaker ?? {};
  const scene = game.scenes.get(speaker.scene) ?? canvas.scene;
  const thrower = scene?.tokens.get(speaker.token) ?? scene?.tokens.find(t => t.actor === item.actor) ?? null;
  if ( !thrower ) return null;
  const targets = (resolution.targets ?? [])
    .map(t => ({ token: fromUuidSync(t.token ?? "", { strict: false }), hit: t.hit === true }))
    .filter(t => t.token);
  // Seule l'action « Lancer » compte (demande utilisateur 2026-09-30). dnd5e mémorise le dernier mode d'une arme
  // (activity/attack.mjs:95) et le moteur le garde (son runtime/turn.mjs:257) : après un lancer, une attaque au contact
  // part encore en mode « lancer ». Un lancer, c'est donc : « Lancer » choisi dans le menu du moteur (drapeau
  // `attackMode` sur le message d'utilisation, son runtime/actions.mjs:556), ou une cible hors d'allonge de l'arme.
  const chosen = game.messages.get(resolution.origin ?? "")?.getFlag(ENGINE_ID, "attackMode") ?? "";
  const reach = item.system.range?.reach ?? 5;
  const beyondReach = !!targets[0] && (tokenDistance(thrower, targets[0].token) > reach);
  if ( !chosen.startsWith("thrown") && !beyondReach ) return null;
  return { id: resolution.id, item, thrower, targets };
}
