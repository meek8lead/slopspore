import * as THREE from 'three';
import { makeCellSkin } from '../world/textures';
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
  // «желудок»: сколько переваривается (0..1) и оттенок последнего куска
  digestAmount = 0;
  foodHue = 0.5;

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
        uSymbiosis: { value: 0 },
        // «желудок»: сколько только что съедено (0..1) и оттенок перевариваемой пищи
        uDigest: { value: 0 },
        uFoodHue: { value: 0.5 },
        uPalette: { value: paletteArray },
        uSkin: { value: makeCellSkin(1234) }, // процедурная «кожа» клетки
        uBoost: { value: CONFIG.render.objectBoost },
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

    // оседлость — плата за «прирастание»: тяжёлое медленное тело (sessility-ветка)
    const sessilityPenalty = 1 - this.behavior.sessility * CONFIG.player.sessilitySpeedFactor;
    const maxSp = CONFIG.player.maxSpeed * (1 + fleeBoost) * sessilityPenalty;
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
    // «пушок» — визуальный маркер симбиоза: существа читают его как «свой»
    // (см. Npc.symbioticR — такие держатся ближе и не убегают в панике)
    this.material.uniforms.uFuzz.value =
      Math.min(1, this.behavior.chemosynthesis * 1.0 + this.behavior.symbiosis * 0.6);
    this.material.uniforms.uSymbiosis.value = this.behavior.symbiosis;
    // доминантная ветка задаёт оттенок; фотосинтез слегка сдвигает его к «свету»
    const photo = this.behavior.photosynthesis;
    this.material.uniforms.uTint.value =
      this.behavior.dominantIndex() / 11 + (photo > 0.02 ? photo * 0.18 : 0);
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

    // ── digestion: только что съеденное раздувает тело и светится изнутри ──
    this.digestAmount = Math.max(0, this.digestAmount - CONFIG.player.digestRate * dt);
    this.material.uniforms.uDigest.value = this.digestAmount;
    this.material.uniforms.uFoodHue.value = this.foodHue;

    // hurtSignal затухает сам — диегетика: тело «заживает», никто не жмёт кнопки
    this.hurtSignal = Math.max(0, this.hurtSignal - CONFIG.player.hurtRecovery * dt);

    return { sample, moving };
  }

  feed(amount: number, hue = -1) {
    this.energy = Math.min(CONFIG.player.baseEnergy, this.energy + amount);
    // порция еды раздувает «живот» — видно, что клетка только что ела
    const portion = Math.min(
      CONFIG.player.digestMax,
      this.digestAmount + amount * CONFIG.player.digestPerEnergy,
    );
    this.digestAmount = portion;
    if (hue >= 0) this.foodHue = hue;
  }

  /** Случайный оттенок палитры для съеденного куска (еда/детрит/NPC). */
  static randomFoodHue(): number {
    return Math.floor(Math.random() * 16) / 16;
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
  uniform float uDigest;   // сколько переваривается (0..1) — раздувает «живот»
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vView;
  varying float vDisp;
  varying float vSpike;
  varying float vBulge;    // сторона тела, где выпирает «живот»
  uniform sampler2D uSkin;
  uniform float uBoost;

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

    // digestion: полный живот слегка выпирает с одной стороны — асимметричная
    // «шишка», которая медленно обходит тело (перистальтика)
    vec3 bdir = normalize(vec3(sin(uTime * 0.7), 0.3, cos(uTime * 0.7)));
    float bulge = smoothstep(0.2, 1.0, dot(n, bdir));
    p += n * uDigest * (0.06 + 0.08 * bulge);

    vN = normalize(normalMatrix * normal);
    vView = (modelViewMatrix * vec4(p, 1.0)).xyz;
    vUv = uv;
    vBulge = bulge;
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
  uniform float uSymbiosis;
  uniform float uDigest;   // сколько переваривается (0..1)
  uniform float uFoodHue;  // оттенок последнего куска (индекс палитры / 16)
  varying float vBulge;    // сторона тела, где выпирает «живот»
  uniform vec3 uPalette[16];

  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(-vView);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 2.0);

    // Базовый цвет: плавный микс соседних цветов палитры по деформации поверхности.
    // ВАЖНО: никаких uPalette[int(переменная)] — динамическая индексация uniform-
    // массива в GLSL ES 1.0 (WebGL) не гарантирована и роняла компиляцию шейдера,
    // из-за чего игрок и крупные NPC исчезали с экрана («пустой мир»).
    float mixA = clamp(vDisp * 3.0 + 0.5, 0.0, 1.0);
    vec3 base = mix(uPalette[2], uPalette[6], mixA);

    // оттенок доминантной ветки: плавный микс двух опорных цветов палитры
    float skin = texture2D(uSkin, vec2(vUv.x, vUv.y)).r;
    vec3 tintCol = mix(uPalette[0], uPalette[8], fract(uTint));
    base = mix(base, tintCol, 0.4);

    // процедурная кожа: мягкое умножение яркости (палитра сохраняется),
    // объекты ярче подложки
    base *= (0.78 + 0.42 * skin) * uBoost;

    base += vec3(vSpike * 1.5);
    base *= mix(0.35, 1.1, uEnergy);
    base = mix(base * 0.4, base, 1.0 - rim);
    base += vec3(0.25) * rim * (0.6 + 0.4 * sin(uTime * 4.0));
    base += vec3(1.0, 0.9, 0.6) * uFlash * 0.8;

    // hurt: тело гаснет к тёмно-багровому — диегетический сигнал боли
    base = mix(base, base * vec3(0.45, 0.12, 0.10), uHurt * 0.75);

    // toxicity: ядовитое флюоресцентное марево по силиэту
    base += vec3(0.35, 0.9, 0.25) * uToxin * rim * (0.5 + 0.5 * sin(uTime * 2.2));

    // symbiosis: тёплое мягкое свечение — «свой» сигнал для существ.
    // Медленнее и добрее ядовитого; существа читают его как приглашение.
    base += vec3(0.9, 0.75, 0.4) * uSymbiosis * rim * (0.4 + 0.6 * sin(uTime * 1.1));

    // digestion: перевариваемый кусок виден сквозь тело — светящееся пятно
    // оттенка съеденного, медленно «варится» (пульсирует) и гаснет по мере усвоения.
    // Цвет еды — непрерывный hue 0..1 → HSV (без динамической индексации палитры).
    vec3 hsl = abs(fract(vec3(uFoodHue) + vec3(0.0, 0.66667, 0.33333)) * 6.0 - 3.0);
    vec3 foodCol = mix(vec3(1.0, 0.25, 0.2), vec3(0.95, 0.9, 0.8), hsl.x)
                 * (0.6 + 0.4 * clamp(uEnergy, 0.0, 1.0));
    float blob = vBulge * smoothstep(0.08, 0.35, uDigest);
    blob *= 0.75 + 0.25 * sin(uTime * 3.0 + vUv.y * 12.0); // перистальтика
    base = mix(base, foodCol * 1.25, blob * 0.55);
    base += foodCol * blob * 0.18; // лёгкое внутреннее свечение наружу

    gl_FragColor = vec4(base, 1.0);
  }
`;