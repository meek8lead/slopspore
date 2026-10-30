export const CONFIG = {
  render: {
    internalHeight: 270,
    maxDt: 1 / 20,
    // Пост-обработка ( Educational VHS look — мягче прежнего LSD )
    chromaShift: 0.0016,     // хроматика
    ditherAmount: 0.03,      // Bayer 4x4
    grainAmount: 0.014,      // плёночное зерно
    vignetteMin: 0.62,       // провал по углам (раньше 0.35 — слишком темно)
    colorBits: 6,            // бит на канал (было 5 — кислотность)
    scanlineAmount: 0.05,    // тонкие VHS строки
    lineJitter: 0.0008,      // строковый джиттер
  },
  textures: {
    cellSkinSize: 64,        // процедурная «кожа» клеток
    backgroundW: 256,
    backgroundH: 128,
    repaintPeriod: 2.5,      // сек между перекрасками фона из палитры
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
    armorHitPulse: 0.08,        // маленький импульс брони за каждый прошедший удар
    symbiosisTickPulse: 0.05,   // слабый непрерывный импульс за сосуществование (событие-тик)
    symbiosisFeedPulse: 0.25,   // кормление «своего» существа едой — событие симбиоза
    detritusRatio: 0.45,       // доля энергии NPC, остающаяся в трупе
  },
  player: {
    accel: 14,
    maxSpeed: 8,
    verticalAccel: 10,         // подъём/опускание (Q/E или Space/Shift)
    verticalMaxSpeed: 5,
    verticalDrag: 2.6,
    elevationMin: -14,         // границы «тощи» по вертикали
    elevationMax: 14,
    drag: 2.4,
    baseEnergy: 100,
    drainIdle: 1.2,
    drainMove: 3.4,
    passiveGain: 0.35,
    eatRange: 1.1,
    npcEatRange: 1.3,
    armorMitigation: 0.7,      // макс. доля гашения урона при armor=1
    hurtRecovery: 0.5,         // скорость затухания hurtSignal (сек⁻¹)
    toxicityRadiusFactor: 1.6, // радиус отпугивания мелких = size × фактор
    evasionSpeedBonus: 0.45,   // +к maxSpeed при evasion=1 (только в убегании — см. main)
    symbiosisHealRate: 3.2,    // энергия/сек на symbiosis=1 вблизи «своих» (см. main)
    toxinRepelBonus: 0.8,      // +к радиусу ауры на toxicity=1 — симбиоз дороже яду
    // M4-углубление: фотосинтез/хемосинтез — не просто тики поведения, а питание
    photoGain: 5.5,            // энергия/сек при photosynthesis=1 в светлой зоне
    chemoGain: 3.0,            // энергия/сек при chemosynthesis=1 в химной зоне
    autotrophCap: 0.75,        // автотрофы берут энергию не выше этого доли базы
    sessilitySpeedFactor: 0.75, // макс. потеря скорости при sessility=1 (оседлость)
    // Балансировка M4 по ощущениям (правило ТЗ: «если не чувствуется — крути здесь»):
    // раньше до 85% энергии можно было дойти только обловом NPC — ветки herbivory/
    // chemosynthesis были ловушкой без митоза. Теперь еда и симбиоз пробивают потолок.
    foodEnergyCap: 0.92,       // планка пассивного восстановления при сытости еды
    symbiosisBoost: 0.6,       // на symbiosis=1 потолок растёт ещё на +0.6×healRate/сек
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
    pitchLerp: 0.08,           // наклон камеры при подъёме/опускании
    maxPitch: 1.15,            // рад — почти сверху, но не gimbal-локап
  },
  world: {
    foodCount: 48,
    foodSpawnRadius: 26,
  },
  npc: {
    count: 3,
    wanderRadius: 5,
    recenterTrigger: 40,       // дом популяции дальше этого от игрока → рой переносится (мигание пустого мира)
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
    carrionRange: 12,          // мелкие существа чуют падаль в этом радиусе (пищевая цепь)
    carrionPull: 1.4,          // сила притяжения к детриту (в единицах speed-вектора)
    // Пищевая цепь, уровень 2: крупные — хищники. Они не боятся игрока и
    // охотятся на МЕЛКИХ существ (и на детрит). Стайка мелких спасается от
    // хищника — игрок видит движение популяции до того, как поймёт механизм.
    huntRange: 16,             // крупный замечает мелкую добычу в этом радиусе
    huntPull: 1.8,             // сила преследования (в единицах speed-вектора)
    huntKillRange: 0.9,        // дистанция «схватки» — мелкое существо гибнет
    fearOfHunterRange: 9,      // мелкие чувствуют хищника так далеко…
    fearOfHunterStrength: 2.2, // …и разбегаются (сильнее, чем от игрока)
    large: {                   // tier 'large': медленные, жирные, опасные шипами
      size: 1.1,
      speed: 0.7,
      energyRatio: 3.5,        // × базовой npcEnergy
      fleeRange: 2.0,          // почти не убегают
      damage: 9,               // касательный урон энергии игрока (в секунду контакта)
      contactRange: 1.8,       // базовый; эффективный = size + contactRange (см. main.ts)
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
    // M4-балансировка (6.7): раньше порог крупных NPC не достигался никогда —
    // localLevel упирался в ceiling при maxEco≈0.35. Теперь потолок выше и
    // растёт вместе с раббербенд-радиусом: мир «раскрывается» по мере эволюции.
    pullMax: 0.9,              // макс. доля подтяжки к уровню игрока (было жёсткое 0.55)
    ceilingPerLevel: 0.8,      // +потолок localLevel за каждую единицу ecoLevel
    ceilingBase: 0.6,          // потолок localLevel при ecoLevel = 0
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
    respawnInterval: 0.5,      // сек между «пересадками» мёртвой еды (при density=1)
    driftMin: 2,               // еда не может дрейфовать ближе этого к игроку
    driftMax: 40,              // дальше этого — гарантированный перенос к игроку
    driftSpeed: 0.35,          // скорость дрейфа еды к игроку (ед/сек, ~0.5× maxSpeed)
    energySpread: 7,           // разброс baseEnergy: 14..(14+spread-1) — «жирность» кусков
    chemPlumeBias: 0.6,        // химные поля тянут респавн еды к себе (видимые плюмы)
    lumPlumeBias: 0.4,         // светлые зоны то же для фотосинтезирующих веток
  },
  save: {
    version: 1,
    key: 'pustota.save',
    interval: 5,               // автосейв раз в N секунд
  },
};
