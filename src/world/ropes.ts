import * as THREE from 'three';
import type { RopeSpot } from './forest';

export interface TreeRope {
  readonly spot: RopeSpot;
  /** How far the lower end has been pulled down (metres), for the stretch you see. */
  pull: number;
  taken: boolean;
  /** True while a hand has hold of it. */
  held: boolean;
  readonly phase: number;
}

/** You tear a rope off its tree by pulling it down this far. */
export const PULL_TO_TEAR = 0.35;
/** Ropes further than this from the player are not drawn. */
const DRAW_DISTANCE = 100;
/** Only the lower part of a rope can be grabbed. */
const GRAB_LENGTH = 1.6;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();

/**
 * Ropes hanging down tree trunks. You can reach the lower end; grab it and pull down hard and it tears free
 * (see Grab). Until then it sways a little and stretches as you pull.
 */
export class TreeRopes {
  readonly ropes: TreeRope[];
  private readonly lineMesh: THREE.InstancedMesh;
  private readonly knotMesh: THREE.InstancedMesh;
  private time = 0;

  constructor(scene: THREE.Scene, spots: ReadonlyArray<RopeSpot>) {
    this.ropes = spots.map((spot, i) => ({ spot, pull: 0, taken: false, held: false, phase: i * 1.7 }));
    const material = new THREE.MeshLambertMaterial({ color: 0xb5985f, flatShading: true });
    this.lineMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 5), material, Math.max(1, this.ropes.length));
    this.knotMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), material, Math.max(1, this.ropes.length));
    this.lineMesh.frustumCulled = this.knotMesh.frustumCulled = false;
    this.lineMesh.count = this.knotMesh.count = this.ropes.length;
    scene.add(this.lineMesh, this.knotMesh);
    this.layout();
  }

  /** The rope whose grabbable part is closest to `point`, within `maxDistance`, or null. */
  nearest(point: THREE.Vector3, maxDistance: number): TreeRope | null {
    let best: TreeRope | null = null;
    let bestD = maxDistance;
    for (const r of this.ropes) {
      if (r.taken) continue;
      if (Math.abs(r.spot.x - point.x) > maxDistance + 0.1 || Math.abs(r.spot.z - point.z) > maxDistance + 0.1) continue;
      const low = r.spot.bottom - r.pull;
      _a.set(r.spot.x, low, r.spot.z);
      _b.set(r.spot.x, Math.min(r.spot.top, low + GRAB_LENGTH), r.spot.z);
      _ab.subVectors(_b, _a);
      _ap.subVectors(point, _a);
      const t = Math.min(1, Math.max(0, _ap.dot(_ab) / _ab.lengthSq()));
      const d = _ap.distanceTo(_ab.multiplyScalar(t));
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  }

  /** Takes a rope off its tree. */
  take(rope: TreeRope): void {
    rope.taken = true;
    rope.held = false;
    rope.pull = 0;
    this.layout();
  }

  update(dt: number, viewer?: THREE.Vector3): void {
    this.time += dt;
    for (const r of this.ropes) if (!r.held && r.pull > 0) r.pull = Math.max(0, r.pull - dt * 2.5); // springs back
    this.layout(viewer);
  }

  /** Writes the ropes near `viewer` (all of them if none is given) into the front of the meshes. */
  private layout(viewer?: THREE.Vector3): void {
    let n = 0;
    for (const r of this.ropes) {
      if (r.taken) continue;
      if (viewer && (Math.abs(r.spot.x - viewer.x) > DRAW_DISTANCE || Math.abs(r.spot.z - viewer.z) > DRAW_DISTANCE)) continue;
      const i = n++;
      const top = _p.set(r.spot.x, r.spot.top, r.spot.z);
      const length = r.spot.top - (r.spot.bottom - r.pull);
      // A gentle sway about the top, less when it is held.
      const sway = (r.held ? 0.004 : 0.03) * Math.sin(this.time * 0.9 + r.phase);
      _q.setFromEuler(_e.set(sway, 0, sway * 0.7));
      const centre = _a.set(0, -length / 2, 0).applyQuaternion(_q).add(top);
      _m.compose(centre, _q, _s.set(0.032, length, 0.032));
      this.lineMesh.setMatrixAt(i, _m);
      const end = _b.set(0, -length, 0).applyQuaternion(_q).add(top);
      _m.compose(end, _q.identity(), _s.set(0.085, 0.085, 0.085));
      this.knotMesh.setMatrixAt(i, _m);
    }
    this.lineMesh.count = this.knotMesh.count = n;
    this.lineMesh.instanceMatrix.needsUpdate = true;
    this.knotMesh.instanceMatrix.needsUpdate = true;
  }
}
