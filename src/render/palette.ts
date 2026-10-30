import * as THREE from 'three';
import { CONFIG } from '../config';
import { mulberry32 } from '../core/rng';

interface HSL { h: number; s: number; l: number }

export class Palette {
  readonly colors: THREE.Color[] = [];
  readonly uniformArray: THREE.Vector3[] = [];

  private baseHSL: HSL[] = [];
  private t = 0;

  constructor(seed = 1337) {
    const rng = mulberry32(seed);
    const baseHue = rng() * 360;
    const n = CONFIG.palette.size;

    for (let i = 0; i < n; i++) {
      const h = ((baseHue + (i * 360) / n + rng() * 24) % 360) / 360;
      // Приглушённая палитра «образовательного VHS»: мягкая насыщенность,
      // узкий тёмный диапазон яркости — фон переливается, но не кричит.
      const s = (0.45 + rng() * 0.4) * CONFIG.palette.satScale;
      const l = CONFIG.palette.lightBase + (rng() - 0.5) * CONFIG.palette.lightRange;
      this.baseHSL.push({ h, s, l });
      this.colors.push(new THREE.Color().setHSL(h, s, l));
      this.uniformArray.push(new THREE.Vector3());
    }
    this.refresh();
  }

  update(dt: number) {
    this.t += dt;
    this.refresh();
  }

  private refresh() {
    const shift = this.t * CONFIG.palette.cycleSpeed;
    for (let i = 0; i < this.baseHSL.length; i++) {
      const b = this.baseHSL[i];
      const h = (b.h + shift * 0.03 + 1) % 1;
      // мягкое «дыхание» яркости — без выхода в белый/чёрный
      const l = Math.max(0.08, Math.min(0.92, b.l + Math.sin(this.t * 0.3 + i * 0.7) * 0.04));
      const c = this.colors[i].setHSL(h, b.s, l);
      this.uniformArray[i].set(c.r, c.g, c.b);
    }
  }

  /** Усреднённый цвет палитры с учётом фазы цикла — для подложки фона. */
  averageColor(): THREE.Color {
    const out = new THREE.Color(0, 0, 0);
    for (const c of this.colors) out.add(c);
    return out.multiplyScalar(1 / this.colors.length);
  }
}