import * as THREE from 'three';
import type { Facility } from './backrooms';
import type { Monster } from './monsters';

/** A security monitor in the lobby: the plan of the facility, the state of every door and relay, and flickering blips where the cameras think something is. It is not reliable. */
export class CctvMap {
  readonly mesh: THREE.Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly tex: THREE.CanvasTexture;
  private blips: Array<{ x: number; z: number; kind: string }> = [];
  private refresh = 0;
  private last = -1;

  constructor() {
    this.canvas.width = 512;
    this.canvas.height = 576;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(3, 3.375), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
  }

  update(dt: number, t: number, facility: Facility, monsters: Monster[], player: THREE.Vector3 | null): void {
    this.refresh -= dt;
    if (this.refresh <= 0) {
      this.refresh = 2.4;
      // The cameras miss things and smear others.
      this.blips = monsters.filter(() => Math.random() < 0.72).map((m) => ({ x: m.pos.x + (Math.random() - 0.5) * 3, z: m.pos.z + (Math.random() - 0.5) * 3, kind: m.kind }));
    }
    if (t - this.last < 0.12) return;
    this.last = t;
    const c = this.canvas.getContext('2d')!;
    const S = 8.4;
    const px = (x: number): number => 256 + x * S;
    const pz = (z: number): number => 40 + (z - 7) * S;
    c.fillStyle = '#041008';
    c.fillRect(0, 0, 512, 576);
    c.strokeStyle = '#0f5a30';
    c.lineWidth = 1;
    for (let x = 0; x < 512; x += 42) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, 576);
      c.stroke();
    }
    for (let y = 0; y < 576; y += 42) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(512, y);
      c.stroke();
    }
    // The maze: every wall line, the flooded hallway and the Pitfalls.
    c.strokeStyle = '#30c070';
    c.lineWidth = 2;
    c.beginPath();
    for (const [x0, z0, x1, z1] of facility.segments) {
      c.moveTo(px(x0), pz(z0));
      c.lineTo(px(x1), pz(z1));
    }
    c.stroke();
    const w = facility.water;
    c.fillStyle = 'rgba(20,120,180,0.5)';
    c.fillRect(px(w.x0), pz(w.z0), (w.x1 - w.x0) * S, (w.z1 - w.z0) * S);
    c.fillStyle = 'rgba(255,120,40,0.35)';
    for (const p of facility.pits) c.fillRect(px(p.x0), pz(p.z0), (p.x1 - p.x0) * S, (p.z1 - p.z0) * S);
    // Doors.
    for (const d of facility.doors) {
      const open = d.pos > 0.7;
      c.fillStyle = d.jam !== 'none' ? '#ffc020' : d.locked ? '#4060ff' : open ? '#30ff70' : '#ff3030';
      const x = px(d.center.x);
      const z = pz(d.center.z);
      if (d.wall === 'z') c.fillRect(x - 3, z - 11, 6, 22);
      else c.fillRect(x - 11, z - 3, 22, 6);
    }
    // Relays and the lift.
    for (const r of facility.relays) {
      c.fillStyle = r.active ? '#40ffff' : '#206a6a';
      c.fillRect(px(r.pos.x) - 6, pz(r.pos.z) - 6, 12, 12);
      c.fillStyle = '#9fffff';
      c.font = '12px monospace';
      c.fillText(r.active ? 'ON' : 'OFF', px(r.pos.x) - (r.pos.x < 0 ? -10 : 28), pz(r.pos.z) + 4);
    }
    c.fillStyle = '#80ff90';
    c.font = 'bold 14px monospace';
    c.fillText('EXIT', px(0) - 16, pz(69.5));
    // The cameras' guesses.
    const flick = Math.sin(t * 20) > -0.5;
    for (const b of this.blips) {
      if (!flick) continue;
      c.fillStyle = '#ff3030';
      c.beginPath();
      c.arc(px(b.x), pz(b.z), 7 + Math.sin(t * 6) * 2, 0, Math.PI * 2);
      c.fill();
    }
    if (player) {
      c.strokeStyle = '#ffffff';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(px(player.x), pz(player.z), 6, 0, Math.PI * 2);
      c.stroke();
    }
    // Noise.
    for (let i = 0; i < 90; i++) {
      c.fillStyle = `rgba(80,255,140,${Math.random() * 0.12})`;
      c.fillRect(Math.random() * 512, Math.random() * 576, 14, 1);
    }
    c.fillStyle = '#40ff90';
    c.font = 'bold 20px monospace';
    c.fillText('FACILITY 9 · LIVE', 14, 26);
    this.tex.needsUpdate = true;
  }
}
