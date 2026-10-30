# ПУСТОТА

Браузерная 3D-игра про альтернативную эволюцию. Ты — клетка в абстрактной «пустоте»
(не вода, не воздух, а шумовое поле). Двигайся, ешь, эволюционируй через поведение —
без меню выбора. Мир процедурный и подстраивается под твой эволюционный уровень
(rubberband, скрыто от игрока). Визуал — LSD: Dream Emulator: low-res, палитра, dither.

**Стек:** TypeScript + Vite + Three.js + simplex-noise. Ноль ассетов, всё процедурное.
Bundle ≤ 2 МБ gzip. WebGL2.

## Запуск

```bash
npm install
npm run dev      # разработка
npm run build    # прод-сборка в dist/
```

## Управление

| Действие | Клавиши (раскладка не важна — используются физические коды) |
|---|---|
| Движение | `W A S D` / стрелки |
| Вверх | `Space` или `Q` |
| Вниз | `Shift` или `E` |

Еда, детрит и существа поглощаются **касанием**. Никаких меню, HUD и уведомлений —
эволюция читается по телу и миру (debug-overlay — временный, будет удалён в M7).

## Статус вех

- ✅ **M1–M3**: рендер-пайплайн (270p + Bayer-dither + хроматика + grain), домен-варпнутый
  фон, среда (density/viscosity/luminosity/chemEnergy), игрок-иконосфера с морфологией
  от поведения, митоз, BehaviorProfile (EMA + pulse, 11 полей — все живые), NPC, еда.
- 🚧 **M4 (экосистема)**: EcoField (trueLevel/localLevel/rubberband), реактивная сложность
  (голод→еда плотнее, урон→хищников меньше, доминанта→мир сложнее), NpcManager
  (плотность по localLevel, tier 'large' при >0.3, плавное растворение, респавн),
  детрит + scavenging, пищевая цепь (падальщики слетаются к трупам), armor/toxicity/
  evasion/symbiosis через NPC-взаимодействия, автотрофия (photo/chemo — реальный доход
  энергии с потолком; симбиоз — единственный способ его пробить), sessility — замедление,
  вертикальное 3D-движение, save/load (localStorage).
- ⏳ **M5**: колония/многоклеточность (marching cubes, органы).
- ⏳ **M6**: порталы в REMIXED-миры. **M7**: звук, диегетика, удаление GUI. **M8**: деплой.

## Карта файлов

```
src/
├── main.ts           # game loop, input (code-based), камера, оркестрация
├── config.ts         # ВСЕ константы — единая точка правды
├── core/
│   ├── rng.ts        # mulberry32
│   └── save.ts       # saveState/loadState (localStorage, версия)
├── render/
│   ├── palette.ts    # 16 цветов, циклится через HSL
│   └── pipeline.ts   # low-res RT + пост-пасс (шейдеры inline)
├── world/
│   ├── medium.ts     # CPU-сэмплер полей среды
│   ├── background.ts # скайбокс-сфера (прибита к камере)
│   ├── particles.ts  # FoodField: еда + детрит (пулы фиксированного размера)
│   └── eco.ts        # EcoField: trueLevel / localLevel / reactivity
├── entities/
│   ├── behavior.ts   # BehaviorProfile (EMA + pulse)
│   ├── player.ts     # движение, митоз, шейдер морфологии
│   └── npc.ts        # Npc (specs small/large) + NpcManager (спавнер)
└── ui/
    └── debug.ts      # debug overlay (20 Hz), bar-chart поведения
```

## Ключевые инварианты (нарушение = провал)

1. Ноль меню выбора эволюции — ветки emergent из behaviorProfile.
2. Ноль дискретных стадий — ecoLevel float, тело морфится плавно; храповик, только растёт.
3. Ноль HUD в релизе — всё диегетически.
4. Ноль внешних ассетов.
5. Bundle ≤ 2 МБ gzip, без новых зависимостей без обоснования.
6. Не трогать: `CONFIG.render.maxDt`, `ColorManagement.enabled=false`, low-res 270p,
   lerp-привязку камеры, мутабельность `palette.uniformArray`.
