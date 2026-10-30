import * as THREE from 'three';
import { CONFIG } from './config';
import { Pipeline } from './render/pipeline';
import { Medium } from './world/medium';
import { createBackground } from './world/background';
import { FoodField } from './world/particles';
import { EcoField } from './world/eco';
import { Player } from './entities/player';
import { NpcManager } from './entities/npc';
import { BehaviorProfile } from './entities/behavior';
import { DebugUI } from './ui/debug';
import { saveState, loadState, type GameState } from './core/save';

const pipeline = new Pipeline();
const { scene, camera, palette } = pipeline;

const medium = new Medium(7);
const background = createBackground(palette);
scene.add(background);

const eco = new EcoField();
const food = new FoodField(scene, palette, 99);
const behavior = new BehaviorProfile(CONFIG.behavior.rate, CONFIG.behavior.pulseDecay);
const player = new Player(scene, palette.uniformArray, behavior);
scene.add(new THREE.AmbientLight(0xffffff, 1));

// M4: реактивный спавнер вместо статичных трёх NPC
const npcManager = new NpcManager(scene, palette);

// ── сериализация состояния (правило: с этого момента обязательно) ─────────
let worldSeed = 7;
const saved = loadState();
if (saved) {
  player.ecoLevel = saved.ecoLevel;
  player.mass = saved.mass;
  player.energy = saved.energy;
  player.mitosisCount = saved.mitosisCount;
  player.position.set(saved.position.x, saved.position.y, saved.position.z);
  player.restoreBehavior(saved.behavior);
  npcManager.restore(saved.npcs);
  eco.restoreReactivity(
    saved.reactivity.food,
    saved.reactivity.predator,
    saved.reactivity.difficulty,
  );
  worldSeed = saved.seed;
}
void worldSeed;

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
let recentDamage = 0;        // EMA недавнего урона (0..1)
let saveTimer = CONFIG.save.interval;

// кэш локального уровня — обновляем не каждый кадр, спавнерам хватает раз в ~0.5с
let localLevelCache = 0;
let trueLevelCache = 0;
let levelTimer = 0;
let reactivity = { foodDensity: 1, predatorDensity: 1, difficulty: 1 };

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

  // ── eco: уровень вокруг игрока (обновляем редко — это шум, он медленный) ──
  levelTimer -= dt;
  if (levelTimer <= 0) {
    levelTimer = 0.5;
    trueLevelCache = eco.trueLevel(player.position, t);
    localLevelCache = eco.localLevel(player.position, player.position, player.ecoLevel, t);
  }

  // ── реактивная сложность: голод / урон / доминанта → множители спавнеров ──
  recentDamage = Math.max(0, recentDamage - dt * 0.2); // медленно заживает
  reactivity = eco.reactivity(
    {
      energyRatio: player.energy / CONFIG.player.baseEnergy,
      recentDamage,
      dominance: behavior.dominanceStrength(),
    },
    dt,
  );
  food.setDensity(reactivity.foodDensity);
  food.setTier(localLevelCache);

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

  // scavenging: подбор детрита (меньше энергии, чем живой NPC)
  const scav = food.tryEatDetritus(player.position, CONFIG.player.eatRange);
  if (scav > 0) {
    player.feed(scav);
    behavior.pulse('scavenging', CONFIG.behavior.foodPulse);
  }

  // NPCs: менеджер обновляет популяцию по localLevel и predatorDensity
  npcManager.update(dt, t, player.position, localLevelCache, reactivity.predatorDensity);
  for (const npc of npcManager.npcs) {
    if (!npc.alive) continue;
    const d = npc.position.distanceTo(player.position);
    if (d < CONFIG.player.npcEatRange) {
      // съеден: энергия из spec, труп остаётся только если его «догрызают» позже
      npc.kill();
      player.feed(npc.spec.energy);
      behavior.pulse('predation', CONFIG.behavior.npcPulse);
      food.addDetritus(
        npc.position.clone(),
        npc.spec.energy * CONFIG.behavior.detritusRatio,
        palette,
      );
      npcManager.notifyKilled();
    } else if (
      npc.spec.tier === 'large' &&
      d < CONFIG.npc.large.contactRange + Math.sqrt(player.mass) * 0.7
    ) {
      // шипастый крупняк бьёт при касании — мир отвечает на вторжение
      player.damage(CONFIG.npc.large.damage * dt);
      recentDamage = Math.min(1, recentDamage + dt * 1.5);
    }
  }

  food.respawnDead(player.position, palette);
  food.update(dt, t);
  updateCamera();

  (background.material as THREE.ShaderMaterial).uniforms.uTime.value = t;

  pipeline.render(dt, t);

  // автосейв
  saveTimer -= dt;
  if (saveTimer <= 0) {
    saveTimer = CONFIG.save.interval;
    const state: Omit<GameState, 'version'> = {
      ecoLevel: player.ecoLevel,
      mass: player.mass,
      energy: player.energy,
      mitosisCount: player.mitosisCount,
      position: { x: player.position.x, y: player.position.y, z: player.position.z },
      behavior: behavior.snapshot(),
      npcs: npcManager.snapshotState(),
      reactivity: {
        food: reactivity.foodDensity,
        predator: reactivity.predatorDensity,
        difficulty: reactivity.difficulty,
      },
      seed: worldSeed,
    };
    saveState(state);
  }

  debug.update(
    [
      `ecoLevel:   ${player.ecoLevel.toFixed(3)}`,
      `localLevel: ${localLevelCache.toFixed(2)}  trueLevel: ${trueLevelCache.toFixed(2)}`,
      `reactivity: food=${reactivity.foodDensity.toFixed(2)} pred=${reactivity.predatorDensity.toFixed(2)} diff=${reactivity.difficulty.toFixed(2)}`,
      `mass:       ${player.mass.toFixed(2)}   (mitosis ×${player.mitosisCount})`,
      `energy:     ${player.energy.toFixed(0)} / ${CONFIG.player.baseEnergy}`,
      `speed:      ${player.velocity.length().toFixed(2)}`,
      `moving:     ${moving ? 'yes' : 'no'}`,
      `dominant:   ${behavior.dominant()}`,
      `npcs:       ${npcManager.npcs.filter((n) => n.alive).length}/${CONFIG.npc.maxCount}`,
      `pos:        (${player.position.x.toFixed(1)}, ${player.position.y.toFixed(1)}, ${player.position.z.toFixed(1)})`,
    ],
    behavior.snapshot(),
  );

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
