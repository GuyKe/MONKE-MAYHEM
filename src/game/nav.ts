import * as THREE from 'three';
import type { Door } from './doors';

/** Where monsters can walk: a grid of 2 m cells on two levels (the hall floor and the catwalk), with stairs between and doors on some edges. */
export const CELL = 2;
export const COLS = 30;
export const ROWS = 30;
export const X0 = -30;
export const Z0 = 7;
export const FLOOR_Y = -14;
export const CATWALK_Y = -4.5;

export interface Spot {
  x: number;
  z: number;
  layer: 0 | 1;
}

export const cellX = (ix: number): number => X0 + ix * CELL + CELL / 2;
export const cellZ = (iz: number): number => Z0 + iz * CELL + CELL / 2;
export const colOf = (x: number): number => Math.max(0, Math.min(COLS - 1, Math.floor((x - X0) / CELL)));
export const rowOf = (z: number): number => Math.max(0, Math.min(ROWS - 1, Math.floor((z - Z0) / CELL)));

const N = COLS * ROWS * 2;
const G = new Float32Array(N);
const PREV = new Int32Array(N);
const SEEN = new Uint32Array(N);
const CLOSED = new Uint32Array(N);
let stamp = 0;
// A binary heap of (node, priority) pairs; stale entries are skipped when popped.
const HEAP_NODE = new Int32Array(40000);
const HEAP_KEY = new Float32Array(40000);
let heapSize = 0;

function push(node: number, key: number): void {
  if (heapSize >= HEAP_NODE.length) return;
  let i = heapSize++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (HEAP_KEY[p] <= key) break;
    HEAP_NODE[i] = HEAP_NODE[p];
    HEAP_KEY[i] = HEAP_KEY[p];
    i = p;
  }
  HEAP_NODE[i] = node;
  HEAP_KEY[i] = key;
}

function pop(): number {
  const top = HEAP_NODE[0];
  heapSize--;
  if (heapSize > 0) {
    const node = HEAP_NODE[heapSize];
    const key = HEAP_KEY[heapSize];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= heapSize) break;
      if (c + 1 < heapSize && HEAP_KEY[c + 1] < HEAP_KEY[c]) c++;
      if (HEAP_KEY[c] >= key) break;
      HEAP_NODE[i] = HEAP_NODE[c];
      HEAP_KEY[i] = HEAP_KEY[c];
      i = c;
    }
    HEAP_NODE[i] = node;
    HEAP_KEY[i] = key;
  }
  return top;
}

export class Nav {
  readonly open: [boolean[], boolean[]] = [new Array(COLS * ROWS).fill(false), new Array(COLS * ROWS).fill(false)];
  /** Doors on an edge between two cells: key "layer:ix:iz:x" for the edge between (ix, iz) and (ix+1, iz), "layer:ix:iz:z" for (ix, iz) and (ix, iz+1). */
  readonly doorEdges = new Map<string, Door>();
  /** Edges that are walls (key as above). */
  readonly wallEdges = new Set<string>();
  /** Gaps too tight for a big monster: it can squeeze through, but slowly. */
  readonly tightEdges = new Set<string>();
  /** Cells that block sight (cargo, racks) though they might not block walking... they do both unless listed in `see`. */
  readonly tall: [boolean[], boolean[]] = [new Array(COLS * ROWS).fill(false), new Array(COLS * ROWS).fill(false)];
  /** Stairs: from (layer, index) to (layer, index). */
  readonly links: Array<{ a: number; b: number }> = [];

  idx(ix: number, iz: number): number {
    return iz * COLS + ix;
  }

  setBlock(layer: 0 | 1, x0: number, x1: number, z0: number, z1: number, open = false): void {
    for (let ix = colOf(x0 + 0.01); ix <= colOf(x1 - 0.01); ix++) for (let iz = rowOf(z0 + 0.01); iz <= rowOf(z1 - 0.01); iz++) this.open[layer][this.idx(ix, iz)] = open;
  }

  /** The spot nearest `p` that can be walked on. */
  spotFor(x: number, z: number, layer: 0 | 1): Spot {
    let ix = colOf(x);
    let iz = rowOf(z);
    if (!this.open[layer][this.idx(ix, iz)]) {
      let best = Infinity;
      for (let dx = -3; dx <= 3; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
          const a = ix + dx;
          const b = iz + dz;
          if (a < 0 || b < 0 || a >= COLS || b >= ROWS || !this.open[layer][this.idx(a, b)]) continue;
          const d = dx * dx + dz * dz;
          if (d < best) {
            best = d;
            ix = a;
            iz = b;
          }
        }
      }
    }
    return { x: cellX(ix), z: cellZ(iz), layer };
  }

  edgeKey(layer: number, ix: number, iz: number, jx: number, jz: number): string {
    return jx !== ix ? `${layer}:${Math.min(ix, jx)}:${iz}:x` : `${layer}:${ix}:${Math.min(iz, jz)}:z`;
  }

  /** Cost of one orthogonal step across an edge: Infinity for a wall; extra for a shut or jammed door or a tight gap. */
  private edgeCost(layer: number, ix: number, iz: number, jx: number, jz: number, canOpen: boolean): number {
    const key = this.edgeKey(layer, ix, iz, jx, jz);
    if (this.wallEdges.has(key)) return Infinity;
    let extra = 0;
    const door = this.doorEdges.get(key);
    if (door) {
      if (door.jam === 'closed') extra += 14;
      else if (!door.passable) {
        if (!canOpen) return Infinity;
        extra += 3;
      }
    }
    if (this.tightEdges.has(key)) extra += 2;
    return extra;
  }

  /** Cost of stepping, or Infinity if impossible. */
  private stepCost(layer: number, ix: number, iz: number, nx: number, nz: number, canOpen: boolean): number {
    if (nx < 0 || nz < 0 || nx >= COLS || nz >= ROWS || !this.open[layer][this.idx(nx, nz)]) return Infinity;
    if (nx === ix || nz === iz) {
      const e = this.edgeCost(layer, ix, iz, nx, nz, canOpen);
      return isFinite(e) ? 1 + e : Infinity;
    }
    // A diagonal needs both ways round the corner to be clear (no cutting corners past walls, doors or gaps).
    if (!this.open[layer][this.idx(nx, iz)] || !this.open[layer][this.idx(ix, nz)]) return Infinity;
    const a = this.edgeCost(layer, ix, iz, nx, iz, canOpen) + this.edgeCost(layer, nx, iz, nx, nz, canOpen) + this.edgeCost(layer, ix, iz, ix, nz, canOpen) + this.edgeCost(layer, ix, nz, nx, nz, canOpen);
    return a === 0 ? 1.414 : Infinity;
  }

  /** A path (cell centres) from one spot to another. Empty if there is none. */
  path(from: Spot, to: Spot, canOpen = true): Spot[] {
    const CELLS = COLS * ROWS;
    const start = from.layer * CELLS + this.idx(colOf(from.x), rowOf(from.z));
    const goal = to.layer * CELLS + this.idx(colOf(to.x), rowOf(to.z));
    if (start === goal) return [to];
    const gx = colOf(to.x);
    const gz = rowOf(to.z);
    stamp++;
    heapSize = 0;
    const h = (i: number): number => {
      const l = i >= CELLS ? 1 : 0;
      const c = i - l * CELLS;
      return Math.hypot((c % COLS) - gx, Math.floor(c / COLS) - gz) + (l === to.layer ? 0 : 6);
    };
    G[start] = 0;
    PREV[start] = -1;
    SEEN[start] = stamp;
    push(start, h(start));
    let guard = 0;
    let found = false;
    while (heapSize > 0 && guard++ < 8000) {
      const cur = pop();
      if (CLOSED[cur] === stamp) continue;
      CLOSED[cur] = stamp;
      if (cur === goal) {
        found = true;
        break;
      }
      const layer = cur >= CELLS ? 1 : 0;
      const cell = cur - layer * CELLS;
      const ix = cell % COLS;
      const iz = Math.floor(cell / COLS);
      const g0 = G[cur];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dz) continue;
          const nx = ix + dx;
          const nz = iz + dz;
          const c = this.stepCost(layer, ix, iz, nx, nz, canOpen);
          if (!isFinite(c)) continue;
          const ni = layer * CELLS + nz * COLS + nx;
          if (CLOSED[ni] === stamp) continue;
          const g = g0 + c;
          if (SEEN[ni] !== stamp || g < G[ni]) {
            SEEN[ni] = stamp;
            G[ni] = g;
            PREV[ni] = cur;
            push(ni, g + h(ni));
          }
        }
      }
      for (const l of this.links) {
        const other = l.a === cur ? l.b : l.b === cur ? l.a : -1;
        if (other < 0 || CLOSED[other] === stamp) continue;
        const g = g0 + 8;
        if (SEEN[other] !== stamp || g < G[other]) {
          SEEN[other] = stamp;
          G[other] = g;
          PREV[other] = cur;
          push(other, g + h(other));
        }
      }
    }
    if (!found) return [];
    const out: Spot[] = [];
    for (let i = goal; i !== -1; i = PREV[i]) {
      const layer = (i >= CELLS ? 1 : 0) as 0 | 1;
      const cell = i - layer * CELLS;
      out.push({ x: cellX(cell % COLS), z: cellZ(Math.floor(cell / COLS)), layer });
    }
    out.reverse();
    out.shift();
    return out;
  }

  /** The door a step from `a` to `b` goes through, if any (steps are between neighbouring cells). */
  doorBetween(a: Spot, b: Spot): Door | null {
    if (a.layer !== b.layer) return null;
    const ix = colOf(a.x);
    const iz = rowOf(a.z);
    const jx = colOf(b.x);
    const jz = rowOf(b.z);
    if ((ix === jx) === (iz === jz)) return null;
    return this.doorEdges.get(this.edgeKey(a.layer, ix, iz, jx, jz)) ?? null;
  }

  /** Is the step from `a` to `b` through a gap too tight for a big monster? */
  tightBetween(a: Spot, b: Spot): boolean {
    if (a.layer !== b.layer) return false;
    const ix = colOf(a.x);
    const iz = rowOf(a.z);
    const jx = colOf(b.x);
    const jz = rowOf(b.z);
    if ((ix === jx) === (iz === jz)) return false;
    return this.tightEdges.has(this.edgeKey(a.layer, ix, iz, jx, jz));
  }

  /** Is there a clear line of sight between two floor positions? Walls, shut doors and tall cargo block it; tight gaps and open doors do not. */
  sightClear(layer: 0 | 1, x0: number, z0: number, x1: number, z1: number): boolean {
    let ix = colOf(x0);
    let iz = rowOf(z0);
    const ex = colOf(x1);
    const ez = rowOf(z1);
    const dx = x1 - x0;
    const dz = z1 - z0;
    const sx = Math.sign(dx);
    const sz = Math.sign(dz);
    const tdx = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tdz = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tx = dx !== 0 ? (sx > 0 ? (X0 + (ix + 1) * CELL - x0) / dx : (X0 + ix * CELL - x0) / dx) : Infinity;
    let tz = dz !== 0 ? (sz > 0 ? (Z0 + (iz + 1) * CELL - z0) / dz : (Z0 + iz * CELL - z0) / dz) : Infinity;
    let guard = 0;
    while ((ix !== ex || iz !== ez) && guard++ < 80) {
      let jx = ix;
      let jz = iz;
      if (tx < tz) {
        jx += sx;
        tx += tdx;
      } else {
        jz += sz;
        tz += tdz;
      }
      if (jx < 0 || jz < 0 || jx >= COLS || jz >= ROWS) return false;
      const key = this.edgeKey(layer, ix, iz, jx, jz);
      if (this.wallEdges.has(key)) return false;
      const door = this.doorEdges.get(key);
      if (door && door.pos < 0.5) return false;
      if (this.tall[layer][this.idx(jx, jz)]) return false;
      ix = jx;
      iz = jz;
    }
    return true;
  }

  linkIndex(layer: 0 | 1, ix: number, iz: number): number {
    return layer * COLS * ROWS + this.idx(ix, iz);
  }

  yFor(layer: 0 | 1): number {
    return layer === 0 ? FLOOR_Y : CATWALK_Y;
  }

  static _v = new THREE.Vector3();
}
