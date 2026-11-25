import * as THREE from 'three';
import { accessoryTier, Progress, rankFor } from '../progress';
import type { Runtime } from './runtime';

const gold = new THREE.MeshStandardMaterial({ color: 0xffc830, metalness: 0.9, roughness: 0.25, emissive: 0x6a4a00 });
const glow = (color: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color, fog: false });

/** A little banner that floats in front of your eyes for a moment ("+10 XP", "LEVEL UP!"). */
export class Toast {
  private readonly canvas = document.createElement('canvas');
  private readonly tex: THREE.CanvasTexture;
  private readonly mesh: THREE.Mesh;
  private time = 0;
  private lines: Array<{ text: string; color: string; time: number }> = [];

  constructor(camera: THREE.Camera) {
    this.canvas.width = 512;
    this.canvas.height = 160;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.125), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    this.mesh.position.set(0, 0.2, -0.75);
    this.mesh.renderOrder = 998;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    camera.add(this.mesh);
  }

  show(text: string, color = '#ffffff', seconds = 2.4): void {
    this.lines.push({ text, color, time: seconds });
    if (this.lines.length > 3) this.lines.shift();
    this.draw();
  }

  update(dt: number): void {
    if (!this.lines.length) return;
    this.time += dt;
    for (const l of this.lines) l.time -= dt;
    const before = this.lines.length;
    this.lines = this.lines.filter((l) => l.time > 0);
    this.mesh.visible = this.lines.length > 0;
    if (this.lines.length !== before) this.draw();
  }

  private draw(): void {
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, 512, 160);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = 8;
    c.strokeStyle = 'rgba(0,0,0,0.7)';
    this.lines.forEach((l, i) => {
      c.font = `bold ${i === this.lines.length - 1 ? 52 : 38}px system-ui, sans-serif`;
      c.fillStyle = l.color;
      const y = 140 - (this.lines.length - i) * 48;
      c.strokeText(l.text, 256, y);
      c.fillText(l.text, 256, y);
    });
    this.tex.needsUpdate = true;
    this.mesh.visible = this.lines.length > 0;
  }
}

/** A crown with points and jewels, sitting at the origin of a head. */
export function crown(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.05, 12, 1, true), gold);
  band.material = gold.clone();
  (band.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  g.add(band);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.07, 5), gold);
    spike.position.set(Math.cos(a) * 0.105, 0.055, Math.sin(a) * 0.105);
    g.add(spike);
    const jewel = new THREE.Mesh(new THREE.IcosahedronGeometry(0.012, 0), glow([0xff3050, 0x30a0ff, 0x40ff80][i % 3]));
    jewel.position.set(Math.cos(a) * 0.112, 0.0, Math.sin(a) * 0.112);
    g.add(jewel);
  }
  g.scale.setScalar(scale);
  return g;
}

export function halo(scale = 1): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.012, 8, 28), glow(0xfff0a0));
  m.rotation.x = Math.PI / 2;
  m.scale.setScalar(scale);
  return m;
}

export function horns(scale = 1): THREE.Group {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22, 8), new THREE.MeshStandardMaterial({ color: 0x20141a, emissive: 0xff1040, emissiveIntensity: 0.6, roughness: 0.4 }));
    h.position.set(sx * 0.1, 0.1, 0);
    h.rotation.z = -sx * 0.5;
    g.add(h);
  }
  g.scale.setScalar(scale);
  return g;
}

export function wings(scale = 1): THREE.Group {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    const wing = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const feather = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5 - i * 0.04, 0.012), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xfff4c0 : 0xffffff, emissive: 0x6a5a20, roughness: 0.6 }));
      feather.position.set(sx * (0.12 + i * 0.075), 0.1 + i * 0.03, 0);
      feather.rotation.z = -sx * (0.5 + i * 0.12);
      wing.add(feather);
    }
    g.add(wing);
  }
  g.scale.setScalar(scale);
  return g;
}

export function cape(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.6, 0.012), new THREE.MeshStandardMaterial({ color: 0xa01020, roughness: 0.7, emissive: 0x300008 }));
  m.geometry.translate(0, -0.3, 0);
  return m;
}

export function bracer(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 14), gold);
  m.rotation.x = Math.PI / 2;
  return m;
}

/** Cosmetics a gorilla figure (head origin at the neck or eyes) can wear at a trusted rank. */
export function dressHead(head: THREE.Object3D, tier: 0 | 1 | 2 | 3, y: number): void {
  if (tier >= 1) {
    const c = crown();
    c.position.y = y + 0.04;
    c.userData.cosmetic = true;
    head.add(c);
    const h = halo();
    h.position.y = y + 0.22;
    h.userData.cosmetic = true;
    head.add(h);
  }
  if (tier >= 3) {
    const hn = horns();
    hn.position.y = y + 0.06;
    hn.userData.cosmetic = true;
    head.add(hn);
  }
}

/** Puts the accessories for `level` on the player's own body: a crown and halo on the head, a cape and wings (seen in a mirror), gold bracers and orbiting lights on the hands. */
export function wear(rt: Runtime, level: number): void {
  const tier = accessoryTier(level);
  const clear = (o: THREE.Object3D): void => {
    for (const c of [...o.children]) if (c.userData.cosmetic) o.remove(c);
  };
  clear(rt.body.head);
  clear(rt.body.torso);
  clear(rt.hands.left.mesh);
  clear(rt.hands.right.mesh);
  rt.updaters = rt.updaters.filter((u) => !(u as { cosmetic?: boolean }).cosmetic);
  if (tier === 0) return;
  dressHead(rt.body.head, tier, 0.08);
  const cp = cape();
  cp.position.set(0, -0.12, 0.2);
  cp.userData.cosmetic = true;
  rt.body.torso.add(cp);
  if (tier >= 2) {
    const w = wings();
    w.position.set(0, -0.1, 0.22);
    w.userData.cosmetic = true;
    rt.body.torso.add(w);
  }
  const orbs: THREE.Mesh[] = [];
  for (const hand of [rt.hands.left, rt.hands.right]) {
    const b = bracer();
    b.position.set(0, 0.02, 0.09);
    b.userData.cosmetic = true;
    hand.mesh.add(b);
    if (tier >= 2) {
      for (let i = 0; i < 3; i++) {
        const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.014, 0), glow(tier >= 3 ? 0xff40a0 : 0xffe060));
        orb.userData.cosmetic = true;
        hand.mesh.add(orb);
        orbs.push(orb);
      }
    }
  }
  if (orbs.length) {
    let t = 0;
    const spin = (dt: number): void => {
      t += dt;
      orbs.forEach((o, i) => o.position.set(Math.cos(t * 3 + i * 2.1) * 0.12, 0.03 + Math.sin(t * 2 + i) * 0.04, Math.sin(t * 3 + i * 2.1) * 0.12));
    };
    (spin as { cosmetic?: boolean }).cosmetic = true;
    rt.updaters.push(spin);
  }
}

/** The text for a rank line: "LEVEL 7 · OK". */
export function rankLine(progress: Progress): string {
  const r = rankFor(progress.level);
  return `LEVEL ${progress.level} · ${r.name}${progress.trusted ? ' · TRUSTED USER' : ''}`;
}
