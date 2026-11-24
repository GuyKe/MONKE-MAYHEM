import * as THREE from 'three';
import { blob, box, cone, cyl, limb, lowBlob, mat, p3, part } from './figures';

/** Props for the game modes: animals, cars, ufos, guns, saws, kitchen stuff, a rocket. All in metres, facing -Z, standing on y = 0. */

const rgb = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b;
export const hsl = (h: number, s = 0.7, l = 0.5): number => new THREE.Color().setHSL(h, s, l).getHex();

/** A horse, stiff as a board (it has no animations, on purpose). */
export function horse(color = 0x8a5a34, mane = 0x2a1a10): THREE.Group {
  const g = new THREE.Group();
  part(g, blob, color, [0, 1.15, 0], [0.32, 0.36, 0.78]);
  part(g, blob, color, [0, 1.2, -0.45], [0.3, 0.38, 0.4]); // chest
  part(g, blob, color, [0, 1.17, 0.5], [0.3, 0.35, 0.36]); // rump
  for (const [x, z] of [[-0.2, -0.5], [0.2, -0.5], [-0.2, 0.55], [0.2, 0.55]]) {
    limb(g, p3(x, 1.0, z), p3(x, 0.1, z + (z > 0 ? 0.05 : 0)), 0.065, color);
    part(g, cyl, 0x1a1410, [x, 0.04, z + (z > 0 ? 0.05 : 0)], [0.07, 0.08, 0.07]);
  }
  limb(g, p3(0, 1.35, -0.7), p3(0, 1.95, -1.0), 0.14, color); // neck
  part(g, blob, color, [0, 2.0, -1.25], [0.11, 0.15, 0.3], [0.5, 0, 0]); // head
  part(g, blob, 0x2a2018, [0, 1.93, -1.5], [0.075, 0.09, 0.07]); // muzzle
  for (const sx of [-1, 1]) {
    part(g, cone, color, [sx * 0.07, 2.18, -1.08], [0.03, 0.12, 0.03]);
    part(g, lowBlob, 0x050505, [sx * 0.1, 2.04, -1.25], [0.02, 0.025, 0.02]);
  }
  for (let i = 0; i < 6; i++) part(g, box, mane, [0, 1.95 - i * 0.1, -1.0 + i * 0.05 + 0.02], [0.03, 0.13, 0.05], [0.3, 0, 0]);
  for (let i = 0; i < 4; i++) part(g, cone, mane, [0, 1.15 - i * 0.12, 0.88 + i * 0.03], [0.04, 0.3, 0.04], [0.15, 0, 0]);
  return g;
}

export function chicken(color = 0xf6f2e8): THREE.Group {
  const g = new THREE.Group();
  part(g, blob, color, [0, 0.36, 0], [0.17, 0.16, 0.22]);
  part(g, blob, color, [0, 0.58, -0.16], [0.075, 0.1, 0.075]);
  part(g, cone, 0xf0b020, [0, 0.58, -0.27], [0.03, 0.08, 0.03], [-Math.PI / 2, 0, 0]);
  part(g, blob, 0xc81818, [0, 0.69, -0.15], [0.02, 0.04, 0.05]);
  part(g, blob, 0xc81818, [0, 0.52, -0.23], [0.015, 0.035, 0.015]);
  for (const sx of [-1, 1]) {
    part(g, lowBlob, 0x050505, [sx * 0.05, 0.6, -0.2], [0.012, 0.014, 0.012]);
    part(g, blob, color, [sx * 0.17, 0.38, 0.02], [0.03, 0.1, 0.15], [0, 0, sx * -0.2]);
    limb(g, p3(sx * 0.06, 0.22, 0.02), p3(sx * 0.06, 0.02, 0), 0.012, 0xe0a020);
    part(g, box, 0xe0a020, [sx * 0.06, 0.012, -0.03], [0.05, 0.012, 0.09]);
  }
  for (let i = -1; i <= 1; i++) part(g, cone, color, [i * 0.04, 0.5, 0.25], [0.04, 0.2, 0.025], [-Math.PI / 2 - 0.5, 0, i * 0.3]);
  return g;
}

/** A car; `open` has no roof (so something can sit in it). */
export function car(color = 0xc03020, open = false): THREE.Group {
  const g = new THREE.Group();
  part(g, box, color, [0, 0.55, 0], [1.75, 0.5, 3.8]);
  part(g, box, color, [0, 0.95, 0.7], [1.7, 0.3, 1.5]);
  if (!open) {
    part(g, box, color, [0, 1.2, 0.35], [1.6, 0.5, 1.9]);
    part(g, box, 0x9ad0ea, [0, 1.22, 0.35], [1.62, 0.36, 1.7]);
  } else {
    part(g, box, 0x9ad0ea, [0, 1.15, -0.45], [1.6, 0.5, 0.06], [0.35, 0, 0]);
    part(g, box, 0x1e1e22, [0, 0.98, 0.1], [1.4, 0.06, 1.2]);
  }
  for (const [x, z] of [[-0.85, -1.2], [0.85, -1.2], [-0.85, 1.2], [0.85, 1.2]]) {
    part(g, cyl, 0x111111, [x, 0.34, z], [0.34, 0.26, 0.34], [0, 0, Math.PI / 2]);
    part(g, cyl, 0xcfcfd4, [x * 1.04, 0.34, z], [0.18, 0.28, 0.18], [0, 0, Math.PI / 2]);
  }
  for (const sx of [-1, 1]) {
    part(g, blob, 0xfff2b0, [sx * 0.6, 0.62, -1.92], [0.17, 0.12, 0.06], [0, 0, 0], 0xfff2b0);
    part(g, blob, 0xc01010, [sx * 0.6, 0.65, 1.92], [0.14, 0.09, 0.05], [0, 0, 0], 0x600000);
  }
  part(g, box, 0xcfcfd4, [0, 0.38, -1.95], [1.7, 0.1, 0.12]);
  return g;
}

export function ufo(): THREE.Group {
  const g = new THREE.Group();
  part(g, blob, 0xa8b0bc, [0, 0, 0], [2.3, 0.5, 2.3]);
  part(g, blob, 0x8a94a2, [0, -0.28, 0], [1.2, 0.3, 1.2]);
  part(g, blob, 0x9cf0c0, [0, 0.35, 0], [0.9, 0.62, 0.9]);
  part(g, blob, 0x62d890, [0, 0.36, 0], [0.5, 0.35, 0.5], [0, 0, 0], 0x30b060);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const c = hsl(i / 10, 1, 0.55);
    part(g, lowBlob, c, [Math.cos(a) * 2.05, -0.02, Math.sin(a) * 2.05], [0.14, 0.14, 0.14], [0, 0, 0], c);
  }
  part(g, blob, 0xfff0a0, [0, -0.45, 0], [0.4, 0.1, 0.4], [0, 0, 0], 0xffe060);
  return g;
}

/** A faint tractor beam under a ufo. */
export function beam(radius = 1.8, height = 8, color = 0xa8ffc8): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.3, radius, height, 16, 1, true).translate(0, -height / 2, 0),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
  );
  m.position.y = -0.45;
  return m;
}

let bucketTexture: THREE.CanvasTexture | null = null;
/** A red-and-white striped bucket of fried chicken. */
export function kfcBucket(): THREE.Group {
  if (!bucketTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const c = canvas.getContext('2d')!;
    for (let i = 0; i < 16; i++) {
      c.fillStyle = i % 2 ? '#f4f0e8' : '#d01c28';
      c.fillRect(i * 32, 0, 32, 256);
    }
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(256, 128, 88, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#d01c28';
    c.font = 'bold 84px Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('KFC', 256, 134);
    bucketTexture = new THREE.CanvasTexture(canvas);
    bucketTexture.colorSpace = THREE.SRGBColorSpace;
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.24, 0.5, 20, 1, true), new THREE.MeshLambertMaterial({ map: bucketTexture, side: THREE.DoubleSide }));
  body.position.y = 0.25;
  body.rotation.y = Math.PI;
  g.add(body);
  part(g, cyl, 0xd01c28, [0, 0.01, 0], [0.24, 0.02, 0.24]);
  part(g, cyl, 0xf4f0e8, [0, 0.51, 0], [0.36, 0.03, 0.36]);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const x = Math.cos(a) * 0.17;
    const z = Math.sin(a) * 0.17;
    part(g, blob, 0xb86a22, [x, 0.6, z], [0.1, 0.09, 0.1]);
    part(g, cyl, 0xf2ecd8, [x * 1.4, 0.7, z * 1.4], [0.018, 0.1, 0.018], [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]);
  }
  return g;
}

export function drumstick(): THREE.Group {
  const g = new THREE.Group();
  part(g, blob, 0xb86a22, [0, 0, -0.04], [0.06, 0.055, 0.09], [0.2, 0, 0]);
  part(g, cyl, 0xf2ecd8, [0, 0, 0.1], [0.012, 0.12, 0.012], [Math.PI / 2, 0, 0]);
  part(g, lowBlob, 0xf2ecd8, [0, 0, 0.17], [0.022, 0.022, 0.022]);
  return g;
}

/** A handgun with its muzzle at (0, 0.02, -0.3) in the group's space. Hold it by the grip, which is at the origin. */
export function gun(color = 0x2a2c32): THREE.Group {
  const g = new THREE.Group();
  part(g, box, color, [0, 0.03, -0.1], [0.05, 0.07, 0.24]);
  part(g, cyl, 0x14151a, [0, 0.035, -0.28], [0.014, 0.12, 0.014], [Math.PI / 2, 0, 0]);
  part(g, box, 0x3a2a1c, [0, -0.04, 0.0], [0.045, 0.12, 0.06], [0.25, 0, 0]);
  part(g, box, 0x14151a, [0, 0.075, -0.02], [0.012, 0.02, 0.02]);
  part(g, box, 0xc08020, [0, 0.0, -0.1], [0.052, 0.01, 0.1]);
  g.userData.muzzle = new THREE.Vector3(0, 0.035, -0.36);
  return g;
}

export interface Chainsaw {
  group: THREE.Group;
  /** The two ends of the blade, in the group's space. */
  base: THREE.Vector3;
  tip: THREE.Vector3;
  /** Run the chain (and shake). */
  update(dt: number, running: boolean): void;
  /** 0 to 1: how bloody it is. */
  blood: number;
}

/** A chainsaw to hold by the handle at the origin; the blade points along -Z. */
export function chainsaw(): Chainsaw {
  const group = new THREE.Group();
  part(group, box, 0xe07a14, [0, 0.0, -0.1], [0.1, 0.15, 0.26]);
  part(group, box, 0x2a2a2e, [0, 0.09, -0.08], [0.06, 0.04, 0.18]);
  part(group, box, 0x2a2a2e, [0, -0.1, 0.02], [0.05, 0.1, 0.05]); // the grip
  part(group, cyl, 0x111111, [0, 0.0, -0.24], [0.03, 0.04, 0.03], [0, 0, Math.PI / 2]);
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 256;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#3a3a3e';
  c.fillRect(0, 0, 32, 256);
  c.fillStyle = '#d8d8dc';
  for (let y = 0; y < 256; y += 16) c.fillRect(0, y, 32, 7);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1, 6);
  const bladeMat = new THREE.MeshLambertMaterial({ map: tex });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.1, 0.8), [bladeMat, bladeMat, new THREE.MeshLambertMaterial({ color: 0xaaaaae }), new THREE.MeshLambertMaterial({ color: 0xaaaaae }), bladeMat, bladeMat]);
  blade.position.set(0, 0, -0.62);
  group.add(blade);
  tex.center.set(0.5, 0.5);
  tex.rotation = Math.PI / 2;
  const bloodMat = new THREE.MeshBasicMaterial({ color: 0x8a0a0a, transparent: true, opacity: 0, depthWrite: false });
  const bloodMesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.104, 0.8), bloodMat);
  bloodMesh.position.copy(blade.position);
  group.add(bloodMesh);
  const saw: Chainsaw = {
    group,
    base: new THREE.Vector3(0, 0, -0.25),
    tip: new THREE.Vector3(0, 0, -1.02),
    blood: 0,
    update(dt, running) {
      if (running) tex.offset.x -= dt * 3.2;
      group.position.x = running ? (Math.random() - 0.5) * 0.004 : 0;
      group.position.y = running ? (Math.random() - 0.5) * 0.004 : 0;
      bloodMat.opacity = Math.min(0.75, saw.blood * 0.75);
    },
  };
  return saw;
}

/**
 * A robot-style vacuum cleaner: a body on wheels with a wide mouth in front (at -Z), a hose and a handle.
 * `mouth` is the middle of the opening.
 */
export function vacuum(color = 0xd23a2a): { group: THREE.Group; mouth: THREE.Vector3 } {
  const g = new THREE.Group();
  part(g, blob, color, [0, 0.42, 0.05], [0.55, 0.3, 0.7]);
  part(g, box, 0x2a2a30, [0, 0.3, 0.05], [1.02, 0.08, 1.2]);
  part(g, box, 0xefefea, [0, 0.62, 0.15], [0.5, 0.04, 0.4]);
  part(g, lowBlob, 0x30c0ff, [0, 0.66, -0.15], [0.07, 0.03, 0.07], [0, 0, 0], 0x1090d0);
  for (const sx of [-1, 1]) {
    part(g, cyl, 0x111111, [sx * 0.55, 0.2, 0.5], [0.2, 0.12, 0.2], [0, 0, Math.PI / 2]);
    part(g, cyl, 0x111111, [sx * 0.5, 0.12, -0.45], [0.12, 0.1, 0.12], [0, 0, Math.PI / 2]);
  }
  // The mouth: a wide dark slot on a flared nozzle.
  part(g, box, 0x2a2a30, [0, 0.14, -0.78], [1.1, 0.2, 0.5]);
  part(g, box, 0x050505, [0, 0.14, -1.04], [0.98, 0.14, 0.04]);
  part(g, box, 0x9a9aa2, [0, 0.07, -1.0], [1.14, 0.03, 0.06]);
  // Handle and hose.
  limb(g, p3(0, 0.55, 0.45), p3(0, 1.15, 0.7), 0.03, 0x2a2a30);
  part(g, box, 0x2a2a30, [0, 1.17, 0.7], [0.3, 0.05, 0.06]);
  const curve = new THREE.CatmullRomCurve3([p3(0.2, 0.55, -0.1), p3(0.55, 1.0, -0.3), p3(0.35, 0.8, -0.7), p3(0.1, 0.25, -0.85)]);
  const hose = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.045, 6), mat(0x4a4a52));
  g.add(hose);
  return { group: g, mouth: new THREE.Vector3(0, 0.14, -1.06) };
}

/** A pillar of yellow wallpaper. */
export function pillar(height = 6, width = 1.6): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#c9b64a';
  c.fillRect(0, 0, 128, 128);
  c.fillStyle = '#b6a238';
  for (let x = 0; x < 128; x += 32) c.fillRect(x, 0, 16, 128);
  c.fillStyle = 'rgba(80,60,10,0.25)';
  for (let i = 0; i < 60; i++) c.fillRect(Math.random() * 128, Math.random() * 128, 2, 6);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(2, height / 2.5);
  const m = new THREE.Mesh(new THREE.BoxGeometry(width, height, width), new THREE.MeshLambertMaterial({ map: tex }));
  m.position.y = height / 2;
  return m;
}

/** A screen showing something loud: bars, noise, text, a spinning shape. Call `tick(t)` now and then. */
export class Screen {
  readonly mesh: THREE.Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly tex: THREE.CanvasTexture;
  private last = -1;
  private readonly style: number;

  constructor(width: number, height: number, seed: number) {
    this.canvas.width = 128;
    this.canvas.height = 72;
    this.style = seed % 5;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const frame = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false, fog: false }));
    face.position.z = 0.03;
    const back = new THREE.Mesh(new THREE.BoxGeometry(width + 0.2, height + 0.2, 0.08), mat(0x141418));
    frame.add(back, face);
    this.mesh = face;
    this.mesh.userData.frame = frame;
    this.group = frame;
  }

  readonly group: THREE.Group;

  tick(t: number): void {
    if (t - this.last < 0.16) return;
    this.last = t;
    const c = this.canvas.getContext('2d')!;
    const w = 128;
    const h = 72;
    const words = ['WOW', 'HORSE', 'BUY NOW', '???', 'CHICKEN', 'HELP', 'YES', 'NO', 'MADNESS', 'AAAAA', 'SALE', 'KFC?'];
    switch (this.style) {
      case 0:
        for (let i = 0; i < 8; i++) {
          c.fillStyle = `#${hsl((t * 0.8 + i / 8) % 1, 1, 0.5).toString(16).padStart(6, '0')}`;
          c.fillRect((i * w) / 8, 0, w / 8 + 1, h);
        }
        break;
      case 1:
        for (let i = 0; i < 400; i++) {
          const v = Math.random() * 255;
          c.fillStyle = `rgb(${v},${v},${v})`;
          c.fillRect(Math.random() * w, Math.random() * h, 6, 4);
        }
        break;
      case 2:
        c.fillStyle = `hsl(${(t * 120) % 360},90%,45%)`;
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#fff';
        c.font = 'bold 34px system-ui';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(words[Math.floor(t * 2.5) % words.length], w / 2, h / 2);
        break;
      case 3:
        c.fillStyle = '#10101a';
        c.fillRect(0, 0, w, h);
        c.fillStyle = `hsl(${(t * 200) % 360},100%,60%)`;
        c.save();
        c.translate(w / 2, h / 2);
        c.rotate(t * 3);
        c.fillRect(-18, -18, 36, 36);
        c.restore();
        break;
      default:
        c.fillStyle = Math.floor(t * 4) % 2 ? '#fff' : '#d01c28';
        c.fillRect(0, 0, w, h);
        c.fillStyle = Math.floor(t * 4) % 2 ? '#d01c28' : '#fff';
        c.font = 'bold 28px system-ui';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('LOUD', w / 2, h / 2);
    }
    this.tex.needsUpdate = true;
  }
}

export function blender(): THREE.Group {
  const g = new THREE.Group();
  part(g, box, 0x2a2a2e, [0, 0.12, 0], [0.34, 0.24, 0.34]);
  part(g, lowBlob, 0xc8c8cc, [0.12, 0.18, -0.17], [0.025, 0.025, 0.025]);
  const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.13, 0.5, 14, 1, true), new THREE.MeshLambertMaterial({ color: 0xcfe8f4, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  jug.position.y = 0.5;
  g.add(jug);
  part(g, cyl, 0xe0e0e4, [0, 0.27, 0], [0.025, 0.04, 0.025]);
  for (let i = 0; i < 3; i++) part(g, box, 0xdedee2, [0, 0.3, 0], [0.18, 0.012, 0.03], [0, (i * Math.PI) / 3, 0]);
  part(g, cyl, 0x2a2a2e, [0, 0.77, 0], [0.21, 0.04, 0.21]);
  return g;
}

export function stove(): THREE.Group {
  const g = new THREE.Group();
  part(g, box, 0xdcdcd8, [0, 0.45, 0], [1.0, 0.9, 0.7]);
  part(g, box, 0x1a1a1e, [0, 0.92, 0], [1.0, 0.04, 0.7]);
  for (const [x, z] of [[-0.25, -0.15], [0.25, -0.15], [-0.25, 0.17], [0.25, 0.17]]) part(g, cyl, 0x3a3a40, [x, 0.95, z], [0.13, 0.025, 0.13]);
  for (let i = 0; i < 4; i++) part(g, cyl, 0x2a2a2e, [-0.33 + i * 0.22, 0.82, -0.36], [0.03, 0.04, 0.03], [Math.PI / 2, 0, 0]);
  part(g, box, 0x1a1a1e, [0, 0.4, -0.355], [0.8, 0.45, 0.02]);
  return g;
}

export function oven(): THREE.Group {
  const g = new THREE.Group();
  part(g, box, 0x4a4a52, [0, 0.9, 0], [1.1, 1.8, 0.9]);
  part(g, box, 0x1a1a1e, [0, 0.95, -0.46], [0.84, 0.8, 0.02]);
  part(g, box, 0xff7a20, [0, 0.95, -0.47], [0.72, 0.66, 0.02], [0, 0, 0], 0xff5a10);
  part(g, cyl, 0xcfcfd4, [0, 1.42, -0.5], [0.025, 0.8, 0.025], [0, 0, Math.PI / 2]);
  return g;
}

/** A rocket on its legs. `built` hides nothing; the mode swaps parts in. */
export function rocket(): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl, 0xf0f0f2, [0, 4.5, 0], [1.4, 9, 1.4]);
  part(g, cone, 0xd02a2a, [0, 10.2, 0], [1.4, 2.4, 1.4]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    part(g, box, 0xd02a2a, [Math.cos(a) * 1.5, 1.3, Math.sin(a) * 1.5], [0.2, 2.6, 1.3], [0, -a, 0]);
    limb(g, p3(Math.cos(a) * 1.4, 2.4, Math.sin(a) * 1.4), p3(Math.cos(a) * 2.8, 0, Math.sin(a) * 2.8), 0.12, 0x6a6a72);
  }
  part(g, cyl, 0x3a3a40, [0, 0.1, 0], [0.8, 0.5, 0.8]);
  for (let i = 0; i < 2; i++) part(g, blob, 0x6ad0ff, [0, 6.5 - i * 1.9, -1.35], [0.45, 0.45, 0.12], [0, 0, 0], 0x2090c0);
  part(g, box, 0x2a2a30, [0, 3.0, -1.4], [0.4, 0.4, 0.1]);
  return g;
}

/** A glowing planet Earth, for the sky. */
export function earth(radius: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#1f5fb8';
  c.fillRect(0, 0, 512, 256);
  c.fillStyle = '#3a9a48';
  for (let i = 0; i < 26; i++) {
    c.beginPath();
    c.ellipse(Math.random() * 512, 30 + Math.random() * 196, 14 + Math.random() * 46, 10 + Math.random() * 30, Math.random() * 3, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = 'rgba(255,255,255,0.65)';
  for (let i = 0; i < 40; i++) {
    c.beginPath();
    c.ellipse(Math.random() * 512, Math.random() * 256, 10 + Math.random() * 40, 3 + Math.random() * 6, Math.random() * 0.5, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = '#fff';
  c.fillRect(0, 0, 512, 14);
  c.fillRect(0, 242, 512, 14);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), new THREE.MeshBasicMaterial({ map: tex, fog: false, toneMapped: false }));
}

export { rgb };
