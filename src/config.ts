export const CONFIG = {
  render: {
    internalHeight: 270,
    maxDt: 1 / 20,
  },
  palette: {
    size: 16,
    cycleSpeed: 0.06,
  },
  medium: {
    scale: 0.008,
    warp: 0.6,
  },
  behavior: {
    rate: 0.15,
    pulseDecay: 2.5,
    foodPulse: 0.6,
    npcPulse: 0.9,
    detritusRatio: 0.45,       // доля энергии NPC, остающаяся в трупе
  },
  player: {
    accel: 14,
    maxSpeed: 8,
    drag: 2.4,
    baseEnergy: 100,
    drainIdle: 1.2,
    drainMove: 3.4,
    passiveGain: 0.35,
    eatRange: 1.1,
    npcEatRange: 1.3,
    // growth / mitosis
    massStart: 1.0,
    massMin: 0.3,
    massMax: 8.0,
    massGrowth: 0.05,
    massDecay: 0.05,
    mitosisCooldown: 2.0,
    ecoLevelPerMitosis: 0.05,
    npcEnergy: 35,
  },
  camera: {
    distance: 9,
    height: 3.5,
    followLerp: 0.12,
  },
  world: {
    foodCount: 48,
    foodSpawnRadius: 26,
  },
  npc: {
    count: 3,
    wanderRadius: 5,
    wanderSpeed: 1.5,
    fleeRange: 4,
    fleeStrength: 3,
    // M4: NpcManager — реактивный спавнер
    maxCount: 7,               // жёсткий потолок существ
    levelGrowth: 2,            // +существа на каждую единицу localLevel
    checkInterval: 2.0,        // сек между проверками «добавить/убрать»
    fadeDuration: 1.6,         // сек плавного растворения при удалении
    respawnDelay: 6.0,         // сек до появления новой замены вместо съеденной
    spawnMinRadius: 14,        // не спавним прямо в игроке
    spawnMaxRadius: 26,
    largeTierLevel: 0.3,       // localLevel выше порога → могут спавниться крупные
    large: {                   // tier 'large': медленные, жирные, опасные шипами
      size: 1.1,
      speed: 0.7,
      energyRatio: 3.5,        // × базовой npcEnergy
      fleeRange: 2.0,          // почти не убегают
      damage: 9,               // касательный урон энергии игрока (в секунду контакта)
      contactRange: 1.8,
      colorSeed: 0.55,
    },
  },
  eco: {
    seed: 131,                 // независимый сид (не тот же, что у Medium)
    scale: 0.005,              // крупный медленный шум
    drift: 0.004,              // очень медленный дрейф поля во времени
    blendBase: 0.55,           // базовая доля уровня игрока в rubberband-миксе
    rubberBaseRadius: 12,      // радиус влияния игрока при ecoLevel = 0
    rubberGrowth: 10,          // +радиус на единицу ecoLevel
    reactivityRate: 0.08,      // EMA-сглаживание реактивности
    minMult: 0.5,              // без «режима бога»: не ниже 0.5×
    maxMult: 2.0,              // и не выше 2×
    hungerThreshold: 0.45,     // energyRatio ниже → еда плотнее
    damageThreshold: 0.25,     // recentDamage выше → хищников меньше
    dominanceThreshold: 0.5,   // доминанта выше → мир сложнее
  },
  food: {
    tierEnergyPerLevel: 0.8,   // множитель энергии еды от localTier
    tierSizePerLevel: 0.5,     // множитель визуального размера
    detritusLifetime: 10,      // сек до оседания трупа
    detritusSink: 0.5,         // скорость погружения детрита
  },
  save: {
    version: 1,
    key: 'pustota.save',
    interval: 5,               // автосейв раз в N секунд
  },
};
