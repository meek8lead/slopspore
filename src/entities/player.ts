import * as THREE from 'three';
import { CONFIG } from '../config';
import { Medium } from '../world/medium';
import { BehaviorProfile } from './behavior';

export class Player {
  readonly mesh: THREE.Mesh;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  energy = CONFIG.player.baseEnergy;
  ecoLevel = 0;
  mass = CONFIG.player.massStart;
  mitosisCount = 0;
  mitosisFlash = 0;

  private mitosisCooldown = 0;
  private material: THREE.ShaderMaterial;
  private behavior: BehaviorProfile;
  private t = 0;
  // диегетический сигнал недавнего урона (0..1): тело гаснет и дрожит.
  // Не накапливается напрямую в behavior — только через pulse() из main.ts.
  hurtSignal = 0;

  constructor(
    scene: THREE.Scene,
    paletteArray: THREE.Vector3[],
    behavior: BehaviorProfile,
  ) {
    this.behavior = behavior;
    const geo = new THREE.IcosahedronGeometry(0.7, 3);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 1 },
        uSpikes: { value: 0 },
        uFuzz: { value: 0 },
        uTint: { value: 0 },
        uFlash: { value: 0 },
        uStretch: { value: 0 },
        uStretchDir: { value: new THREE.Vector3(1, 0, 0) },
        uHurt: { value: 0 },
        uToxin: { value: 0 },
        uArmor: { value: 0 },
        uPalette: { value: paletteArray },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    scene.add(this.mesh);
  }

  update(
    dt: number,
    input: { x: number; y: number; v: number },
    medium: Medium,
    fleeBoost = 0, // evasion-бонус от main.ts: >0 только когда рядом угроза
  ): { sample: ReturnType<Medium['sample']>; moving: boolean } {
    this.t += dt;
    const sample = medium.sample(this.position.x, this.position.y, this.position.z);
    const viscosity = sample.viscosity;

    const accel = CONFIG.player.accel / (0.4 + viscosity * 1.8);
    this.velocity.x += input.x * accel * dt;
    this.velocity.z += input.y * accel * dt;

    // вертикаль: подъём/опускание — та же вязкость держит, отдельный лимит скорости
    const vAccel = CONFIG.player.verticalAccel / (0.4 + viscosity * 1.8);
    this.velocity.y += input.v * vAccel * dt;
    if (Math.abs(this.velocity.y) > CONFIG.player.verticalMaxSpeed) {
      this.velocity.y = Math.sign(this.velocity.y) * CONFIG.player.verticalMaxSpeed;
    }

    const drag = Math.exp(-CONFIG.player.drag * (0.4 + viscosity) * dt);
    this.velocity.multiplyScalar(drag);
    const vDrag = Math.exp(-CONFIG.player.verticalDrag * (0.4 + viscosity) * dt);
    this.velocity.y *= vDrag;

    const maxSp = CONFIG.player.maxSpeed * (1 + fleeBoost);
    const sp = this.velocity.length();
    if (sp > maxSp) {
      this.velocity.multiplyScalar(maxSp / sp);
    }

    this.position.addScaledVector(this.velocity, dt);
    // границы по высоте — «тоща» пустоты конечна по вертикали
    this.position.y = Math.min(
      CONFIG.player.elevationMax,
      Math.max(CONFIG.player.elevationMin, this.position.y),
    );
    if (this.position.y === CONFIG.player.elevationMax || this.position.y === CONFIG.player.elevationMin) {
      this.velocity.y = 0;
    }

    const moving = sp > 0.15;
    const drain = moving ? CONFIG.player.drainMove : CONFIG.player.drainIdle;
    this.energy = Math.max(0, this.energy - drain * dt);

    // ── growth / decay ──────────────────────────────────────────
    const energyRatio = this.energy / CONFIG.player.baseEnergy;
    if (energyRatio > 0.6) {
      this.mass = Math.min(CONFIG.player.massMax, this.mass + CONFIG.player.massGrowth * dt);
    } else if (energyRatio < 0.2) {
      this.mass = Math.max(CONFIG.player.massMin, this.mass - CONFIG.player.massDecay * dt);
    }

    // ── mitosis ─────────────────────────────────────────────────
    this.mitosisCooldown = Math.max(0, this.mitosisCooldown - dt);
    const threshold = 2.0 + this.ecoLevel * 0.4;
    if (
      this.mitosisCooldown <= 0 &&
      this.mass >= threshold &&
      energyRatio > 0.85
    ) {
      this.mass *= 0.5;
      this.energy *= 0.5;
      this.ecoLevel += CONFIG.player.ecoLevelPerMitosis;
      this.mitosisCount++;
      this.mitosisFlash = 1;
      this.mitosisCooldown = CONFIG.player.mitosisCooldown;
    }
    this.mitosisFlash = Math.max(0, this.mitosisFlash - dt * 2.5);

    // ── body scale ──────────────────────────────────────────────
    const scale = Math.sqrt(this.mass);
    this.mesh.scale.setScalar(scale);
    this.mesh.position.copy(this.position);

    // ── behavior-driven morphology ──────────────────────────────
    this.material.uniforms.uSpikes.value =
      this.behavior.predation * 0.7 + this.behavior.armor * 0.4;
    this.material.uniforms.uFuzz.value =
      this.behavior.chemosynthesis * 1.0 + this.behavior.symbiosis * 0.6;
    this.material.uniforms.uTint.value = this.behavior.dominantIndex() / 11;
    this.material.uniforms.uFlash.value = this.mitosisFlash;

    const speedRatio = Math.min(1, this.velocity.length() / CONFIG.player.maxSpeed);
    this.material.uniforms.uStretch.value = this.behavior.motility * 0.35 * speedRatio;
    if (this.velocity.lengthSq() > 0.001) {
      (this.material.uniforms.uStretchDir.value as THREE.Vector3)
        .copy(this.velocity)
        .normalize();
    }

    this.material.uniforms.uTime.value = this.t;
    this.material.uniforms.uEnergy.value = energyRatio;
    // uHurt — тело гаснет/дрожит после урона; uToxin — ядовитое свечение
    this.material.uniforms.uHurt.value = this.hurtSignal;
    this.material.uniforms.uToxin.value = this.behavior.toxicity;
    this.material.uniforms.uArmor.value = this.behavior.armor;

    // hurtSignal затухает сам — диегетика: тело «заживает», никто не жмёт кнопки
    this.hurtSignal = Math.max(0, this.hurtSignal - CONFIG.player.hurtRecovery * dt);

    return { sample, moving };
  }

  feed(amount: number) {
    this.energy = Math.min(CONFIG.player.baseEnergy, this.energy + amount);
  }

  /** Урон от контакта с шипастым существом — диегетический сигнал (тело гаснет). */
  damage(amount: number) {
    this.energy = Math.max(0, this.energy - amount);
    // armor гасит урон: чем больше нарабирован, тем меньше проходит
    const blocked = 1 - this.behavior.armor * CONFIG.player.armorMitigation;
    this.hurtSignal = Math.min(1, this.hurtSignal + amount * 0.04 * blocked);
    return amount * blocked; // сколько реально прошло (для recentDamage в main)
  }

  /** Прямое восстановление полей поведения из сейва (без нарушения EMA-механики). */
  restoreBehavior(snapshot: Record<string, number>) {
    for (const [k, v] of Object.entries(snapshot)) {
      if (k in this.behavior) {
        (this.behavior as unknown as Record<string, number>)[k] = v;
      }
    }
  }
}

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSpikes;
  uniform float uFuzz;
  uniform float uStretch;
  uniform vec3 uStretchDir;
  uniform float uArmor;
  uniform float uHurt;
  varying vec3 vN;
  varying vec3 vView;
  varying float vDisp;
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

    // base wobble
    float w1 = noise(p * 2.0 + vec3(uTime * 0.5, uTime * 0.3, uTime * 0.2));
    float w2 = noise(p * 4.5 - vec3(uTime * 0.4));
    float disp = (w1 - 0.5) * 0.16 + (w2 - 0.5) * 0.09;
    p += n * disp;
    vDisp = disp;

    // spikes / protrusions
    float sN = noise(p * 5.0 + uTime * 0.2);
    float spike = pow(max(0.0, sN), 4.0) * uSpikes;
    p += n * spike * 0.4;
    vSpike = spike;

    // surface fuzz
    float fN = noise(p * 14.0 + uTime * 0.7);
    p += n * (fN - 0.5) * uFuzz * 0.06;

    // stretch along velocity direction
    float proj = dot(p, uStretchDir);
    p += uStretchDir * proj * uStretch;

    // armor: сглаженная «скорлупа» — тело уплотняется и слегка набухает
    p += n * uArmor * 0.10;

    // hurt: тело дрожит от боли (высокочастотный шум по всей поверхности)
    float hj = noise(p * 20.0 + uTime * 6.0);
    p += n * (hj - 0.5) * uHurt * 0.10;

    vN = normalize(normalMatrix * normal);
    vView = (modelViewMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vN;
  varying vec3 vView;
  varying float vDisp;
  varying float vSpike;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uTint;
  uniform float uFlash;
  uniform float uHurt;
  uniform float uToxin;
  uniform vec3 uPalette[16];

  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(-vView);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 2.0);

    float idx = clamp((vDisp * 4.0 + 0.5) * 16.0, 0.0, 15.0);
    vec3 base = uPalette[int(idx)];

    float tintIdx = clamp(fract(uTint + vDisp * 0.5) * 16.0, 0.0, 15.0);
    vec3 tint = uPalette[int(tintIdx)];
    base = mix(base, tint, 0.35);

    base += vec3(vSpike * 1.5);
    base *= mix(0.35, 1.1, uEnergy);
    base = mix(base * 0.4, base, 1.0 - rim);
    base += vec3(0.25) * rim * (0.6 + 0.4 * sin(uTime * 4.0));
    base += vec3(1.0, 0.9, 0.6) * uFlash * 0.8;

    // hurt: тело гаснет к тёмно-багровому — диегетический сигнал боли
    base = mix(base, base * vec3(0.45, 0.12, 0.10), uHurt * 0.75);

    // toxicity: ядовитое флюоресцентное марево по силиэту
    base += vec3(0.35, 0.9, 0.25) * uToxin * rim * (0.5 + 0.5 * sin(uTime * 2.2));

    gl_FragColor = vec4(base, 1.0);
  }
`;