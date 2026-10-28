/**
 * Retours d'action (règles DAS du 2026-10-27) : chaque geste donne un retour **visuel** et **sonore**, et rien de ce qui suit un jet
 * n'apparaît avant la fin des dés 3D (adapter/dice.mjs).
 *  - `channel` : un geste qui prend du temps (désamorcer…) — barre de progression chez le joueur (ui.notifications, `progress`), un
 *    ping autour du token et un bruit d'outils entendus de tous ; un déplacement l'interrompt.
 *  - `feedbackCard` : l'issue, chez le MJ actif — une carte de chat publique marquée `flags.darsh-loot.feedback`, un son diffusé à tous.
 *    À la création de la carte, **chaque** client dessine le texte flottant au-dessus du token (moteur, `dnd5e-combat.notice`) : le hook
 *    du moteur est local, la carte le fait voir partout.
 */

import { MODULE_ID } from "../shared.mjs";
import { engineNotice } from "../adapter/engine.mjs";
import { route } from "./router.mjs";

/** Sons du cœur de Foundry (public/sounds/doors/metal), présents sur toute installation. */
export const SOUNDS = Object.freeze({
  tools: "sounds/doors/metal/test.ogg",
  success: "sounds/doors/metal/unlock.ogg",
  failure: "sounds/doors/metal/lock.ogg",
  // 2026-10-28 : quelque chose de caché est trouvé (porte secrète, piège, cachette), en fouillant ou en passant.
  discover: "sounds/notify.wav",
  // 2026-10-28 : fouiller (un cadavre, les environs) — le bruissement ; prendre un objet — les pièces.
  rummage: `modules/${MODULE_ID}/assets/sounds/drop-soft.mp3`,
  coins: `modules/${MODULE_ID}/assets/sounds/drop-coins.mp3`
});

/** Une carte plus vieille que ça (chargement du journal) ne refait pas son texte flottant. */
const FRESH_MS = 10000;

/** Joue un son chez tout le monde (`AudioHelper.play`, `socketOptions` true = diffusé). */
export function playForAll(src, volume=0.8) {
  if ( !src ) return;
  foundry.audio.AudioHelper.play({ src, volume, loop: false }, true).catch?.(() => {});
}

/** Un ping « pulse » autour du token, vu de tous (`canvas.ping` le diffuse, client/canvas/board.mjs). */
function pingAt(token) {
  const placeable = token?.object;
  if ( !placeable || !canvas.ready ) return;
  canvas.ping(placeable.center, { style: CONFIG.Canvas.pings.types.PULSE, pull: false, size: 2 * canvas.grid.size, duration: 1200, rings: 1 })
    .catch(() => {});
}

/**
 * Un geste de `seconds` secondes réelles pour ce token (TokenDocument) : barre de progression intitulée `label` chez ce joueur, ping
 * et bruit d'outils toutes les 2,5 s chez tous. Rend false si le token a bougé (interrompu), true sinon (ou s'il n'y a rien à attendre).
 */
export async function channel(token, { seconds=0, label="", sound=SOUNDS.tools }={}) {
  if ( !token || !(seconds > 0) ) return true;
  const start = { x: token._source.x, y: token._source.y, elevation: token._source.elevation };
  const moved = () => !token.parent || (token._source.x !== start.x) || (token._source.y !== start.y) || (token._source.elevation !== start.elevation);
  const bar = ui.notifications.info(label, { progress: true });
  const began = Date.now();
  let last = 0;
  try {
    while ( (Date.now() - began) < (seconds * 1000) ) {
      if ( (Date.now() - last) >= 2500 ) { last = Date.now(); pingAt(token); playForAll(sound, 0.6); }
      await new Promise(resolve => setTimeout(resolve, 100));
      if ( moved() ) return false;
      const left = Math.max(0, Math.ceil(seconds - ((Date.now() - began) / 1000)));
      bar.update({ pct: Math.min(1, (Date.now() - began) / (seconds * 1000)), message: `${label} (${left} s)` });
    }
    return true;
  } finally {
    bar.update({ pct: 1 });
    bar.remove?.();
  }
}

/**
 * Chez le MJ actif : la carte publique d'une issue, son texte flottant chez tous (à sa création) et son son.
 * @param {TokenDocument} token
 * @param {string} text            Texte de la carte et du texte flottant (déjà traduit, sans HTML).
 * @param {{kind?: string, icon?: string, sound?: string|null, float?: string}} [options]  `kind` : gain / refused…
 */
export async function feedbackCard(token, text, { kind="gain", icon="fa-solid fa-screwdriver-wrench", sound=null, float=text }={}) {
  if ( !token || !text ) return null;
  if ( sound ) playForAll(sound);
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ token, actor: token.actor }),
    content: `<p><i class="${icon}"></i> ${foundry.utils.escapeHTML(text)}</p>`,
    flags: { [MODULE_ID]: { feedback: { token: token.uuid, text: float, kind } } }
  });
}

function onCreateMessage(message) {
  const f = message.getFlag?.(MODULE_ID, "feedback");
  if ( !f?.token || !canvas?.ready || ((Date.now() - (message.timestamp ?? 0)) > FRESH_MS) ) return;
  engineNotice(f.token, f.text, f.kind);
}

export function registerFeedback() {
  route("createChatMessage", "action feedback: floating text", onCreateMessage);
}
