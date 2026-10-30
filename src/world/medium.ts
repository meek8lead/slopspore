import { createNoise3D } from 'simplex-noise';
import { mulberry32 } from '../core/rng';
import { CONFIG } from '../config';

export interface MediumSample {
  density: number;
  viscosity: number;
  luminosity: number;
  chemEnergy: number;
}

export class Medium {
  private nx: (x: number, y: number, z: number) => number;
  private ny: (x: number, y: number, z: number) => number;
  private nz: (x: number, y: number, z: number) => number;

  constructor(seed = 7) {
    const rng = mulberry32(seed);
    this.nx = createNoise3D(rng);
    this.ny = createNoise3D(rng);
    this.nz = createNoise3D(rng);
  }

  sample(x: number, y: number, z: number): MediumSample {
    const s = CONFIG.medium.scale;
    const w = CONFIG.medium.warp;
    const wx = this.nx(x * s * 2, y * s * 2, z * s * 2) * w;
    const wy = this.ny(x * s * 2, y * s * 2, z * s * 2) * w;
    const wz = this.nz(x * s * 2, y * s * 2, z * s * 2) * w;

    const a = this.nx(x * s + wx, y * s + wy, z * s + wz);
    const b = this.ny(x * s + wx, y * s + wy, z * s + wz);
    const c = this.nz(x * s + wx, y * s + wy, z * s + wz);

    return {
      density: (a + 1) * 0.5,
      viscosity: ((b + 1) * 0.5) * 0.7 + 0.15,
      luminosity: (c + 1) * 0.5,
      chemEnergy: Math.max(0, (a * b + 1) * 0.5),
    };
  }
}