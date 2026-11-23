import * as THREE from 'three';
import { RAPIER, STICK_GROUPS } from '../physics';
import { mulberry32 } from './noise';

export type Side = 'left' | 'right';

export interface Stick {
  readonly id: number;
  readonly body: RAPIER.RigidBody;
  readonly length: number;
  readonly radius: number;
  /** Which hand is holding it, if any. */
  heldBy: Side | null;
  /** Current pose: from the physics body, or from the hand while held. */
  readonly pos: THREE.Vector3;
  readonly quat: THREE.Quaternion;
  readonly baseColor: THREE.Color;
  highlighted: boolean;
  drawnHighlighted: boolean;
  /** True while the stick has heavy damping on (resting on the ground, not flying). */
  settling: boolean;
}

export interface SticksOptions {
  /** Ground height at (x, z). */
  heightAt(x: number, z: number): number;
  /** True where sticks should not be dropped (trees, water, spawn clearing furniture). */
  isBlocked(x: number, z: number, pad?: number): boolean;
  /** The player's spawn, on the ground. A few sticks are placed right in front of it. */
  spawn: THREE.Vector3Like;
  count?: number;
  seed?: number;
}

/** Corners of the stick's six-sided, slightly tapered prism, matching its mesh (see Sticks.mesh). */
function stickShape(length: number, radius: number): RAPIER.ColliderDesc {
  const points = new Float32Array(12 * 3);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    points.set([sin * radius * TAPER, length / 2, cos * radius * TAPER], i * 6); // thinner end (top)
    points.set([sin * radius, -length / 2, cos * radius], i * 6 + 3); // thicker end (bottom)
  }
  // A round stick has no rolling resistance and rolls down any slope for ever; a prism comes to rest.
  return RAPIER.ColliderDesc.convexHull(points) ?? RAPIER.ColliderDesc.capsule(Math.max(0.01, length / 2 - radius), radius);
}

const HIGHLIGHT = new THREE.Color(0xffd84a);
const TAPER = 0.8;
const FLIGHT_DAMPING = { linear: 0.05, angular: 0.3 };
const RESTING_DAMPING = { linear: 0.3, angular: 2.5 };
/** Slower than this (m/s) a stick counts as resting and gets heavy damping. */
const SETTLE_BELOW_SPEED = 1.5;
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _color = new THREE.Color();

/**
 * Loose sticks lying around the forest. Each is a real physics body, so it can be
 * kicked, dropped, thrown and will tumble and come to rest on the ground. Sticks
 * collide with the world and each other, but never block your hands or body.
 */
export class Sticks {
  readonly list: Stick[] = [];
  readonly mesh: THREE.InstancedMesh;
  private readonly home: THREE.Vector3Like;

  constructor(scene: THREE.Scene, world: RAPIER.World, private readonly options: SticksOptions) {
    this.home = options.spawn;
    const count = options.count ?? 40;
    const rand = mulberry32((options.seed ?? 99) + 7);
    const range = (a: number, b: number) => a + rand() * (b - a);

    const geometry = new THREE.CylinderGeometry(TAPER, 1, 1, 6);
    this.mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ flatShading: true }), count);
    this.mesh.frustumCulled = false;

    for (let i = 0; i < count; i++) {
      // The first few sit just ahead of the spawn so there is something to grab straight away.
      const near = i < 6;
      const spot = this.findSpot(rand, near);
      const length = range(0.6, 1.2);
      const radius = range(0.018, 0.03);
      const yaw = rand() * Math.PI * 2;
      const q = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)); // lie flat

      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(spot.x, options.heightAt(spot.x, spot.z) + radius + 0.15, spot.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setCcdEnabled(true) // thin and fast: don't let a throw tunnel through the ground
          .setLinearDamping(FLIGHT_DAMPING.linear)
          .setAngularDamping(FLIGHT_DAMPING.angular),
      );
      world.createCollider(
        stickShape(length, radius)
          .setDensity(400)
          .setFriction(0.7)
          .setRestitution(0)
          .setCollisionGroups(STICK_GROUPS),
        body,
      );

      const baseColor = new THREE.Color().setHSL(0.07 + range(-0.015, 0.02), range(0.3, 0.45), range(0.2, 0.32));
      this.list.push({
        id: i,
        body,
        length,
        radius,
        heldBy: null,
        pos: new THREE.Vector3(spot.x, 0, spot.z),
        quat: q.clone(),
        baseColor,
        highlighted: false,
        drawnHighlighted: true, // forces the first sync to write the colour
        settling: false,
      });
    }

    // Let them drop and settle before the player sees them.
    for (let i = 0; i < 240; i++) {
      world.step();
      this.updateDamping();
    }
    this.sync();
    scene.add(this.mesh);
  }

  /**
   * The stick closest to `point`, within `maxDistance` of its surface, or null.
   * Distance is measured to the stick's body, so you can grab anywhere along it.
   */
  nearest(point: THREE.Vector3, maxDistance: number): { stick: Stick; distance: number } | null {
    let best: { stick: Stick; distance: number } | null = null;
    for (const stick of this.list) {
      const d = this.distanceTo(stick, point);
      if (d <= maxDistance && (!best || d < best.distance)) best = { stick, distance: d };
    }
    return best;
  }

  /** Distance from `point` to the surface of `stick`. */
  distanceTo(stick: Stick, point: THREE.Vector3): number {
    const half = _ab.set(0, stick.length / 2, 0).applyQuaternion(stick.quat);
    _a.copy(stick.pos).sub(half);
    _b.copy(stick.pos).add(half);
    _ab.subVectors(_b, _a);
    _ap.subVectors(point, _a);
    const t = Math.min(1, Math.max(0, _ap.dot(_ab) / _ab.lengthSq()));
    return Math.max(0, _ap.distanceTo(_ab.multiplyScalar(t)) - stick.radius);
  }

  /** Copies body poses to the meshes (held sticks use the pose their hand gave them). */
  sync(): void {
    for (const stick of this.list) {
      if (stick.heldBy === null) {
        const t = stick.body.translation();
        const r = stick.body.rotation();
        stick.pos.set(t.x, t.y, t.z);
        stick.quat.set(r.x, r.y, r.z, r.w);
        if (t.y < -20) this.respawn(stick); // fell out of the world
      }
      this.updateStickDamping(stick);
      _m.compose(stick.pos, stick.quat, _s.set(stick.radius, stick.length, stick.radius));
      this.mesh.setMatrixAt(stick.id, _m);
      if (stick.highlighted !== stick.drawnHighlighted) {
        stick.drawnHighlighted = stick.highlighted;
        this.mesh.setColorAt(stick.id, stick.highlighted ? HIGHLIGHT : _color.copy(stick.baseColor));
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private updateDamping(): void {
    for (const stick of this.list) this.updateStickDamping(stick);
  }

  /**
   * A thin stick on flat ground would roll on for ever. Once it has slowed down it gets
   * heavy damping so it comes to rest; while it is fast (thrown, tumbling) it is nearly
   * undamped so throws keep their spin.
   */
  private updateStickDamping(stick: Stick): void {
    if (stick.heldBy !== null) return;
    const v = stick.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    const wantSettling = speed < SETTLE_BELOW_SPEED;
    if (wantSettling === stick.settling) return;
    stick.settling = wantSettling;
    const d = wantSettling ? RESTING_DAMPING : FLIGHT_DAMPING;
    stick.body.setLinearDamping(d.linear);
    stick.body.setAngularDamping(d.angular);
  }

  /** Drops a stray stick back near the spawn. */
  private respawn(stick: Stick): void {
    const home = this.home;
    const x = home.x + (Math.random() - 0.5) * 6;
    const z = home.z - 3 - Math.random() * 3;
    stick.body.setTranslation({ x, y: this.options.heightAt(x, z) + 1, z }, true);
    stick.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    stick.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  private findSpot(rand: () => number, near: boolean): { x: number; z: number } {
    const { spawn, isBlocked, heightAt } = this.options;
    for (let tries = 0; tries < 200; tries++) {
      let x: number;
      let z: number;
      if (near) {
        // A fan in front of the player (forward is -z), 2.5-5 m out.
        const a = (rand() - 0.5) * 2 * (Math.PI / 3);
        const d = 2.5 + rand() * 2.5;
        x = spawn.x + Math.sin(a) * d;
        z = spawn.z - Math.cos(a) * d;
      } else {
        const a = rand() * Math.PI * 2;
        const d = 5 + Math.sqrt(rand()) * 28;
        x = spawn.x + Math.cos(a) * d;
        z = spawn.z + Math.sin(a) * d;
      }
      const slope = Math.abs(heightAt(x + 1, z) - heightAt(x, z)) + Math.abs(heightAt(x, z + 1) - heightAt(x, z));
      if (slope < 0.6 && !isBlocked(x, z, near ? 0.2 : 0.4)) return { x, z };
    }
    return { x: spawn.x, z: spawn.z - 3 };
  }
}
