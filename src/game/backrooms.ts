import * as THREE from 'three';
import type { Zone } from '../audio';
import { WorldButton } from '../ui/panel';
import { batchStatic } from './batch';
import { Door, DOOR_H, DOOR_W } from './doors';
import type { Engine } from './engine';
import { CATWALK_Y, FLOOR_Y, Nav, colOf, rowOf } from './nav';
import { barrel, hazardFrame, pallet, shelves } from './props';
import { box, cyl, dyn, mat, part, sphere } from './shapes';
import { slab, surface } from './textures';

/** The Backrooms, Level 0: a maze of mono-yellow rooms on damp carpet under a drop ceiling of buzzing lights. */
export const N = 15;
export const PITCH = 4;
export const MX0 = -30;
export const MZ0 = 7;
export const WALL_T = 0.3;
export const CEIL = FLOOR_Y + 3.8;
export const PIT_DEPTH = 6;

/** What is on the edge between two rooms. */
const OPEN = 0;
const WALL = 1;
const DOOR = 2;
const TIGHT = 3;
const HOLE = 4;

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

interface CellRect {
  c0: number;
  c1: number;
  r0: number;
  r1: number;
}

/** A recessed ceiling light panel: steady, flickering, or dead. */
interface Panel {
  pos: THREE.Vector3;
  state: 0 | 1 | 2;
  phase: number;
  k: number;
  index: number;
}

export interface NearLight {
  pos: THREE.Vector3;
  k: number;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cellX = (cx: number): number => MX0 + cx * PITCH + PITCH / 2;
const cellZ = (cz: number): number => MZ0 + cz * PITCH + PITCH / 2;
const inCells = (r: CellRect, cx: number, cz: number): boolean => cx >= r.c0 && cx <= r.c1 && cz >= r.r0 && cz <= r.r1;

const ATRIUM: CellRect = { c0: 3, c1: 11, r0: 0, r1: 2 };
const PITS: CellRect = { c0: 0, c1: 2, r0: 0, r1: 4 };
const SERVER: CellRect = { c0: 12, c1: 14, r0: 9, r1: 12 };
const FLOOD_ROW = 7;
const FLOOD: CellRect = { c0: 3, c1: 14, r0: FLOOD_ROW, r1: FLOOD_ROW };

const _q = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _c = new THREE.Color();

export class Facility {
  readonly nav = new Nav();
  readonly doors: Door[] = [];
  readonly fixtures: Fixture[] = [];
  readonly relays: Relay[] = [];
  readonly blockers: Rect[] = [];
  exitDoor!: Door;
  readonly cabin = new THREE.Vector3(0, FLOOR_Y, 70);
  evacuate!: WorldButton;
  readonly group = new THREE.Group();
  readonly spawns: THREE.Vector3[] = [];
  readonly gearSpots: THREE.Vector3[] = [];
  readonly logSpots: THREE.Vector3[] = [];
  readonly lockerSpots: Array<{ x: number; z: number; facing: 1 | -1 }> = [];
  /** The wall lines, for the security map: x0, z0, x1, z1. */
  readonly segments: Array<[number, number, number, number]> = [];
  readonly water: Rect = { x0: MX0 + 3 * PITCH, x1: MX0 + 15 * PITCH, z0: MZ0 + FLOOD_ROW * PITCH, z1: MZ0 + (FLOOD_ROW + 1) * PITCH };
  readonly pits: Rect[] = [];
  /** How dark and how red it is (set by the game for blackouts and lockdowns). */
  blackout = false;
  redness = 0;
  onDoorSlam: ((d: Door) => void) | null = null;
  onRelay: ((r: Relay) => void) | null = null;
  onEvacuate: (() => void) | null = null;

  private readonly rand = rng(1971);
  private readonly V: number[][] = Array.from({ length: N }, () => new Array(N).fill(WALL));
  private readonly H: number[][] = Array.from({ length: N }, () => new Array(N).fill(WALL));
  private readonly panels: Panel[] = [];
  private panelMesh!: THREE.InstancedMesh;
  private reflectMesh!: THREE.InstancedMesh;
  private reflectIndex: number[] = [];
  private panelTimer = 0;
  private waterMat!: THREE.MeshLambertMaterial;
  private readonly leds: Array<{ index: number; rate: number; phase: number; on: THREE.Color }> = [];
  private ledMesh: THREE.InstancedMesh | null = null;
  private readonly screens: Array<{ tick: (t: number) => void; last: number }> = [];
  private ventTimer = 6;
  private core: THREE.Mesh | null = null;

  constructor(private readonly e: Engine) {
    e.scene.add(this.group);
    this.generate();
    this.buildFloorAndPits();
    this.buildWalls();
    this.buildCeiling();
    this.buildGantry();
    this.buildFurniture();
    this.buildLandmarks();
    this.buildExit();
    this.buildNavData();
    this.pickSpots();
    batchStatic(this.group);
  }

  // --- The maze ---------------------------------------------------------------------------------------------------------------

  private generate(): void {
    const { V, H, rand } = this;
    // A random spanning tree of rooms (recursive backtracker).
    const seen = Array.from({ length: N }, () => new Array(N).fill(false));
    const stack: Array<[number, number]> = [[7, 5]];
    seen[7][5] = true;
    while (stack.length) {
      const [cx, cz] = stack[stack.length - 1];
      const options: Array<[number, number, () => void]> = [];
      if (cx > 0 && !seen[cx - 1][cz]) options.push([cx - 1, cz, () => (V[cx - 1][cz] = OPEN)]);
      if (cx < N - 1 && !seen[cx + 1][cz]) options.push([cx + 1, cz, () => (V[cx][cz] = OPEN)]);
      if (cz > 0 && !seen[cx][cz - 1]) options.push([cx, cz - 1, () => (H[cx][cz - 1] = OPEN)]);
      if (cz < N - 1 && !seen[cx][cz + 1]) options.push([cx, cz + 1, () => (H[cx][cz] = OPEN)]);
      if (!options.length) {
        stack.pop();
        continue;
      }
      const [nx, nz, carve] = options[Math.floor(rand() * options.length)];
      carve();
      seen[nx][nz] = true;
      stack.push([nx, nz]);
    }
    // Loops, so there is always another way round.
    for (let cx = 0; cx < N; cx++) {
      for (let cz = 0; cz < N; cz++) {
        if (cx < N - 1 && V[cx][cz] === WALL && rand() < 0.14) V[cx][cz] = OPEN;
        if (cz < N - 1 && H[cx][cz] === WALL && rand() < 0.14) H[cx][cz] = OPEN;
      }
    }
    // Landmarks are open rooms inside.
    for (const r of [ATRIUM, PITS, SERVER]) {
      for (let cx = r.c0; cx <= r.c1; cx++) {
        for (let cz = r.r0; cz <= r.r1; cz++) {
          if (cx < r.c1) V[cx][cz] = OPEN;
          if (cz < r.r1) H[cx][cz] = OPEN;
        }
      }
    }
    // The flooded hallway: a straight corridor with a wall on each side and a few ways out.
    for (let cx = FLOOD.c0; cx <= FLOOD.c1; cx++) {
      if (cx < FLOOD.c1) V[cx][FLOOD_ROW] = OPEN;
      H[cx][FLOOD_ROW - 1] = [5, 9, 13].includes(cx) ? OPEN : WALL;
      H[cx][FLOOD_ROW] = [4, 8, 12].includes(cx) ? OPEN : WALL;
    }
    // Boundaries of the landmarks and their doors.
    for (let cx = ATRIUM.c0; cx <= ATRIUM.c1; cx++) H[cx][ATRIUM.r1] = [4, 10].includes(cx) ? OPEN : cx === 7 ? DOOR : WALL;
    for (let cz = ATRIUM.r0; cz <= ATRIUM.r1; cz++) {
      V[PITS.c1][cz] = cz === 1 ? OPEN : WALL;
      V[ATRIUM.c1][cz] = cz === 1 ? OPEN : WALL;
    }
    for (let cx = PITS.c0; cx <= PITS.c1; cx++) H[cx][PITS.r1] = cx === 1 ? DOOR : WALL;
    for (let cz = SERVER.r0; cz <= SERVER.r1; cz++) V[SERVER.c0 - 1][cz] = cz === 10 ? DOOR : WALL;
    for (let cx = SERVER.c0; cx <= SERVER.c1; cx++) H[cx][SERVER.r0 - 1] = cx === 13 ? TIGHT : WALL;
    V[2][FLOOD_ROW] = DOOR;
    H[7][13] = OPEN;
    // Make sure every room can be reached from the atrium.
    const reach = (): boolean[][] => {
      const got = Array.from({ length: N }, () => new Array(N).fill(false));
      const q: Array<[number, number]> = [[7, 1]];
      got[7][1] = true;
      while (q.length) {
        const [cx, cz] = q.pop()!;
        const go = (nx: number, nz: number, t: number): void => {
          if (nx < 0 || nz < 0 || nx >= N || nz >= N || got[nx][nz] || t === WALL) return;
          got[nx][nz] = true;
          q.push([nx, nz]);
        };
        go(cx + 1, cz, cx < N - 1 ? V[cx][cz] : WALL);
        go(cx - 1, cz, cx > 0 ? V[cx - 1][cz] : WALL);
        go(cx, cz + 1, cz < N - 1 ? H[cx][cz] : WALL);
        go(cx, cz - 1, cz > 0 ? H[cx][cz - 1] : WALL);
      }
      return got;
    };
    for (let guard = 0; guard < 400; guard++) {
      const got = reach();
      let fixed = false;
      for (let cx = 0; cx < N && !fixed; cx++) {
        for (let cz = 0; cz < N && !fixed; cz++) {
          if (got[cx][cz]) continue;
          // Knock a wall through to a room that is reachable.
          if (cx > 0 && got[cx - 1][cz] && V[cx - 1][cz] === WALL) V[cx - 1][cz] = OPEN;
          else if (cx < N - 1 && got[cx + 1][cz] && V[cx][cz] === WALL) V[cx][cz] = OPEN;
          else if (cz > 0 && got[cx][cz - 1] && H[cx][cz - 1] === WALL) H[cx][cz - 1] = OPEN;
          else if (cz < N - 1 && got[cx][cz + 1] && H[cx][cz] === WALL) H[cx][cz] = OPEN;
          else continue;
          fixed = true;
        }
      }
      if (!fixed) break;
    }
    // Heavy doors in open passages, tight gaps and drywall holes in walls.
    const reserved = (cx: number, cz: number): boolean => inCells(ATRIUM, cx, cz) || inCells(PITS, cx, cz) || inCells(SERVER, cx, cz) || inCells(FLOOD, cx, cz) || (cx === 7 && cz >= 13);
    const doorSpots: Array<[number, number]> = [];
    const open: Array<['v' | 'h', number, number]> = [];
    const walls: Array<['v' | 'h', number, number]> = [];
    for (let cx = 0; cx < N; cx++) {
      for (let cz = 0; cz < N; cz++) {
        if (reserved(cx, cz)) continue;
        if (cx < N - 1 && !reserved(cx + 1, cz)) (V[cx][cz] === OPEN ? open : V[cx][cz] === WALL ? walls : []).push(['v', cx, cz]);
        if (cz < N - 1 && !reserved(cx, cz + 1)) (H[cx][cz] === OPEN ? open : H[cx][cz] === WALL ? walls : []).push(['h', cx, cz]);
      }
    }
    const shuffle = <T,>(a: T[]): T[] => a.map((v) => [rand(), v] as const).sort((x, y) => x[0] - y[0]).map((p) => p[1]);
    let doors = 0;
    for (const [o, cx, cz] of shuffle(open)) {
      if (doors >= 9) break;
      if (doorSpots.some(([a, b]) => Math.abs(a - cx) + Math.abs(b - cz) < 4)) continue;
      (o === 'v' ? V : H)[cx][cz] = DOOR;
      doorSpots.push([cx, cz]);
      doors++;
    }
    let tight = 0;
    let holes = 0;
    for (const [o, cx, cz] of shuffle(walls)) {
      const arr = o === 'v' ? V : H;
      if (arr[cx][cz] !== WALL) continue;
      if (tight < 12) {
        arr[cx][cz] = TIGHT;
        tight++;
      } else if (holes < 16) {
        arr[cx][cz] = HOLE;
        holes++;
      } else break;
    }
  }

  // --- Floor, pits and water ------------------------------------------------------------------------------------------------

  private slab(kind: 'wallpaper' | 'carpet' | 'tile' | 'concrete' | 'grate' | 'hazard' | 'wall' | 'ceiling' | 'floor' | 'door', x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, collide = true, tint = 0xffffff): THREE.Mesh | null {
    if (x1 - x0 < 0.001 || z1 - z0 < 0.001 || y1 - y0 < 0.001) return null;
    const m = slab(kind, x1 - x0, y1 - y0, z1 - z0, tint);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.group.add(m);
    if (collide) this.e.solid((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2);
    return m;
  }

  private buildFloorAndPits(): void {
    const X1 = MX0 + N * PITCH;
    const Z1 = MZ0 + N * PITCH;
    // Carpet everywhere except the Pitfalls room, which is a lattice of narrow walkways over square drops.
    const px0 = MX0;
    const px1 = MX0 + (PITS.c1 + 1) * PITCH;
    const pz0 = MZ0;
    const pz1 = MZ0 + (PITS.r1 + 1) * PITCH;
    this.slab('carpet', px1, X1, FLOOR_Y - 0.6, FLOOR_Y, MZ0, Z1);
    this.slab('carpet', px0, px1, FLOOR_Y - 0.6, FLOOR_Y, pz1, Z1);
    // The lattice: holes 2.4 m square on a 3.6 m pitch.
    const xs: Array<[number, number]> = [];
    const zs: Array<[number, number]> = [];
    for (let i = 0; i < 3; i++) xs.push([px0 + 1.2 + i * 3.6, px0 + 3.6 + i * 3.6]);
    for (let j = 0; j < 5; j++) zs.push([pz0 + 1.2 + j * 3.6, pz0 + 3.6 + j * 3.6]);
    // Walkways: full-length strips between and around the holes, then the short pieces between holes in a row.
    const xEdges = [px0, ...xs.flat(), px1];
    const zEdges = [pz0, ...zs.flat(), pz1];
    for (let i = 0; i < xEdges.length - 1; i += 2) this.slab('carpet', xEdges[i], xEdges[i + 1], FLOOR_Y - 0.6, FLOOR_Y, pz0, pz1); // columns of walkway
    for (let j = 0; j < zEdges.length - 1; j += 2) {
      for (let i = 1; i < xEdges.length - 1; i += 2) this.slab('carpet', xEdges[i], xEdges[i + 1], FLOOR_Y - 0.6, FLOOR_Y, zEdges[j], zEdges[j + 1]);
    }
    for (const [hx0, hx1] of xs) {
      for (const [hz0, hz1] of zs) {
        this.pits.push({ x0: hx0, x1: hx1, z0: hz0, z1: hz1 });
        const bottom = FLOOR_Y - PIT_DEPTH;
        this.slab('concrete', hx0, hx1, bottom - 0.5, bottom, hz0, hz1);
        for (const [a0, a1, b0, b1] of [[hx0 - 0.05, hx0, hz0, hz1], [hx1, hx1 + 0.05, hz0, hz1], [hx0, hx1, hz0 - 0.05, hz0], [hx0, hx1, hz1, hz1 + 0.05]]) this.slab('concrete', a0, a1, bottom, FLOOR_Y - 0.6, b0, b1);
      }
    }
    // A caution line round the Pitfalls room, and the warning sign.
    for (const [x, z, w, d] of [[(px0 + px1) / 2, pz1 + 0.06, px1 - px0, 0.4]] as Array<[number, number, number, number]>) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w, d), surface('hazard', w, d));
      s.rotation.x = -Math.PI / 2;
      s.position.set(x, FLOOR_Y + 0.012, z);
      this.group.add(s);
    }
    // The flooded hallway.
    const w = this.water;
    this.waterMat = new THREE.MeshLambertMaterial({ color: 0x4a6a62, transparent: true, opacity: 0.58, depthWrite: false });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(w.x1 - w.x0, w.z1 - w.z0).rotateX(-Math.PI / 2), this.waterMat);
    water.position.set((w.x0 + w.x1) / 2, FLOOR_Y + 0.13, (w.z0 + w.z1) / 2);
    dyn(water);
    this.group.add(water);
    // Puddles elsewhere.
    const puddle = new THREE.MeshBasicMaterial({ color: 0x3a3a24, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    puddle.userData.batchable = true;
    for (let i = 0; i < 30; i++) {
      const x = MX0 + 2 + this.rand() * 56;
      const z = MZ0 + 2 + this.rand() * 56;
      if (x < px1 + 0.5 && z < pz1) continue;
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.4 + this.rand() * 0.9, 14).rotateX(-Math.PI / 2), puddle);
      d.position.set(x, FLOOR_Y + 0.011, z);
      this.group.add(d);
    }
  }

  // --- Walls -----------------------------------------------------------------------------------------------------------------

  private wallPiece(vertical: boolean, f: number, a0: number, a1: number, y0: number, y1: number, hx = false): void {
    if (a1 - a0 < 0.01 || y1 - y0 < 0.01) return;
    const t = WALL_T;
    const yy0 = FLOOR_Y + y0;
    const yy1 = FLOOR_Y + y1;
    if (vertical) this.slab('wallpaper', f - t / 2, f + t / 2, yy0, yy1, a0, a1);
    else this.slab('wallpaper', a0, a1, yy0, yy1, f - t / 2, f + t / 2);
    // A stained dark skirting board on both sides.
    if (y0 === 0 && !hx) {
      const sk = 0x3a2c1a;
      if (vertical) {
        this.slab('wall', f - t / 2 - 0.03, f + t / 2 + 0.03, yy0, yy0 + 0.16, a0, a1, false, sk);
      } else this.slab('wall', a0, a1, yy0, yy0 + 0.16, f - t / 2 - 0.03, f + t / 2 + 0.03, false, sk);
    }
  }

  /** One edge between rooms, of whatever type. */
  private buildEdge(vertical: boolean, cx: number, cz: number, type: number, tall = false): void {
    const f = vertical ? MX0 + (cx + 1) * PITCH : MZ0 + (cz + 1) * PITCH;
    const a0 = vertical ? MZ0 + cz * PITCH : MX0 + cx * PITCH;
    const a1 = a0 + PITCH;
    const Hh = tall ? 6.4 : 3.8;
    const h = 3.8;
    switch (type) {
      case WALL:
        this.wallPiece(vertical, f, a0 - WALL_T / 2, a1 + WALL_T / 2, 0, Hh);
        break;
      case DOOR: {
        this.wallPiece(vertical, f, a0 - WALL_T / 2, a0 + 0.5, 0, Hh);
        this.wallPiece(vertical, f, a1 - 0.5, a1 + WALL_T / 2, 0, Hh);
        this.wallPiece(vertical, f, a0 + 0.5, a1 - 0.5, DOOR_H, Hh);
        // The door itself, facing alternate ways.
        const mid = (a0 + a1) / 2;
        const centre = vertical ? new THREE.Vector3(f, FLOOR_Y, mid) : new THREE.Vector3(mid, FLOOR_Y, f);
        const facing = ((cx + cz) % 2 ? 1 : -1) as 1 | -1;
        const d = new Door(this.e, this.doors.length, `D${this.doors.length + 1}`, centre, facing, vertical ? 'z' : 'x');
        d.onSlam = (dd) => this.onDoorSlam?.(dd);
        this.doors.push(d);
        // Yellow-and-black on both faces.
        const frame = hazardFrame(DOOR_W, DOOR_H);
        frame.position.copy(centre);
        frame.position.addScaledVector(vertical ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), WALL_T / 2 + 0.07);
        frame.rotation.y = vertical ? Math.PI / 2 : 0;
        this.group.add(frame);
        const frame2 = hazardFrame(DOOR_W, DOOR_H);
        frame2.position.copy(centre);
        frame2.position.addScaledVector(vertical ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), -(WALL_T / 2 + 0.07));
        frame2.rotation.y = vertical ? -Math.PI / 2 : Math.PI;
        this.group.add(frame2);
        break;
      }
      case TIGHT: {
        // A tight gap low in the wall: a person slips through, a big thing struggles.
        this.wallPiece(vertical, f, a0 - WALL_T / 2, a0 + 0.45, 0, Hh);
        this.wallPiece(vertical, f, a0 + 1.55, a1 + WALL_T / 2, 0, Hh);
        this.wallPiece(vertical, f, a0 + 0.45, a0 + 1.55, 1.5, Hh);
        break;
      }
      case HOLE: {
        // A hole knocked through the drywall, shoulder height: climb up to it.
        this.wallPiece(vertical, f, a0 - WALL_T / 2, a1 + WALL_T / 2, 0, 1.5);
        this.wallPiece(vertical, f, a0 - WALL_T / 2, a1 + WALL_T / 2, 2.7, Hh);
        this.wallPiece(vertical, f, a0 - WALL_T / 2, a0 + 1.3, 1.5, 2.7, true);
        this.wallPiece(vertical, f, a1 - 1.3, a1 + WALL_T / 2, 1.5, 2.7, true);
        break;
      }
      default:
        break;
    }
    void h;
  }

  private buildWalls(): void {
    const X1 = MX0 + N * PITCH;
    const Z1 = MZ0 + N * PITCH;
    // Inside walls.
    for (let cx = 0; cx < N - 1; cx++) {
      for (let cz = 0; cz < N; cz++) {
        const t = this.V[cx][cz];
        const tall = inCells(ATRIUM, cx, cz) !== inCells(ATRIUM, cx + 1, cz);
        if (t !== OPEN) this.buildEdge(true, cx, cz, t, tall);
        this.recordSegment(true, cx, cz, t);
      }
    }
    for (let cx = 0; cx < N; cx++) {
      for (let cz = 0; cz < N - 1; cz++) {
        const t = this.H[cx][cz];
        const tall = inCells(ATRIUM, cx, cz) !== inCells(ATRIUM, cx, cz + 1);
        if (t !== OPEN) this.buildEdge(false, cx, cz, t, tall);
        this.recordSegment(false, cx, cz, t);
      }
    }
    // The outer walls. The west and east ones are plain; the south has the lift's gate; the north wall (under the lobby) has the window.
    for (let cz = 0; cz < N; cz++) {
      this.wallPiece(true, MX0, MZ0 + cz * PITCH - WALL_T / 2, MZ0 + (cz + 1) * PITCH + WALL_T / 2, 0, 3.8);
      this.wallPiece(true, X1, MZ0 + cz * PITCH - WALL_T / 2, MZ0 + (cz + 1) * PITCH + WALL_T / 2, 0, 3.8);
      this.segments.push([MX0, MZ0 + cz * PITCH, MX0, MZ0 + (cz + 1) * PITCH], [X1, MZ0 + cz * PITCH, X1, MZ0 + (cz + 1) * PITCH]);
    }
    for (let cx = 0; cx < N; cx++) {
      this.segments.push([MX0 + cx * PITCH, MZ0, MX0 + (cx + 1) * PITCH, MZ0]);
      if (cx === 7) {
        this.wallPiece(false, Z1, MX0 + cx * PITCH - WALL_T / 2, MX0 + cx * PITCH + 0.5, 0, 3.8);
        this.wallPiece(false, Z1, MX0 + (cx + 1) * PITCH - 0.5, MX0 + (cx + 1) * PITCH + WALL_T / 2, 0, 3.8);
        this.wallPiece(false, Z1, MX0 + cx * PITCH + 0.5, MX0 + (cx + 1) * PITCH - 0.5, DOOR_H, 3.8);
      } else this.wallPiece(false, Z1, MX0 + cx * PITCH - WALL_T / 2, MX0 + (cx + 1) * PITCH + WALL_T / 2, 0, 3.8);
      this.segments.push([MX0 + cx * PITCH, Z1, MX0 + (cx + 1) * PITCH, Z1]);
    }
    // North wall: the underside of the lobby. In the atrium it climbs to the roof, with the observation window in it.
    const wz0 = MZ0 - 0.3;
    this.slab('wallpaper', -18, 18, FLOOR_Y, 0.9, wz0 - 0.2, wz0, true);
    this.slab('wallpaper', -18, -5.5, 0.9, 6, wz0 - 0.2, wz0, true);
    this.slab('wallpaper', 5.5, 18, 0.9, 6, wz0 - 0.2, wz0, true);
    this.slab('wallpaper', -5.5, 5.5, 3.7, 6, wz0 - 0.2, wz0, true);
    // The rest of the north edge: plain wall to the ceiling.
    this.slab('wallpaper', MX0, -18, FLOOR_Y, CEIL + 0.3, wz0 - 0.2, wz0, true);
    this.slab('wallpaper', 18, X1, FLOOR_Y, CEIL + 0.3, wz0 - 0.2, wz0, true);
    // The atrium's corners are walled too.
    for (const f of [-18, 18]) this.slab('wallpaper', f - 0.15, f + 0.15, FLOOR_Y, 6, MZ0, MZ0 + 3 * PITCH, false);
  }

  private recordSegment(vertical: boolean, cx: number, cz: number, type: number): void {
    if (type === OPEN) return;
    const f = vertical ? MX0 + (cx + 1) * PITCH : MZ0 + (cz + 1) * PITCH;
    const a0 = vertical ? MZ0 + cz * PITCH : MX0 + cx * PITCH;
    if (type === DOOR) return;
    this.segments.push(vertical ? [f, a0, f, a0 + PITCH] : [a0, f, a0 + PITCH, f]);
  }

  // --- Ceiling and lights ------------------------------------------------------------------------------------------------------

  private buildCeiling(): void {
    const X1 = MX0 + N * PITCH;
    const Z1 = MZ0 + N * PITCH;
    const atrium = { x0: MX0 + ATRIUM.c0 * PITCH, x1: MX0 + (ATRIUM.c1 + 1) * PITCH, z0: MZ0, z1: MZ0 + (ATRIUM.r1 + 1) * PITCH };
    // The drop ceiling, with the atrium cut out of it (and open to a roof high above).
    this.slab('tile', MX0, X1, CEIL, CEIL + 0.3, atrium.z1, Z1);
    this.slab('tile', MX0, atrium.x0, CEIL, CEIL + 0.3, MZ0, atrium.z1);
    this.slab('tile', atrium.x1, X1, CEIL, CEIL + 0.3, MZ0, atrium.z1);
    this.slab('concrete', atrium.x0, atrium.x1, 6, 6.4, MZ0, atrium.z1, false);
    // Panels: a grid of recessed fluorescent tubes. Some hum steadily, some flicker, some are dead.
    for (let cx = 0; cx < N; cx++) {
      for (let cz = 0; cz < N; cz++) {
        if (inCells(ATRIUM, cx, cz)) continue;
        let r = this.rand();
        let dead = 0.12;
        let flick = 0.24;
        if (inCells(SERVER, cx, cz)) {
          dead = 0.55;
          flick = 0.3;
        } else if (inCells(FLOOD, cx, cz)) {
          dead = 0.05;
          flick = 0.1;
        }
        r = this.rand();
        const state = r < dead ? 2 : r < dead + flick ? 1 : 0;
        const pos = new THREE.Vector3(cellX(cx), CEIL - 0.03, cellZ(cz));
        this.panels.push({ pos, state: state as 0 | 1 | 2, phase: this.rand() * 40, k: 1, index: this.panels.length });
      }
    }
    // Three work lamps hung over the atrium on cables.
    for (const x of [-9, 0, 9]) {
      const pos = new THREE.Vector3(x, 4.8, 13);
      this.panels.push({ pos, state: 0, phase: this.rand() * 40, k: 1, index: this.panels.length });
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 5), mat(0x101012));
      cable.position.set(x, 5.4, 13);
      this.group.add(cable);
    }
    const count = this.panels.length;
    const bezelGeo = new THREE.BoxGeometry(1.32, 0.05, 0.72);
    const bezel = new THREE.InstancedMesh(bezelGeo, mat(0x6a6a62), count);
    this.panelMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.04, 0.6), new THREE.MeshBasicMaterial({ fog: false }), count);
    this.panelMesh.frustumCulled = false;
    bezel.frustumCulled = false;
    dyn(this.panelMesh);
    this.panels.forEach((p, i) => {
      _m4.compose(p.pos, _q.identity(), new THREE.Vector3(1, 1, 1));
      this.panelMesh.setMatrixAt(i, _m4);
      _m4.compose(p.pos.clone().setY(p.pos.y + 0.03), _q.identity(), new THREE.Vector3(1, 1, 1));
      bezel.setMatrixAt(i, _m4);
      this.panelMesh.setColorAt(i, _c.setRGB(1, 0.98, 0.82));
    });
    this.group.add(bezel, this.panelMesh);
    // Their reflections in the water.
    const w = this.water;
    const refl: Panel[] = this.panels.filter((p) => p.pos.x > w.x0 && p.pos.x < w.x1 && p.pos.z > w.z0 && p.pos.z < w.z1);
    this.reflectMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.1, 0.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), Math.max(1, refl.length));
    this.reflectMesh.frustumCulled = false;
    dyn(this.reflectMesh);
    refl.forEach((p, i) => {
      _m4.compose(new THREE.Vector3(p.pos.x, FLOOR_Y + 0.14, p.pos.z), _q.identity(), new THREE.Vector3(1, 1, 1));
      this.reflectMesh.setMatrixAt(i, _m4);
      this.reflectIndex[i] = p.index;
    });
    this.reflectMesh.count = refl.length;
    this.group.add(this.reflectMesh);
    this.updatePanels(0, true);
    // Pipes under the ceiling to swing along.
    const pipeMat = [mat(0x8a4a2a), mat(0x3a4a7a), mat(0x7a7a72)];
    const runs: Array<[boolean, number, number, number]> = [[true, -26, 20, 64], [true, -10, 28, 64], [true, 10, 22, 64], [true, 26, 8, 40], [false, 31, -28, 28], [false, 55, -28, 28], [false, 23, -28, 28]];
    runs.forEach(([alongZ, fixed, a, b], i) => {
      const len = Math.abs(b - a);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, len, 10), pipeMat[i % 3]);
      const y = CEIL - 0.42 - (i % 2) * 0.22;
      if (alongZ) {
        p.rotation.x = Math.PI / 2;
        p.position.set(fixed, y, (a + b) / 2);
        this.e.solid(fixed, y, (a + b) / 2, 0.12, 0.12, len / 2);
      } else {
        p.rotation.z = Math.PI / 2;
        p.position.set((a + b) / 2, y, fixed);
        this.e.solid((a + b) / 2, y, fixed, len / 2, 0.12, 0.12);
      }
      this.group.add(p);
      // Brackets.
      for (let k = 0; k <= len; k += 3) {
        const br = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.05), mat(0x222226));
        br.position.set(alongZ ? fixed : Math.min(a, b) + k, y + 0.2, alongZ ? Math.min(a, b) + k : fixed);
        this.group.add(br);
      }
    });
  }

  private updatePanels(t: number, force = false): void {
    const red = this.redness;
    for (const p of this.panels) {
      let k = 1;
      if (p.state === 2) k = 0.04;
      else if (p.state === 1) k = Math.sin(t * 29 + p.phase) * Math.sin(t * 4.3 + p.phase * 2) > 0.2 ? 0.08 : 0.95;
      else k = 0.94 + 0.06 * Math.sin(t * 90 + p.phase);
      if (this.blackout) k = 0.02;
      if (red > 0) k *= 0.5 + 0.5 * Math.abs(Math.sin(t * 5 + p.phase * 0.1));
      p.k = k;
      _c.setRGB(1, 0.98 - red * 0.8, 0.82 - red * 0.78).multiplyScalar(k);
      this.panelMesh.setColorAt(p.index, _c);
    }
    if (this.panelMesh.instanceColor) this.panelMesh.instanceColor.needsUpdate = true;
    for (let i = 0; i < this.reflectIndex.length; i++) {
      const p = this.panels[this.reflectIndex[i]];
      this.reflectMesh.setColorAt(i, _c.setRGB(1, 0.95, 0.7).multiplyScalar(p.k * 0.8));
    }
    if (this.reflectMesh.instanceColor) this.reflectMesh.instanceColor.needsUpdate = true;
    void force;
  }

  /** The `n` brightest lights close to a point, for the few real lights the game has. */
  nearestLights(p: THREE.Vector3, n: number): NearLight[] {
    const best: Array<{ d: number; panel: Panel }> = [];
    for (const panel of this.panels) {
      if (panel.k < 0.25) continue;
      const d = (panel.pos.x - p.x) ** 2 + (panel.pos.z - p.z) ** 2 + (panel.pos.y - p.y) ** 2 * 0.2;
      if (best.length < n || d < best[best.length - 1].d) {
        best.push({ d, panel });
        best.sort((a, b) => a.d - b.d);
        if (best.length > n) best.pop();
      }
    }
    return best.map((b) => ({ pos: b.panel.pos, k: b.panel.k }));
  }

  /** How near the closest live light is (for the hum). */
  nearestLive(p: THREE.Vector3): number {
    let best = Infinity;
    for (const panel of this.panels) {
      if (panel.state === 2 || this.blackout) continue;
      const d = (panel.pos.x - p.x) ** 2 + (panel.pos.z - p.z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  // --- The gantry under the window -------------------------------------------------------------------------------------------

  private buildGantry(): void {
    // A research catwalk under the observation window, with hazard stripes, and stairs down into the atrium.
    this.slab('grate', -18, 18, CATWALK_Y - 0.18, CATWALK_Y, MZ0, 12.5);
    this.slab('hazard', -18, 18, CATWALK_Y - 0.5, CATWALK_Y - 0.18, 12.4, 12.55, false);
    const rail = mat(0xd8a020);
    for (const [x0, x1] of [[-14.5, 14.5]]) {
      for (let x = x0; x <= x1 + 0.01; x += 2) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.05, 0.07), rail);
        post.position.set(x, CATWALK_Y + 0.52, 12.4);
        this.group.add(post);
      }
      for (const h of [0.55, 1.05]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.05, 0.05), rail);
        r.position.set((x0 + x1) / 2, CATWALK_Y + h, 12.4);
        this.group.add(r);
      }
      this.e.solid((x0 + x1) / 2, CATWALK_Y + 0.55, 12.4, (x1 - x0) / 2, 0.55, 0.06);
    }
    for (const x of [-12, -4, 4, 12]) {
      this.slab('concrete', x - 0.3, x + 0.3, FLOOR_Y, CATWALK_Y - 0.18, 12.0, 12.6);
    }
    for (const side of [-1, 1]) {
      const steps = 14;
      for (let i = 0; i < steps; i++) {
        const top = CATWALK_Y - 0.1 - ((i + 1) * (CATWALK_Y - FLOOR_Y - 0.1)) / steps;
        const x0 = side > 0 ? 14.5 : -17.5;
        const x1 = side > 0 ? 17.5 : -14.5;
        const z0 = 12.5 + i * 0.4;
        this.slab('grate', x0, x1, FLOOR_Y, top, z0, z0 + 0.4);
      }
    }
  }

  // --- Furniture to climb: crates, dividers, ramps ------------------------------------------------------------------------------

  private freeCell(cx: number, cz: number): boolean {
    return !inCells(PITS, cx, cz) && !inCells(SERVER, cx, cz) && !inCells(FLOOD, cx, cz) && !(cx === 7 && cz >= 12) && cz > 0;
  }

  private solidRot(x: number, y: number, z: number, hx: number, hy: number, hz: number, q: THREE.Quaternion): void {
    this.e.solidRot(x, y, z, hx, hy, hz, q);
  }

  private buildFurniture(): void {
    const crateMat = [0x9a7a48, 0x8a6a3a, 0xb09060, 0x7a6038];
    const place = (cx: number, cz: number, rot = 0): THREE.Vector3 => {
      // Crates go in the corner of a room (a quarter of it), leaving the rest of the room clear.
      const x = MX0 + cx * PITCH + 0.9;
      const z = MZ0 + cz * PITCH + 0.9;
      void rot;
      return new THREE.Vector3(x, FLOOR_Y, z);
    };
    let stacks = 0;
    let guard = 0;
    while (stacks < 22 && guard++ < 400) {
      const cx = Math.floor(this.rand() * N);
      const cz = Math.floor(this.rand() * N);
      if (!this.freeCell(cx, cz)) continue;
      const base = place(cx, cz);
      const h = 2 + Math.floor(this.rand() * 2);
      for (let i = 0; i < h; i++) {
        const w = 1.0 - i * 0.04;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.98, w), slab('wall', w, 0.98, w, crateMat[(i + cx) % 4]).material);
        const c = slab('wall', w, 0.98, w, crateMat[(i + cx + cz) % 4]);
        void m;
        c.position.set(base.x + (this.rand() - 0.5) * 0.1, FLOOR_Y + 0.5 + i, base.z + (this.rand() - 0.5) * 0.1);
        c.rotation.y = (this.rand() - 0.5) * 0.3;
        this.group.add(c);
        this.e.solid(c.position.x, c.position.y, c.position.z, w / 2 + 0.02, 0.49, w / 2 + 0.02);
      }
      this.nav.setBlock(0, MX0 + cx * PITCH, MX0 + cx * PITCH + 2, MZ0 + cz * PITCH, MZ0 + cz * PITCH + 2, false);
      this.nav.tall[0][this.nav.idx(2 * cx, 2 * cz)] = true;
      this.blockers.push({ x0: base.x - 0.6, x1: base.x + 0.6, z0: base.z - 0.6, z1: base.z + 0.6 });
      // A knocked-over office divider makes a ramp up to the first few stacks.
      if (stacks < 9) {
        const dirs = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)];
        const dir = dirs[stacks % 2];
        const L = 2.6;
        const th = h === 2 ? 0.78 : 0.95;
        const top = h * 1.0;
        const dist = top / Math.tan(th);
        const centre = new THREE.Vector3(base.x + dir.x * (0.5 + dist / 2), FLOOR_Y + top / 2, base.z + dir.z * (0.5 + dist / 2));
        const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dir.x, -dir.z) + Math.PI);
        const q = q1.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -th));
        const dm = slab('wall', 1.2, 0.08, L, 0x7a8a8a);
        dm.position.copy(centre);
        dm.quaternion.copy(q);
        this.group.add(dm);
        this.solidRot(centre.x, centre.y, centre.z, 0.6, 0.05, Math.sqrt(dist * dist + top * top) / 2, q);
      }
      stacks++;
    }
    // Office dividers still standing, in a few rooms (low cover to hide behind).
    let dividers = 0;
    guard = 0;
    while (dividers < 16 && guard++ < 300) {
      const cx = Math.floor(this.rand() * N);
      const cz = Math.floor(this.rand() * N);
      if (!this.freeCell(cx, cz) || inCells(ATRIUM, cx, cz) === false && this.rand() < 0.2) continue;
      const alongX = this.rand() < 0.5;
      const x = cellX(cx) + 0.6;
      const z = cellZ(cz) - 0.4;
      const d = slab('wall', alongX ? 2.2 : 0.1, 1.5, alongX ? 0.1 : 2.2, 0x6a8a8a);
      d.position.set(x, FLOOR_Y + 0.75, z);
      this.group.add(d);
      this.e.solid(x, FLOOR_Y + 0.75, z, alongX ? 1.1 : 0.05, 0.75, alongX ? 0.05 : 1.1);
      const cap = slab('wall', alongX ? 2.2 : 0.14, 0.05, alongX ? 0.14 : 2.2, 0x2a3030);
      cap.position.set(x, FLOOR_Y + 1.52, z);
      this.group.add(cap);
      this.nav.setBlock(0, x - (alongX ? 1.1 : 0.2), x + (alongX ? 1.1 : 0.2), z - (alongX ? 0.2 : 1.1), z + (alongX ? 0.2 : 1.1), false);
      dividers++;
    }
    // Pallets and stacked supply crates in the atrium, to climb from the stairs.
    for (const [x, z, n] of [[-12, 15, 3], [-5, 17, 2], [6, 16, 3], [13, 14.8, 2], [0, 10.8, 1]] as Array<[number, number, number]>) {
      const p = pallet(n);
      p.position.set(x, FLOOR_Y, z);
      this.group.add(p);
      this.e.solid(x, FLOOR_Y + 0.3 * n + 0.1, z, 0.6, 0.3 * n + 0.1, 0.5);
      this.nav.setBlock(0, x - 0.7, x + 0.7, z - 0.6, z + 0.6, false);
      this.nav.tall[0][this.nav.idx(colOf(x), rowOf(z))] = true;
    }
    for (const [x, z, c] of [[-16, 17, 0x2a4a9a], [16, 17.5, 0xb02a20], [-3, 12, 0xe0b020]] as Array<[number, number, number]>) {
      const b = barrel(c);
      b.position.set(x, FLOOR_Y, z);
      this.group.add(b);
      this.e.solid(x, FLOOR_Y + 0.45, z, 0.3, 0.45, 0.3);
    }
    const sh = shelves(3.2, 3.0, 0.8, 3, true);
    sh.position.set(0, FLOOR_Y, 18.3);
    this.group.add(sh);
    this.e.solid(0, FLOOR_Y + 1.5, 18.3, 1.6, 1.5, 0.45);
  }

  // --- Landmarks ------------------------------------------------------------------------------------------------------------------

  private labelTexture(text: string, color: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const x = c.getContext('2d')!;
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

  private sign(text: string, color: string, bg: string, w: number, h: number, x: number, y: number, z: number, ry: number): void {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = Math.round(512 * (h / w));
    const x2 = c.getContext('2d')!;
    x2.fillStyle = bg;
    x2.fillRect(0, 0, c.width, c.height);
    x2.strokeStyle = color;
    x2.lineWidth = 8;
    x2.strokeRect(6, 6, c.width - 12, c.height - 12);
    x2.fillStyle = color;
    x2.font = `bold ${Math.round(c.height * 0.46)}px system-ui`;
    x2.textAlign = 'center';
    x2.textBaseline = 'middle';
    x2.fillText(text, c.width / 2, c.height / 2 + 3);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    this.group.add(m);
  }

  private led(x: number, y: number, z: number, color: number, rate = 1): void {
    if (!this.ledMesh) {
      this.ledMesh = new THREE.InstancedMesh(sphere, new THREE.MeshBasicMaterial({ fog: false }), 300);
      this.ledMesh.count = 0;
      this.ledMesh.frustumCulled = false;
      dyn(this.ledMesh);
      this.group.add(this.ledMesh);
    }
    const i = this.ledMesh.count++;
    this.ledMesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(0.018, 0.018, 0.018)));
    this.ledMesh.setColorAt(i, new THREE.Color(color));
    this.leds.push({ index: i, rate: rate * (0.5 + Math.random()), phase: Math.random() * 10, on: new THREE.Color(color) });
  }

  private buildLandmarks(): void {
    const w = this.water;
    this.sign('THE PITFALLS', '#ffd060', '#2a2410', 3.6, 0.7, MX0 + 3 * PITCH + 0.2, FLOOR_Y + 2.7, MZ0 + 4.2, Math.PI / 2);
    this.sign('CAUTION: DROP', '#ff6a40', '#1a0a06', 2.6, 0.5, MX0 + 3 * PITCH + 0.2, FLOOR_Y + 2.0, MZ0 + 8.6, Math.PI / 2);
    this.sign('FLOODED', '#60c8ff', '#06141a', 2.2, 0.5, w.x0 + 0.2, FLOOR_Y + 2.7, (w.z0 + w.z1) / 2, Math.PI / 2);
    this.sign('RELAY STATION', '#ff9040', '#1a0e04', 2.8, 0.5, MX0 + 12 * PITCH + 0.2, FLOOR_Y + 3.0, cellZ(10), Math.PI / 2);
    this.sign('LEVEL 0', '#e8e0a0', '#2a2810', 2.0, 0.5, 0, 5.2, MZ0 + 0.25, 0);
    // The pit walkways have a rail of caution tape at one end, and the relay B console at the far wall.
    this.relayStation(2, 'RELAY B', new THREE.Vector3(MX0 + 0.4, FLOOR_Y, MZ0 + 10.2), 1);
    // The relay station: racks with blinking lights, monitors, cables, and relay A.
    const sx0 = MX0 + SERVER.c0 * PITCH;
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 5; i++) {
        const x = sx0 + 1.6 + row * 3.2;
        const z = MZ0 + SERVER.r0 * PITCH + 2.4 + i * 2.6;
        const rack = slab('wall', 0.8, 2.2, 0.9, 0x2a3036);
        rack.position.set(x, FLOOR_Y + 1.1, z);
        this.group.add(rack);
        this.e.solid(x, FLOOR_Y + 1.1, z, 0.4, 1.1, 0.45);
        for (let k = 0; k < 8; k++) this.led(x - 0.42, FLOOR_Y + 0.3 + k * 0.24, z - 0.3 + (k % 3) * 0.3, [0x30ff60, 0xff4030, 0x40a0ff][k % 3], 2 + k * 0.3);
        this.nav.setBlock(0, x - 0.45, x + 0.45, z - 0.5, z + 0.5, false);
      }
    }
    for (let i = 0; i < 4; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 144;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mon = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.75), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      mon.position.set(MX0 + 15 * PITCH - 0.35, FLOOR_Y + 2.0 + (i % 2) * 0.9, cellZ(10) - 3.2 + Math.floor(i / 2) * 1.6 + 1.8);
      mon.rotation.y = -Math.PI / 2;
      dyn(mon);
      this.group.add(mon);
      const ctx2 = canvas.getContext('2d')!;
      this.screens.push({
        last: 0,
        tick: (t) => {
          ctx2.fillStyle = '#04100a';
          ctx2.fillRect(0, 0, 256, 144);
          ctx2.fillStyle = '#30ff80';
          ctx2.font = '14px monospace';
          ctx2.fillText(`LEVEL 0  CAM ${i + 1}  ${Math.floor(t) % 100}`, 8, 18);
          if (Math.sin(t * 0.7 + i * 2) > 0.3) for (let n = 0; n < 160; n++) {
            ctx2.fillStyle = `rgba(80,255,140,${Math.random() * 0.5})`;
            ctx2.fillRect(Math.random() * 256, Math.random() * 144, 6, 2);
          } else {
            ctx2.fillStyle = '#ff3030';
            ctx2.fillText('NO SIGNAL', 90, 84);
          }
          tex.needsUpdate = true;
        },
      });
    }
    this.relayStation(1, 'RELAY A', new THREE.Vector3(MX0 + 15 * PITCH - 0.4, FLOOR_Y, cellZ(11) + 0.4), -1);
    // A lab bench and cables, a fallen chair.
    const desk = slab('wall', 1.0, 0.8, 2.4, 0x4a4036);
    desk.position.set(sx0 + 9.4, FLOOR_Y + 0.4, MZ0 + SERVER.r0 * PITCH + 4);
    this.group.add(desk);
    this.e.solid(sx0 + 9.4, FLOOR_Y + 0.4, MZ0 + SERVER.r0 * PITCH + 4, 0.5, 0.4, 1.2);
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Mesh(new THREE.TorusGeometry(0.4 + i * 0.1, 0.02, 6, 20, Math.PI), mat(0x101012));
      c.position.set(sx0 + 2 + this.rand() * 8, FLOOR_Y + 0.03, MZ0 + SERVER.r0 * PITCH + 1 + this.rand() * 14);
      c.rotation.x = Math.PI / 2;
      this.group.add(c);
    }
    // The reactor core of the old building, glowing in a cage in the atrium: a landmark.
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.6, 14), new THREE.MeshStandardMaterial({ color: 0x205840, emissive: 0x20ff80, emissiveIntensity: 0.8, transparent: true, opacity: 0.8 }));
    core.position.set(8.5, FLOOR_Y + 1.5, 14.5);
    dyn(core);
    this.core = core;
    this.group.add(core);
    this.e.solid(8.5, FLOOR_Y + 1.5, 14.5, 1, 1.5, 1);
    this.nav.setBlock(0, 7.4, 9.6, 13.4, 15.6, false);
  }

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
    this.relays.push({ id, name, active: false, button, lamp, pos: at.clone().setY(FLOOR_Y + 1.2) });
    this.e.solid(at.x, FLOOR_Y + 1.0, at.z, facing > 0 ? 0.25 : 0.25, 1.0, 1.1);
  }

  private activate(id: number): void {
    const r = this.relays.find((x) => x.id === id);
    if (!r || r.active) return;
    r.active = true;
    r.button.enabled = false;
    r.button.setLabel('POWER ON');
    (r.lamp.material as THREE.MeshLambertMaterial).emissive.setHex(0x20ff60);
    (r.lamp.material as THREE.MeshLambertMaterial).color.setHex(0x20ff60);
    this.e.audio.play('relay', r.pos, 1);
    this.onRelay?.(r);
  }

  // --- The way out ---------------------------------------------------------------------------------------------------------------

  private buildExit(): void {
    const Z1 = MZ0 + N * PITCH;
    this.exitDoor = new Door(this.e, this.doors.length, 'EXIT', new THREE.Vector3(0, FLOOR_Y, Z1 + 0.05), -1, 'x');
    this.exitDoor.setLocked(true);
    this.exitDoor.onSlam = (d) => this.onDoorSlam?.(d);
    this.doors.push(this.exitDoor);
    const c = this.cabin;
    this.c_slab(-2.6, 2.6, 71.9, 72.3);
    this.slab('concrete', -2.6, -2.4, FLOOR_Y, FLOOR_Y + 4.5, Z1 + 0.3, 72);
    this.slab('concrete', 2.4, 2.6, FLOOR_Y, FLOOR_Y + 4.5, Z1 + 0.3, 72);
    this.slab('concrete', -2.6, 2.6, FLOOR_Y + 4.5, FLOOR_Y + 4.8, Z1 + 0.3, 72.3, false);
    this.evacuate = this.e.panels.add(new WorldButton(this.e.scene, 'EVACUATE', 1.6, 0.4, '#2d7a3a', () => this.onEvacuate?.()));
    this.evacuate.mesh.position.set(0, FLOOR_Y + 1.4, 71.7);
    this.evacuate.mesh.rotation.y = Math.PI;
    this.evacuate.enabled = false;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.6), new THREE.MeshBasicMaterial({ map: this.labelTexture('EXIT LIFT', '#60ff90'), transparent: true }));
    sign.position.set(0, FLOOR_Y + 3.45, Z1 - 0.35);
    sign.rotation.y = Math.PI;
    this.group.add(sign);
    const lamp = new THREE.PointLight(0xffffff, 0, 1);
    void lamp;
    void c;
  }

  private c_slab(x0: number, x1: number, z0: number, z1: number): void {
    this.slab('concrete', x0, x1, FLOOR_Y, FLOOR_Y + 4.5, z0, z1);
    this.slab('carpet', -2.6, 2.6, FLOOR_Y - 0.6, FLOOR_Y, MZ0 + N * PITCH, 72.3, true);
  }

  // --- Navigation data ---------------------------------------------------------------------------------------------------------

  private edgeNav(vertical: boolean, cx: number, cz: number, type: number, door: Door | null): void {
    const nav = this.nav;
    // The two nav cells either side of this edge, for each of the two rows (or columns) it spans.
    for (let k = 0; k < 2; k++) {
      const ix = vertical ? 2 * cx + 1 : 2 * cx + k;
      const iz = vertical ? 2 * cz + k : 2 * cz + 1;
      const key = vertical ? `0:${ix}:${iz}:x` : `0:${ix}:${iz}:z`;
      if (type === WALL || type === HOLE) nav.wallEdges.add(key);
      else if (type === DOOR && door) nav.doorEdges.set(key, door);
      else if (type === TIGHT) {
        if (k === 0) nav.tightEdges.add(key);
        else nav.wallEdges.add(key);
      }
    }
  }

  private buildNavData(): void {
    const nav = this.nav;
    // Everything on the floor is open to start with; the Pitfalls are not for walking.
    nav.setBlock(0, MX0, MX0 + 60, MZ0, MZ0 + 60, true);
    nav.setBlock(0, MX0, MX0 + (PITS.c1 + 1) * PITCH, MZ0, MZ0 + (PITS.r1 + 1) * PITCH, false);
    // The server racks are cargo too (their blocks were set when they were built).
    const doorIt = this.doors.filter((d) => d.name !== 'EXIT');
    let di = 0;
    const doorAt = (vertical: boolean, cx: number, cz: number): Door | null => {
      const f = vertical ? MX0 + (cx + 1) * PITCH : MZ0 + (cz + 1) * PITCH;
      const mid = (vertical ? MZ0 + cz * PITCH : MX0 + cx * PITCH) + PITCH / 2;
      return doorIt.find((d) => (vertical ? Math.abs(d.center.x - f) < 0.01 && Math.abs(d.center.z - mid) < 0.01 : Math.abs(d.center.z - f) < 0.01 && Math.abs(d.center.x - mid) < 0.01)) ?? null;
    };
    void di;
    for (let cx = 0; cx < N - 1; cx++) for (let cz = 0; cz < N; cz++) this.edgeNav(true, cx, cz, this.V[cx][cz], this.V[cx][cz] === DOOR ? doorAt(true, cx, cz) : null);
    for (let cx = 0; cx < N; cx++) for (let cz = 0; cz < N - 1; cz++) this.edgeNav(false, cx, cz, this.H[cx][cz], this.H[cx][cz] === DOOR ? doorAt(false, cx, cz) : null);
    // The gantry (layer 1) and its stairs.
    nav.setBlock(1, -18, 18, MZ0, 13, true);
    nav.setBlock(0, 14.5, 17.5, 12.5, 18.1, false);
    nav.setBlock(0, -17.5, -14.5, 12.5, 18.1, false);
    for (const side of [-1, 1]) {
      const top = nav.linkIndex(1, colOf(side * 16), rowOf(12));
      const bottom = nav.linkIndex(0, colOf(side * 12.5), rowOf(18.6));
      nav.links.push({ a: top, b: bottom });
      nav.open[1][nav.idx(colOf(side * 16), rowOf(12))] = true;
      nav.open[0][nav.idx(colOf(side * 12.5), rowOf(18.6))] = true;
    }
  }

  // --- Spots for things -------------------------------------------------------------------------------------------------------

  private pickSpots(): void {
    const { V, H } = this;
    const cellEdges = (cx: number, cz: number): number[] => [cx < N - 1 ? V[cx][cz] : WALL, cx > 0 ? V[cx - 1][cz] : WALL, cz < N - 1 ? H[cx][cz] : WALL, cz > 0 ? H[cx][cz - 1] : WALL];
    const deadEnds: Array<[number, number]> = [];
    for (let cx = 0; cx < N; cx++) {
      for (let cz = 1; cz < N - 1; cz++) {
        if (!this.freeCell(cx, cz)) continue;
        const open = cellEdges(cx, cz).filter((t) => t === OPEN || t === DOOR).length;
        if (open === 1) deadEnds.push([cx, cz]);
      }
    }
    deadEnds.sort(() => this.rand() - 0.5);
    // Data logs wait in dead ends (padded with ordinary rooms if the maze has too few).
    const used = new Set<string>();
    const take = (cx: number, cz: number): THREE.Vector3 => {
      used.add(`${cx},${cz}`);
      return new THREE.Vector3(cellX(cx) + 0.3, FLOOR_Y, cellZ(cz) + 0.3);
    };
    for (const [cx, cz] of deadEnds) {
      if (this.logSpots.length >= 8) break;
      this.logSpots.push(take(cx, cz));
    }
    let guard = 0;
    while (this.logSpots.length < 8 && guard++ < 500) {
      const cx = Math.floor(this.rand() * N);
      const cz = 1 + Math.floor(this.rand() * (N - 2));
      if (!this.freeCell(cx, cz) || used.has(`${cx},${cz}`)) continue;
      this.logSpots.push(take(cx, cz));
    }
    // Lockers stand against solid east or west walls.
    guard = 0;
    while (this.lockerSpots.length < 8 && guard++ < 800) {
      const cx = Math.floor(this.rand() * (N - 1));
      const cz = 1 + Math.floor(this.rand() * (N - 2));
      if (!this.freeCell(cx, cz) || used.has(`${cx},${cz}`) || inCells(ATRIUM, cx, cz)) continue;
      if (V[cx][cz] !== WALL) continue;
      used.add(`${cx},${cz}`);
      this.lockerSpots.push({ x: MX0 + (cx + 1) * PITCH - WALL_T / 2 - 0.55, z: cellZ(cz) + 0.9, facing: -1 });
    }
    // Gear on the floor.
    guard = 0;
    while (this.gearSpots.length < 22 && guard++ < 600) {
      const cx = Math.floor(this.rand() * N);
      const cz = 1 + Math.floor(this.rand() * (N - 2));
      if (!this.freeCell(cx, cz)) continue;
      this.gearSpots.push(new THREE.Vector3(cellX(cx) - 0.6, FLOOR_Y, cellZ(cz) + 0.6));
    }
    // Where the shades wake: far from the stairs.
    for (const [cx, cz] of [[9, 12], [4, 10], [8, 6], [2, 12], [12, 4]]) this.spawns.push(new THREE.Vector3(cellX(cx) + 0.4, FLOOR_Y, cellZ(cz) + 0.4));
  }

  // --- Queries and life --------------------------------------------------------------------------------------------------------

  inWater(p: THREE.Vector3): boolean {
    const w = this.water;
    return p.x > w.x0 && p.x < w.x1 && p.z > w.z0 && p.z < w.z1 && p.y < FLOOR_Y + 0.9;
  }

  zoneAt(p: THREE.Vector3): Zone {
    if (p.y > -1.5 && p.z < 7) return 'lobby';
    if (p.z < MZ0 + 12 && Math.abs(p.x) < 18) return 'hall';
    if (p.x < MX0 + 12 && p.z < MZ0 + 20) return 'hall';
    if (this.inWater(p)) return 'hall';
    return 'room';
  }

  floorAt(x: number, y: number, z: number): number {
    if (z < 7 && x > -24.4 && x < 9 && y > -1) return 0;
    if (y > CATWALK_Y - 0.4 && z >= 7 && z <= 12.5 && Math.abs(x) <= 18) return CATWALK_Y;
    for (const p of this.pits) if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1 && y < FLOOR_Y + 0.6) return FLOOR_Y - PIT_DEPTH;
    return FLOOR_Y;
  }

  /** Is there a clear line between two floor positions (walls, shut doors and cargo block it)? */
  clear(ax: number, az: number, bx: number, bz: number): boolean {
    return this.nav.sightClear(0, ax, az, bx, bz);
  }

  /** A walkable place somewhere in the maze. */
  randomSpot(): THREE.Vector3 {
    for (let i = 0; i < 40; i++) {
      const ix = Math.floor(Math.random() * 30);
      const iz = 2 + Math.floor(Math.random() * 28);
      if (this.nav.open[0][this.nav.idx(ix, iz)]) return new THREE.Vector3(MX0 + ix * 2 + 1, FLOOR_Y, MZ0 + iz * 2 + 1);
    }
    return new THREE.Vector3(0, FLOOR_Y, 40);
  }

  /** Everything that moves or blinks. */
  update(dt: number, time: number): void {
    this.panelTimer += dt;
    if (this.panelTimer > 1 / 15) {
      this.panelTimer = 0;
      this.updatePanels(time);
      if (this.ledMesh && this.e.head.z > 7.3) {
        for (const l of this.leds) this.ledMesh.setColorAt(l.index, Math.sin(time * l.rate * 3 + l.phase) > -0.3 ? l.on : _c.setHex(0x101010));
        if (this.ledMesh.instanceColor) this.ledMesh.instanceColor.needsUpdate = true;
      }
      for (const s of this.screens) {
        if (time - s.last > 0.4 && this.e.head.x > 10 && this.e.head.z > 40) {
          s.last = time;
          s.tick(time);
        }
      }
    }
    if (this.core) (this.core.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + 0.3 * Math.sin(time * 2);
    this.waterMat.opacity = 0.55 + 0.04 * Math.sin(time * 1.3);
    // Far-off vents breathe.
    this.ventTimer -= dt;
    if (this.ventTimer <= 0 && this.e.head.z > 7.3) {
      this.ventTimer = 5 + Math.random() * 9;
      const a = Math.random() * Math.PI * 2;
      const r = 14 + Math.random() * 22;
      this.e.audio.play('vent', new THREE.Vector3(this.e.head.x + Math.cos(a) * r, FLOOR_Y + 2.8, this.e.head.z + Math.sin(a) * r), 0.6);
    }
  }

  /** Spins the reactor glow (kept for the game loop). */
  pulse(): void {}

  get lightList(): Fixture[] {
    return this.fixtures;
  }

  /** Strays kept so shared helpers stay referenced. */
  static readonly _keep = { DOOR_W };
}
