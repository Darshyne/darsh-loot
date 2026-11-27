/**
 * Corpse glint (user's request, 2026-11-27): a corpse that still has something to take — items, coins, or treasure not rolled
 * yet — gives off a few golden motes, without holding any key. Played by each client, never written: the same corpses the Alt
 * highlight rings (runtime/highlight.mjs `corpsesToDraw`: searchable for this user, visible to them), so a player never sees a
 * glint through a wall or the fog. Setting `lootGlint`: never, outside combat (default), always. Motion: core/loot-visuals.mjs.
 *
 * Drawn on its own non-interactive container in `canvas.interface`, like the highlight (`eventMode = "none"`).
 */
import { setting } from "../shared.mjs";
import { route } from "./router.mjs";
import { corpsesToDraw } from "./highlight.mjs";
import { glintShown, mote, pulse, MOTES, GLINT } from "../core/loot-visuals.mjs";

// Normal blending, not additive: an additive glow vanishes on a light map (seen on the bench, 2026-11-27).
const COLOR = 0xffe9a8;
const HALO = 0xf0b429;
/** How often the list of glinting corpses is read again (ms): a corpse emptied stops within that time. */
const LIST_MS = 400;

let layer = null;
let graphics = null;
let corpses = [];
let listedAt = 0;
let ticking = false;

const inCombat = () => game.combat?.started === true;

function mode() {
  const v = setting("lootGlint");
  return Object.values(GLINT).includes(v) ? v : GLINT.peace;
}

function ensureLayer() {
  if ( layer && !layer.destroyed && layer.parent ) return graphics;
  layer = new PIXI.Container();
  layer.eventMode = "none";
  layer.interactiveChildren = false;
  graphics = new PIXI.Graphics();
  graphics.eventMode = "none";
  layer.addChild(graphics);
  canvas.interface.addChild(layer);
  return graphics;
}

function listCorpses(now) {
  if ( (now - listedAt) < LIST_MS ) return corpses;
  listedAt = now;
  try { corpses = glintShown(mode(), inCombat()) ? corpsesToDraw() : []; }
  catch(err) { corpses = []; }
  return corpses;
}

function tick() {
  if ( !canvas.ready ) return;
  const now = performance.now();
  const list = listCorpses(now);
  const g = ensureLayer();
  g.clear();
  for ( const [n, token] of list.entries() ) {
    if ( token.destroyed || !token.visible ) continue;
    const { x, y } = token.center;
    const r = Math.max(token.w, token.h) / 2;
    // A soft golden glow at its feet, pulsing slowly (wider than tall, like light on the ground).
    const glow = pulse(now + (n * 500));
    g.beginFill(HALO, glow * 0.5);
    g.drawEllipse(x, y + (r * 0.55), r * 0.95, r * 0.38);
    g.endFill();
    g.beginFill(HALO, glow);
    g.drawEllipse(x, y + (r * 0.55), r * 0.6, r * 0.22);
    g.endFill();
    for ( let i = 0; i < MOTES; i++ ) {
      const m = mote(i + (n * MOTES), now);
      if ( m.alpha <= 0.01 ) continue;
      const px = x + (m.x * r), py = y + (m.y * r), s = Math.max(2, m.size * r);
      g.beginFill(HALO, m.alpha * 0.3);
      g.drawCircle(px, py, s * 2.4);
      g.endFill();
      g.beginFill(COLOR, m.alpha);
      g.drawCircle(px, py, s);
      g.endFill();
    }
  }
}

function start() {
  if ( ticking || !canvas.ready ) return;
  canvas.app.ticker.add(tick);
  ticking = true;
}

function stop() {
  if ( ticking ) canvas.app?.ticker?.remove(tick);
  ticking = false;
  layer = null;
  graphics = null;
  corpses = [];
  listedAt = 0;
}

/** For the in-game self-test: the corpses glinting now. */
export function glintState() {
  listedAt = 0;
  return { mode: mode(), corpses: listCorpses(performance.now()).map(t => t.document.uuid) };
}

export function registerGlint() {
  route("canvasReady", "corpse glint", () => { stop(); start(); });
  route("canvasTearDown", "corpse glint", stop);
  start();
}
