import * as THREE from 'three';

/** Procedural surfaces: brushed metal wall panels, sterile floor tiles, grated catwalk, stained concrete. One texture tile covers about 2 m. */
export type SurfaceKind = 'wall' | 'floor' | 'grate' | 'concrete' | 'hazard' | 'ceiling' | 'door' | 'wallpaper' | 'carpet' | 'tile';

interface Maps {
  color: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  rough: THREE.CanvasTexture;
}

const base = new Map<SurfaceKind, Maps>();
const materials = new Map<string, THREE.MeshLambertMaterial>();

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 2;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noise(c: CanvasRenderingContext2D, size: number, count: number, alpha: number, dark = true): void {
  for (let i = 0; i < count; i++) {
    const v = dark ? Math.floor(Math.random() * 60) : 180 + Math.floor(Math.random() * 70);
    c.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    c.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
}

function build(kind: SurfaceKind): Maps {
  const S = 512;
  const [cc, c] = canvas(S);
  const [bc, b] = canvas(S);
  const [rc, r] = canvas(S);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, S, S);
  r.fillStyle = '#909090';
  r.fillRect(0, 0, S, S);
  switch (kind) {
    case 'wall': {
      // Pale, mottled poured concrete with pits, stains and shuttering seams, like an old service corridor.
      c.fillStyle = '#d9d7d0';
      c.fillRect(0, 0, S, S);
      for (let i = 0; i < 70; i++) {
        const x = Math.random() * S;
        const y = Math.random() * S;
        const r = 20 + Math.random() * 90;
        const g = c.createRadialGradient(x, y, 2, x, y, r);
        const dark = Math.random() < 0.6;
        g.addColorStop(0, dark ? 'rgba(90,88,80,0.06)' : 'rgba(255,255,250,0.1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(x - r, y - r, r * 2, r * 2);
      }
      for (let i = 0; i < 160; i++) {
        const x = Math.random() * S;
        const y = Math.random() * S;
        const r = 1 + Math.random() * 3;
        c.fillStyle = 'rgba(70,68,62,0.55)';
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.beginPath();
        c.arc(x - 1, y - 1, r * 0.6, 0, Math.PI * 2);
        c.fill();
        b.fillStyle = '#303030';
        b.beginPath();
        b.arc(x, y, r, 0, Math.PI * 2);
        b.fill();
      }
      for (let i = 0; i < 5; i++) {
        const x = Math.random() * S;
        const gr = c.createLinearGradient(x, 0, x + 8, S);
        gr.addColorStop(0, 'rgba(110,96,70,0)');
        gr.addColorStop(0.5, 'rgba(110,96,70,0.14)');
        gr.addColorStop(1, 'rgba(110,96,70,0)');
        c.fillStyle = gr;
        c.fillRect(x, 0, 10 + Math.random() * 14, S);
      }
      c.strokeStyle = 'rgba(80,78,72,0.28)';
      c.lineWidth = 3;
      c.strokeRect(0, 0, S, S);
      b.strokeStyle = '#505050';
      b.lineWidth = 4;
      b.strokeRect(0, 0, S, S);
      r.fillStyle = '#c0c0c0';
      r.fillRect(0, 0, S, S);
      break;
    }
    case 'floor': {
      // Grey-blue industrial tiles, half a metre, speckled, with dark grout.
      c.fillStyle = '#a6abb2';
      c.fillRect(0, 0, S, S);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const v = 158 + Math.floor(Math.random() * 20);
          c.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
          c.fillRect(x * 128 + 3, y * 128 + 3, 122, 122);
        }
      }
      c.strokeStyle = '#4a4e54';
      c.lineWidth = 6;
      for (let i = 0; i <= 4; i++) {
        c.beginPath();
        c.moveTo(i * 128, 0);
        c.lineTo(i * 128, S);
        c.moveTo(0, i * 128);
        c.lineTo(S, i * 128);
        c.stroke();
      }
      for (let i = 0; i < 1200; i++) {
        c.fillStyle = Math.random() < 0.5 ? 'rgba(40,44,50,0.25)' : 'rgba(220,226,232,0.22)';
        c.fillRect(Math.random() * S, Math.random() * S, 2, 2);
      }
      for (let i = 0; i < 5; i++) {
        const gr = c.createRadialGradient(Math.random() * S, Math.random() * S, 2, Math.random() * S, Math.random() * S, 60);
        gr.addColorStop(0, 'rgba(60,56,48,0.16)');
        gr.addColorStop(1, 'rgba(60,56,48,0)');
        c.fillStyle = gr;
        c.fillRect(0, 0, S, S);
      }
      b.strokeStyle = '#303030';
      b.lineWidth = 8;
      for (let i = 0; i <= 4; i++) {
        b.beginPath();
        b.moveTo(i * 128, 0);
        b.lineTo(i * 128, S);
        b.moveTo(0, i * 128);
        b.lineTo(S, i * 128);
        b.stroke();
      }
      r.fillStyle = '#707070';
      r.fillRect(0, 0, S, S);
      break;
    }
    case 'grate': {
      c.fillStyle = '#16181b';
      c.fillRect(0, 0, S, S);
      b.fillStyle = '#101010';
      b.fillRect(0, 0, S, S);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          c.fillStyle = '#3a3f46';
          c.fillRect(x * 32 + 2, y * 32 + 2, 28, 28);
          c.fillStyle = '#0a0b0d';
          c.fillRect(x * 32 + 8, y * 32 + 8, 16, 16);
          b.fillStyle = '#d8d8d8';
          b.fillRect(x * 32 + 2, y * 32 + 2, 28, 28);
          b.fillStyle = '#000';
          b.fillRect(x * 32 + 8, y * 32 + 8, 16, 16);
        }
      }
      noise(c, S, 400, 0.15);
      r.fillStyle = '#606060';
      r.fillRect(0, 0, S, S);
      break;
    }
    case 'concrete': {
      c.fillStyle = '#a4a6a2';
      c.fillRect(0, 0, S, S);
      noise(c, S, 3000, 0.14);
      noise(c, S, 1500, 0.1, false);
      // Cracks and oil.
      for (let i = 0; i < 6; i++) {
        c.strokeStyle = 'rgba(20,20,20,0.6)';
        c.lineWidth = 1.5;
        c.beginPath();
        let x = Math.random() * S;
        let y = Math.random() * S;
        c.moveTo(x, y);
        for (let k = 0; k < 14; k++) {
          x += (Math.random() - 0.5) * 50;
          y += (Math.random() - 0.3) * 40;
          c.lineTo(x, y);
        }
        c.stroke();
        b.strokeStyle = '#202020';
        b.lineWidth = 3;
        b.beginPath();
        b.moveTo(x, y);
        b.lineTo(x + 10, y + 30);
        b.stroke();
      }
      for (let i = 0; i < 4; i++) {
        const gr = c.createRadialGradient(Math.random() * S, Math.random() * S, 3, Math.random() * S, Math.random() * S, 70);
        gr.addColorStop(0, 'rgba(10,8,6,0.5)');
        gr.addColorStop(1, 'rgba(10,8,6,0)');
        c.fillStyle = gr;
        c.fillRect(0, 0, S, S);
      }
      // A painted seam.
      c.fillStyle = 'rgba(210,180,40,0.55)';
      c.fillRect(0, S - 14, S, 6);
      r.fillStyle = '#b0b0b0';
      r.fillRect(0, 0, S, S);
      break;
    }
    case 'hazard': {
      c.fillStyle = '#e8b818';
      c.fillRect(0, 0, S, S);
      c.fillStyle = '#16161a';
      for (let i = -S; i < S * 2; i += 128) {
        c.beginPath();
        c.moveTo(i, 0);
        c.lineTo(i + 64, 0);
        c.lineTo(i + 64 - S, S);
        c.lineTo(i - S, S);
        c.fill();
      }
      noise(c, S, 800, 0.2);
      r.fillStyle = '#808080';
      r.fillRect(0, 0, S, S);
      break;
    }
    case 'ceiling': {
      c.fillStyle = '#d2d0ca';
      c.fillRect(0, 0, S, S);
      for (let i = 0; i < 50; i++) {
        const x = Math.random() * S;
        const y = Math.random() * S;
        const g = c.createRadialGradient(x, y, 2, x, y, 80);
        g.addColorStop(0, 'rgba(100,96,88,0.1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(x - 80, y - 80, 160, 160);
      }
      c.strokeStyle = 'rgba(90,88,82,0.35)';
      c.lineWidth = 5;
      c.strokeRect(0, 0, S, S);
      noise(c, S, 500, 0.1);
      break;
    }
    case 'wallpaper': {
      // The Backrooms' mono-yellow wallpaper: faint vertical stripes and a tiny repeating motif, water-stained and worn.
      c.fillStyle = '#cdbb52';
      c.fillRect(0, 0, S, S);
      for (let x = 0; x < S; x += 32) {
        c.fillStyle = 'rgba(150,130,30,0.16)';
        c.fillRect(x, 0, 14, S);
      }
      c.fillStyle = 'rgba(140,120,30,0.18)';
      for (let y = 8; y < S; y += 32) for (let x = 7; x < S; x += 32) {
        c.beginPath();
        c.moveTo(x, y - 5);
        c.lineTo(x + 4, y);
        c.lineTo(x, y + 5);
        c.lineTo(x - 4, y);
        c.fill();
      }
      // Water damage: brown tide-marks creeping down from the top and up from the bottom.
      for (let i = 0; i < 9; i++) {
        const x = Math.random() * S;
        const down = Math.random() < 0.6;
        const g = c.createLinearGradient(x, down ? 0 : S, x, down ? 160 + Math.random() * 240 : S - 120);
        g.addColorStop(0, 'rgba(110,80,30,0.34)');
        g.addColorStop(1, 'rgba(110,80,30,0)');
        c.fillStyle = g;
        c.fillRect(x - 20 - Math.random() * 40, down ? 0 : S - 260, 60 + Math.random() * 90, 260);
      }
      for (let i = 0; i < 6; i++) {
        const x = Math.random() * S;
        const y = Math.random() * S;
        const g = c.createRadialGradient(x, y, 3, x, y, 40 + Math.random() * 50);
        g.addColorStop(0, 'rgba(100,70,25,0.22)');
        g.addColorStop(1, 'rgba(100,70,25,0)');
        c.fillStyle = g;
        c.fillRect(x - 100, y - 100, 200, 200);
      }
      // A small peeling corner: pale curl with a dark gap behind it.
      {
        const x = 0;
        const y = 40 + Math.random() * 120;
        c.fillStyle = 'rgba(70,56,20,0.5)';
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + 34, y);
        c.lineTo(x, y + 44);
        c.fill();
        c.fillStyle = 'rgba(232,220,150,0.7)';
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + 22, y + 5);
        c.lineTo(x + 5, y + 28);
        c.fill();
      }
      noise(c, S, 500, 0.06);
      break;
    }
    case 'carpet': {
      // Damp, tired beige commercial carpet: short fibres, darker wet patches, old stains.
      c.fillStyle = '#b3a276';
      c.fillRect(0, 0, S, S);
      for (let i = 0; i < 9000; i++) {
        const v = 150 + Math.floor(Math.random() * 50);
        c.fillStyle = `rgba(${v},${v - 14},${v - 52},0.5)`;
        c.fillRect(Math.random() * S, Math.random() * S, 2, 3);
      }
      for (let i = 0; i < 2500; i++) {
        c.fillStyle = 'rgba(70,56,32,0.22)';
        c.fillRect(Math.random() * S, Math.random() * S, 2, 2);
      }
      for (let i = 0; i < 8; i++) {
        const x = Math.random() * S;
        const y = Math.random() * S;
        const r = 40 + Math.random() * 90;
        const g = c.createRadialGradient(x, y, 4, x, y, r);
        g.addColorStop(0, 'rgba(70,52,30,0.38)');
        g.addColorStop(1, 'rgba(70,52,30,0)');
        c.fillStyle = g;
        c.fillRect(x - r, y - r, r * 2, r * 2);
      }
      r.fillStyle = '#d0d0d0';
      r.fillRect(0, 0, S, S);
      break;
    }
    case 'tile': {
      // Acoustic drop-ceiling tiles in a metal grid: 0.6 m squares, perforated, stained.
      c.fillStyle = '#d6d0b4';
      c.fillRect(0, 0, S, S);
      for (let i = 0; i < 1800; i++) {
        c.fillStyle = 'rgba(90,84,60,0.35)';
        c.fillRect(Math.random() * S, Math.random() * S, 2, 2);
      }
      for (let i = 0; i < 6; i++) {
        const x = Math.random() * S;
        const y = Math.random() * S;
        const g = c.createRadialGradient(x, y, 3, x, y, 60);
        g.addColorStop(0, 'rgba(120,86,40,0.4)');
        g.addColorStop(1, 'rgba(120,86,40,0)');
        c.fillStyle = g;
        c.fillRect(x - 60, y - 60, 120, 120);
      }
      c.strokeStyle = '#8a8a82';
      c.lineWidth = 8;
      for (let i = 0; i <= 3; i++) {
        c.beginPath();
        c.moveTo(i * 128, 0);
        c.lineTo(i * 128, S);
        c.moveTo(0, i * 128);
        c.lineTo(S, i * 128);
        c.stroke();
      }
      break;
    }
    case 'door': {
      c.fillStyle = '#4a4e56';
      c.fillRect(0, 0, S, S);
      for (let i = 0; i < 6; i++) {
        c.fillStyle = i % 2 ? '#3a3e46' : '#555a64';
        c.fillRect(0, i * 85, S, 80);
      }
      noise(c, S, 800, 0.2);
      b.fillStyle = '#707070';
      b.fillRect(0, 0, S, S);
      for (let i = 0; i < 6; i++) {
        b.fillStyle = '#b0b0b0';
        b.fillRect(0, i * 85, S, 6);
      }
      break;
    }
  }
  return { color: tex(cc, true), bump: tex(bc, false), rough: tex(rc, false) };
}

/** A material of `kind` for a surface about w × h metres (the texture repeats every 2 m). */
export function surface(kind: SurfaceKind, w = 2, h = 2, tint = 0xffffff): THREE.MeshLambertMaterial {
  const key = `${kind}|${Math.round(w * 2)}|${Math.round(h * 2)}|${tint}`;
  let m = materials.get(key);
  if (m) return m;
  let maps = base.get(kind);
  if (!maps) {
    maps = build(kind);
    base.set(kind, maps);
  }
  const rep = (t: THREE.CanvasTexture): THREE.CanvasTexture => {
    const c = t.clone();
    c.needsUpdate = true;
    c.repeat.set(Math.max(0.25, w / 2), Math.max(0.25, h / 2));
    return c;
  };
  // Only walls and doors get a bump map (it costs); the rest are flat.
  const bumpy = kind === 'wall' || kind === 'door';
  m = new THREE.MeshLambertMaterial({ map: rep(maps.color), bumpMap: bumpy ? rep(maps.bump) : null, bumpScale: 1.0, color: tint });
  materials.set(key, m);
  return m;
}

const slabMaterials = new Map<SurfaceKind, THREE.MeshLambertMaterial>();

/** One material per kind of surface for boxes: the tint lives in the vertex colours, so differently tinted boxes can still share (and batch). */
function slabMaterial(kind: SurfaceKind): THREE.MeshLambertMaterial {
  let m = slabMaterials.get(kind);
  if (!m) {
    m = surface(kind, 2, 2).clone();
    m.vertexColors = true;
    m.color.setHex(0xffffff);
    slabMaterials.set(kind, m);
  }
  return m;
}

/** A box with one material: each face's texture coordinates are scaled to its size, so the surface looks the same size everywhere (and boxes can be batched). */
export function slab(kind: SurfaceKind, w: number, h: number, d: number, tint = 0xffffff): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const dims: Array<[number, number]> = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / 2, (uv.getY(i) * dims[f][1]) / 2);
    }
  }
  const c = new THREE.Color(tint);
  const colors = new Float32Array(uv.count * 3);
  for (let i = 0; i < uv.count; i++) colors.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, slabMaterial(kind));
}
