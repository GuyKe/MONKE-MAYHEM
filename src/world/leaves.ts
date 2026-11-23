import * as THREE from 'three';
import { mulberry32 } from './noise';

const COUNT = 140;
/** Leaves drift down within this distance of the player (metres). */
const RADIUS = 20;
const CEILING = 9;
const COLORS = [0xb8761e, 0xd39a2b, 0x9c4a1c, 0x7a8a2a, 0x5f8a2c, 0xc2562a];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

interface Leaf {
  x: number;
  y: number;
  z: number;
  spin: number;
  sway: number;
  phase: number;
  speed: number;
  size: number;
}

/**
 * Leaves tumbling slowly down through the air around you. They live in a box that follows the player, and when
 * one reaches the ground it goes back to the top.
 */
export class FallingLeaves {
  private readonly mesh: THREE.InstancedMesh;
  private readonly leaves: Leaf[] = [];
  private time = 0;

  constructor(
    scene: THREE.Scene,
    seed: number,
    private readonly surfaceAt: (x: number, z: number) => number,
  ) {
    const rand = mulberry32(seed + 77);
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.1, 0.16), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), COUNT);
    this.mesh.frustumCulled = false;
    const c = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      this.leaves.push({
        x: (rand() * 2 - 1) * RADIUS,
        y: rand() * CEILING,
        z: (rand() * 2 - 1) * RADIUS,
        spin: rand() * 6,
        sway: 0.4 + rand() * 0.8,
        phase: rand() * 6,
        speed: 0.35 + rand() * 0.45,
        size: 0.7 + rand() * 0.8,
      });
      this.mesh.setColorAt(i, c.set(COLORS[i % COLORS.length]).offsetHSL(0, 0, (rand() - 0.5) * 0.1));
    }
    scene.add(this.mesh);
  }

  private placed = false;

  update(dt: number, viewer: THREE.Vector3, night: number): void {
    this.time += dt;
    this.mesh.visible = night < 0.8;
    if (!this.mesh.visible) return;
    if (!this.placed) {
      // First time: scatter them through the air around the player (positions are in the world from here on).
      this.placed = true;
      for (const l of this.leaves) {
        l.x += viewer.x;
        l.z += viewer.z;
        l.y = this.surfaceAt(l.x, l.z) + Math.random() * CEILING;
      }
    }
    this.leaves.forEach((l, i) => {
      l.y -= l.speed * dt;
      // Keep the cloud around the player: a leaf that falls out of the box on one side comes back on the other.
      if (l.x - viewer.x > RADIUS) l.x -= 2 * RADIUS;
      else if (l.x - viewer.x < -RADIUS) l.x += 2 * RADIUS;
      if (l.z - viewer.z > RADIUS) l.z -= 2 * RADIUS;
      else if (l.z - viewer.z < -RADIUS) l.z += 2 * RADIUS;
      const ground = this.surfaceAt(l.x, l.z);
      if (l.y < ground + 0.02) l.y = ground + CEILING * (0.7 + Math.random() * 0.3);
      const sx = Math.sin(this.time * l.sway + l.phase) * 0.5;
      const sz = Math.cos(this.time * l.sway * 0.8 + l.phase) * 0.5;
      _p.set(l.x + sx, l.y, l.z + sz);
      _q.setFromEuler(_e.set(this.time * l.sway * 1.3 + l.spin, l.spin + this.time * 0.5, this.time * l.sway + l.phase));
      _m.compose(_p, _q, _s.setScalar(l.size));
      this.mesh.setMatrixAt(i, _m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
