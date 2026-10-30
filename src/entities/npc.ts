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

  void main() {
    float lit = 0.55 + 0.45 * max(dot(normalize(vN), vec3(0.3, 0.6, 0.7)), 0.0);
    float skin = texture2D(uSkin, vUv).r; // около-белая карта яркости
    vec3 c = uColor * lit * (0.7 + 0.55 * skin) + vec3(vSpike * 1.2);
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

  constructor(scene: THREE.Scene, palette: Palette, spawnPos: THREE.Vector3, skin: THREE.Texture, spec?: NpcSpec) {
    this.spec = spec ?? SMALL_SPEC;
    const detail = this.spec.tier === 'large' ? 2 : 1;
    const geo = new THREE.IcosahedronGeometry(this.spec.size, detail);
    const idx = Math.min(
      palette.colors.length - 1,
      Math.floor(this.spec.colorSeed * (palette.colors.length - 1)),
    );
    const baseColor = palette.colors[idx].clone();
    if (this.spec.tier === 'large') baseColor.multiplyScalar(0.8);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSpikes: { value: this.spec.tier === 'large' ? 0.8 : 0 },
        uColor: { value: new THREE.Vector3(baseColor.r, baseColor.g, baseColor.b) },
        uAlpha: { value: 1 },
        uSkin: { value: skin },
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
        // мягкое любопытство: слегка притормаживаем побег, тянемся к соседу
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
  ) {
    this.lastLocalLevel = localLevel;

    for (const npc of this.npcs) {
      npc.update(dt, t, playerPos, repelRadius, carrion, symbiosis);
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

  /** Восстановление после загрузки (заменяет стартовый набор). */
  restore(states: Array<{ x: number; y: number; z: number; hx: number; hy: number; hz: number; tier: NpcTier }>) {
    for (const n of this.npcs) n.dispose(this.scene);
    this.npcs.length = 0;
    for (const s of states) {
      const spec: NpcSpec = s.tier === 'large' ? largeSpec() : { ...SMALL_SPEC };
      const npc = new Npc(this.scene, this.palette, new THREE.Vector3(s.hx, s.hy, s.hz), this.skinFor(spec), spec);
      npc.position.set(s.x, s.y, s.z);
      npc.mesh.position.copy(npc.position);
      npc.appearInstantly();
      this.npcs.push(npc);
    }
  }
}
