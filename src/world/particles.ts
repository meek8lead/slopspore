import * as THREE from 'three';
import { CONFIG } from '../config';
import { mulberry32 } from '../core/rng';
import { Palette } from '../render/palette';

interface Food {
  mesh: THREE.Mesh;
  energy: number;
  alive: boolean;
}

export class FoodField {
  private foods: Food[] = [];
  private group = new THREE.Group();
  private geo = new THREE.IcosahedronGeometry(0.28, 0);
  private rng: () => number;

  constructor(scene: THREE.Scene, palette: Palette, seed = 99) {
    this.rng = mulberry32(seed);
    scene.add(this.group);
    for (let i = 0; i < CONFIG.world.foodCount; i++) {
      this.spawnAround(new THREE.Vector3(), palette);
    }
  }

  private spawnAround(center: THREE.Vector3, palette: Palette) {
    const angle = this.rng() * Math.PI * 2;
    const radius = 3 + this.rng() * CONFIG.world.foodSpawnRadius;
    const pos = new THREE.Vector3(
      center.x + Math.cos(angle) * radius,
      center.y + (this.rng() - 0.5) * 8,
      center.z + Math.sin(angle) * radius,
    );
    const mat = new THREE.MeshBasicMaterial({
      color: palette.colors[Math.floor(this.rng() * palette.colors.length)].clone(),
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.position.copy(pos);
    this.group.add(mesh);
    this.foods.push({ mesh, energy: 14, alive: true });
  }

  update(t: number) {
    for (const f of this.foods) {
      if (!f.alive) continue;
      f.mesh.rotation.x += 0.012;
      f.mesh.rotation.y += 0.015;
      f.mesh.position.y += Math.sin(t * 1.7 + f.mesh.position.x * 0.8) * 0.002;
    }
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

  respawnDead(playerPos: THREE.Vector3, palette: Palette) {
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
      (f.mesh.material as THREE.MeshBasicMaterial).color.copy(
        palette.colors[Math.floor(this.rng() * palette.colors.length)],
      );
    }
  }
}