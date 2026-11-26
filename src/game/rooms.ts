import * as THREE from 'three';
import type { Engine } from './engine';
import type { Facility } from './facility';
import { FLOOR_Y } from './nav';
import { blob, box, cone, cyl, dyn, low, mat, part, rnd, sphere } from './shapes';
import { surface } from './textures';

/** What each room behind a door is. */
export const ROOM_THEMES = ['SERVER ROOM', 'COLD STORAGE', 'BOILER ROOM', 'ARMORY', 'MORGUE', 'POWER ROOM', 'SPECIMEN LAB', 'BREAK ROOM'] as const;
export type RoomTheme = (typeof ROOM_THEMES)[number];

interface Led {
  index: number;
  rate: number;
  phase: number;
  on: THREE.Color;
  off: THREE.Color;
}

/** Flat marks on the floor share a few materials so they batch. */
function decalMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  m.userData.batchable = true;
  return m;
}
const FROST = decalMaterial(0xe0f4ff, 0.35);
const BLOOD_OLD = decalMaterial(0x4a0808, 0.9);
const BLOOD_DARK = decalMaterial(0x2a0808, 0.8);
const OIL = decalMaterial(0x101010, 0.8);

const _m4 = new THREE.Matrix4();
const _v3 = new THREE.Vector3();
const _q4 = new THREE.Quaternion();
const _s3 = new THREE.Vector3();

function canvasPlane(w: number, h: number, draw: (c: CanvasRenderingContext2D, t: number) => void, cw = 256, ch = 144): { mesh: THREE.Mesh; tick: (t: number) => void } {
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  const ctx = canvas.getContext('2d')!;
  return {
    mesh,
    tick: (t) => {
      draw(ctx, t);
      tex.needsUpdate = true;
    },
  };
}

function label(text: string, color: string, w = 1.6, h = 0.4): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round(512 * (h / w));
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#14161a';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.strokeStyle = color;
  c.lineWidth = 6;
  c.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
  c.fillStyle = color;
  c.font = `bold ${Math.round(canvas.height * 0.5)}px system-ui`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, canvas.width / 2, canvas.height / 2 + 3);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
}

/**
 * The look of the places in the hazard zone: a theme for each room behind a door (servers, a cold store, a boiler room, an armoury, a
 * morgue, power room, specimen lab and a break room) and the hall's own details: a coolant channel, a hanging crane and cargo, steam
 * vents, cables, bodies. Mostly for the eye, and for sound: things hiss, hum and blink.
 */
export class Dressing {
  private readonly leds: Led[] = [];
  private ledMesh: THREE.InstancedMesh | null = null;
  private readonly screens: Array<{ tick: (t: number) => void; every: number; last: number }> = [];
  private readonly steam: Array<{ mesh: THREE.Mesh | null; index: number; base: THREE.Vector3; phase: number; speed: number }> = [];
  private puffMesh: THREE.InstancedMesh | null = null;
  private readonly vents: THREE.Vector3[] = [];
  private ventTimer = 4;
  private crane: THREE.Group | null = null;
  private pool: THREE.Mesh | null = null;
  private poolTex: THREE.CanvasTexture | null = null;
  private readonly sparks: Array<{ mesh: THREE.Mesh; phase: number }> = [];
  private readonly lamps: Array<{ mesh: THREE.Mesh; phase: number; base: THREE.Color }> = [];
  private readonly tanks: Array<{ fluid: THREE.Mesh; phase: number }> = [];
  private readonly g = new THREE.Group();
  private readonly swingers: THREE.Object3D[] = [];
  private readonly floaters: THREE.Object3D[] = [];
  private near = true;
  private tick = 0;

  constructor(
    private readonly e: Engine,
    private readonly f: Facility,
  ) {
    f.group.add(this.g);
  }

  // --- Helpers --------------------------------------------------------------------------------------------------------------

  private add(o: THREE.Object3D): void {
    this.g.add(o);
  }

  private led(x: number, y: number, z: number, color: number, rate = 1): void {
    // All the little lights are one instanced mesh, coloured per light.
    if (!this.ledMesh) {
      this.ledMesh = new THREE.InstancedMesh(sphere, new THREE.MeshBasicMaterial({ fog: false }), 300);
      this.ledMesh.count = 0;
      this.ledMesh.frustumCulled = false;
      dyn(this.ledMesh);
      this.add(this.ledMesh);
    }
    const i = this.ledMesh.count++;
    this.ledMesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(0.018, 0.018, 0.018)));
    this.ledMesh.setColorAt(i, new THREE.Color(color));
    this.leds.push({ index: i, rate: rate * (0.5 + Math.random()), phase: Math.random() * 10, on: new THREE.Color(color), off: new THREE.Color(0x101010) });
  }

  private solid(x: number, y: number, z: number, w: number, h: number, d: number, color: number, solid = true, kind: 'wall' | 'concrete' = 'wall'): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), surface(kind, Math.max(w, d), h, color));
    m.position.set(x, y, z);
    this.add(m);
    if (solid) this.e.solid(x, y, z, w / 2, h / 2, d / 2);
    return m;
  }

  /** Where `depth` metres in from the doorway and `lat` metres across is, in a room. */
  private at(side: number, zc: number, depth: number, lat: number): THREE.Vector3 {
    return new THREE.Vector3(side * (20.6 + depth), FLOOR_Y, zc + lat);
  }

  // --- Rooms -------------------------------------------------------------------------------------------------------------------

  dressRoom(theme: RoomTheme, side: number, zc: number): void {
    const room = new THREE.Group();
    this.add(room);
    const sign = label(theme, '#e8d060', 1.8, 0.36);
    sign.position.set(side * 20.45, FLOOR_Y + 3.6, zc);
    sign.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    // The sign hangs inside, over the door.
    sign.position.x = side * 20.45;
    this.add(sign);
    switch (theme) {
      case 'SERVER ROOM': this.servers(side, zc); break;
      case 'COLD STORAGE': this.cold(side, zc); break;
      case 'BOILER ROOM': this.boiler(side, zc); break;
      case 'ARMORY': this.armory(side, zc); break;
      case 'MORGUE': this.morgue(side, zc); break;
      case 'POWER ROOM': this.power(side, zc); break;
      case 'SPECIMEN LAB': this.lab(side, zc); break;
      case 'BREAK ROOM': this.breakRoom(side, zc); break;
    }
  }

  private servers(side: number, zc: number): void {
    // Rows of racks with blinking lights, and a wall of monitors.
    for (const row of [0, 1]) {
      for (let i = 0; i < 4; i++) {
        const p = this.at(side, zc, 2.2 + row * 3.4, -3.6 + i * 2.4);
        this.solid(p.x, FLOOR_Y + 1.1, p.z, 0.8, 2.2, 0.9, 0x2a2e36);
        part(this.g, box, 0x14161a, [p.x - side * 0.41, FLOOR_Y + 1.1, p.z], [0.02, 2.0, 0.8]);
        for (let k = 0; k < 8; k++) this.led(p.x - side * 0.43, FLOOR_Y + 0.3 + k * 0.24, p.z - 0.3 + (k % 3) * 0.3, [0x30ff60, 0xff4030, 0x40a0ff][k % 3], 2 + k * 0.3);
        for (let k = 0; k < 4; k++) part(this.g, box, 0x1a1c20, [p.x - side * 0.42, FLOOR_Y + 0.5 + k * 0.45, p.z], [0.01, 0.12, 0.7]);
      }
    }
    for (let i = 0; i < 4; i++) {
      const scr = canvasPlane(1.3, 0.75, (c, t) => {
        c.fillStyle = '#04100a';
        c.fillRect(0, 0, 256, 144);
        c.fillStyle = '#30ff80';
        c.font = '14px monospace';
        c.fillText(`CAM ${i + 1}  ${Math.floor(t) % 100}`, 8, 18);
        if (Math.sin(t * 0.7 + i * 2) > 0.5) for (let n = 0; n < 160; n++) {
          c.fillStyle = `rgba(80,255,140,${Math.random() * 0.5})`;
          c.fillRect(Math.random() * 256, Math.random() * 144, 6, 2);
        }
        else {
          c.strokeStyle = '#106a30';
          c.strokeRect(20, 30, 216, 100);
          c.fillStyle = '#ff3030';
          c.fillText('NO SIGNAL', 90, 84);
        }
      });
      scr.mesh.position.set(side * 29.6, FLOOR_Y + 2.1 + (i % 2) * 0.9, zc - 2.4 + Math.floor(i / 2) * 1.5);
      scr.mesh.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.add(scr.mesh);
      this.screens.push({ tick: scr.tick, every: 0.4, last: 0 });
    }
    const desk = this.at(side, zc, 8.6, 0);
    this.solid(desk.x, FLOOR_Y + 0.4, desk.z, 0.9, 0.8, 2.4, 0x3a3e46, false);
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(new THREE.TorusGeometry(0.4 + i * 0.1, 0.02, 6, 20, Math.PI), mat(0x101012));
      const p = this.at(side, zc, 1.5 + i * 1.3, -4.8);
      c.position.set(p.x, FLOOR_Y + 0.03, p.z + (i % 2) * 1.5);
      c.rotation.x = Math.PI / 2;
      this.add(c);
    }
  }

  private cold(side: number, zc: number): void {
    // Freezers, hooks with shrouded shapes, frost, and drifting mist.
    for (let i = 0; i < 4; i++) {
      const p = this.at(side, zc, 8.6, -3.6 + i * 2.4);
      this.solid(p.x, FLOOR_Y + 1.2, p.z, 1.2, 2.4, 2.0, 0xdfe8ee);
      part(this.g, box, 0x9ab0c0, [p.x - side * 0.62, FLOOR_Y + 1.2, p.z], [0.04, 2.2, 1.8]);
      part(this.g, box, 0x40c0ff, [p.x - side * 0.64, FLOOR_Y + 2.1, p.z], [0.02, 0.05, 1.4], [0, 0, 0], 0x2090d0);
      part(this.g, box, 0x303840, [p.x - side * 0.66, FLOOR_Y + 1.2, p.z + 0.7], [0.04, 0.5, 0.05]);
    }
    for (let i = 0; i < 5; i++) {
      const p = this.at(side, zc, 2 + i * 1.5, -2 + (i % 2) * 1.2);
      part(this.g, cyl, 0x606870, [p.x, FLOOR_Y + 3.5, p.z], [0.02, 1.0, 0.02]);
      const shroud = part(this.g, sphere, 0xcfd8e0, [p.x, FLOOR_Y + 2.6, p.z], [0.28, 0.75, 0.22]);
      shroud.userData.swing = 1;
      dyn(shroud);
      this.swingers.push(shroud);
      part(this.g, cyl, 0x606870, [p.x, FLOOR_Y + 4.0, p.z], [0.04, 0.02, 0.04]);
    }
    for (let i = 0; i < 6; i++) {
      const frost = new THREE.Mesh(new THREE.CircleGeometry(0.4 + Math.random() * 0.8, 12).rotateX(-Math.PI / 2), FROST);
      const p = this.at(side, zc, rnd(1, 9), rnd(-4, 4));
      frost.position.set(p.x, FLOOR_Y + 0.025, p.z);
      this.add(frost);
    }
    for (let i = 0; i < 4; i++) this.mist(this.at(side, zc, 2 + i * 2.2, rnd(-3, 3)), 0xcfe8ff);
    this.coldLight(side, zc);
  }

  private coldLight(side: number, zc: number): void {
    const l = this.f.fixtures.find((x) => Math.abs(x.pos.x - side * 25) < 0.1 && Math.abs(x.pos.z - zc) < 0.1);
    if (l) l.base.setHex(0x9ad8ff);
  }

  private mist(p: THREE.Vector3, color: number): void {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(p.x, FLOOR_Y + 0.5, p.z);
    m.rotation.x = -Math.PI / 2;
    this.add(m);
    this.steam.push({ mesh: m, index: -1, base: m.position.clone(), phase: Math.random() * 6, speed: 0.15 });
  }

  private boiler(side: number, zc: number): void {
    for (const lat of [-2.4, 2.4]) {
      const p = this.at(side, zc, 3.2, lat);
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3.4, 18), mat(0x6a4a3a, 0, 0.5, 0.6));
      tank.position.set(p.x, FLOOR_Y + 1.7, p.z);
      this.add(tank);
      this.e.solid(p.x, FLOOR_Y + 1.7, p.z, 1.2, 1.7, 1.2);
      const door = part(this.g, cyl, 0xff7a10, [p.x - side * 1.0, FLOOR_Y + 0.9, p.z], [0.45, 0.04, 0.45], [0, 0, Math.PI / 2], 0xff5a00);
      dyn(door);
      this.sparks.push({ mesh: door, phase: Math.random() * 6 });
      for (let k = 0; k < 4; k++) part(this.g, cyl, 0x303030, [p.x, FLOOR_Y + 0.5 + k * 0.8, p.z], [1.24, 0.04, 1.24]);
      const gauge = part(this.g, cyl, 0xe8e8e8, [p.x - side * 0.9, FLOOR_Y + 2.5, p.z + 0.7], [0.14, 0.03, 0.14], [0, 0, Math.PI / 2], 0x303030);
      void gauge;
      part(this.g, box, 0xff3030, [p.x - side * 0.93, FLOOR_Y + 2.5, p.z + 0.7], [0.02, 0.1, 0.012], [0, 0, 0.6], 0xff2020);
      const vent = this.at(side, zc, 3.2, lat);
      this.steamColumn(vent.x, FLOOR_Y + 3.4, vent.z);
    }
    for (let i = 0; i < 3; i++) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 10, 10).rotateZ(Math.PI / 2), mat(0x5a626c, 0, 0.4, 0.7));
      pipe.position.set(side * 25, FLOOR_Y + 3.6 - i * 0.35, zc - 3 + i * 3);
      this.add(pipe);
    }
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 6, 16), mat(0xb02020, 0, 0.4, 0.5));
    const wp = this.at(side, zc, 9.5, 3.6);
    wheel.position.set(wp.x, FLOOR_Y + 1.4, wp.z);
    wheel.rotation.y = Math.PI / 2;
    this.add(wheel);
    this.vents.push(this.at(side, zc, 5, 0));
  }

  private steamColumn(x: number, y: number, z: number): void {
    // Every puff of steam in the facility is one instanced mesh.
    if (!this.puffMesh) {
      this.puffMesh = new THREE.InstancedMesh(sphere, new THREE.MeshBasicMaterial({ color: 0xdfe4e8, transparent: true, opacity: 0.1, depthWrite: false }), 200);
      this.puffMesh.count = 0;
      this.puffMesh.frustumCulled = false;
      dyn(this.puffMesh);
      this.add(this.puffMesh);
    }
    for (let i = 0; i < 4; i++) {
      const index = this.puffMesh.count++;
      this.steam.push({ mesh: null, index, base: new THREE.Vector3(x, y, z), phase: i / 4, speed: 0.5 });
    }
  }

  private armory(side: number, zc: number): void {
    for (let i = 0; i < 6; i++) {
      const p = this.at(side, zc, 8.8, -4 + i * 1.6);
      this.solid(p.x, FLOOR_Y + 1.1, p.z, 0.7, 2.2, 1.4, 0x2a3a5a);
      part(this.g, box, 0x14161a, [p.x - side * 0.36, FLOOR_Y + 1.1, p.z], [0.02, 1.9, 1.2]);
      this.led(p.x - side * 0.37, FLOOR_Y + 1.9, p.z + 0.5, i % 2 ? 0xff3030 : 0x30ff60, 0.5);
    }
    const rack = this.at(side, zc, 2, -4.6);
    this.solid(rack.x, FLOOR_Y + 1.0, rack.z, 0.5, 2.0, 3.0, 0x3a3a40, false);
    for (let i = 0; i < 8; i++) part(this.g, box, 0x1a1c20, [rack.x - side * 0.3, FLOOR_Y + 0.4 + (i % 4) * 0.45, rack.z - 1.3 + Math.floor(i / 4) * 2.4 + (i % 2) * 0.3], [0.04, 0.05, 1.0]);
    for (let i = 0; i < 4; i++) {
      const p = this.at(side, zc, 4.5, rnd(-4, 4));
      this.solid(p.x, FLOOR_Y + 0.5, p.z, 1.2, 1.0, 0.8, 0x4a5a3a, true);
      part(this.g, box, 0xe0b020, [p.x, FLOOR_Y + 1.02, p.z], [1.0, 0.02, 0.3]);
    }
    const bench = this.at(side, zc, 2.2, 4);
    this.solid(bench.x, FLOOR_Y + 0.5, bench.z, 0.9, 1.0, 2.2, 0x6a5a3a, false);
    for (let i = 0; i < 5; i++) part(this.g, box, [0xb02020, 0x2a2a30, 0xe0b020][i % 3], [bench.x, FLOOR_Y + 1.06, bench.z - 0.8 + i * 0.4], [0.1, 0.05, 0.3]);
    const w = label('AUTHORIZED ONLY', '#ff5050', 1.8, 0.4);
    const wp = this.at(side, zc, 9.7, 0);
    w.position.set(wp.x - side * 0.02, FLOOR_Y + 3.0, wp.z);
    w.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    this.add(w);
  }

  private morgue(side: number, zc: number): void {
    for (let i = 0; i < 3; i++) {
      const p = this.at(side, zc, 4.2, -3 + i * 3);
      this.solid(p.x, FLOOR_Y + 0.5, p.z, 0.9, 1.0, 2.0, 0xb8c0c8, false);
      // A shape under a sheet.
      const sheet = part(this.g, sphere, 0xe8ecee, [p.x, FLOOR_Y + 1.2, p.z], [0.35, 0.18, 0.95]);
      sheet.scale.set(0.36, 0.17, 0.95);
      part(this.g, sphere, 0xe8ecee, [p.x, FLOOR_Y + 1.28, p.z - 0.55], [0.15, 0.13, 0.17]);
      part(this.g, blob, 0x6a0a0a, [p.x + 0.08, FLOOR_Y + 1.3, p.z + 0.2], [0.12, 0.02, 0.2]);
      const lamp = this.lampCone(p.x, FLOOR_Y + 3.6, p.z, 0xd8f0ff);
      this.lamps.push({ mesh: lamp, phase: Math.random() * 10, base: new THREE.Color(0xd8f0ff) });
    }
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
      const p = this.at(side, zc, 9.6, -2.4 + c * 1.6);
      part(this.g, box, 0xc0c8d0, [p.x, FLOOR_Y + 0.5 + r * 0.7, p.z], [0.12, 0.6, 1.4]);
      part(this.g, box, 0x40454c, [p.x - side * 0.07, FLOOR_Y + 0.5 + r * 0.7, p.z], [0.02, 0.06, 0.2]);
    }
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.CircleGeometry(0.3 + Math.random() * 0.5, 10).rotateX(-Math.PI / 2), BLOOD_OLD);
      const p = this.at(side, zc, rnd(1, 9), rnd(-4, 4));
      b.position.set(p.x, FLOOR_Y + 0.03, p.z);
      this.add(b);
    }
    const tray = this.at(side, zc, 1.4, 4.2);
    this.solid(tray.x, FLOOR_Y + 0.55, tray.z, 0.5, 1.1, 1.0, 0x9aa2aa, false);
    for (let i = 0; i < 5; i++) part(this.g, box, 0xc8d0d8, [tray.x - side * 0.1, FLOOR_Y + 1.16, tray.z - 0.3 + i * 0.12], [0.03, 0.02, 0.2], [0, 0, i * 0.3]);
  }

  private lampCone(x: number, y: number, z: number, color: number): THREE.Mesh {
    const cone2 = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.3, 12, 1, true), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false }));
    cone2.position.set(x, y, z);
    dyn(cone2);
    this.add(cone2);
    part(this.g, cyl, 0x303840, [x, y + 0.7, z], [0.02, 0.6, 0.02]);
    return cone2;
  }

  private power(side: number, zc: number): void {
    for (let i = 0; i < 3; i++) {
      const p = this.at(side, zc, 2.4 + i * 2.8, -3.2);
      this.solid(p.x, FLOOR_Y + 0.9, p.z, 1.6, 1.8, 1.4, 0x4a5a3a);
      for (let k = 0; k < 3; k++) {
        const coil = part(this.g, cyl, 0xb87333, [p.x - side * 0.2, FLOOR_Y + 1.95, p.z - 0.4 + k * 0.4], [0.16, 0.2, 0.16], [0, 0, 0], 0, 0.4, 0.8);
        void coil;
      }
      const lamp = part(this.g, sphere, 0xffe040, [p.x - side * 0.82, FLOOR_Y + 1.5, p.z], [0.06, 0.06, 0.03], [0, 0, 0], 0xffd020);
      dyn(lamp);
      this.sparks.push({ mesh: lamp, phase: Math.random() * 6 });
    }
    for (let i = 0; i < 3; i++) {
      const p = this.at(side, zc, 8.8, 1.2 + i * 1.2);
      this.solid(p.x, FLOOR_Y + 1.2, p.z, 0.6, 2.4, 1.0, 0x30343c);
      part(this.g, box, 0xffd020, [p.x - side * 0.31, FLOOR_Y + 2.0, p.z], [0.02, 0.3, 0.3]);
      for (let k = 0; k < 3; k++) this.led(p.x - side * 0.32, FLOOR_Y + 1.2 + k * 0.2, p.z - 0.3, [0x30ff60, 0xffa020, 0xff3030][k], 1.5);
    }
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 8, 6).rotateZ(Math.PI / 2), mat(0x101012));
      c.position.set(side * 25, FLOOR_Y + 4.1 - i * 0.12, zc - 4 + i * 2);
      this.add(c);
    }
    const warn = label('HIGH VOLTAGE', '#ffd020', 1.8, 0.4);
    const wp = this.at(side, zc, 5, 4.9);
    warn.position.set(wp.x, FLOOR_Y + 2.2, wp.z);
    warn.rotation.y = Math.PI;
    this.add(warn);
  }

  private lab(side: number, zc: number): void {
    for (let i = 0; i < 4; i++) {
      const p = this.at(side, zc, 3.2 + (i % 2) * 3.2, -2.6 + Math.floor(i / 2) * 5.2);
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 3.0, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x9ae0b0, transparent: true, opacity: 0.2, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }));
      glass.position.set(p.x, FLOOR_Y + 1.7, p.z);
      this.add(glass);
      this.e.solid(p.x, FLOOR_Y + 1.5, p.z, 0.8, 1.5, 0.8);
      part(this.g, cyl, 0x2a2e36, [p.x, FLOOR_Y + 0.1, p.z], [0.9, 0.2, 0.9]);
      part(this.g, cyl, 0x2a2e36, [p.x, FLOOR_Y + 3.25, p.z], [0.9, 0.15, 0.9]);
      const fluid = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.76, 2.8, 18), new THREE.MeshBasicMaterial({ color: 0x40ff90, transparent: true, opacity: 0.22, depthWrite: false }));
      fluid.position.set(p.x, FLOOR_Y + 1.7, p.z);
      this.add(fluid);
      this.tanks.push({ fluid, phase: Math.random() * 6 });
      if (i === 3) {
        // This one is empty, and its glass is on the floor.
        fluid.visible = false;
        for (let k = 0; k < 8; k++) part(this.g, low, 0x9ae0b0, [p.x + rnd(-1.2, 1.2), FLOOR_Y + 0.03, p.z + rnd(-1.2, 1.2)], [0.1, 0.02, 0.07], [0, rnd(0, 3), 0]);
        part(this.g, blob, 0x2a5a30, [p.x + 0.6, FLOOR_Y + 0.04, p.z + 1.1], [0.5, 0.02, 0.3]);
        continue;
      }
      // Something dark floats in it.
      const body = part(this.g, sphere, 0x20282a, [p.x, FLOOR_Y + 1.5, p.z], [0.22, 0.5, 0.18]);
      part(this.g, sphere, 0x20282a, [p.x, FLOOR_Y + 2.15, p.z], [0.16, 0.18, 0.15]);
      for (const sx of [-1, 1]) {
        limb2(this.g, new THREE.Vector3(p.x + sx * 0.2, FLOOR_Y + 1.9, p.z), new THREE.Vector3(p.x + sx * 0.55, FLOOR_Y + 1.0, p.z + 0.1), 0x20282a);
        part(this.g, sphere, 0xff3040, [p.x + sx * 0.06, FLOOR_Y + 2.17, p.z - 0.13], [0.014, 0.014, 0.01], [0, 0, 0], 0xff2030);
      }
      body.userData.float = 1;
      dyn(body);
      this.floaters.push(body);
    }
    for (let i = 0; i < 3; i++) {
      const p = this.at(side, zc, 8.6, -3.4 + i * 2.6);
      this.solid(p.x, FLOOR_Y + 0.45, p.z, 0.9, 0.9, 1.8, 0x7a8a96, false);
      part(this.g, cyl, 0x202428, [p.x, FLOOR_Y + 1.1, p.z + 0.4], [0.07, 0.3, 0.07]);
      part(this.g, box, 0x40e0ff, [p.x + 0.1, FLOOR_Y + 0.95, p.z - 0.5], [0.3, 0.02, 0.4], [0, 0, 0], 0x20a0c0);
    }
    this.mist(this.at(side, zc, 5, 0), 0x80ffb0);
  }

  private breakRoom(side: number, zc: number): void {
    const t = this.at(side, zc, 5, 1);
    this.solid(t.x, FLOOR_Y + 0.4, t.z, 1.8, 0.8, 1.4, 0x6a5a3a, false);
    for (const [dx, dz] of [[-1.2, -0.2], [1.2, 0.3], [0.2, -1.1], [-0.2, 1.1]]) part(this.g, box, 0x2a3a5a, [t.x + dx, FLOOR_Y + 0.25, t.z + dz], [0.4, 0.5, 0.4]);
    part(this.g, cyl, 0xe8e0d0, [t.x + 0.2, FLOOR_Y + 0.84, t.z], [0.1, 0.04, 0.1]);
    const couch = this.at(side, zc, 9.2, -3.2);
    this.solid(couch.x, FLOOR_Y + 0.35, couch.z, 0.9, 0.7, 2.6, 0x6a2a2a, false);
    part(this.g, box, 0x5a2222, [couch.x + side * 0.4, FLOOR_Y + 0.9, couch.z], [0.2, 0.7, 2.6]);
    const vm = this.at(side, zc, 9.3, 3.6);
    this.solid(vm.x, FLOOR_Y + 1.0, vm.z, 0.9, 2.0, 1.2, 0x2a3a6a);
    const face = part(this.g, box, 0xfff6c0, [vm.x - side * 0.46, FLOOR_Y + 1.3, vm.z], [0.02, 1.1, 0.9], [0, 0, 0], 0xffe090);
    dyn(face);
    this.sparks.push({ mesh: face, phase: Math.random() * 6 });
    const posters = ['KEEP CALM', 'SAFETY FIRST', 'DAY 412', 'THEY LISTEN'];
    posters.forEach((txt, i) => {
      const poster = label(txt, ['#60e0ff', '#ffd020', '#a0a0a0', '#ff5050'][i], 1.0, 0.6);
      const p = this.at(side, zc, 9.7, -2.2 + i * 1.5);
      poster.position.set(p.x, FLOOR_Y + 2.3, p.z);
      poster.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.add(poster);
    });
    for (let i = 0; i < 3; i++) {
      const p = this.at(side, zc, 1.2 + i * 0.9, -4.4);
      this.solid(p.x, FLOOR_Y + 1.0, p.z, 0.8, 2.0, 0.55, 0x4a6a8a, true);
      part(this.g, box, 0x2a3a4a, [p.x, FLOOR_Y + 1.0, p.z + 0.28], [0.7, 1.9, 0.03]);
    }
  }

  // --- The hall ---------------------------------------------------------------------------------------------------------------

  dressHall(): void {
    // A coolant channel across the hall's west side, with a rim.
    const poolCanvas = document.createElement('canvas');
    poolCanvas.width = poolCanvas.height = 128;
    const pc = poolCanvas.getContext('2d')!;
    pc.fillStyle = '#0a4a6a';
    pc.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 70; i++) {
      pc.strokeStyle = `rgba(120,230,255,${0.1 + Math.random() * 0.25})`;
      pc.beginPath();
      const y = Math.random() * 128;
      pc.moveTo(0, y);
      pc.bezierCurveTo(40, y + 12, 80, y - 12, 128, y);
      pc.stroke();
    }
    this.poolTex = new THREE.CanvasTexture(poolCanvas);
    this.poolTex.wrapS = this.poolTex.wrapT = THREE.RepeatWrapping;
    this.poolTex.repeat.set(3, 4);
    this.poolTex.colorSpace = THREE.SRGBColorSpace;
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(7, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.poolTex, transparent: true, opacity: 0.85, fog: true }));
    this.pool.position.set(-13.5, FLOOR_Y + 0.06, 54);
    this.add(this.pool);
    for (const [x, z, w, d] of [[-17.2, 54, 0.3, 12.6], [-9.8, 54, 0.3, 12.6], [-13.5, 47.8, 7.6, 0.3], [-13.5, 60.2, 7.6, 0.3]] as Array<[number, number, number, number]>) this.solid(x, FLOOR_Y + 0.25, z, w, 0.5, d, 0x5a5e66, true, 'concrete');
    // An overhead crane on rails with a hanging container.
    this.crane = dyn(new THREE.Group());
    for (const x of [-14, 14]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 56), mat(0x3a3e46, 0, 0.5, 0.6));
      rail.position.set(x, 4.9, 37);
      this.add(rail);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(28.6, 0.7, 1.2), mat(0x7a6a20, 0, 0.5, 0.5));
    bridge.position.set(0, 4.9, 0);
    this.crane.add(bridge);
    const trolley = new THREE.Group();
    trolley.position.set(8, 4.3, 0);
    trolley.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.4), mat(0x303236, 0, 0.5, 0.6)));
    for (const sx of [-0.5, 0.5]) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 6, 6), mat(0x20242a, 0, 0.5, 0.7));
      chain.position.set(sx, -3.2, 0);
      trolley.add(chain);
    }
    const crate = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 2.4), surface('wall', 3.4, 2.2, 0x6a3a2a));
    crate.position.set(0, -6.6, 0);
    trolley.add(crate);
    part(trolley, box, 0x303236, [0, -5.4, 0], [3.6, 0.2, 2.6]);
    this.crane.add(trolley);
    this.crane.position.set(0, 0, 24);
    this.crane.userData.trolley = trolley;
    this.add(this.crane);
    // Floor steam vents that hiss.
    for (const [x, z] of [[-4, 24], [5, 33], [-6, 58], [9, 46], [0, 18]]) {
      const v = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 12), surface('grate', 0.8, 0.8));
      v.position.set(x, FLOOR_Y + 0.03, z);
      this.add(v);
      this.vents.push(new THREE.Vector3(x, FLOOR_Y, z));
      this.steamColumn(x, FLOOR_Y + 0.2, z);
    }
    // Hanging cables, exit signs, and bodies of people who did not make it.
    for (let i = 0; i < 14; i++) {
      const x = rnd(-17, 17);
      const z = rnd(12, 64);
      const len = rnd(1.5, 4);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 5), mat(0x101012));
      c.position.set(x, 6 - len / 2 - 0.5, z);
      this.add(c);
    }
    for (const [x, z] of [[-19, 14], [19, 14], [0, 65.5], [-19, 62], [19, 62]]) {
      const sign = label('EXIT →', '#60ff90', 1.3, 0.3);
      sign.position.set(x * 0.98, 3.8, z);
      sign.rotation.y = x < -5 ? Math.PI / 2 : x > 5 ? -Math.PI / 2 : Math.PI;
      this.add(sign);
    }
    const bodyAt: Array<[number, number, number]> = [[-10, 30, 0.6], [12, 58, 2.2], [-3, 14.5, 1.2]];
    for (const [x, z, r] of bodyAt) this.body(x, z, r);
    // Smears and puddles of oil and blood.
    for (let i = 0; i < 22; i++) {
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.3 + Math.random() * 0.9, 12).rotateX(-Math.PI / 2), i % 3 ? BLOOD_DARK : OIL);
      d.position.set(rnd(-18, 18), FLOOR_Y + 0.02, rnd(10, 66));
      d.scale.y = 1;
      this.add(d);
    }
    // Fallen pipes and an overturned crate.
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, rnd(3, 6), 10), mat(0x5a626c, 0, 0.4, 0.7));
      p.rotation.set(Math.PI / 2, rnd(0, 3), rnd(-0.1, 0.1));
      p.position.set(rnd(-16, 16), FLOOR_Y + 0.25, rnd(15, 62));
      this.add(p);
    }
  }

  /** A suited body on the floor. */
  private body(x: number, z: number, yaw: number): void {
    const b = new THREE.Group();
    b.position.set(x, FLOOR_Y + 0.12, z);
    b.rotation.y = yaw;
    part(b, sphere, 0xe8731a, [0, 0, 0], [0.22, 0.12, 0.34]);
    part(b, sphere, 0xe8731a, [0, 0.02, -0.4], [0.16, 0.14, 0.17]);
    part(b, sphere, 0x050608, [0, 0.03, -0.52], [0.1, 0.07, 0.06]);
    for (const sx of [-1, 1]) {
      part(b, cyl, 0xe8731a, [sx * 0.3, 0, -0.1 + sx * 0.1], [0.05, 0.5, 0.05], [Math.PI / 2, 0, sx * 0.4]);
      part(b, sphere, 0xd05a10, [sx * 0.4, 0, -0.5 + sx * 0.2], [0.07, 0.05, 0.08]);
    }
    part(b, cyl, 0x1a1c22, [0, -0.06, 0.4], [0.2, 0.04, 0.2]);
    part(b, blob, 0x3a0808, [0.1, -0.1, -0.1], [0.45, 0.01, 0.6]);
    this.add(b);
  }

  // --- Life ---------------------------------------------------------------------------------------------------------------------

  update(dt: number, t: number): void {
    // Nothing here is seen from the lobby except through the window, and only roughly: update it at a gentler pace.
    this.near = this.e.head.z > 7.3;
    this.tick += dt;
    if (!this.near && this.tick < 0.2) return;
    if (this.near && this.tick < 1 / 30) return;
    dt = this.tick;
    this.tick = 0;
    if (this.ledMesh) {
      for (const l of this.leds) this.ledMesh.setColorAt(l.index, Math.sin(t * l.rate * 3 + l.phase) > -0.3 ? l.on : l.off);
      if (this.ledMesh.instanceColor) this.ledMesh.instanceColor.needsUpdate = true;
    }
    for (const s of this.screens) {
      if (t - s.last > s.every) {
        s.last = t;
        s.tick(t);
      }
    }
    for (const p of this.steam) {
      const k = (t * p.speed + p.phase) % 1;
      if (p.mesh) {
        p.mesh.position.x = p.base.x + Math.sin(t * 0.3 + p.phase * 6) * 0.8;
        p.mesh.position.z = p.base.z + Math.cos(t * 0.25 + p.phase * 6) * 0.8;
      } else if (this.puffMesh) {
        const sc = 0.08 + k * 0.22;
        this.puffMesh.setMatrixAt(p.index, _m4.compose(_v3.set(p.base.x, p.base.y + k * 2.4, p.base.z), _q4, _s3.set(sc, sc, sc)));
      }
    }
    if (this.puffMesh) this.puffMesh.instanceMatrix.needsUpdate = true;
    if (this.pool && this.poolTex) {
      this.poolTex.offset.x += dt * 0.02;
      this.poolTex.offset.y += dt * 0.012;
    }
    if (this.crane) {
      const tr = this.crane.userData.trolley as THREE.Group;
      tr.position.x = Math.sin(t * 0.08) * 9;
      tr.rotation.z = Math.sin(t * 0.5) * 0.015;
      this.crane.position.z = 37 + Math.sin(t * 0.05) * 14;
    }
    for (const s of this.sparks) {
      const v = Math.max(0, Math.sin(t * 9 + s.phase) * Math.sin(t * 2.3 + s.phase));
      const m = s.mesh.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.7 + v * 2.2;
    }
    for (const l of this.lamps) (l.mesh.material as THREE.MeshBasicMaterial).color.copy(l.base).multiplyScalar(Math.sin(t * 31 + l.phase) * Math.sin(t * 4.1 + l.phase) > 0.85 ? 0.2 : 1);
    for (const tk of this.tanks) (tk.fluid.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.07 * Math.sin(t * 1.6 + tk.phase);
    if (this.near) {
      for (const o of this.swingers) o.rotation.z = Math.sin(t * 0.9 + o.position.x * 3) * 0.05;
      for (const o of this.floaters) o.position.y += Math.sin(t * 1.2 + o.position.x) * 0.0007;
    }
    // Steam vents hiss.
    this.ventTimer -= dt;
    if (this.ventTimer <= 0 && this.vents.length) {
      this.ventTimer = rnd(2.5, 6);
      const v = this.vents[Math.floor(Math.random() * this.vents.length)];
      const d = this.e.head.distanceTo(v);
      if (d < 40) this.e.audio.play('static', v.clone().setY(v.y + 0.3), Math.max(0.1, 0.7 - d / 60));
    }
  }
}

function limb2(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, color: number): void {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 1, 6), mat(color));
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.scale.y = a.distanceTo(b);
  parent.add(m);
}

export const _unused = { cone };
