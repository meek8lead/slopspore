import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { mulberry32 } from '../core/rng';
import { CONFIG } from '../config';

export interface ReactivityInput {
  energyRatio: number;   // 0..1 — голод игрока
  recentDamage: number;  // 0..1 — сглаженный недавний урон
  dominance: number;     // 0..1 — сила доминантной ветки поведения
}

export interface ReactivityOutput {
  foodDensity: number;      // >1 при голоде
  predatorDensity: number;  // <1 при уроне
  difficulty: number;       // >1 при доминировании
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * EcoField — уровень экосистемы в точке мира + реактивная сложность.
 *
 * trueLevel(x)   — «истинный» глобальный фон: крупный медленный шум
 *                  (независимый сид), слегка дрейфует во времени.
 * localLevel()   — то, что видит игрок вокруг себя: раббербенд подтягивает
 *                  локальный уровень к его ecoLevel гауссией вокруг игрока.
 *                  Радиус растёт вместе с игроком — мир «расширяется» незаметно.
 * reactivity()   — EMA-сглаженные множители для спавнеров. Жёстко заперты
 *                  в [0.5×, 2×]: без «режима бога» и без спиралей смерти.
 */
export class EcoField {
  private noise: (x: number, y: number, z: number) => number;

  // EMA-состояние реактивности
  private emaFood = 1;
  private emaPredator = 1;
  private emaDifficulty = 1;

  constructor(seed = CONFIG.eco.seed) {
    this.noise = createNoise3D(mulberry32(seed));
  }

  /** Истинный глобальный уровень экосистемы в точке (~0..1). */
  trueLevel(x: THREE.Vector3, t = 0): number {
    const s = CONFIG.eco.scale;
    const n = this.noise(
      x.x * s,
      x.y * s + t * CONFIG.eco.drift,
      x.z * s,
    );
    return (n + 1) * 0.5;
  }

  /** Уровень с учётом раббербенда под игрока. */
  localLevel(
    x: THREE.Vector3,
    playerPos: THREE.Vector3,
    playerEcoLevel: number,
    t = 0,
  ): number {
    const radius = CONFIG.eco.rubberBaseRadius + playerEcoLevel * CONFIG.eco.rubberGrowth;
    const d = x.distanceTo(playerPos);
    const rubberband = Math.exp(-(d * d) / (radius * radius));
    // M4-балансировка: раньше pull был заперт на blendBase (0.55), и localLevel
    // у самого игрока упирался в ~eco·0.55+truth·0.45 — порог крупных NPC (0.3)
    // становился почти недостижимым. Теперь подтяжка растёт с ecoLevel:
    // мир вокруг «раскрывается» по мере эволюции — незаметно, без сообщений.
    const pullStrength = clamp(
      CONFIG.eco.blendBase + playerEcoLevel * 0.8,
      0,
      CONFIG.eco.pullMax,
    );
    const pull = clamp(pullStrength * rubberband, 0, 1);
    const truth = this.trueLevel(x, t);
    const mixed = truth + (playerEcoLevel - truth) * pull;
    // потолок локального уровня тоже растёт с игроком — «жирность» мира
    const ceiling = CONFIG.eco.ceilingBase + playerEcoLevel * CONFIG.eco.ceilingPerLevel;
    return Math.min(mixed, ceiling);
  }

  /** Реактивная сложность: сглаженные множители для спавнеров. */
  reactivity(playerState: ReactivityInput, dt: number): ReactivityOutput {
    const c = CONFIG.eco;
    const hunger = clamp((c.hungerThreshold - playerState.energyRatio) / c.hungerThreshold, 0, 1);
    const damage = clamp(playerState.recentDamage / c.damageThreshold, 0, 1);
    const dominance = clamp(playerState.dominance / c.dominanceThreshold, 0, 1);

    // цели заперты в [minMult, maxMult] до EMA — иначе асимптота упирается в климп
    // и ползёт к нему экспоненциально слишком долго (реактивность «вялая»)
    const targetFood = clamp(1 + hunger * 1.3 - damage * 0.5, c.minMult, c.maxMult);
    const targetPredator = clamp(1 + dominance * 1.0 - damage * 2.0, c.minMult, c.maxMult);
    const targetDifficulty = clamp(1 + dominance * 0.9 + hunger * 0.3, c.minMult, c.maxMult);

    // EMA по времени: быстрее реакция при большем reactivityRate
    const ke = 1 - Math.exp(-c.reactivityRate * dt * 10);
    this.emaFood += (targetFood - this.emaFood) * ke;
    this.emaPredator += (targetPredator - this.emaPredator) * ke;
    this.emaDifficulty += (targetDifficulty - this.emaDifficulty) * ke;

    return {
      foodDensity: clamp(this.emaFood, c.minMult, c.maxMult),
      predatorDensity: clamp(this.emaPredator, c.minMult, c.maxMult),
      difficulty: clamp(this.emaDifficulty, c.minMult, c.maxMult),
    };
  }

  /** Прямая установка EMA-состояния (для загрузки сейва). */
  restoreReactivity(food: number, predator: number, difficulty: number) {
    this.emaFood = food;
    this.emaPredator = predator;
    this.emaDifficulty = difficulty;
  }

  currentReactivity(): ReactivityOutput {
    const c = CONFIG.eco;
    return {
      foodDensity: clamp(this.emaFood, c.minMult, c.maxMult),
      predatorDensity: clamp(this.emaPredator, c.minMult, c.maxMult),
      difficulty: clamp(this.emaDifficulty, c.minMult, c.maxMult),
    };
  }
}
