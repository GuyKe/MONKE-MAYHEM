import * as THREE from 'three';
import { mulberry32 } from '../world/noise';
import { Baker } from '../world/baker';
import { propTexture } from '../world/textures';
import type { Runtime } from '../mode/runtime';
import { sign } from '../mode/figures';

/** Cells on a side, and how wide each is (metres). */
export const GRID = 9;
export const CELL = 6;
export const WALL_HEIGHT = 3.6;
const T = 0.3;

export interface Cell {
  i: number;
  j: number;
  /** Which sides are open to the next cell. */
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

export interface Facility {
  cells: Cell[][];
  safe: Cell;
  exit: Cell;
  /** Cells the monster may not go into. */
  isSafe(c: Cell): boolean;
  center(c: Cell, out?: THREE.Vector3): THREE.Vector3;
  cellAt(x: number, z: number): Cell | null;
  /** The cells you can walk to from `c`. */
  neighbours(c: Cell): Cell[];
  /** Ceiling lights that flicker, for animating. */
  flicker: Array<{ material: THREE.MeshBasicMaterial; base: number; phase: number }>;
  lights: Array<{ pos: THREE.Vector3 }>;
  /** Where the monster starts. */
  monsterStart: Cell;
}

/** Builds the facility: a maze of corridors and rooms with a safe room at one end and a way out at the far one. */
export function buildFacility(rt: Runtime, seed: number): Facility {
  const rand = mulberry32(seed);
  const cells: Cell[][] = [];
  for (let i = 0; i < GRID; i++) {
    cells.push([]);
    for (let j = 0; j < GRID; j++) cells[i].push({ i, j, n: false, e: false, s: false, w: false });
  }
  const get = (i: number, j: number): Cell | null => (i >= 0 && j >= 0 && i < GRID && j < GRID ? cells[i][j] : null);
  const link = (a: Cell, b: Cell): void => {
    if (b.i === a.i + 1) {
      a.e = true;
      b.w = true;
    } else if (b.i === a.i - 1) {
      a.w = true;
      b.e = true;
    } else if (b.j === a.j + 1) {
      a.s = true;
      b.n = true;
    } else {
      a.n = true;
      b.s = true;
    }
  };
  // A maze with no loops, from the safe corner...
  const seen = new Set<Cell>();
  const stack: Cell[] = [cells[0][0]];
  seen.add(cells[0][0]);
  while (stack.length) {
    const c = stack[stack.length - 1];
    const options = [get(c.i + 1, c.j), get(c.i - 1, c.j), get(c.i, c.j + 1), get(c.i, c.j - 1)].filter((o): o is Cell => !!o && !seen.has(o));
    if (!options.length) {
      stack.pop();
      continue;
    }
    const next = options[Math.floor(rand() * options.length)];
    link(c, next);
    seen.add(next);
    stack.push(next);
  }
  // ...then knock some walls out so there are loops to run round.
  for (let k = 0; k < GRID * 2; k++) {
    const c = cells[Math.floor(rand() * GRID)][Math.floor(rand() * GRID)];
    const o = rand() < 0.5 ? get(c.i + 1, c.j) : get(c.i, c.j + 1);
    if (o && !(c.i === 0 && c.j === 0) && !(o.i === 0 && o.j === 0)) link(c, o);
  }
  const safe = cells[0][0];

  // The exit: the cell farthest (by walking) from the safe room.
  const dist = new Map<Cell, number>([[safe, 0]]);
  const queue = [safe];
  const neighbours = (c: Cell): Cell[] => [c.e && get(c.i + 1, c.j), c.w && get(c.i - 1, c.j), c.s && get(c.i, c.j + 1), c.n && get(c.i, c.j - 1)].filter((o): o is Cell => !!o);
  while (queue.length) {
    const c = queue.shift()!;
    for (const o of neighbours(c)) {
      if (!dist.has(o)) {
        dist.set(o, dist.get(c)! + 1);
        queue.push(o);
      }
    }
  }
  let exit = safe;
  for (const [c, d] of dist) if (d > (dist.get(exit) ?? 0)) exit = c;
  // The monster starts about halfway out.
  const far = [...dist.entries()].filter(([, d]) => d > (dist.get(exit) ?? 0) * 0.5).sort((a, b) => a[1] - b[1]);
  const monsterStart = far[0]?.[0] ?? exit;

  const center = (c: Cell, out = new THREE.Vector3()): THREE.Vector3 => out.set((c.i + 0.5) * CELL, 0, (c.j + 0.5) * CELL);
  const size = GRID * CELL;

  // --- Walls, floor, ceiling ---------------------------------------------------------------
  const baker = new Baker();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const color = new THREE.Color();
  const addBox = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, tint: number, solid = true): void => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    baker.add(box, m, color.setHex(tint));
    if (solid) rt.solidBox(cx, cy, cz, sx / 2, sy / 2, sz / 2);
  };
  const concrete = () => 0x6a6d6e + Math.floor(rand() * 0x080808);
  const wallAlongX = (cx: number, cz: number) => addBox(cx, WALL_HEIGHT / 2, cz, CELL + T, WALL_HEIGHT, T, concrete()); // runs east-west
  const wallAlongZ = (cx: number, cz: number) => addBox(cx, WALL_HEIGHT / 2, cz, T, WALL_HEIGHT, CELL + T, concrete()); // runs north-south
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const c = cells[i][j];
      const x = i * CELL;
      const z = j * CELL;
      if (!c.n) wallAlongX(x + CELL / 2, z);
      if (!c.w) wallAlongZ(x, z + CELL / 2);
      if (i === GRID - 1 && !c.e) wallAlongZ(x + CELL, z + CELL / 2);
      if (j === GRID - 1 && !c.s) wallAlongX(x + CELL / 2, z + CELL);
      // A header over each doorway.
      if (c.e && i < GRID - 1) addBox(x + CELL, WALL_HEIGHT - 0.5, z + CELL / 2, T, 1, 1.9, 0x4a4c4e, false);
      if (c.s && j < GRID - 1) addBox(x + CELL / 2, WALL_HEIGHT - 0.5, z + CELL, 1.9, 1, T, 0x4a4c4e, false);
    }
  }
  addBox(size / 2, -0.25, size / 2, size + 2, 0.5, size + 2, 0x3a3c3e); // floor
  addBox(size / 2, WALL_HEIGHT + 0.25, size / 2, size + 2, 0.5, size + 2, 0x2c2e30); // ceiling
  // Crates and lockers to look at and run round.
  for (let k = 0; k < 26; k++) {
    const c = cells[Math.floor(rand() * GRID)][Math.floor(rand() * GRID)];
    if (c === safe || c === exit) continue;
    const ctr = center(c);
    const w = 0.8 + rand() * 0.8;
    addBox(ctr.x + (rand() - 0.5) * 3.2, w / 2, ctr.z + (rand() - 0.5) * 3.2, w, w, 0.8 + rand() * 0.6, 0x5a4a38);
  }
  const mesh = new THREE.Mesh(baker.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map: propTexture(11) }));
  rt.scene.add(mesh);

  // --- Lights ---------------------------------------------------------------------------------------
  const flicker: Facility['flicker'] = [];
  const lights: Facility['lights'] = [];
  const mats = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: 0xd8e6ff }));
  mats.forEach((m, k) => flicker.push({ material: m, base: 1, phase: k * 2.1 }));
  const fixtureGeo = new THREE.BoxGeometry(1.6, 0.08, 0.35);
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const c = cells[i][j];
      if (c === safe || c === exit) continue;
      const ctr = center(c);
      // Some are dead, to make long dark stretches.
      if (rand() < 0.35) continue;
      const fixture = new THREE.Mesh(fixtureGeo, mats[(i + j) % 3]);
      fixture.position.set(ctr.x, WALL_HEIGHT - 0.04, ctr.z);
      rt.scene.add(fixture);
      lights.push({ pos: new THREE.Vector3(ctr.x, WALL_HEIGHT - 0.5, ctr.z) });
    }
  }
  // The safe room: green, steady, with its name over the door.
  const sctr = center(safe);
  const green = new THREE.PointLight(0x40ff80, 22, 12, 1.5);
  green.position.set(sctr.x, WALL_HEIGHT - 0.6, sctr.z);
  rt.scene.add(green);
  const bulb = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.4), new THREE.MeshBasicMaterial({ color: 0x7dffa8 }));
  bulb.position.set(sctr.x, WALL_HEIGHT - 0.04, sctr.z);
  rt.scene.add(bulb);
  const safeSign = sign('SAFE', '#6dff9a', 2.4);
  safeSign.position.set(sctr.x, 2.6, sctr.z + CELL / 2 - 0.2);
  safeSign.rotation.y = Math.PI;
  rt.scene.add(safeSign);
  // The way out: a lift, glowing.
  const ectr = center(exit);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 2.6), new THREE.MeshBasicMaterial({ color: 0xffb040 }));
  pad.position.set(ectr.x, 0.03, ectr.z);
  rt.scene.add(pad);
  const exitLight = new THREE.PointLight(0xffa030, 18, 12, 1.5);
  exitLight.position.set(ectr.x, 2.6, ectr.z);
  rt.scene.add(exitLight);
  const exitSign = sign('EXIT', '#ffb040', 2.2);
  exitSign.position.set(ectr.x, 2.5, ectr.z - 1.4);
  exitSign.rotation.y = 0;
  rt.scene.add(exitSign);

  // Blood on some of the walls.
  const bloodMat = new THREE.MeshBasicMaterial({ color: 0x5a0808 });
  for (let k = 0; k < 40; k++) {
    const c = cells[Math.floor(rand() * GRID)][Math.floor(rand() * GRID)];
    if (c === safe) continue;
    const ctr = center(c);
    const smear = new THREE.Mesh(new THREE.BoxGeometry(0.4 + rand() * 0.8, 0.5 + rand() * 1.2, 0.01), bloodMat);
    smear.position.set(ctr.x + (rand() - 0.5) * 4, 0.8 + rand(), ctr.z - CELL / 2 + T / 2 + 0.02);
    rt.scene.add(smear);
  }

  return {
    cells,
    safe,
    exit,
    isSafe: (c) => c === safe,
    center,
    cellAt: (x, z) => get(Math.floor(x / CELL), Math.floor(z / CELL)),
    neighbours,
    flicker,
    lights,
    monsterStart,
  };
}
