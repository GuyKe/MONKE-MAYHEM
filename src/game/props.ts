import * as THREE from 'three';
import { box, cyl, mat, part, rnd, sphere, v3 } from './shapes';
import { surface } from './textures';

/** Things that make the places look used: a forklift, shelves of crates, pallets, pipes, lockers, a picnic table... */

export function forklift(): THREE.Group {
  const g = new THREE.Group();
  const yellow = 0xe0b020;
  part(g, box, yellow, [0, 0.55, 0.3], [1.0, 0.7, 1.7]);
  part(g, box, 0x2a2c30, [0, 0.3, 0.3], [1.02, 0.25, 1.4]);
  part(g, box, yellow, [0, 0.95, 0.9], [0.9, 0.5, 0.7]); // the engine cover
  part(g, box, 0x1a1c20, [0, 1.0, 0.1], [0.6, 0.12, 0.6]); // the seat
  part(g, box, 0x1a1c20, [0, 1.25, 0.4], [0.6, 0.5, 0.08]);
  for (const sx of [-1, 1]) {
    part(g, cyl, 0x2a2c30, [sx * 0.55, 1.55, -0.3], [0.03, 1.2, 0.03]);
    part(g, cyl, 0x2a2c30, [sx * 0.55, 1.55, 0.8], [0.03, 1.2, 0.03]);
    part(g, cyl, 0x15161a, [sx * 0.52, 0.28, -0.3], [0.28, 0.2, 0.28], [0, 0, Math.PI / 2]);
    part(g, cyl, 0x15161a, [sx * 0.52, 0.25, 1.0], [0.25, 0.18, 0.25], [0, 0, Math.PI / 2]);
  }
  for (let i = 0; i < 7; i++) part(g, box, 0x2a2c30, [-0.55 + i * 0.18, 2.2, 0.25], [0.04, 0.04, 1.2]);
  // The mast and forks at the front.
  for (const sx of [-1, 1]) part(g, box, 0x3a3c40, [sx * 0.32, 1.1, -0.65], [0.07, 2.1, 0.08]);
  part(g, box, 0x3a3c40, [0, 0.5, -0.7], [0.8, 0.12, 0.06]);
  for (const sx of [-1, 1]) part(g, box, 0x4a4c50, [sx * 0.3, 0.1, -1.35], [0.1, 0.05, 1.3]);
  return g;
}

export function shelves(w = 2.4, h = 2.6, d = 0.8, levels = 3, crates = true): THREE.Group {
  const g = new THREE.Group();
  const metal = 0x4a5058;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, box, metal, [sx * w / 2, h / 2, sz * d / 2], [0.07, h, 0.07]);
  for (let i = 0; i <= levels; i++) part(g, box, 0x5a626a, [0, 0.15 + (i * (h - 0.3)) / levels, 0], [w, 0.06, d]);
  if (crates) {
    for (let l = 0; l < levels; l++) {
      const y = 0.18 + (l * (h - 0.3)) / levels;
      let x = -w / 2 + 0.3;
      while (x < w / 2 - 0.3) {
        const cw = rnd(0.4, 0.8);
        const ch = rnd(0.35, (h - 0.3) / levels - 0.12);
        part(g, box, [0x9a7a48, 0x8a6a3a, 0xb09060, 0x6a5a40][Math.floor(Math.random() * 4)], [x + cw / 2, y + ch / 2 + 0.03, rnd(-0.08, 0.08)], [cw, ch, d * 0.8]);
        x += cw + 0.1;
      }
    }
  }
  return g;
}

export function pallet(stack = 1): THREE.Group {
  const g = new THREE.Group();
  part(g, box, 0x9a7a4a, [0, 0.07, 0], [1.2, 0.05, 1.0]);
  for (const x of [-0.5, 0, 0.5]) part(g, box, 0x8a6a3a, [x, 0.03, 0], [0.12, 0.06, 1.0]);
  for (let i = 0; i < stack; i++) part(g, box, [0x9a7a48, 0x8a6a3a, 0xb09060][i % 3], [0, 0.4 + i * 0.6, 0], [1.1, 0.55, 0.9]);
  return g;
}

export function barrel(color: number): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl, color, [0, 0.45, 0], [0.3, 0.9, 0.3]);
  for (const y of [0.2, 0.7]) part(g, cyl, 0x2a2a2a, [0, y, 0], [0.31, 0.03, 0.31]);
  return g;
}

/** A run of pipe with brackets, from `a` to `b`. */
export function pipe(a: THREE.Vector3, b: THREE.Vector3, radius: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const len = a.distanceTo(b);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 12), mat(color));
  body.position.copy(a).add(b).multiplyScalar(0.5);
  body.quaternion.setFromUnitVectors(v3(0, 1, 0), b.clone().sub(a).normalize());
  g.add(body);
  const n = Math.max(2, Math.floor(len / 1.8));
  for (let i = 0; i <= n; i++) {
    const p = a.clone().lerp(b, i / n);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.12, radius * 1.12, 0.06, 12), mat(0x2a2a2e));
    ring.position.copy(p);
    ring.quaternion.copy(body.quaternion);
    g.add(ring);
  }
  // The open end, dark inside.
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.1, radius * 1.1, 0.08, 12), mat(0x1a1612));
  cap.position.copy(b);
  cap.quaternion.copy(body.quaternion);
  g.add(cap);
  return g;
}

export function lockerBank(n = 4, color = 0x2a4a9a): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    part(g, box, color, [i * 0.62, 1.0, 0], [0.6, 2.0, 0.5]);
    part(g, box, 0x1a2a5a, [i * 0.62, 1.7, -0.255], [0.4, 0.14, 0.01]);
    for (let k = 0; k < 4; k++) part(g, box, 0x14161a, [i * 0.62, 1.62 + k * 0.03, -0.26], [0.34, 0.01, 0.005]);
    part(g, box, 0xc0c0c0, [i * 0.62 + 0.2, 1.0, -0.265], [0.03, 0.12, 0.02]);
  }
  part(g, box, 0x14161a, [(n - 1) * 0.31, 0.04, 0], [n * 0.62, 0.08, 0.5]);
  return g;
}

export function picnicTable(color = 0x2a4a9a): THREE.Group {
  const g = new THREE.Group();
  part(g, box, color, [0, 0.76, 0], [1.9, 0.06, 0.8]);
  for (const sz of [-1, 1]) {
    part(g, box, color, [0, 0.45, sz * 0.7], [1.9, 0.06, 0.28]);
    for (const sx of [-1, 1]) part(g, box, 0x14161a, [sx * 0.7, 0.4, sz * 0.38], [0.06, 0.8, 0.06], [sz * 0.5, 0, 0]);
  }
  return g;
}

/** A big green bin with a hazard stripe, like the one in the lobby photo. */
export function dumpster(): THREE.Group {
  const g = new THREE.Group();
  part(g, box, 0x2a5a30, [0, 0.8, 0], [1.9, 1.5, 1.0]);
  part(g, box, 0x224a28, [0, 1.58, 0.02], [2.0, 0.1, 1.1]);
  part(g, box, 0xe0b020, [0, 0.45, -0.51], [1.9, 0.18, 0.02]);
  part(g, box, 0x1a1a1a, [0, 0.45, -0.52], [0.3, 0.18, 0.005]);
  for (const sx of [-1, 1]) {
    part(g, cyl, 0x15161a, [sx * 0.8, 0.12, 0.3], [0.12, 0.08, 0.12], [0, 0, Math.PI / 2]);
    part(g, cyl, 0x15161a, [sx * 0.8, 0.12, -0.3], [0.12, 0.08, 0.12], [0, 0, Math.PI / 2]);
  }
  part(g, box, 0xffb040, [-0.5, 1.2, -0.51], [0.2, 0.12, 0.01], [0, 0, 0], 0xff8010);
  return g;
}

export function plant(): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl, 0x40464e, [0, 0.25, 0], [0.26, 0.5, 0.26]);
  part(g, cyl, 0x2a2018, [0, 0.52, 0], [0.24, 0.04, 0.24]);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    part(g, sphere, [0x3a8a3a, 0x4aa048, 0x2e7a34][i % 3], [Math.cos(a) * 0.12, 0.85 + (i % 3) * 0.1, Math.sin(a) * 0.12], [0.1, 0.32, 0.05], [0.4 * Math.cos(a), a, 0.4 * Math.sin(a)]);
  }
  return g;
}

/** A square ceiling light in a black frame (hung just under the ceiling). The inner panel is returned to flicker. */
export function panelLight(size = 0.9): { group: THREE.Group; panel: THREE.Mesh } {
  const g = new THREE.Group();
  part(g, box, 0x101214, [0, 0, 0], [size + 0.1, 0.07, size + 0.1]);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(size, 0.02, size), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
  panel.position.y = -0.035;
  g.add(panel);
  return { group: g, panel };
}

/** A rolling shutter door (dark corrugated metal with a hazard edge). */
export function shutter(w = 3.4, h = 3.2): THREE.Group {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#2a2a2c';
  x.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 256; y += 16) {
    x.fillStyle = '#3a3a3e';
    x.fillRect(0, y, 128, 8);
    x.fillStyle = 'rgba(120,60,30,0.25)';
    for (let i = 0; i < 6; i++) x.fillRect(Math.random() * 128, y, 10 + Math.random() * 20, 6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, h / 1.2);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex }));
  m.position.y = h / 2;
  g.add(m);
  part(g, box, 0x14161a, [0, h + 0.12, 0.04], [w + 0.5, 0.3, 0.2]);
  for (const sx of [-1, 1]) part(g, box, 0xe0b020, [sx * (w / 2 + 0.12), h / 2, 0.02], [0.1, h, 0.1]);
  part(g, box, 0xe0b020, [0, 0.04, 0.03], [w, 0.08, 0.06]);
  return g;
}

/** A frame of yellow-and-black stripes round a doorway (facing +Z). */
export function hazardFrame(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const stripe = surface('hazard', 1, 1);
  const bar = (bw: number, bh: number, x: number, y: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.1), stripe);
    m.position.set(x, y, 0);
    g.add(m);
  };
  bar(w + 0.3, 0.2, 0, h + 0.1);
  bar(0.15, h, -w / 2 - 0.075, h / 2);
  bar(0.15, h, w / 2 + 0.075, h / 2);
  return g;
}
