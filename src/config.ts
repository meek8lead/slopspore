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
  },
} as const;