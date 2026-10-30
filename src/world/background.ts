import * as THREE from 'three';
import { CONFIG } from '../config';
import { Palette } from '../render/palette';
import { makeBackgroundNoise } from './textures';

// Фон — «educational VHS»: мягкая процедурная карта (FBM с варпом), перекрашивается
// из текущей палитры каждые CONFIG.textures.repaintPeriod секунд. Сфера прибита
// к камере снаружи (main.ts) — не убирать, иначе выпадешь из мира.

export function createBackground(palette: Palette): THREE.Mesh {
  const W = CONFIG.textures.backgroundW;
  const H = CONFIG.textures.backgroundH;
  const noise = makeBackgroundNoise(W, H, 1337);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;

  let acc = 0;
  const paint = () => {
    const img = ctx.createImageData(W, H);
    const cols = palette.colors;
    // Подложка — усреднённый цвет палитры (тёмный, приглушённый). Палитра
    // смешивается с ней малой долей: фон переливается мягко, без «запёкшейся»
    // радуги и без провала в чёрный.
    const avg = palette.averageColor();
    const mixT = CONFIG.textures.bgMix;
    const bgDim = CONFIG.textures.bgDim; // фон темнее объектов → силуэты читаются
    for (let y = 0; y < H; y++) {
      // вертикальный градиент «небо→пол», как в старых edu-сценах
      const up = 1 - y / (H - 1);
      const shade = (0.8 + 0.35 * up) * bgDim;
      for (let x = 0; x < W; x++) {
        const n = noise[y * W + x];
        // два соседних индекса + дробное смешение → плавные переходы вместо полос
        const f = n * (cols.length - 1);
        const i0 = Math.floor(f);
        const i1 = Math.min(cols.length - 1, i0 + 1);
        const fr = f - i0;
        const a = cols[i0], b = cols[i1];
        const r = (avg.r + (a.r + (b.r - a.r) * fr - avg.r) * mixT) * shade;
        const g = (avg.g + (a.g + (b.g - a.g) * fr - avg.g) * mixT) * shade;
        const bl = (avg.b + (a.b + (b.b - a.b) * fr - avg.b) * mixT) * shade;
        const i = (y * W + x) * 4;
        img.data[i] = Math.round(Math.min(1, r) * 255);
        img.data[i + 1] = Math.round(Math.min(1, g) * 255);
        img.data[i + 2] = Math.round(Math.min(1, bl) * 255);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    tex.needsUpdate = true;
  };
  paint();

  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), mat);
  mesh.renderOrder = -1;
  mesh.userData.tick = (dt: number) => {
    acc += dt;
    if (acc >= CONFIG.textures.repaintPeriod) { acc = 0; paint(); }
  };
  return mesh;
}
