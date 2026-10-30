import * as THREE from 'three';
import { CONFIG } from '../config';
import { mulberry32 } from '../core/rng';
import { Palette } from '../render/palette';
import { makeCellSkin } from './textures';

interface Food {
  mesh: THREE.Mesh;
  energy: number;
  alive: boolean;
  baseEnergy: number;
}

interface Detritus {
  mesh: THREE.Mesh;
  energy: number;
  life: number; // сек до оседания
  alive: boolean;
}

/**
 * FoodField — еда + детрит (падаль).
 *
 * setDensity(m)  — реактивная плотность: при m > 1 мёртвая еда оживает
 *                  быстрее (плотнее «косяк»), при m < 1 — медленнее.
 * setTier(lvl)   — локальный уровень экосистемы: еда «жирнее» (энергия)
 *                  и крупнее визуально. Эффект плавный, без сообщений.
 */
export class FoodField {
  private foods: Food[] = [];
  private detritus: Detritus[] = [];
  private group = new THREE.Group();
  private geo = new THREE.IcosahedronGeometry(0.28, 0);
  private detritusGeo = new THREE.IcosahedronGeometry(0.5, 1);
  private rng: () => number;
  private skin = makeCellSkin(505); // процедурная «кожа» еды/детрита — одна на всех

  private density = 1;
  private tier = 0;
  private respawnTimer = 0;

  constructor(scene: THREE.Scene, palette: Palette, seed = 99) {
    this.rng = mulberry32(seed);
    scene.add(this.group);
    for (let i = 0; i < CONFIG.world.foodCount; i++) {
      this.spawnAround(new THREE.Vector3(), palette);
    }
  }

  setDensity(multiplier: number) {
    this.density = multiplier;
  }

  setTier(localLevel: number) {
    this.tier = Math.max(0, localLevel);
  }

  /** Множитель энергии от тира (наружу — для отчётов/сейва). */
  tierEnergyMult(): number {
    return 1 + this.tier * CONFIG.food.tierEnergyPerLevel;
  }

  private applyTier(f: Food) {
    f.energy = f.baseEnergy * this.tierEnergyMult();
    const s = 1 + this.tier * CONFIG.food.tierSizePerLevel;
    f.mesh.scale.setScalar(s);
  }

  private spawnAround(center: THREE.Vector3, palette: Palette) {
    const angle = this.rng() * Math.PI * 2;
    const radius = 3 + this.rng() * CONFIG.world.foodSpawnRadius;
    const pos = new THREE.Vector3(
      center.x + Math.cos(angle) * radius,
      center.y + (this.rng() - 0.5) * 8,
      center.z + Math.sin(angle) * radius,
    );
    const mat = new THREE.MeshLambertMaterial({
      color: palette.colors[Math.floor(this.rng() * palette.colors.length)]
        .clone().multiplyScalar(CONFIG.render.objectBoost),
      map: this.skin,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.position.copy(pos);
    this.group.add(mesh);
    // baseEnergy 14..20 — разброс «питательности» кусков (одна пересадка за раз)
    const f: Food = {
      mesh,
      energy: 14,
      alive: true,
      baseEnergy: 14 + Math.floor(this.rng() * CONFIG.food.energySpread),
    };
    this.applyTier(f);
    this.foods.push(f);
  }

  /** Оседающий труп NPC — источник scavenging. */
  addDetritus(pos: THREE.Vector3, energy: number, palette: Palette) {
    if (this.detritus.length >= CONFIG.npc.maxCount) {
      // переиспользуем самый старый — фиксированный пул
      let oldest = this.detritus[0];
      for (const d of this.detritus) if (d.life < oldest.life) oldest = d;
      oldest.mesh.position.copy(pos);
      oldest.energy = energy;
      oldest.life = CONFIG.food.detritusLifetime;
      oldest.alive = true;
      oldest.mesh.visible = true;
      oldest.mesh.scale.setScalar(1);
      (oldest.mesh.material as THREE.MeshLambertMaterial).color
        .copy(palette.colors[Math.floor(this.rng() * palette.colors.length)])
        .multiplyScalar(0.6);
      return;
    }
    const mat = new THREE.MeshLambertMaterial({
      color: palette.colors[Math.floor(this.rng() * palette.colors.length)]
        .clone()
        .multiplyScalar(0.6),
      map: this.skin,
    });
    const mesh = new THREE.Mesh(this.detritusGeo, mat);
    mesh.position.copy(pos);
    this.group.add(mesh);
    this.detritus.push({
      mesh,
      energy,
      life: CONFIG.food.detritusLifetime,
      alive: true,
    });
  }

  update(dt: number, t: number, playerPos: THREE.Vector3) {
    for (const f of this.foods) {
      if (!f.alive) continue;
      f.mesh.rotation.x += 0.012;
      f.mesh.rotation.y += 0.015;
      f.mesh.position.y += Math.sin(t * 1.7 + f.mesh.position.x * 0.8) * 0.002;
      // M4-фикс «мира без еды»: еда не следует за игроком — при долгом пути
      // все икосаэдры остаются позади. Живая еда медленно дрейфует к клетке
      // (как планктон за течением); совсем далеко — «переселяется» в поле видимости.
      const dx = playerPos.x - f.mesh.position.x;
      const dy = playerPos.y - f.mesh.position.y;
      const dz = playerPos.z - f.mesh.position.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > CONFIG.world.foodSpawnRadius) {
        // нормализованный дрейф: постоянная скорость «к течению за клеткой»
        const step = Math.min(d, CONFIG.food.driftSpeed * dt * 12); // ~4 ед/сек
        f.mesh.position.x += (dx / d) * step;
        f.mesh.position.y += (dy / d) * step;
        f.mesh.position.z += (dz / d) * step;
      } else if (d > CONFIG.food.driftMax) {
        // гарантировано далеко — тихий перенос ближе к игроку
        const angle = this.rng() * Math.PI * 2;
        const r = CONFIG.food.driftMin + this.rng() * CONFIG.world.foodSpawnRadius;
        f.mesh.position.set(
          playerPos.x + Math.cos(angle) * r,
          playerPos.y + (this.rng() - 0.5) * 8,
          playerPos.z + Math.sin(angle) * r,
        );
      }
    }
    // детрит оседает и гаснет
    for (const d of this.detritus) {
      if (!d.alive) continue;
      d.life -= dt;
      d.mesh.position.y -= CONFIG.food.detritusSink * dt;
      const frac = Math.max(0, d.life / CONFIG.food.detritusLifetime);
      d.mesh.scale.setScalar(0.4 + frac * 0.6);
      d.mesh.rotation.y += dt * 0.4;
      if (d.life <= 0) {
        d.alive = false;
        d.mesh.visible = false;
      }
    }
    // реактивный respawn: плотность управляет темпом оживления мёртвой еды
    this.respawnTimer -= dt * this.density;
  }

  tryEat(pos: THREE.Vector3, range: number): number {
    let gained = 0;
    for (const f of this.foods) {
      if (!f.alive) continue;
      if (f.mesh.position.distanceTo(pos) < range) {
        f.alive = false;
        f.mesh.visible = false;
        gained += f.energy;
      }
    }
    return gained;
  }

  /** Подбор детрита. Возвращает энергию (меньше живого NPC) или 0. */
  tryEatDetritus(pos: THREE.Vector3, range: number): number {
    let gained = 0;
    for (const d of this.detritus) {
      if (!d.alive) continue;
      if (d.mesh.position.distanceTo(pos) < range) {
        d.alive = false;
        d.mesh.visible = false;
        gained += d.energy;
      }
    }
    return gained;
  }

  /** Позиции живого детрита — чтобы мелкие NPC слетались к падали (пищевая цепь). */
  detritusPositions(out: THREE.Vector3[]): THREE.Vector3[] {
    out.length = 0;
    for (const d of this.detritus) if (d.alive) out.push(d.mesh.position);
    return out;
  }

  /** Сколько еды сейчас живо — для debug-строки. */
  aliveCount(): number {
    let n = 0;
    for (const f of this.foods) if (f.alive) n++;
    return n;
  }

  respawnDead(playerPos: THREE.Vector3, palette: Palette) {
    if (this.respawnTimer > 0) return; // темп задаёт density в update()
    for (const f of this.foods) {
      if (f.alive) continue;
      const angle = this.rng() * Math.PI * 2;
      const radius = 6 + this.rng() * CONFIG.world.foodSpawnRadius;
      f.mesh.position.set(
        playerPos.x + Math.cos(angle) * radius,
        playerPos.y + (this.rng() - 0.5) * 8,
        playerPos.z + Math.sin(angle) * radius,
      );
      f.alive = true;
      f.mesh.visible = true;
      this.applyTier(f);
      (f.mesh.material as THREE.MeshLambertMaterial).color.copy(
        palette.colors[Math.floor(this.rng() * palette.colors.length)],
      );
      this.respawnTimer = CONFIG.food.respawnInterval; // одна пересадка за раз — плавно
    }
  }
}
