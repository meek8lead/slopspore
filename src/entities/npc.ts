import * as THREE from 'three';
import { makeCellSkin } from '../world/textures';
import { CONFIG } from '../config';
import { Palette } from '../render/palette';

export type NpcTier = 'small' | 'large';

export interface NpcSpec {
  size: number;            // радиус икосаэдра (0.45 по умолчанию)
  speed: number;
  energy: number;          // сколько даёт при поедании
  colorSeed: number;       // 0..1 — доля палитры, от которой берём цвет
  tier: NpcTier;
}

export const SMALL_SPEC: NpcSpec = {
  size: 0.45,
  speed: CONFIG.npc.wanderSpeed,
  energy: CONFIG.player.npcEnergy,
  colorSeed: Math.random(),
  tier: 'small',
};

export function largeSpec(): NpcSpec {
  return {
    size: CONFIG.npc.large.size,
    speed: CONFIG.npc.large.speed,
    energy: CONFIG.player.npcEnergy * CONFIG.npc.large.energyRatio,
    colorSeed: CONFIG.npc.large.colorSeed,
    tier: 'large',
  };
}

/** Вершинный шейдер с шипами для крупных NPC (те же приёмы, что у Player). */
const NPC_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSpikes;
  varying vec2 vUv;
  varying vec3 vN;
  varying float vSpike;

  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
                   mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
                   mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
  }

  void main() {
    vec3 p = position;
    vec3 n = normalize(position);
    float w = noise(p * 3.0 + vec3(uTime * 0.4));
    p += n * (w - 0.5) * 0.12;
    float sN = noise(p * 5.0 + uTime * 0.15);
    float spike = pow(max(0.0, sN), 4.0) * uSpikes;
    p += n * spike * 0.45;
    vSpike = spike;
    vUv = uv;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const NPC_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vN;
  varying float vSpike;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform sampler2D uSkin;
  uniform float uAlpha;
  uniform float uBoost;   // объекты ярче подложки

  void main() {
    // Двойной «под» — как у игрока: свет из направления камеры + мягкий
    // заполняющий снизу. Раньше освещение было в мировых координатах
    // (vec3(0.3,0.6,0.7)) — существо оказывалось тёмным с одной стороны
    // и сливалось с фоном («не вижу существ»).
    vec3 n = normalize(vN);
    float key = 0.55 + 0.45 * max(dot(n, normalize(vec3(0.3, 0.6, 0.7))), 0.0);
    float fill = 0.35 + 0.25 * max(dot(n, vec3(-0.3, -0.5, 0.4)), 0.0);
    float lit = max(key, fill);
    float skin = texture2D(uSkin, vUv).r; // около-белая карта яркости
    vec3 c = (uColor * lit * (0.7 + 0.55 * skin) + vec3(vSpike * 1.2)) * uBoost;
    // нижняя guarantee: ни одна грань не темнее 0.45*uColor*uBoost — тело читается всегда
    c = max(c, uColor * 0.45 * uBoost);
    gl_FragColor = vec4(c, uAlpha);
  }
`;

/**
 * Npc — параметризованное существо. small — текущий орбитальный блуждатель,
 * large — медленный, жирный, с шипами (наносит касательный урон).
 * Удаление — плавное растворение (fade), не мгновенное исчезновение.
 */
export class Npc {
  readonly mesh: THREE.Mesh;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly home: THREE.Vector3;
  readonly spec: NpcSpec;
  alive = true;
  fadingOut = false;
  fade = 1; // 1 → 0 при растворении, 0 → 1 при появлении

  private phase: number;
  private material: THREE.ShaderMaterial;
  // цвет при спавне + средняя яркость палитры на момент спавна — для «живого» цвета
  private baseColor = new THREE.Vector3();
  // (baseAvg больше не нужен: базовый цвет нормирован на среднее палитры)
  // текущий средний цвет палитры (обновляет NpcManager каждый кадр)
  static paletteAvg = new THREE.Vector3(0.5, 0.5, 0.5);

  constructor(scene: THREE.Scene, palette: Palette, spawnPos: THREE.Vector3, skin: THREE.Texture, spec?: NpcSpec) {
    this.spec = spec ?? SMALL_SPEC;
    const detail = this.spec.tier === 'large' ? 2 : 1;
    const geo = new THREE.IcosahedronGeometry(this.spec.size, detail);
    const idx = Math.min(
      palette.colors.length - 1,
      Math.floor(this.spec.colorSeed * (palette.colors.length - 1)),
    );
    const baseCol = palette.colors[idx].clone();
    if (this.spec.tier === 'large') baseCol.multiplyScalar(0.8);
    // нормируем к средней яркости палитры: существо ярче подложки всегда
    const avgC = palette.averageColor();
    const avgLum = Math.max(0.05, 0.299 * avgC.r + 0.587 * avgC.g + 0.114 * avgC.b);
    const objLum = Math.max(0.05, 0.299 * baseCol.r + 0.587 * baseCol.g + 0.114 * baseCol.b);
    const minContrast = CONFIG.npc.contrastMin; // множитель к яркости фона
    if (objLum < avgLum * minContrast) baseCol.multiplyScalar((avgLum * minContrast) / objLum);
    this.baseColor.set(baseCol.r, baseCol.g, baseCol.b);
    const avgV = new THREE.Vector3(avgC.r, avgC.g, avgC.b);
    // нормируем базовый цвет к «единичной средней» — дальше uColor = base × paletteAvg
    if (avgV.lengthSq() > 0.0001) this.baseColor.divide(avgV);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSpikes: { value: this.spec.tier === 'large' ? 0.8 : 0 },
        uColor: { value: new THREE.Vector3(baseCol.r, baseCol.g, baseCol.b) },
        uAlpha: { value: 1 },
        uSkin: { value: skin },
        uBoost: { value: CONFIG.render.objectBoost },
      },
      vertexShader: NPC_VERT,
      fragmentShader: NPC_FRAG,
      transparent: true,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.position.copy(spawnPos);
    this.home = spawnPos.clone();
    this.mesh.position.copy(this.position);
    this.phase = Math.random() * 100;
    this.fade = 0; // плавно появляется
    scene.add(this.mesh);
  }

  /** Съедобность зависит от тира: крупные почти не убегают. */
  private fleeRange(): number {
    return this.spec.tier === 'large' ? CONFIG.npc.large.fleeRange : CONFIG.npc.fleeRange;
  }

  update(
    dt: number,
    t: number,
    playerPos: THREE.Vector3,
    repelRadius = 0,
    carrion: readonly THREE.Vector3[] = [], // живой детрит — пищевая цепь (M4)
    symbiosis = 0, // «пушистость» игрока: мелкие существа считывают её как «свой»
    hunters: readonly THREE.Vector3[] = [], // крупные хищники — цепь замкнута
    smallPrey: readonly THREE.Vector3[] = [], // позиции мелких — цель охоты крупных
  ): void {
    // fade-in / fade-out работает даже когда !alive (растворение)
    if (this.fadingOut) {
      this.fade = Math.max(0, this.fade - dt / CONFIG.npc.fadeDuration);
      this.material.uniforms.uAlpha.value = this.fade;
      this.mesh.scale.setScalar(Math.max(0.001, this.fade));
      if (this.fade <= 0) this.mesh.visible = false;
      return;
    } else if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / (CONFIG.npc.fadeDuration * 0.5));
      this.material.uniforms.uAlpha.value = this.fade;
      this.mesh.scale.setScalar(this.fade);
    }

    if (!this.alive) return;
    this.phase += dt;
    this.material.uniforms.uTime.value = t + this.phase;

    // Цвет существа «живёт» вместе с палитрой: при спавне baseColor нормирован
    // на средний цвет палитры; каждый кадр uColor = base × paletteAvg(сейчас).
    // Так NPC переливаются вместе с фоном, но сохраняют контраст (анти-слияние).
    {
      const uc = this.material.uniforms.uColor.value as THREE.Vector3;
      uc.copy(this.baseColor).multiply(Npc.paletteAvg);
      // нижняя граница яркости — существо всегда чуть ярче подложки
      const lum = 0.299 * uc.x + 0.587 * uc.y + 0.114 * uc.z;
      if (lum < 0.28) uc.multiplyScalar(0.28 / Math.max(lum, 0.001));
    }

    const wander = new THREE.Vector3(
      Math.sin(this.phase * 0.7),
      Math.cos(this.phase * 0.5) * 0.5,
      Math.cos(this.phase * 0.9),
    ).multiplyScalar(CONFIG.npc.wanderRadius);

    // M4: существа живут в той же толще, что и игрок — не «пол» на y=0.
    // home.y из сейва/спавна задаёт их глубину, блуждание слегка её дышит.
    const target = this.home.clone().add(wander);
    const desired = target.sub(this.position);

    const toPlayer = this.position.clone().sub(playerPos);
    const distP = toPlayer.length();
    // токсичная аура игрока: мелкие существа обходят стороной (symbiosis-побочка —
    // крупные не боятся яда, они слишком велики, чтобы реагировать на химтрейлер)
    if (repelRadius > 0 && this.spec.tier === 'small' && distP < repelRadius) {
      desired.add(toPlayer.normalize().multiplyScalar(CONFIG.npc.fleeStrength * 1.2));
    }
    // пищевая цепь: падальщики слетаются к детриту, если он ближе дома
    if (this.spec.tier === 'small' && carrion.length > 0) {
      let nearest = carrion[0];
      let nd = nearest.distanceTo(this.position);
      for (const c of carrion) {
        const d2 = c.distanceTo(this.position);
        if (d2 < nd) {
          nd = d2;
          nearest = c;
        }
      }
      if (nd < CONFIG.npc.carrionRange) {
        desired.add(
          nearest.clone().sub(this.position).normalize().multiplyScalar(CONFIG.npc.carrionPull),
        );
      }
    }
    if (distP < this.fleeRange()) {
      // симбиотичный игрок («пушистый») — не угроза: мелкие существа теряют
      // страх и вместо паники держатся рядом. Это «свой» сигнал, не меню.
      const symbioticR = this.spec.tier === 'small' ? this.fleeRange() * symbiosis : 0;
      if (distP < symbioticR) {
        // мягкое любопытство: слегка прормаживаем побег, тянемся к соседу
        desired.add(toPlayer.clone().normalize().multiplyScalar(-0.35));
      } else {
        const flee = toPlayer.normalize().multiplyScalar(CONFIG.npc.fleeStrength * 2);
        desired.add(flee);
      }
    } else if (
      distP < this.fleeRange() * 1.8 &&
      this.spec.tier === 'small' &&
      playerPos.distanceTo(this.home) > CONFIG.npc.wanderRadius * 2
    ) {
      // крупняк не преследует — только мелкие любопытны; лёгкое выравнивание
      // по глубине, чтобы погоня/убегание были настоящими 3D
      desired.y += (playerPos.y - this.position.y) * 0.15;
    }

    // ── пищевая цепь, уровень 2 ──
    if (this.spec.tier === 'large') {
      // крупные — хищники: охотятся на ближайшую мелкую добычу (и на падаль).
      let prey: THREE.Vector3 | null = null;
      let pd = CONFIG.npc.huntRange;
      for (const s of smallPrey) {
        const d = s.distanceTo(this.position);
        if (d < pd) { pd = d; prey = s; }
      }
      if (!prey && carrion.length > 0) {
        // добычи нет — бродят к падали (хищник всёяден, детрит не пропадает)
        for (const c of carrion) {
          const d = c.distanceTo(this.position);
          if (d < CONFIG.npc.carrionRange * 1.4 && d < pd) { pd = d; prey = c; }
        }
      }
      if (prey) {
        desired.add(
          prey.clone().sub(this.position).normalize().multiplyScalar(CONFIG.npc.huntPull),
        );
      }
    } else {
      // мелкие чувствуют хищника издалека и разбегаются сильнее, чем от игрока —
      // игрок видит «волну паники» в популяции до того, как поймёт причину
      for (const h of hunters) {
        const dh = this.position.distanceTo(h);
        if (dh < CONFIG.npc.fearOfHunterRange) {
          const away = this.position.clone().sub(h).normalize();
          const panic = 1 - dh / CONFIG.npc.fearOfHunterRange;
          desired.add(away.multiplyScalar(CONFIG.npc.fearOfHunterStrength * (0.5 + panic)));
        }
      }
    }

    if (desired.lengthSq() > 0.0001) {
      desired.normalize().multiplyScalar(this.spec.speed);
    }

    this.velocity.lerp(desired, 1 - Math.exp(-3 * dt));
    this.position.addScaledVector(this.velocity, dt);
    this.mesh.position.copy(this.position);
    this.mesh.rotation.x += dt * 0.8;
    this.mesh.rotation.y += dt * 1.1;
  }

  /** Полное исчезновение (съеден — труп не остаётся). */
  kill() {
    this.alive = false;
    this.fadingOut = true;
    this.fade = 0;
    this.mesh.visible = false;
  }

  /** Убран спавнером — плавное растворение. */
  startFadeOut() {
    this.alive = false;
    this.fadingOut = true;
  }

  /** Мгновенно показать существо без fade-in (загрузка из сейва). */
  appearInstantly() {
    this.fade = 1;
    this.material.uniforms.uAlpha.value = 1;
    this.mesh.scale.setScalar(1);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * NpcManager — реактивный спавнер вместо статичных трёх NPC.
 * Целевое количество = baseCount + floor(localLevel * growth), макс maxCount.
 * При localLevel > порога могут спавниться крупные. Мёртвых заменяет
 * (с задержкой respawnDelay). Перелишние — плавно растворяются.
 */

// Переиспользуемые буферы ролей в пищевой цепи (аллоцируются один раз)
const hunterBuf: THREE.Vector3[] = [];
const preyBuf: THREE.Vector3[] = [];

export class NpcManager {
  // процедурные «кожи»: по одной на тир (без аллокаций на спавн)
  private skinSmall = makeCellSkin(201);
  private skinLarge = makeCellSkin(907);
  private skinFor(spec: NpcSpec): THREE.Texture {
    return spec.tier === 'large' ? this.skinLarge : this.skinSmall;
  }

  readonly npcs: Npc[] = [];
  private scene: THREE.Scene;
  private palette: Palette;
  private checkTimer = 0;
  private respawnQueue: number[] = []; // время, когда пора возместить потерю
  private lastLocalLevel = 0;

  constructor(scene: THREE.Scene, palette: Palette) {
    this.scene = scene;
    this.palette = palette;
    for (let i = 0; i < CONFIG.npc.count; i++) {
      const angle = (i / CONFIG.npc.count) * Math.PI * 2 + Math.random() * 0.5;
      const r = 8 + Math.random() * 4;
      const pos = new THREE.Vector3(
        Math.cos(angle) * r,
        (Math.random() - 0.5) * 3,
        Math.sin(angle) * r,
      );
      this.npcs.push(new Npc(scene, palette, pos, this.skinSmall));
    }
  }

  private targetCount(predatorDensity: number): number {
    const base =
      CONFIG.npc.count +
      Math.floor(Math.max(0, this.lastLocalLevel) * CONFIG.npc.levelGrowth);
    const scaled = base * predatorDensity;
    return Math.max(1, Math.min(CONFIG.npc.maxCount, Math.round(scaled)));
  }

  private spawnOne(playerPos: THREE.Vector3, allowLarge: boolean) {
    const angle = Math.random() * Math.PI * 2;
    const r =
      CONFIG.npc.spawnMinRadius +
      Math.random() * (CONFIG.npc.spawnMaxRadius - CONFIG.npc.spawnMinRadius);
    const pos = new THREE.Vector3(
      playerPos.x + Math.cos(angle) * r,
      playerPos.y + (Math.random() - 0.5) * 4,
      playerPos.z + Math.sin(angle) * r,
    );
    const spec = allowLarge && Math.random() < 0.5 ? largeSpec() : undefined;
    this.npcs.push(new Npc(this.scene, this.palette, pos, this.skinFor(spec ?? SMALL_SPEC), spec));
  }

  update(
    dt: number,
    t: number,
    playerPos: THREE.Vector3,
    localLevel: number,
    predatorDensity: number,
    repelRadius = 0, // токсичная аура игрока (main.ts считает из behavior.toxicity)
    carrion: readonly THREE.Vector3[] = [], // живой детрит — пищевая цепь (M4)
    symbiosis = 0, // «пушистость» игрока — мелкие существа теряют страх (симбиоз)
    onHunterKill?: (victim: Npc) => void, // крупный сожрал мелкого → труп/событие в main
  ) {
    this.lastLocalLevel = localLevel;

    // средний цвет палитры «на сейчас» — Npc используют его для живой подгонки цвета
    const avg = this.palette.averageColor();
    Npc.paletteAvg.set(avg.r, avg.g, avg.b);

    // Переиспользуемые буферы ролей в цепи (без аллокаций на кадр):
    // крупные охотятся на позиции мелких; мелкие чувствуют позиции крупных.
    hunterBuf.length = 0;
    preyBuf.length = 0;
    for (const n of this.npcs) {
      if (!n.alive || n.fadingOut) continue;
      if (n.spec.tier === 'large') hunterBuf.push(n.position);
      else preyBuf.push(n.position);
    }

    for (const npc of this.npcs) {
      npc.update(dt, t, playerPos, repelRadius, carrion, symbiosis, hunterBuf, preyBuf);
    }

    // ── охота завершена? крупный догнал мелкого — цепь сомкнулась ──
    for (const h of this.npcs) {
      if (!h.alive || h.fadingOut || h.spec.tier !== 'large') continue;
      for (const v of this.npcs) {
        if (v === h || !v.alive || v.fadingOut || v.spec.tier !== 'small') continue;
        const d = h.position.distanceTo(v.position);
        if (d < CONFIG.npc.huntKillRange + v.spec.size * 0.5) {
          v.kill();
          onHunterKill?.(v);
          break;
        }
      }
    }
    // чистка полностью растворившихся
    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const npc = this.npcs[i];
      if (npc.fadingOut && npc.fade <= 0) {
        npc.dispose(this.scene);
        this.npcs.splice(i, 1);
      }
    }

    // очередь замещения погибших
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      this.respawnQueue[i] -= dt;
      if (this.respawnQueue[i] <= 0) {
        this.respawnQueue.splice(i, 1);
        const active = this.npcs.filter((n) => n.alive && !n.fadingOut).length;
        if (active < CONFIG.npc.maxCount) {
          this.spawnOne(playerPos, localLevel > CONFIG.npc.largeTierLevel);
        }
      }
    }

    // периодическая проверка плотности популяции
    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = CONFIG.npc.checkInterval;
      const active = this.npcs.filter((n) => n.alive && !n.fadingOut).length;
      const target = this.targetCount(predatorDensity);
      if (active < target) {
        this.spawnOne(playerPos, localLevel > CONFIG.npc.largeTierLevel);
      } else if (active > target) {
        // убираем самого дальнего — он тихо растворяется
        let far: Npc | null = null;
        let farD = -1;
        for (const n of this.npcs) {
          if (!n.alive || n.fadingOut) continue;
          const d = n.position.distanceTo(playerPos);
          if (d > farD) {
            farD = d;
            far = n;
          }
        }
        far?.startFadeOut();
      }
    }
  }

  /** Вызывается из main.ts, когда игрой NPC съеден/убит. */
  notifyKilled() {
    this.respawnQueue.push(CONFIG.npc.respawnDelay);
  }

  /** Состояние для сейва. */
  snapshotState() {
    return this.npcs
      .filter((n) => n.alive && !n.fadingOut)
      .map((n) => ({
        x: n.position.x, y: n.position.y, z: n.position.z,
        hx: n.home.x, hy: n.home.y, hz: n.home.z,
        tier: n.spec.tier as NpcTier,
      }));
  }

  /**
   * Перенос всей экосистемы к позиции игрока (прибитый «дом»).
   * Иначе при быстром уходе из окрестностей origin мир остаётся позади —
   * и после загрузки сейва экран пуст («вижу только себя»).
   *
   * Фикс «схлопывания роя»: старая версия сдвигала ВСЕ дома параллельно к
   * игроку — после нескольких переносов облако домов спрессовывалось в точку,
   * существа стекались друг в друга и исчезали из вида (игрок оставался один).
   * Теперь переносится только ЦЕНТР облака, а дома заново разбрасываются
   * вокруг новой точки со случайным радиусом — форма популяции сохраняется.
   */
  recenter(to: THREE.Vector3) {
    if (this.npcs.length === 0) return;
    // центр домов популяции
    const c = new THREE.Vector3();
    for (const n of this.npcs) {
      c.add(n.home);
    }
    c.multiplyScalar(1 / this.npcs.length);
    // уже рядом с игроком? ничего не делаем
    if (c.distanceTo(to) < CONFIG.npc.recenterTrigger) return;
    // НО: если сами существа далеко от игрока — переносим их тоже.
    // Иначе при быстром бегстве рой «не догоняет» (скорость NPC 0.7–1.5 против
    // 8 у игрока) и мир становится пустым, хотя дома уже переехали.
    const farFromPlayer = this.npcs.some(
      (n) => n.alive && !n.fadingOut && n.position.distanceTo(to) > CONFIG.npc.recenterTrigger * 1.6,
    );
    // новые дома — вокруг позиции игрока, со случайным направлением/радиусом
    let i = 0;
    for (const n of this.npcs) {
      const angle = (i / Math.max(1, this.npcs.length)) * Math.PI * 2 + Math.random() * 0.9;
      const r =
        CONFIG.npc.recenterSpreadMin +
        Math.random() * (CONFIG.npc.recenterSpreadMax - CONFIG.npc.recenterSpreadMin);
      n.home.set(
        to.x + Math.cos(angle) * r,
        to.y + (Math.random() - 0.5) * 6,
        to.z + Math.sin(angle) * r,
      );
      // если рой сильно отстал — телепортируем к новому дому (иначе он будет
      // догонять вечность; в «пустоте» без ориентиров это незаметно)
      if (farFromPlayer && n.alive && !n.fadingOut) {
        n.position.copy(n.home);
        n.mesh.position.copy(n.position);
      }
      void i;
      i++;
    }
  }

  /** Восстановление после загрузки (заменяет стартовый набор). */
  restore(
    states: Array<{ x: number; y: number; z: number; hx: number; hy: number; hz: number; tier: NpcTier }>,
    anchor?: THREE.Vector3, // если задан — дома переносятся так, чтобы рой встал вокруг anchor
  ) {
    for (const n of this.npcs) n.dispose(this.scene);
    this.npcs.length = 0;
    // вычисляем «центр домов» из сейва — относительно него кладём новых NPC
    let anchorShift: THREE.Vector3 | null = null;
    if (anchor && states.length > 0) {
      const c = new THREE.Vector3();
      for (const s of states) c.add(new THREE.Vector3(s.hx, s.hy, s.hz));
      c.multiplyScalar(1 / states.length);
      anchorShift = anchor.clone().sub(c);
    }
    for (const s of states) {
      const spec: NpcSpec = s.tier === 'large' ? largeSpec() : { ...SMALL_SPEC };
      const home = new THREE.Vector3(s.hx, s.hy, s.hz);
      if (anchorShift) home.add(anchorShift);
      const npc = new Npc(this.scene, this.palette, home, this.skinFor(spec), spec);
      npc.position.set(s.x, s.y, s.z);
      if (anchorShift) {
        npc.position.add(anchorShift);
      }
      npc.mesh.position.copy(npc.position);
      npc.appearInstantly();
      this.npcs.push(npc);
    }
  }
}
