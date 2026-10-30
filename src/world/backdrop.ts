import * as THREE from 'three';

const TEX_SIZE = 256;      // размер Canvas-текстуры пола
const PLANE_SIZE = 260;    // мировой размер плоскости (хватает за горизонт)

// Дальний «пол» пустоты — плоскость с мягким процедурным шумом (Canvas-текстура,
// ноль ассетов). Даёт ощущение движения и глубины: игрок видит, что проплывает
// над узором. Прибит к игроку по XZ (как скайбокс), следует за ним всегда.

export function createBackdrop(): THREE.Mesh {
  const S = TEX_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(S, S);

  // value-noise + FBM на тайловой сетке (шум периодичен → текстура бесшовна)
  const grid = 16;
  const rnd = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const vnoise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const w = (ix: number, iy: number) => rnd(((ix % grid) + grid) % grid, ((iy % grid) + grid) % grid);
    const a = w(xi, yi), b = w(xi + 1, yi), c = w(xi, yi + 1), d = w(xi + 1, yi + 1);
    const u = smooth(xf), v = smooth(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let n = 0;
      n += vnoise((x / S) * grid, (y / S) * grid) * 0.55;
      n += vnoise((x / S) * grid * 2, (y / S) * grid * 2) * 0.28;
      n += vnoise((x / S) * grid * 4, (y / S) * grid * 4) * 0.17;
      const base = 92 + n * 118;               // серо-бежевый «образовательный» тон
      const blot = vnoise((x / S) * 5, (y / S) * 5); // крупные пятна для читаемости
      const k = (base * (0.82 + 0.3 * blot)) | 0;
      const i = (y * S + x) * 4;
      img.data[i] = Math.min(255, k);
      img.data[i + 1] = Math.min(255, k * 0.97);
      img.data[i + 2] = Math.min(255, k * 0.9);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;

  const mat = new THREE.MeshLambertMaterial({ map: tex });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = false;
  return mesh;
}

