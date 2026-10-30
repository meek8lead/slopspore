import * as THREE from 'three';
import { CONFIG } from '../config';
import { Palette } from '../render/palette';

export class Npc {
  readonly mesh: THREE.Mesh;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly home: THREE.Vector3;
  alive = true;

  private phase: number;
  private material: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, palette: Palette, spawnPos: THREE.Vector3) {
    const geo = new THREE.IcosahedronGeometry(0.45, 1);
    this.material = new THREE.MeshBasicMaterial({
      color: palette.colors[Math.floor(Math.random() * palette.colors.length)].clone(),
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.position.copy(spawnPos);
    this.home = spawnPos.clone();
    this.mesh.position.copy(this.position);
    this.phase = Math.random() * 100;
    scene.add(this.mesh);
  }

  update(dt: number, playerPos: THREE.Vector3) {
    if (!this.alive) return;
    this.phase += dt;

    const wander = new THREE.Vector3(
      Math.sin(this.phase * 0.7),
      Math.cos(this.phase * 0.5) * 0.5,
      Math.cos(this.phase * 0.9),
    ).multiplyScalar(CONFIG.npc.wanderRadius);

    const target = this.home.clone().add(wander);
    const desired = target.sub(this.position);

    const toPlayer = this.position.clone().sub(playerPos);
    const distP = toPlayer.length();
    if (distP < CONFIG.npc.fleeRange) {
      const flee = toPlayer.normalize().multiplyScalar(CONFIG.npc.fleeStrength * 2);
      desired.add(flee);
    }

    if (desired.lengthSq() > 0.0001) {
      desired.normalize().multiplyScalar(CONFIG.npc.wanderSpeed);
    }

    this.velocity.lerp(desired, 1 - Math.exp(-3 * dt));
    this.position.addScaledVector(this.velocity, dt);
    this.mesh.position.copy(this.position);
    this.mesh.rotation.x += dt * 0.8;
    this.mesh.rotation.y += dt * 1.1;
  }

  kill() {
    this.alive = false;
    this.mesh.visible = false;
  }
}