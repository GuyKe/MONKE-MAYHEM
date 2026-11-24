import * as THREE from 'three';
import { mulberry32 } from './noise';

/** Value noise that wraps round, so the texture tiles. */
function tileableNoise(size: number, cells: number, rand: () => number): Float32Array {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (ix: number, iy: number) => lattice[(iy % cells) * cells + (ix % cells)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}

/** Sums noise at several scales: broad patches, then finer and finer grain. */
function fractal(size: number, rand: () => number, octaves: Array<[number, number]>): Float32Array {
  const total = new Float32Array(size * size);
  let weight = 0;
  for (const [cells, w] of octaves) {
    const n = tileableNoise(size, cells, rand);
    for (let i = 0; i < total.length; i++) total[i] += n[i] * w;
    weight += w;
  }
  for (let i = 0; i < total.length; i++) total[i] /= weight;
  return total;
}

function toTexture(size: number, paint: (x: number, y: number) => [number, number, number], anisotropy = 2): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d')!;
  const image = c.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * size + x) * 4;
      image.data[i] = Math.max(0, Math.min(255, r));
      image.data[i + 1] = Math.max(0, Math.min(255, g));
      image.data[i + 2] = Math.max(0, Math.min(255, b));
      image.data[i + 3] = 255;
    }
  }
  c.putImageData(image, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/**
 * Ground: patches of light and dark, crumbs of soil, fallen needles and blades of grass, greyscale so the terrain's own
 * colours (grass, moss, dirt, sand) show through. Tiles every few metres.
 */
export function groundTexture(seed: number): THREE.CanvasTexture {
  const size = 256;
  const rand = mulberry32(seed + 5);
  const base = fractal(size, rand, [[4, 1], [8, 0.9], [16, 0.6], [32, 0.45], [64, 0.3]]);
  const speck = new Float32Array(size * size).map(() => rand());
  return toTexture(size, (x, y) => {
    const i = y * size + x;
    let v = 0.62 + base[i] * 0.55;
    // Blades and needles: short bright and dark strokes.
    const s = speck[i];
    if (s > 0.965) v += 0.18;
    else if (s < 0.03) v -= 0.22;
    const streak = Math.sin((x * 0.9 + base[i] * 20) * 1.3) * 0.04;
    v += streak;
    const g = v * 255;
    return [g, g * 1.02, g * 0.95];
  });
}

/**
 * Props: bark, rock and foliage share this. Mottled with fine grain and faint vertical fibres, so a trunk's cylinder reads
 * as bark and a boulder as rough stone.
 */
export function propTexture(seed: number): THREE.CanvasTexture {
  const size = 256;
  const rand = mulberry32(seed + 9);
  const base = fractal(size, rand, [[3, 1], [6, 1], [12, 0.8], [24, 0.6], [48, 0.5]]);
  const fibres = fractal(size, rand, [[2, 0.3], [64, 1]]);
  return toTexture(size, (x, y) => {
    const i = y * size + x;
    // Fibres run up and down: stretch a coarse noise along y.
    const f = fibres[((y * 7) % size) * size + x];
    const v = 0.55 + base[i] * 0.5 + (f - 0.5) * 0.35;
    // Cracks: thin dark lines where the noise crosses a level.
    const crack = Math.abs(base[i] - 0.5) < 0.012 ? -0.25 : 0;
    const g = (v + crack) * 255;
    return [g, g, g * 0.97];
  });
}

/** Wood for sticks, poles and logs: long grain along the piece. */
export function woodTexture(seed: number): THREE.CanvasTexture {
  const size = 128;
  const rand = mulberry32(seed + 13);
  const noise = fractal(size, rand, [[2, 1], [16, 0.7], [64, 0.5]]);
  return toTexture(size, (x, y) => {
    const i = y * size + x;
    const grain = noise[(x % size) + ((y * 5) % size) * size] ;
    const v = 0.7 + (noise[i] - 0.5) * 0.35 + (grain - 0.5) * 0.4 + Math.sin(x * 0.7 + noise[i] * 6) * 0.05;
    const g = v * 255;
    return [g, g * 0.98, g * 0.92];
  });
}
