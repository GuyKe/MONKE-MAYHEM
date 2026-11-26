import * as THREE from 'three';
import type { Zone } from '../audio';
import { WorldButton } from '../ui/panel';
import { Door, DOOR_H, DOOR_W } from './doors';
import type { Engine } from './engine';
import { CATWALK_Y, FLOOR_Y, Nav, colOf, rowOf, cellX, cellZ } from './nav';
import { box, cyl, dyn, mat, part } from './shapes';
import { batchStatic } from './batch';
import { slab, surface } from './textures';
import { Dressing, ROOM_THEMES } from './rooms';
import { barrel, forklift, hazardFrame, pallet, pipe, shelves, shutter } from './props';

export const HALL_TOP = 6;
export const ROOM_Z = [20, 32, 44, 56];
const ROOM_HALF = 5;

export interface Fixture {
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  phase: number;
  base: THREE.Color;
}

export interface Relay {
  id: number;
  name: string;
  active: boolean;
  button: WorldButton;
  lamp: THREE.Mesh;
  pos: THREE.Vector3;
}

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const _tmp = new THREE.Vector3();

/** The hazard zone: a vast machine hall far below the lobby window, with a catwalk hung over it, stairs, columns and cargo, eight heavy doors into side rooms and an exit gate at the far end. */
export class Facility {
  readonly nav = new Nav();
  readonly doors: Door[] = [];
  readonly fixtures: Fixture[] = [];
  readonly relays: Relay[] = [];
  /** Things that block sight and sound on the hall floor. */
  readonly blockers: Rect[] = [];
  exitDoor!: Door;
  readonly cabin = new THREE.Vector3(0, FLOOR_Y, 70);
  evacuate!: WorldButton;
  readonly group = new THREE.Group();
  /** Where monsters may start. */
  readonly spawns: THREE.Vector3[] = [];
  /** Spots in rooms and the hall where gear lies. */
  readonly gearSpots: THREE.Vector3[] = [];

  readonly dressing: Dressing;

  constructor(private readonly e: Engine) {
    e.scene.add(this.group);
    this.dressing = new Dressing(e, this);
    this.buildShell();
    this.buildRooms();
    this.buildCatwalk();
    this.buildCargo();
    this.buildExit();
    this.buildLights();
    this.buildNav();
    this.buildProps();
    this.dressing.dressHall();
    batchStatic(this.group);
  }

  // --- Pieces ----------------------------------------------------------------------------------------------------

  private block(kind: 'wall' | 'floor' | 'grate' | 'concrete' | 'hazard' | 'ceiling' | 'door', x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, collide = true, tint = 0xffffff): THREE.Mesh {
    const m = slab(kind, x1 - x0, y1 - y0, z1 - z0, tint);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.group.add(m);
    if (collide) this.e.solid((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2);
    return m;
  }

  private buildShell(): void {
    // The floor (the hall and the rooms either side) and the ceiling.
    this.block('concrete', -30, 30, FLOOR_Y - 0.6, FLOOR_Y, 7, 73);
    this.block('ceiling', -20, 20, HALL_TOP, HALL_TOP + 0.4, 7, 67, false);
    // The north wall under the lobby window and its sides.
    this.block('wall', -20, 20, FLOOR_Y, 0.9, 6.6, 7, true);
    this.block('wall', -20, -5.5, 0.9, HALL_TOP, 6.6, 7);
    this.block('wall', 5.5, 20, 0.9, HALL_TOP, 6.6, 7);
    this.block('wall', -5.5, 5.5, 3.7, HALL_TOP, 6.6, 7);
    // The long walls, with a doorway for each room, and lintels above.
    for (const side of [-1, 1]) {
      const wx = side * 20;
      const doorsZ = ROOM_Z.slice();
      let z = 7;
      for (const dz of doorsZ) {
        this.wallSegment(wx, z, dz - DOOR_W / 2);
        // The lintel over the doorway.
        this.block('wall', wx - 0.2, wx + 0.2, FLOOR_Y + DOOR_H, HALL_TOP, dz - DOOR_W / 2, dz + DOOR_W / 2);
        z = dz + DOOR_W / 2;
      }
      this.wallSegment(wx, z, 67);
    }
    // The far wall, with the exit gate in it.
    this.block('wall', -20, -DOOR_W / 2, FLOOR_Y, HALL_TOP, 67, 67.4);
    this.block('wall', DOOR_W / 2, 20, FLOOR_Y, HALL_TOP, 67, 67.4);
    this.block('wall', -DOOR_W / 2, DOOR_W / 2, FLOOR_Y + DOOR_H, HALL_TOP, 67, 67.4);
    // Painted safety lines on the floor in front of each door.
    for (const side of [-1, 1]) {
      for (const dz of ROOM_Z) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(2.4, DOOR_W + 0.6), surface('hazard', 2.4, DOOR_W + 0.6));
        s.rotation.x = -Math.PI / 2;
        s.position.set(side * 18.8, FLOOR_Y + 0.02, dz);
        this.group.add(s);
      }
    }
    // Blockers for sight.
    this.blockers.push({ x0: -20.2, x1: -19.8, z0: 7, z1: 67 }, { x0: 19.8, x1: 20.2, z0: 7, z1: 67 });
  }

  private wallSegment(wx: number, z0: number, z1: number): void {
    if (z1 - z0 < 0.05) return;
    this.block('wall', wx - 0.2, wx + 0.2, FLOOR_Y, HALL_TOP, z0, z1);
  }

  private buildRooms(): void {
    for (const side of [-1, 1] as const) {
      ROOM_Z.forEach((zc, i) => {
        const name = `${side > 0 ? 'E' : 'W'}${i + 1}`;
        const x0 = side > 0 ? 20.2 : -30;
        const x1 = side > 0 ? 30 : -20.2;
        // Partitions, back wall, ceiling.
        this.block('wall', x0, x1, FLOOR_Y, FLOOR_Y + 4.5, zc - ROOM_HALF - 1, zc - ROOM_HALF);
        this.block('wall', x0, x1, FLOOR_Y, FLOOR_Y + 4.5, zc + ROOM_HALF, zc + ROOM_HALF + 1);
        this.block('wall', side > 0 ? 30 : -30.4, side > 0 ? 30.4 : -30, FLOOR_Y, FLOOR_Y + 4.5, zc - ROOM_HALF, zc + ROOM_HALF);
        this.block('ceiling', x0, x1, FLOOR_Y + 4.5, FLOOR_Y + 4.8, zc - ROOM_HALF, zc + ROOM_HALF);
        // The door and its controls.
        const door = new Door(this.e, this.doors.length, name, new THREE.Vector3(side * 20, FLOOR_Y, zc), (-side) as 1 | -1, 'z');
        door.onSlam = (d) => this.onDoorSlam?.(d);
        this.doors.push(door);
        // The room's lamp and a few things in it.
        this.lamp(new THREE.Vector3(side * 25, FLOOR_Y + 4.3, zc), 0xfff0d0, 0.9);
        this.gearSpots.push(new THREE.Vector3(side * 28.6, FLOOR_Y + 0.05, zc - 3));
        this.gearSpots.push(new THREE.Vector3(side * 28.6, FLOOR_Y + 0.05, zc + 3));
        this.dressing.dressRoom(ROOM_THEMES[(side > 0 ? 0 : 4) + i], side, zc);
      });
    }
    // Two rooms hold the power relays.
    this.relayStation(1, 'RELAY A', new THREE.Vector3(-29.6, FLOOR_Y, ROOM_Z[1]), 1);
    this.relayStation(2, 'RELAY B', new THREE.Vector3(29.6, FLOOR_Y, ROOM_Z[2]), -1);
  }

  onDoorSlam: ((d: Door) => void) | null = null;
  onRelay: ((r: Relay) => void) | null = null;

  private relayStation(id: number, name: string, at: THREE.Vector3, facing: 1 | -1): void {
    const g = new THREE.Group();
    g.position.copy(at);
    g.rotation.y = facing > 0 ? Math.PI / 2 : -Math.PI / 2;
    part(g, box, 0x2a2e36, [0, 1.0, 0], [2.2, 2.0, 0.5], [0, 0, 0], 0, 0.35, 0.7);
    part(g, box, 0x14161a, [0, 1.3, 0.27], [1.9, 1.0, 0.04]);
    const lamp = dyn(part(g, cyl, 0xff3030, [0, 1.95, 0.3], [0.14, 0.08, 0.14], [Math.PI / 2, 0, 0], 0xff2020));
    lamp.material = (lamp.material as THREE.MeshLambertMaterial).clone();
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: this.labelTexture(name, '#ffcf40'), transparent: true }));
    label.position.set(0, 1.62, 0.3);
    g.add(label);
    this.group.add(g);
    const button = this.e.panels.add(new WorldButton(this.e.scene, 'RESTORE POWER', 1.5, 0.34, '#2d7a3a', () => this.activate(id)));
    button.mesh.position.set(0, 1.05, 0.31);
    g.add(button.mesh);
    const relay: Relay = { id, name, active: false, button, lamp, pos: at.clone().setY(FLOOR_Y + 1.2) };
    this.relays.push(relay);
  }

  private activate(id: number): void {
    const r = this.relays.find((x) => x.id === id);
    if (!r || r.active) return;
    r.active = true;
    r.button.enabled = false;
    r.button.setLabel('POWER ON');
    (r.lamp.material as THREE.MeshStandardMaterial).emissive.setHex(0x20ff60);
    (r.lamp.material as THREE.MeshStandardMaterial).color.setHex(0x20ff60);
    this.e.audio.play('relay', r.pos, 1);
    this.onRelay?.(r);
  }

  private labelTexture(text: string, color: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const x = c.getContext('2d')!;
    x.fillStyle = 'rgba(0,0,0,0)';
    x.clearRect(0, 0, 512, 128);
    x.fillStyle = color;
    x.font = 'bold 84px system-ui';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, 256, 68);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private buildCatwalk(): void {
    // The deck under the window, the long walks down both sides, and the walk across the far end.
    const deck = (x0: number, x1: number, z0: number, z1: number): void => void this.block('grate', x0, x1, CATWALK_Y - 0.18, CATWALK_Y, z0, z1);
    deck(-20, 20, 7, 13);
    deck(16.5, 20, 13, 64);
    deck(-20, -16.5, 13, 64);
    deck(-20, 20, 61, 64);
    // Edge beams.
    for (const [x0, x1, z0, z1] of [[-20, 20, 13, 13.15], [16.4, 16.55, 13, 61], [-16.55, -16.4, 13, 61], [-16.5, 16.5, 61, 61.15]]) this.block('wall', x0, x1, CATWALK_Y - 0.5, CATWALK_Y - 0.18, z0, z1, false, 0x404850);
    // Railings: posts and rails along the inner edges (with gaps at the stairs).
    const rails: Array<[number, number, number, number]> = [
      [-20, 20, 13.1, 13.1],
      [16.45, 16.45, 13, 30],
      [16.45, 16.45, 36, 61],
      [-16.45, -16.45, 13, 30],
      [-16.45, -16.45, 36, 61],
      [-16.5, 16.5, 61.1, 61.1],
    ];
    const railMat = mat(0xd8a020, 0, 0.4, 0.6);
    const postGeo = new THREE.BoxGeometry(0.07, 1.05, 0.07);
    for (const [x0, x1, z0, z1] of rails) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.round(len / 2));
      for (let i = 0; i <= n; i++) {
        const p = new THREE.Mesh(postGeo, railMat);
        p.position.set(x0 + ((x1 - x0) * i) / n, CATWALK_Y + 0.52, z0 + ((z1 - z0) * i) / n);
        this.group.add(p);
      }
      for (const h of [0.55, 1.05]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0) || 0.05, 0.05, Math.abs(z1 - z0) || 0.05), railMat);
        r.position.set((x0 + x1) / 2, CATWALK_Y + h, (z0 + z1) / 2);
        this.group.add(r);
      }
      this.e.solid((x0 + x1) / 2, CATWALK_Y + 0.55, (z0 + z1) / 2, Math.abs(x1 - x0) / 2 + 0.05, 0.55, Math.abs(z1 - z0) / 2 + 0.05);
    }
    // Supports down to the floor.
    const supports: Array<[number, number]> = [];
    for (const x of [-18, 18]) for (let z = 20; z <= 60; z += 10) supports.push([x, z]);
    for (const x of [-12, -4, 4, 12]) supports.push([x, 12.6]);
    for (const x of [-12, 12]) supports.push([x, 62.5]);
    for (const [x, z] of supports) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, CATWALK_Y - FLOOR_Y, 0.5), surface('wall', 0.5, 9));
      s.position.set(x, (CATWALK_Y + FLOOR_Y) / 2, z);
      this.group.add(s);
      this.e.solid(x, (CATWALK_Y + FLOOR_Y) / 2, z, 0.25, (CATWALK_Y - FLOOR_Y) / 2, 0.25);
      this.blockers.push({ x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3 });
    }
    // Stairs from the long catwalks down to the floor.
    for (const side of [-1, 1]) {
      const steps = 14;
      for (let i = 0; i < steps; i++) {
        const top = CATWALK_Y - 0.1 - ((i + 1) * (CATWALK_Y - FLOOR_Y - 0.1)) / steps;
        const x0 = side > 0 ? 13.5 : -16.5;
        const x1 = side > 0 ? 16.5 : -13.5;
        const z0 = 30 + i * 0.4;
        const stepMesh = slab('grate', x1 - x0, top - FLOOR_Y, 0.4, 0xffffff);
        stepMesh.position.set((x0 + x1) / 2, (top + FLOOR_Y) / 2, z0 + 0.2);
        this.group.add(stepMesh);
        this.e.solid((x0 + x1) / 2, (top + FLOOR_Y) / 2, z0 + 0.2, (x1 - x0) / 2, (top - FLOOR_Y) / 2, 0.2);
      }
    }
    // The lobby window's deck is the first thing you land on: a hazard strip marks the edge.
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(40, 0.6), surface('hazard', 40, 0.6));
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, CATWALK_Y + 0.01, 12.6);
    this.group.add(strip);
  }

  crate(x: number, z: number, w: number, h: number, d: number, color: number, blocks = true): void {
    const m = slab('wall', w, h, d, color);
    m.position.set(x, FLOOR_Y + h / 2, z);
    m.rotation.y = 0;
    this.group.add(m);
    this.e.solid(x, FLOOR_Y + h / 2, z, w / 2, h / 2, d / 2);
    if (blocks) {
      this.blockers.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
      this.nav.setBlock(0, x - w / 2, x + w / 2, z - d / 2, z + d / 2, false);
    }
  }

  private buildCargo(): void {
    // Great columns.
    for (const x of [-8, 8]) {
      for (const z of [26, 42, 58]) {
        const col = slab('wall', 2, HALL_TOP - FLOOR_Y, 2);
        col.position.set(x, (HALL_TOP + FLOOR_Y) / 2, z);
        this.group.add(col);
        this.e.solid(x, (HALL_TOP + FLOOR_Y) / 2, z, 1, (HALL_TOP - FLOOR_Y) / 2, 1);
        const band = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1, 2.1), surface('hazard', 2, 1));
        band.position.set(x, FLOOR_Y + 0.5, z);
        this.group.add(band);
        this.blockers.push({ x0: x - 1, x1: x + 1, z0: z - 1, z1: z + 1 });
        this.nav.setBlock(0, x - 1, x + 1, z - 1, z + 1, false);
      }
    }
    // The reactor in the middle: a block with tanks and pipes.
    const reactor = slab('wall', 10, 5, 12, 0x8a92a0);
    reactor.position.set(0, FLOOR_Y + 2.5, 40);
    this.group.add(reactor);
    this.e.solid(0, FLOOR_Y + 2.5, 40, 5, 2.5, 6);
    this.blockers.push({ x0: -5, x1: 5, z0: 34, z1: 46 });
    this.nav.setBlock(0, -5, 5, 34, 46, false);
    for (const [x, z] of [[-3, 37], [3, 37], [-3, 43], [3, 43]]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 4.2, 16), mat(0x707a86, 0, 0.35, 0.7));
      tank.position.set(x, FLOOR_Y + 7, z);
      this.group.add(tank);
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.22, 0.3, 16), new THREE.MeshBasicMaterial({ color: 0x40ff90 }));
      glow.position.set(x, FLOOR_Y + 7.6, z);
      this.group.add(glow);
    }
    const core = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 9, 14), new THREE.MeshStandardMaterial({ color: 0x205840, emissive: 0x20ff80, emissiveIntensity: 0.9, transparent: true, opacity: 0.8 }));
    core.position.set(0, FLOOR_Y + 5, 40);
    this.group.add(core);
    dyn(core);
    (this as unknown as { core: THREE.Mesh }).core = core;
    // Shipping containers and crates.
    const boxes: Array<[number, number, number, number, number, number]> = [
      [-13, 22, 5, 2.6, 2.4, 0x3a5a7a],
      [14, 52, 2.4, 2.4, 6, 0x7a3a2a],
      [-14, 49, 2.4, 2.4, 6, 0x3a6a4a],
      [13, 18, 2, 1.6, 2, 0x5a5a60],
      [-4, 24, 2, 2, 2, 0x5a4a30],
      [5, 60, 3, 1.5, 2, 0x4a5a5a],
      [-12, 62, 2, 2, 2, 0x5a4a30],
      [11, 31, 2, 1.4, 1.4, 0x4a4a50],
    ];
    for (const [x, z, w, h, d, c] of boxes) this.crate(x, z, w, h, d, c);
    // Barrels and debris.
    for (let i = 0; i < 18; i++) {
      const x = (Math.random() - 0.5) * 36;
      const z = 15 + Math.random() * 48;
      if (this.nearBlocker(x, z, 1.2) || Math.abs(x) > 18.5) continue;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.0, 12), mat([0xb02020, 0x2060b0, 0xe0b020, 0x607060][i % 4], 0, 0.5, 0.4));
      b.position.set(x, FLOOR_Y + 0.5, z);
      this.group.add(b);
      this.e.solid(x, FLOOR_Y + 0.5, z, 0.4, 0.5, 0.4);
      this.blockers.push({ x0: x - 0.4, x1: x + 0.4, z0: z - 0.4, z1: z + 0.4 });
    }
    // Pipes and cables along the ceiling and walls.
    for (let i = 0; i < 8; i++) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 60, 10).rotateX(Math.PI / 2), mat(0x5a626c, 0, 0.4, 0.7));
      pipe.position.set(-18 + i * 5, HALL_TOP - 0.8 - (i % 3) * 0.4, 37);
      this.group.add(pipe);
    }
    for (let z = 10; z < 66; z += 6) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(40, 0.5, 0.6), mat(0x30343a, 0, 0.6, 0.5));
      beam.position.set(0, HALL_TOP - 0.3, z);
      this.group.add(beam);
    }
    // Gear: things lie about the hall and the catwalk.
    for (const [x, z] of [[-12, 28], [12, 36], [-10, 52], [10, 56], [0, 22], [0, 60]]) this.gearSpots.push(new THREE.Vector3(x, FLOOR_Y + 0.05, z));
    for (const [x, z] of [[-16, 20], [16, 48], [0, 62.5]]) this.gearSpots.push(new THREE.Vector3(x, CATWALK_Y + 0.05, z));
    // Where monsters wake.
    this.spawns.push(new THREE.Vector3(-12, FLOOR_Y, 50), new THREE.Vector3(12, FLOOR_Y, 56), new THREE.Vector3(0, FLOOR_Y, 62), new THREE.Vector3(29, FLOOR_Y, 56), new THREE.Vector3(-29, FLOOR_Y, 44));
  }

  /** Everything in the facility that moves or blinks. */
  update(dt: number, time: number): void {
    this.pulse(time);
    this.dressing.update(dt, time);
  }

  /** Spins the reactor glow. */
  pulse(time: number): void {
    const core = (this as unknown as { core?: THREE.Mesh }).core;
    if (core) (core.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7 + 0.3 * Math.sin(time * 2);
  }

  private nearBlocker(x: number, z: number, pad: number): boolean {
    return this.blockers.some((r) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad);
  }

  private buildExit(): void {
    this.exitDoor = new Door(this.e, this.doors.length, 'EXIT', new THREE.Vector3(0, FLOOR_Y, 67.2), -1, 'x');
    this.exitDoor.setLocked(true);
    this.exitDoor.onSlam = (d) => this.onDoorSlam?.(d);
    this.doors.push(this.exitDoor);
    // The lift behind it.
    const c = this.cabin;
    this.block('wall', -2.6, 2.6, FLOOR_Y, FLOOR_Y + 4.5, 71.9, 72.3);
    this.block('wall', -2.6, -2.4, FLOOR_Y, FLOOR_Y + 4.5, 67.4, 72);
    this.block('wall', 2.4, 2.6, FLOOR_Y, FLOOR_Y + 4.5, 67.4, 72);
    this.block('ceiling', -2.6, 2.6, FLOOR_Y + 4.5, FLOOR_Y + 4.8, 67.4, 72.3, false);
    this.lamp(new THREE.Vector3(0, FLOOR_Y + 4.3, c.z), 0xffffff, 1.2);
    this.evacuate = this.e.panels.add(new WorldButton(this.e.scene, 'EVACUATE', 1.6, 0.4, '#2d7a3a', () => this.onEvacuate?.()));
    this.evacuate.mesh.position.set(0, FLOOR_Y + 1.4, 71.7);
    this.evacuate.mesh.rotation.y = Math.PI;
    this.evacuate.enabled = false;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.6), new THREE.MeshBasicMaterial({ map: this.labelTexture('EXIT LIFT', '#60ff90'), transparent: true }));
    sign.position.set(0, FLOOR_Y + 3.4, 66.6);
    sign.rotation.y = Math.PI;
    this.group.add(sign);
    this.blockers.push({ x0: -3, x1: 3, z0: 67.1, z1: 73 });
  }

  onEvacuate: (() => void) | null = null;

  /** A ceiling lamp: an emissive panel that can flicker. */
  lamp(pos: THREE.Vector3, color: number, size = 1): Fixture {
    const mesh = dyn(new THREE.Mesh(new THREE.BoxGeometry(1.4 * size, 0.1, 0.5 * size), new THREE.MeshBasicMaterial({ color, fog: false })));
    mesh.position.copy(pos);
    this.group.add(mesh);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(1.5 * size, 0.06, 0.62 * size), mat(0x101214));
    housing.position.copy(pos).y += 0.07;
    this.group.add(housing);
    const f: Fixture = { pos: pos.clone(), mesh, phase: Math.random() * 20, base: new THREE.Color(color) };
    this.fixtures.push(f);
    return f;
  }

  private buildLights(): void {
    for (let z = 14; z <= 62; z += 12) for (const x of [-11, 11]) this.lamp(new THREE.Vector3(x, HALL_TOP - 1.2, z), 0xcfe6ff, 1.6);
    for (const [x, z] of [[0, 28], [0, 54]]) this.lamp(new THREE.Vector3(x, HALL_TOP - 1.2, z), 0xcfe6ff, 1.6);
    for (const z of [18, 40, 58]) for (const x of [-18, 18]) this.lamp(new THREE.Vector3(x, CATWALK_Y + 2.6, z), 0xffe6b0, 0.7);
    this.lamp(new THREE.Vector3(0, CATWALK_Y + 3, 10), 0xcfe6ff, 1.4);
  }


  /** The look of a working warehouse: forklifts, shelves of crates, pallets, pipes, roller shutters, hazard frames round the doors. */
  private buildProps(): void {
    // Forklifts parked about the hall (solid, and in the way).
    for (const [x, z, yaw] of [[-13, 28, 0.5], [12.5, 52, -2.4], [-6, 16, 3.1]] as Array<[number, number, number]>) {
      const f = forklift();
      f.position.set(x, FLOOR_Y, z);
      f.rotation.y = yaw;
      this.group.add(f);
      this.e.solid(x, FLOOR_Y + 1.0, z, 0.9, 1.0, 1.1);
      this.blockers.push({ x0: x - 1, x1: x + 1, z0: z - 1.2, z1: z + 1.2 });
      this.nav.setBlock(0, x - 1, x + 1, z - 1.2, z + 1.2, false);
    }
    // Shelves of crates against the long walls, between the doors.
    for (const side of [-1, 1]) {
      for (const z of [28.9, 41.1, 52.6]) {
        const sh = shelves(2.4, 2.8, 0.8, 3, true);
        sh.position.set(side * 19.45, FLOOR_Y, z);
        sh.rotation.y = Math.PI / 2;
        this.group.add(sh);
        this.e.solid(side * 19.45, FLOOR_Y + 1.4, z, 0.45, 1.4, 1.25);
        this.nav.setBlock(0, side * 19.45 - 0.5, side * 19.45 + 0.5, z - 1.25, z + 1.25, false);
      }
    }
    for (const x of [-15, -10, 10, 15]) {
      const sh = shelves(2.6, 3.0, 0.8, 3, true);
      sh.position.set(x, FLOOR_Y, 66.45);
      this.group.add(sh);
      this.e.solid(x, FLOOR_Y + 1.5, 66.45, 1.3, 1.5, 0.45);
      this.nav.setBlock(0, x - 1.3, x + 1.3, 65.9, 67, false);
    }
    // Pallets, barrels.
    for (const [x, z, n] of [[-3, 14, 2], [4, 20, 3], [-17, 56, 2], [16.4, 22, 2], [0, 61, 2]] as Array<[number, number, number]>) {
      const p = pallet(n);
      p.position.set(x, FLOOR_Y, z);
      p.rotation.y = Math.random() * 0.6;
      this.group.add(p);
      this.e.solid(x, FLOOR_Y + 0.3 * n + 0.1, z, 0.6, 0.3 * n + 0.1, 0.5);
      this.blockers.push({ x0: x - 0.7, x1: x + 0.7, z0: z - 0.6, z1: z + 0.6 });
      this.nav.setBlock(0, x - 0.7, x + 0.7, z - 0.6, z + 0.6, false);
    }
    for (const [x, z, c] of [[-18, 12, 0x2a4a9a], [-17.4, 12.8, 0xb02a20], [18, 62, 0xe0b020], [17.3, 62.8, 0x2a5a30]] as Array<[number, number, number]>) {
      const b = barrel(c);
      b.position.set(x, FLOOR_Y, z);
      this.group.add(b);
      this.e.solid(x, FLOOR_Y + 0.45, z, 0.3, 0.45, 0.3);
    }
    // Pipes along the long walls (rust, blue, red) and a vertical one up each corner.
    const runs: Array<[number, number, number]> = [[3.4, 0.24, 0x8a4a2a], [2.7, 0.18, 0x2a3a8a], [4.1, 0.14, 0xb02a20]];
    for (const side of [-1, 1]) {
      for (const [y, r, c] of runs) this.group.add(pipe(new THREE.Vector3(side * 19.5, y, 8), new THREE.Vector3(side * 19.5, y, side > 0 ? 62 : 66), r, c));
      this.group.add(pipe(new THREE.Vector3(side * 19.2, FLOOR_Y, 9.5), new THREE.Vector3(side * 19.2, HALL_TOP, 9.5), 0.22, 0xb02a20));
    }
    // Roller shutters on the north wall below the catwalk, and hazard frames round every room door.
    for (const x of [-12, 12]) {
      const sh = shutter(3.6, 3.4);
      sh.position.set(x, FLOOR_Y, 7.06);
      sh.position.z = 7.06;
      this.group.add(sh);
    }
    for (const side of [-1, 1]) {
      for (const dz of ROOM_Z) {
        const frame = hazardFrame(3.0, 3.6);
        frame.position.set(side * 19.75, FLOOR_Y, dz);
        frame.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        this.group.add(frame);
      }
    }
  }

  private buildNav(): void {
    const nav = this.nav;
    // Floor level: the hall, and a room behind each door.
    nav.setBlock(0, -20, 20, 7, 67, true);
    for (const side of [-1, 1]) {
      for (const zc of ROOM_Z) {
        const x0 = side > 0 ? 20 : -30;
        const x1 = side > 0 ? 30 : -20;
        nav.setBlock(0, x0, x1, zc - ROOM_HALF, zc + ROOM_HALF, true);
      }
    }
    // Walls between the hall and the rooms, except at the doors.
    for (const side of [-1, 1]) {
      const ixHall = colOf(side > 0 ? 19 : -19);
      const ixRoom = colOf(side > 0 ? 21 : -21);
      for (let iz = 0; iz < 30; iz++) {
        const key = `0:${Math.min(ixHall, ixRoom)}:${iz}`;
        nav.wallEdges.add(key);
      }
    }
    this.doors.forEach((d) => {
      if (d === this.exitDoor) return;
      const iz = rowOf(d.center.z);
      const side = d.center.x > 0 ? 1 : -1;
      const ixHall = colOf(side > 0 ? 19 : -19);
      const ixRoom = colOf(side > 0 ? 21 : -21);
      const key = `0:${Math.min(ixHall, ixRoom)}:${iz}`;
      nav.wallEdges.delete(key);
      nav.doorEdges.set(key, d);
    });
    // Catwalk level.
    nav.setBlock(1, -20, 20, 7, 13, true);
    nav.setBlock(1, 16.5, 20, 13, 64, true);
    nav.setBlock(1, -20, -16.5, 13, 64, true);
    nav.setBlock(1, -20, 20, 61, 64, true);
    // The stairs link the long catwalks to the floor. Under them is solid.
    for (const side of [-1, 1]) {
      // (Only the cells the steps really fill: a gap stays between them and the wall.)
      nav.setBlock(0, side > 0 ? 13.5 : -15.9, side > 0 ? 15.9 : -13.5, 29, 36, false);
      const top = nav.linkIndex(1, colOf(side * 17.5), rowOf(29.5));
      const bottom = nav.linkIndex(0, colOf(side * 15), rowOf(37));
      nav.links.push({ a: top, b: bottom });
    }
    // Make sure the link cells are open.
    for (const side of [-1, 1]) {
      nav.open[1][nav.idx(colOf(side * 17.5), rowOf(29.5))] = true;
      nav.open[0][nav.idx(colOf(side * 15), rowOf(37))] = true;
    }
  }

  // --- Queries --------------------------------------------------------------------------------------------------------

  /** Which size of space is this point in, for the echo? */
  zoneAt(p: THREE.Vector3): Zone {
    if (p.y > -1.5 && p.z < 7) return 'lobby';
    if (Math.abs(p.x) > 20.2 && p.y < -9) return 'room';
    if (p.z > 67.3) return 'room';
    return 'hall';
  }

  /** The height of the ground under a point (for things that fall). */
  floorAt(x: number, y: number, z: number): number {
    if (z < 7 && x > -24.4 && x < 9 && y > -1) return 0;
    if (y > CATWALK_Y - 0.4) {
      const onDeck = (z >= 7 && z <= 13 && Math.abs(x) <= 20) || (z >= 13 && z <= 64 && Math.abs(x) >= 16.5 && Math.abs(x) <= 20) || (z >= 61 && z <= 64 && Math.abs(x) <= 20);
      if (onDeck) return CATWALK_Y;
    }
    return FLOOR_Y;
  }

  /** Is there a clear line between two floor positions (walls, columns, cargo and shut doors block it)? */
  clear(ax: number, az: number, bx: number, bz: number): boolean {
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.6);
    for (let i = 1; i < steps; i++) {
      const x = ax + ((bx - ax) * i) / steps;
      const z = az + ((bz - az) * i) / steps;
      for (const r of this.blockers) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) {
        // A doorway that is open is not a wall.
        const door = this.doors.find((d) => d.passable && Math.abs(d.center.x - x) < 0.6 && Math.abs(d.center.z - z) < DOOR_W / 2);
        if (door) continue;
        if (r.x1 - r.x0 < 1 && Math.abs(Math.abs(x) - 20) < 0.5 && this.doors.some((d) => d.passable && Math.abs(d.center.z - z) < DOOR_W / 2)) continue;
        return false;
      }
    }
    return true;
  }

  /** Cell centre helpers for monsters. */
  static cell = { cellX, cellZ };

  /** A place on the hall floor that is open, far from `from`. */
  randomSpot(): THREE.Vector3 {
    for (let i = 0; i < 30; i++) {
      const ix = Math.floor(Math.random() * 30);
      const iz = Math.floor(Math.random() * 30);
      if (this.nav.open[0][this.nav.idx(ix, iz)]) return _tmp.set(cellX(ix), FLOOR_Y, cellZ(iz)).clone();
    }
    return new THREE.Vector3(0, FLOOR_Y, 30);
  }
}
