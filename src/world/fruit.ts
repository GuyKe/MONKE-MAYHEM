import * as THREE from 'three';
import type { Bush } from './forest';

export interface Fruit {
  x: number;
  y: number;
  z: number;
  hue: number;
  taken: boolean;
  /** When (in game days) it grows back. */
  regrowAt: number;
}

/** Fruit is only drawn this close. */
const DRAW_DISTANCE = 55;
/** It grows back after this many game days. */
const REGROW_DAYS = 1.5;

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();

/** Berries on the bushes. Close your grip on one to pick it; it grows back in a day or two. */
export class Fruits {
  readonly all: Fruit[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private time = 0;

  constructor(scene: THREE.Scene, bushes: ReadonlyArray<Bush>) {
    for (const b of bushes) for (const f of b.fruit) this.all.push({ x: f.x, y: f.y, z: f.z, hue: b.hue, taken: false, regrowAt: 0 });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.04, 0), new THREE.MeshLambertMaterial({ flatShading: true }), Math.max(1, this.all.length));
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /** The nearest ripe fruit within `reach` of a point. */
  nearest(point: THREE.Vector3, reach: number): Fruit | null {
    let best: Fruit | null = null;
    let bestD = reach;
    for (const f of this.all) {
      if (f.taken || Math.abs(f.x - point.x) > reach || Math.abs(f.z - point.z) > reach) continue;
      const d = Math.hypot(f.x - point.x, f.y - point.y, f.z - point.z);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  /** A berry was picked here (its index and when it returns), to tell other players. */
  onTake: ((index: number, regrowAt: number) => void) | null = null;

  take(f: Fruit, days: number): void {
    f.taken = true;
    f.regrowAt = days + REGROW_DAYS;
    this.onTake?.(this.all.indexOf(f), f.regrowAt);
  }

  /** The colour a fruit has. */
  colour(f: Fruit, out: THREE.Color): THREE.Color {
    return out.setHSL(f.hue, 0.78, 0.5);
  }

  update(dt: number, viewer: THREE.Vector3, days: number): void {
    this.time += dt;
    let n = 0;
    for (const f of this.all) {
      if (f.taken && days >= f.regrowAt) f.taken = false;
      if (f.taken || Math.abs(f.x - viewer.x) > DRAW_DISTANCE || Math.abs(f.z - viewer.z) > DRAW_DISTANCE) continue;
      _m.compose(_p.set(f.x, f.y, f.z), _q.identity(), _s.set(1, 1, 1));
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, this.colour(f, _c));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Saved state: which are taken, and when they return. */
  export(): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    this.all.forEach((f, i) => {
      if (f.taken) out.push([i, f.regrowAt]);
    });
    return out;
  }

  restore(list: Array<[number, number]>): void {
    for (const [i, at] of list) {
      const f = this.all[i];
      if (f) {
        f.taken = true;
        f.regrowAt = at;
      }
    }
  }
}
