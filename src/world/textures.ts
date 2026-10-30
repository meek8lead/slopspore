import * as THREE from 'three';
import { CONFIG } from '../config';
import { mulberry32 } from '../core/rng';

// Процедурные Canvas-текстуры. Ноль ассетов, всё генерится кодом.
// NearestFilter — намеренно: пиксельность в духе старых edu-рендереров.

function hashGrid(size: number, seed: number): Float32Array {
  const rng = mulberry32(seed);
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return g;
}

function smooth(t: number) { return t * t * (3 - 2 * t); }

function sampleGrid(g: Float32Array, size: number, x: number, y: number): number {
  // тайлирое value-noise (координаты оборачиваются)
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = ((xi % size) + size) % size, x1 = (x0 + 1) % size;
  const y0 = ((yi % size) + size) % size, y1 = (y0 + 1) % size;
  const a = g[y0 * size + x0], b = g[y0 * size + x1];
  const c = g[y1 * size + x0], d = g[y1 * size + x1];
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(g: Float32Array, size: number, x: number, y: number, octaves: number): number {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * sampleGrid(g, size, x * freq, y * freq);
    norm += amp;
    amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

/** «Пластилиновая кожа» клетки: около-белая карта яркости (умножается на цвет палитры). */
export function makeCellSkin(seed: number): THREE.CanvasTexture {
  const size = CONFIG.textures.cellSkinSize;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  const g1 = hashGrid(8, seed);
  const g2 = hashGrid(8, seed + 991);
  const rng = mulberry32(seed + 7);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 8, ny = (y / size) * 8;
      let v = fbm(g1, 8, nx, ny, 3) * 0.7 + fbm(g2, 8, nx * 2, ny * 2, 2) * 0.3;
      v = 0.72 + v * 0.36; // диапазон ~[0.72..1.08]
      // редкие светлые вкрапления (органеллы)
      if (rng() < 0.004) v += 0.18;
      const c = Math.max(0, Math.min(255, Math.round(v * 255)));
      const i = (y * size + x) * 4;
      img.data[i] = c; img.data[i + 1] = c; img.data[i + 2] = c; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace; // ColorManagement выключен — работаем вручную
  return tex;
}

/** Мягкая FBM-карта для фона: [0..1] по горизонтали эволюции шума. Тайлится по X. */
export function makeBackgroundNoise(w: number, h: number, seed: number): Float32Array {
  const out = new Float32Array(w * h);
  const gA = hashGrid(16, seed);
  const gB = hashGrid(16, seed + 4231);
  const warp = hashGrid(8, seed + 77);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      // domain warp мягкими низкочастотными полями
      const wx = u * 16 + fbm(gB, 16, u * 4, v * 4, 2) * 3;
      const wy = v * 8 + fbm(gB, 16, u * 4 + 20, v * 4 + 20, 2) * 2;
      let n = fbm(gA, 16, wx, wy, 4);
      n = n * 0.75 + fbm(gA, 16, wx * 2.7, wy * 2.7, 2) * 0.25;
      out[y * w + x] = Math.max(0, Math.min(1, n));
    }
  }
  return out;
}
