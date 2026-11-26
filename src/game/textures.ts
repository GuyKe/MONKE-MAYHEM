import * as THREE from 'three';

/** Procedural surfaces: brushed metal wall panels, sterile floor tiles, grated catwalk, stained concrete. One texture tile covers about 2 m. */
export type SurfaceKind = 'wall' | 'floor' | 'grate' | 'concrete' | 'hazard' | 'ceiling' | 'door';

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
      // Brushed grey-blue metal panels 1 m square with seams and rivets.
      const g = c.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, '#6c7480');
      g.addColorStop(1, '#5a626d');
      c.fillStyle = g;
      c.fillRect(0, 0, S, S);
      for (let i = 0; i < 900; i++) {
        c.fillStyle = `rgba(${200 + Math.random() * 55},${210 + Math.random() * 45},${220 + Math.random() * 35},0.05)`;
        c.fillRect(Math.random() * S, Math.random() * S, 40 + Math.random() * 120, 1);
      }
      for (const o of [0, S / 2]) {
        for (const p of [o, o + 0]) {
          void p;
        }
      }
      c.strokeStyle = '#2a2f36';
      c.lineWidth = 5;
      c.strokeRect(0, 0, S / 2, S / 2);
      c.strokeRect(S / 2, 0, S / 2, S / 2);
      c.strokeRect(0, S / 2, S / 2, S / 2);
      c.strokeRect(S / 2, S / 2, S / 2, S / 2);
      b.strokeStyle = '#303030';
      b.lineWidth = 8;
      b.strokeRect(0, 0, S / 2, S / 2);
      b.strokeRect(S / 2, 0, S / 2, S / 2);
      b.strokeRect(0, S / 2, S / 2, S / 2);
      b.strokeRect(S / 2, S / 2, S / 2, S / 2);
      for (const px of [0, S / 2]) {
        for (const py of [0, S / 2]) {
          for (const [dx, dy] of [[16, 16], [S / 2 - 16, 16], [16, S / 2 - 16], [S / 2 - 16, S / 2 - 16]]) {
            c.fillStyle = '#9aa2ad';
            c.beginPath();
            c.arc(px + dx, py + dy, 5, 0, Math.PI * 2);
            c.fill();
            b.fillStyle = '#d0d0d0';
            b.beginPath();
            b.arc(px + dx, py + dy, 6, 0, Math.PI * 2);
            b.fill();
          }
        }
      }
      // Scuffs and a streak of grime.
      noise(c, S, 500, 0.12);
      for (let i = 0; i < 4; i++) {
        const x = Math.random() * S;
        const gr = c.createLinearGradient(x, 0, x + 6, S);
        gr.addColorStop(0, 'rgba(20,24,20,0.0)');
        gr.addColorStop(0.5, 'rgba(20,24,20,0.2)');
        gr.addColorStop(1, 'rgba(20,24,20,0.0)');
        c.fillStyle = gr;
        c.fillRect(x, 0, 6 + Math.random() * 10, S);
      }
      r.fillStyle = '#707070';
      r.fillRect(0, 0, S, S);
      break;
    }
    case 'floor': {
      // Sterile off-white tiles, 0.5 m, with dark grout and a few stains.
      c.fillStyle = '#c4c8c8';
      c.fillRect(0, 0, S, S);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const v = 190 + Math.floor(Math.random() * 20);
          c.fillStyle = `rgb(${v},${v + 3},${v + 3})`;
          c.fillRect(x * 128 + 3, y * 128 + 3, 122, 122);
        }
      }
      c.strokeStyle = '#6a6e70';
      c.lineWidth = 6;
      for (let i = 0; i <= 4; i++) {
        c.beginPath();
        c.moveTo(i * 128, 0);
        c.lineTo(i * 128, S);
        c.moveTo(0, i * 128);
        c.lineTo(S, i * 128);
        c.stroke();
      }
      noise(c, S, 700, 0.1);
      for (let i = 0; i < 6; i++) {
        const gr = c.createRadialGradient(Math.random() * S, Math.random() * S, 2, Math.random() * S, Math.random() * S, 50);
        gr.addColorStop(0, 'rgba(80,74,60,0.18)');
        gr.addColorStop(1, 'rgba(80,74,60,0)');
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
      r.fillStyle = '#505050';
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
      c.fillStyle = '#7c7f7c';
      c.fillRect(0, 0, S, S);
      noise(c, S, 3500, 0.18);
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
      c.fillStyle = '#2a2d32';
      c.fillRect(0, 0, S, S);
      c.strokeStyle = '#14161a';
      c.lineWidth = 8;
      c.strokeRect(0, 0, S, S);
      c.strokeRect(0, 0, S / 2, S);
      noise(c, S, 600, 0.12);
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
  m = new THREE.MeshLambertMaterial({ map: rep(maps.color), bumpMap: bumpy ? rep(maps.bump) : null, bumpScale: 2.5, color: tint });
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
