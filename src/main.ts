import * as THREE from 'three';
import { CONFIG } from './config';
import { Pipeline } from './render/pipeline';
import { Medium } from './world/medium';
import { createBackground } from './world/background';
import { FoodField } from './world/particles';
import { Player } from './entities/player';
import { Npc } from './entities/npc';
import { BehaviorProfile } from './entities/behavior';
import { DebugUI } from './ui/debug';

const pipeline = new Pipeline();
const { scene, camera, palette } = pipeline;

const medium = new Medium(7);
const background = createBackground(palette);
scene.add(background);

const food = new FoodField(scene, palette, 99);
const behavior = new BehaviorProfile(CONFIG.behavior.rate, CONFIG.behavior.pulseDecay);
const player = new Player(scene, palette.uniformArray, behavior);
scene.add(new THREE.AmbientLight(0xffffff, 1));

// NPCs
const npcs: Npc[] = [];
for (let i = 0; i < CONFIG.npc.count; i++) {
  const angle = (i / CONFIG.npc.count) * Math.PI * 2 + Math.random() * 0.5;
  const r = 8 + Math.random() * 4;
  const pos = new THREE.Vector3(
    Math.cos(angle) * r,
    (Math.random() - 0.5) * 3,
    Math.sin(angle) * r,
  );
  npcs.push(new Npc(scene, palette, pos));
}

const debug = new DebugUI();

// ── input ─────────────────────────────────────────────────────────────────
const keys = new Set<string>();
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function readInput() {
  let x = 0;
  let y = 0;
  if (keys.has('w') || keys.has('arrowup')) y -= 1;
  if (keys.has('s') || keys.has('arrowdown')) y += 1;
  if (keys.has('a') || keys.has('arrowleft')) x -= 1;
  if (keys.has('d') || keys.has('arrowright')) x += 1;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  return { x, y };
}

// ── camera ────────────────────────────────────────────────────────────────
const cameraTarget = new THREE.Vector3();
const cameraDesired = new THREE.Vector3();

function updateCamera() {
  const dist = CONFIG.camera.distance * Math.cbrt(player.mass);
  cameraDesired
    .copy(player.position)
    .add(new THREE.Vector3(0, CONFIG.camera.height, dist));
  camera.position.lerp(cameraDesired, CONFIG.camera.followLerp);
  cameraTarget.copy(player.position);
  camera.lookAt(cameraTarget);
  background.position.copy(camera.position);
}

// ── main loop ─────────────────────────────────────────────────────────────
let last = performance.now();
let t = 0;

function frame(now: number) {
  const dt = Math.min(CONFIG.render.maxDt, (now - last) / 1000);
  last = now;
  t += dt;

  const input = readInput();
  const { sample, moving } = player.update(dt, input, medium);

  // passive chemosynthesis
  player.energy = Math.min(
    CONFIG.player.baseEnergy,
    player.energy + sample.chemEnergy * CONFIG.player.passiveGain * dt,
  );

  // behavior tick
  behavior.tick(dt, {
    motility: moving,
    sessility: !moving,
    chemosynthesis: sample.chemEnergy > 0.5,
    photosynthesis: sample.luminosity > 0.6,
  });

  // eat food
  const eaten = food.tryEat(player.position, CONFIG.player.eatRange);
  if (eaten > 0) {
    player.feed(eaten);
    behavior.pulse('herbivory', CONFIG.behavior.foodPulse);
  }

  // NPCs
  for (const npc of npcs) {
    npc.update(dt, player.position);
    if (!npc.alive) continue;
    if (npc.position.distanceTo(player.position) < CONFIG.player.npcEatRange) {
      npc.kill();
      player.feed(CONFIG.player.npcEnergy);
      behavior.pulse('predation', CONFIG.behavior.npcPulse);
    }
  }

  food.respawnDead(player.position, palette);
  food.update(t);
  updateCamera();

  (background.material as THREE.ShaderMaterial).uniforms.uTime.value = t;

  pipeline.render(dt, t);

  debug.update(
    [
      `ecoLevel: ${player.ecoLevel.toFixed(3)}`,
      `mass:     ${player.mass.toFixed(2)}   (mitosis ×${player.mitosisCount})`,
      `energy:   ${player.energy.toFixed(0)} / ${CONFIG.player.baseEnergy}`,
      `speed:    ${player.velocity.length().toFixed(2)}`,
      `moving:   ${moving ? 'yes' : 'no'}`,
      `dominant: ${behavior.dominant()}`,
      `pos:      (${player.position.x.toFixed(1)}, ${player.position.y.toFixed(1)}, ${player.position.z.toFixed(1)})`,
    ],
    behavior.snapshot(),
  );

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);