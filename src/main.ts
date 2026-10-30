import * as THREE from 'three';
import { CONFIG } from './config';
import { Pipeline } from './render/pipeline';
import { Medium } from './world/medium';
import { createBackground } from './world/background';
import { createBackdrop } from './world/backdrop';
import { makeMoteTexture } from './world/textures';
import { FoodField } from './world/particles';
import { EcoField } from './world/eco';
import { Player } from './entities/player';
import { NpcManager } from './entities/npc';
import { BehaviorProfile } from './entities/behavior';
import { DebugUI } from './ui/debug';
import { saveState, loadState, clearState, type GameState } from './core/save';

const pipeline = new Pipeline();
const { scene, camera, palette } = pipeline;

const medium = new Medium(7);
const background = createBackground(palette);
scene.add(background);

// Дальний «пол» — процедурная текстура, прибита к игроку по XZ: виден узор,
// чувствуется скорость и глубина (фикс «пустого мира»).
const backdrop = createBackdrop();
scene.add(backdrop);

// Взвесь — мягкие светлые mote-частицы вокруг игрока (дрейф + параллакс).
const MOTE_COUNT = 160;
const motePos = new Float32Array(MOTE_COUNT * 3);
for (let i = 0; i < MOTE_COUNT; i++) {
  motePos[i*3]   = (Math.random() - 0.5) * 60;
  motePos[i*3+1] = (Math.random() - 0.5) * 40;
  motePos[i*3+2] = (Math.random() - 0.5) * 60;
}
const moteGeo = new THREE.BufferGeometry();
moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
  size: 0.5,
  map: makeMoteTexture(),
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  color: 0xffffff,
}));
scene.add(motes);

const eco = new EcoField();
const food = new FoodField(scene, palette, 99);
const behavior = new BehaviorProfile(CONFIG.behavior.rate, CONFIG.behavior.pulseDecay);
const player = new Player(scene, palette.uniformArray, behavior);
scene.add(new THREE.AmbientLight(0xffffff, 0.7)); // приглушён — объём даёт keyLight

// «Софтбокс»-свет в стиле старых edu-рендереров: следует за игроком
// (направление задаём от камеры — сцена освещена одинаково где угодно).
const keyLight = new THREE.DirectionalLight(0xffffff, 1.25);
scene.add(keyLight);
scene.add(keyLight.target);

// M4: реактивный спавнер вместо статичных трёх NPC
const npcManager = new NpcManager(scene, palette);

// ── сериализация состояния (правило: с этого момента обязательно) ─────────
let worldSeed = 7;
// «Носимая» еда в теле игрока и свежая сытость — поднимают потолок пассивного
// восстановления выше автотрофного (путь к митозу для травоядных/падальщиков).
// Объявлены ДО загрузки сейва, чтобы восстановить их из сохранённого состояния.
let foodCarry = 0;
let lastFoodRelief = 0;
const saved = loadState();
if (saved) {
  player.ecoLevel = saved.ecoLevel;
  player.mass = saved.mass;
  player.energy = saved.energy;
  player.mitosisCount = saved.mitosisCount;
  player.position.set(saved.position.x, saved.position.y, saved.position.z);
  player.restoreBehavior(saved.behavior);
  // M4-фикс: NPC и еда «прибиты» к дому — если игрок ушёл далеко, при загрузке
  // сейва мир остаётся позади и экран пуст. Переносим экосистему к игроку.
  npcManager.recenter(player.position);
  npcManager.restore(saved.npcs, player.position);
  // необязательные поля (версии сейва могли не иметь) — с дефолтами
  foodCarry = saved.foodCarry ?? 0;
  lastFoodRelief = saved.lastFoodRelief ?? 0;
  eco.restoreReactivity(
    saved.reactivity.food,
    saved.reactivity.predator,
    saved.reactivity.difficulty,
  );
  worldSeed = saved.seed;
}
void worldSeed;

const debug = new DebugUI();

// Кнопка сброса в debug-оверлее: чистит сейв и перезагружает страницу.
// Решает «застрял в пустом месте из старого сохранения» — без возни с DevTools.
if (CONFIG.debug.resetButton) {
  debug.addResetButton(() => {
    clearState();
    location.reload();
  });
}

// ── input ─────────────────────────────────────────────────────────────────
// Бинды по физическим кодам клавиш (KeyboardEvent.code): работают при любой
// раскладке — РУС/EN/DE и т.д. 'KeyW' — это тот же клавишный домик, где бы
// игрок ни сидел. e.key оставляем как резервный путь для стрелок и пробела.
type Action = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down';

const KEY_BINDS: Record<string, Action> = {
  // movement (physical layout independent)
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  // vertical: подъём / опускание
  Space: 'up',
  ShiftLeft: 'down',
  ShiftRight: 'down',
};

// резервные бинды по символу — Q/E не зависят от раскладки, но на экранных
// клавиатурах code может отсутствовать; стрелки — универсальны
const CHAR_FALLBACK: Record<string, Action> = {
  q: 'up',
  e: 'down',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  w: 'forward',
  s: 'back',
  a: 'left',
  d: 'right',
};

const actions = new Set<Action>();

function bindEvent(e: KeyboardEvent, on: boolean) {
  const act =
    KEY_BINDS[e.code] ??
    (e.key ? CHAR_FALLBACK[e.key.toLowerCase()] : undefined);
  if (!act) return;
  if (on) actions.add(act);
  else actions.delete(act);
  // пробел по умолчанию скроллит страницу / кликает фокус — глушим
  if (e.code === 'Space' || e.key === ' ') e.preventDefault();
}

window.addEventListener('keydown', (e) => bindEvent(e, true));
window.addEventListener('keyup', (e) => bindEvent(e, false));
// при переключении раскладки active keys «залипают» — чистим всё
window.addEventListener('blur', () => actions.clear());
window.addEventListener('focus', () => actions.clear());

function readInput() {
  let x = 0;
  let y = 0;
  let v = 0; // вертикаль: +1 вверх, -1 вниз
  if (actions.has('forward')) y -= 1;
  if (actions.has('back')) y += 1;
  if (actions.has('left')) x -= 1;
  if (actions.has('right')) x += 1;
  if (actions.has('up')) v += 1;
  if (actions.has('down')) v -= 1;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  return { x, y, v };
}

// ── camera ────────────────────────────────────────────────────────────────
const cameraTarget = new THREE.Vector3();
const cameraDesired = new THREE.Vector3();

// наклон камеры: при подъёме/опускании игрок «выныривает» из плоскости —
// камера плавно переключается с горизонтального облёта на вид сверху.
// lerp-привязка сохранена (не жёсткая) — ощущение «тело пухнет» не трогаем.
let camPitch = 0; // 0 = горизонтальный облёт, → maxPitch = почти сверху

function updateCamera() {
  const dist = CONFIG.camera.distance * Math.cbrt(player.mass);
  const pitchTarget = Math.min(
    CONFIG.camera.maxPitch,
    Math.abs(player.position.y) / 8 + Math.abs(player.velocity.y) * 0.12,
  );
  camPitch += (pitchTarget - camPitch) * CONFIG.camera.pitchLerp;
  const cp = Math.cos(camPitch);
  const sp = Math.sin(camPitch);
  cameraDesired.set(
    player.position.x,
    player.position.y + dist * sp,
    player.position.z + dist * cp,
  );
  camera.position.lerp(cameraDesired, CONFIG.camera.followLerp);
  cameraTarget.copy(player.position);
  camera.lookAt(cameraTarget);
  background.position.copy(camera.position);
  backdrop.position.set(player.position.x, CONFIG.player.elevationMin - 9, player.position.z);
  motes.position.copy(player.position);

  // свет-«софтбокс»: луч из-за плеча камеры, привязан к игроку
  const off = new THREE.Vector3(5, 9, -7).applyQuaternion(camera.quaternion);
  keyLight.position.copy(player.position).add(off);
  keyLight.target.position.copy(player.position);
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
const carrionBuf: THREE.Vector3[] = []; // переиспользуемый буфер позиций детрита (без аллокаций/кадр)

function frame(now: number) {
  const dt = Math.min(CONFIG.render.maxDt, (now - last) / 1000);
  last = now;
  t += dt;

  const input = readInput();

  // ── evasion: рывок скорости только когда рядом угроза (крупный NPC близко) ──
  // Считаем по позициям прошлого кадра — порядок вызовов не нарушает инварианты.
  let fleeBoost = 0;
  if (behavior.evasion > 0.02) {
    for (const npc of npcManager.npcs) {
      if (!npc.alive || npc.spec.tier !== 'large') continue;
      const d = npc.position.distanceTo(player.position);
      const threatR =
        (npc.spec.size + CONFIG.npc.large.contactRange * 0.35) * 3 + npc.spec.size;
      if (d < threatR) {
        const closeness = 1 - d / threatR; // чем ближе — тем сильнее рывок
        fleeBoost = Math.max(fleeBoost, behavior.evasion * CONFIG.player.evasionSpeedBonus * closeness);
      }
    }
  }

  const { sample, moving } = player.update(dt, input, medium, fleeBoost);

  // ── пассивное питание: базовый химотрейл + автотрофия (M4-углубление) ──
  // photo/chemo-поля, нарашенные поведением, превращаются в реальный доход
  // энергии — но только в соответствующих зонах среды и с потолком autotrophCap.
  // Растение-стратегия медленнее и не делится быстро (энергия упирается в потолок),
  // хищник остаётся быстрым путём к митозу. Никаких меню — только следствия.
  // Потолок пассивного восстановления: автотрофы упираются в autotrophCap —
  // митоз (85%) без еды невозможен. НО: сытостьrecent-едой поднимает планку
  // до foodEnergyCap (травоядные делятся), симбиоз даёт сверх неё небольшой
  // приток (взаимопомощь «своих»). Так каждая ветка получает свой путь к делению.
  const energyRatioNow = player.energy / CONFIG.player.baseEnergy;
  let passiveGain = sample.chemEnergy * CONFIG.player.passiveGain;
  if (energyRatioNow < CONFIG.player.autotrophCap) {
    if (sample.luminosity > 0.6) {
      passiveGain += behavior.photosynthesis * CONFIG.player.photoGain * ((sample.luminosity - 0.6) / 0.4);
    }
    if (sample.chemEnergy > 0.5) {
      passiveGain += behavior.chemosynthesis * CONFIG.player.chemoGain * ((sample.chemEnergy - 0.5) / 0.5);
    }
  }
  const cap =
    CONFIG.player.baseEnergy *
    Math.min(
      CONFIG.player.foodEnergyCap,
      CONFIG.player.autotrophCap + lastFoodRelief,
    ) +
    behavior.symbiosis * CONFIG.player.symbiosisHealRate * CONFIG.player.symbiosisBoost;
  player.energy = Math.min(cap, player.energy + passiveGain * dt);

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

  // ── токсичная аура: отпугивает мелких существ (main считает из behavior.toxicity).
  // Ветви симбиоза и яда конкурируют: «пушистые» отращивают больший личный ореол,
  // который не даёт существам сблизиться — мир сам выбирает стратегию игрока.
  const repelRadius =
    behavior.toxicity * Math.sqrt(player.mass) * CONFIG.player.toxicityRadiusFactor;
  const symbiosisCalmR =
    behavior.symbiosis * Math.sqrt(player.mass) * CONFIG.player.toxinRepelBonus;

  // ── симбиоз: существо, которое НЕ боится игрока и держится рядом
  // (не в токсичной ауре, не в радиусе поедания), даёт пассивный обмен
  // энергией. Поле растёт только через tick-событие + слабый pulse.
  // Бонус к «пушистости»: если игрок носит еду с собой (foodCarry>0),
  // он может покормить «своего» — это событие symbiosis-кормления. ──
  let symbiosisNear = false;
  let symbiosisFeedTarget: (typeof npcManager.npcs)[number] | null = null;
  {
    const personalR = Math.max(repelRadius, CONFIG.player.npcEatRange * 1.8);
    for (const npc of npcManager.npcs) {
      if (!npc.alive || npc.fadingOut) continue;
      const d = npc.position.distanceTo(player.position);
      if (d < personalR + npc.spec.size + 2.5 && d > CONFIG.player.npcEatRange) {
        symbiosisNear = true;
        symbiosisFeedTarget = npc;
        break;
      }
    }
  }
  if (symbiosisNear) {
    // симбиоз — единственный способ пробить автотрофный потолок: «свои» делятся
    player.energy = Math.min(
      CONFIG.player.baseEnergy,
      player.energy + behavior.symbiosis * CONFIG.player.symbiosisHealRate * dt,
    );
    behavior.pulse('symbiosis', CONFIG.behavior.symbiosisTickPulse);
  }

  // behavior tick
  behavior.tick(dt, {
    motility: moving,
    sessility: !moving,
    chemosynthesis: sample.chemEnergy > 0.5,
    photosynthesis: sample.luminosity > 0.6,
    // evasion наполняется только реальным убеганием (вблизи угрозы с рывком) —
    // иначе поле осталось бы мёртвым; это событие, а не прямая накапка
    evasion: fleeBoost > 0 && moving,
    symbiosis: symbiosisNear,
  });

  // eat food
  const eaten = food.tryEat(player.position, CONFIG.player.eatRange);
  if (eaten > 0) {
    player.feed(eaten);
    behavior.pulse('herbivory', CONFIG.behavior.foodPulse);
    foodCarry += eaten;       // «носим» еду — можно покормить симбионта
    lastFoodRelief = Math.min(
      CONFIG.player.foodEnergyCap - CONFIG.player.autotrophCap,
      lastFoodRelief + eaten / CONFIG.player.baseEnergy,
    );
  }

  // scavenging: подбор детрита (меньше энергии, чем живой NPC)
  const scav = food.tryEatDetritus(player.position, CONFIG.player.eatRange);
  if (scav > 0) {
    player.feed(scav);
    behavior.pulse('scavenging', CONFIG.behavior.foodPulse);
    foodCarry += scav * 0.5;
    lastFoodRelief = Math.min(
      CONFIG.player.foodEnergyCap - CONFIG.player.autotrophCap,
      lastFoodRelief + scav * 0.5 / CONFIG.player.baseEnergy,
    );
  }

  // Кормление «своего» существа: если рядом симбионт и в теле есть запас еды,
  // часть энергии переходит соседу — событие symbiosis (pulse), не прямая накапка.
  // Это тактический выбор: съесть самому или инвестировать в союзника, который
  // потом поддержит тебя притоком энергии выше автотрофного потолка.
  if (symbiosisFeedTarget && foodCarry > CONFIG.player.baseEnergy * 0.1) {
    const gift = foodCarry * 0.3;
    foodCarry -= gift;
    behavior.pulse('symbiosis', CONFIG.behavior.symbiosisFeedPulse);
    // диегетический отклик: сытый симбионт держится чуть ближе (через symbiosis-параметр)
    void symbiosisFeedTarget;
  }
  // foodCarry медленно «усваивается» как небольшой пассивный доход
  if (foodCarry > 0) {
    const metabolized = Math.min(foodCarry, CONFIG.player.baseEnergy * 0.02 * dt);
    foodCarry -= metabolized;
    player.energy = Math.min(CONFIG.player.baseEnergy, player.energy + metabolized * 0.6);
  }
  // relief от еды заживает вместе с голодом
  lastFoodRelief = Math.max(0, lastFoodRelief - dt * 0.02);

  // NPCs: менеджер обновляет популяцию по localLevel и predatorDensity
  // M4-фикс «пустого мира»: дома NPC прибиты к точке спавна — при долгом
  // уходе игрока рой остаётся позади. Раз в checkInterval проверяем и
  // переносим популяцию к игроку (дистанционно, без телепорта рядом).
  npcManager.recenter(player.position);
  const carrion = food.detritusPositions(carrionBuf); // детрит → мелкие NPC слетаются (пищевая цепь)
  npcManager.update(
    dt, t, player.position, localLevelCache, reactivity.predatorDensity,
    Math.max(repelRadius, symbiosisCalmR), carrion, behavior.symbiosis,
    // пищевая цепь замкнута: крупный сожрал мелкого — остаётся труп, и игрок
    // может подобрать его позже (scavenging). Никаких сообщений — только тело мира.
    (victim) => {
      food.addDetritus(
        victim.position.clone(),
        victim.spec.energy * CONFIG.behavior.detritusRatio,
        palette,
      );
      npcManager.notifyKilled();
    },
  );
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
      d < npc.spec.size + CONFIG.npc.large.contactRange * 0.35 + Math.sqrt(player.mass) * 0.7
    ) {
      // шипастый крупняк бьёт при касании — мир отвечает на вторжение
      // armor гасит урон внутри damage(); recentDamage копит ПРОШЕДШИЙ урон
      const dealt = player.damage(CONFIG.npc.large.damage * dt);
      recentDamage = Math.min(1, recentDamage + dealt * 0.06);
      // броня нарабатывается реальным танкованием ударов (событие через pulse)
      if (dealt > 0) behavior.pulse('armor', CONFIG.behavior.armorHitPulse);
    }
  }

  food.respawnDead(player.position, palette);
  food.update(dt, t, player.position); // M4: еда дрейфует за игроком — мир не «пустеет» вдали от спавна
  updateCamera();

  (background.userData.tick as (dt: number) => void)(dt);

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
      foodCarry,
      lastFoodRelief,
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
      `food:       ${food.aliveCount()}/${CONFIG.world.foodCount}  detritus: ${carrion.length}`,
      `pos:        (${player.position.x.toFixed(1)}, ${player.position.y.toFixed(1)}, ${player.position.z.toFixed(1)})`,
    ],
    behavior.snapshot(),
  );

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
