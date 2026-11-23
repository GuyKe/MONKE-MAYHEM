import * as THREE from 'three';
import { RAPIER, STICK_GROUPS } from '../physics';
import { mulberry32 } from './noise';

export type Side = 'left' | 'right';

/** What a piece is. Everything you can pick up is a piece; sticks are the raw material. */
export type PieceKind = 'stick' | 'pole' | 'torch' | 'spear';

interface KindSpec {
  length: [number, number];
  radius: [number, number];
  density: number;
  /** [hue, saturation range, lightness range] */
  color: [number, [number, number], [number, number]];
}

const KINDS: Record<PieceKind, KindSpec> = {
  stick: { length: [0.6, 1.2], radius: [0.018, 0.03], density: 400, color: [0.07, [0.3, 0.45], [0.2, 0.32]] },
  pole: { length: [2.0, 2.0], radius: [0.036, 0.036], density: 450, color: [0.09, [0.35, 0.4], [0.38, 0.45]] },
  torch: { length: [0.85, 0.85], radius: [0.03, 0.03], density: 400, color: [0.06, [0.3, 0.35], [0.12, 0.16]] },
  spear: { length: [1.75, 1.75], radius: [0.02, 0.02], density: 450, color: [0.1, [0.15, 0.2], [0.42, 0.5]] },
};

export interface Stick {
  readonly id: number;
  readonly kind: PieceKind;
  readonly body: RAPIER.RigidBody;
  readonly length: number;
  readonly radius: number;
  /** Which hand is holding it, if any. */
  heldBy: Side | null;
  /** Current pose, from the physics body. */
  readonly pos: THREE.Vector3;
  readonly quat: THREE.Quaternion;
  readonly baseColor: THREE.Color;
  highlighted: boolean;
  drawnHighlighted: boolean;
  /** True while the stick has heavy damping on (resting on the ground, not flying). */
  settling: boolean;
  /** Stashed in the book: out of the world until it is crafted into something. */
  hidden: boolean;
}

export interface SticksOptions {
  /** Exact ground height at (x, z). */
  surfaceAt(x: number, z: number): number;
  /** True where sticks should not be dropped (trees, water, spawn clearing furniture). */
  isBlocked(x: number, z: number, pad?: number, ignoreSpawn?: boolean): boolean;
  /** The player's spawn, on the ground. Sticks are placed close around it. */
  spawn: THREE.Vector3Like;
  /** Half the width of the playable square; far sticks are scattered inside it. */
  worldHalf: number;
  /** Total sticks. A few are always near the spawn. Default 280. */
  count?: number;
  seed?: number;
}

/** Room for crafted pieces on top of the scattered sticks. */
const CRAFTED_CAPACITY = 48;
/** Sticks placed in a fan right in front of the player. */
const FAN_COUNT = 8;
/** Sticks placed in the clearing and trees around the spawn. */
const NEAR_COUNT = 14;
type Tier = 'fan' | 'near' | 'far';

/** The thin end is this fraction of the thick end. */
const TAPER = 0.8;
const FLIGHT_DAMPING = { linear: 0.05, angular: 0.3 };
const RESTING_DAMPING = { linear: 0.3, angular: 2.5 };
/** Slower than this (m/s) a stick counts as resting and gets heavy damping. */
const SETTLE_BELOW_SPEED = 1.5;
const HIGHLIGHT = new THREE.Color(0xffd84a);

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

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _color = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Everything you can pick up: loose sticks lying around the forest and the things crafted from them.
 * Each is a real physics body, so it can be kicked, dropped, thrown and will tumble and come to rest.
 * Pieces collide with the world and each other, but never block your hands or body.
 */
export class Sticks {
  readonly list: Stick[] = [];
  readonly mesh: THREE.InstancedMesh;
  /** How many pieces have fallen out of the world and been put back (should stay 0). */
  respawned = 0;
  private readonly home: THREE.Vector3Like;
  private readonly world: RAPIER.World;

  constructor(scene: THREE.Scene, world: RAPIER.World, private readonly options: SticksOptions) {
    this.world = world;
    this.home = options.spawn;
    const count = options.count ?? 280;
    const rand = mulberry32((options.seed ?? 99) + 7);
    const { surfaceAt } = options;

    const geometry = new THREE.CylinderGeometry(TAPER, 1, 1, 6);
    this.mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ flatShading: true }), count + CRAFTED_CAPACITY);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;

    for (let i = 0; i < count; i++) {
      const tier: Tier = i < FAN_COUNT ? 'fan' : i < FAN_COUNT + NEAR_COUNT ? 'near' : 'far';
      const spot = this.findSpot(rand, tier);
      const spec = KINDS.stick;
      const length = spec.length[0] + rand() * (spec.length[1] - spec.length[0]);
      const radius = spec.radius[0] + rand() * (spec.radius[1] - spec.radius[0]);

      // Lie along the contour of the slope so both ends touch the ground.
      const e = 0.5;
      const gx = surfaceAt(spot.x + e, spot.z) - surfaceAt(spot.x - e, spot.z);
      const gz = surfaceAt(spot.x, spot.z + e) - surfaceAt(spot.x, spot.z - e);
      const yaw = rand() * Math.PI * 2;
      const dir = Math.hypot(gx, gz) > 0.02 ? new THREE.Vector3(-gz, 0, gx).normalize() : new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
      const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);

      // Start above the highest ground under the stick's whole length, then let it drop the last
      // few centimetres. Starting even slightly inside the (thin, one-sided) terrain mesh makes the
      // solver push the stick out through the underside, and it falls out of the world.
      let ground = -Infinity;
      for (let k = -2; k <= 2; k++) {
        const t = (k / 2) * (length / 2 + radius);
        ground = Math.max(ground, surfaceAt(spot.x + dir.x * t, spot.z + dir.z * t));
      }
      this.addPiece('stick', length, radius, new THREE.Vector3(spot.x, ground + radius * 1.05 + 0.04, spot.z), q, rand);
    }

    // Let them all drop and settle (and fall asleep) before the player sees them.
    for (let i = 0; i < 300; i++) {
      world.step();
      this.updateDamping();
    }
    this.sync();
    scene.add(this.mesh);
  }

  /** Creates a crafted piece in the world and returns it, or null if there is no room left. */
  craft(kind: PieceKind, position: THREE.Vector3, quaternion: THREE.Quaternion): Stick | null {
    if (this.list.length >= this.mesh.instanceMatrix.count) return null;
    const spec = KINDS[kind];
    return this.addPiece(kind, spec.length[0], spec.radius[0], position, quaternion, Math.random);
  }

  /** Takes a piece out of the world (into the book). */
  stash(stick: Stick): void {
    stick.hidden = true;
    stick.heldBy = null;
    stick.highlighted = false;
    stick.body.setGravityScale(1, true);
    stick.body.setEnabled(false);
  }

  /**
   * The piece closest to `point`, within `maxDistance` of its surface, or null.
   * Distance is measured to the piece's body, so you can grab anywhere along it.
   */
  nearest(point: THREE.Vector3, maxDistance: number): { stick: Stick; distance: number } | null {
    let best: { stick: Stick; distance: number } | null = null;
    for (const stick of this.list) {
      if (stick.hidden) continue;
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

  /** Copies body poses to the meshes. */
  sync(): void {
    for (const stick of this.list) {
      if (stick.hidden) {
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(stick.id, _m);
        continue;
      }
      // Held pieces are real bodies too, so the pose always comes from the physics.
      const t = stick.body.translation();
      const r = stick.body.rotation();
      stick.pos.set(t.x, t.y, t.z);
      stick.quat.set(r.x, r.y, r.z, r.w);
      if (t.y < -20) this.respawn(stick); // fell out of the world
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

  private addPiece(
    kind: PieceKind,
    length: number,
    radius: number,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    rand: () => number,
  ): Stick {
    const spec = KINDS[kind];
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w })
        .setCcdEnabled(true) // thin and fast: don't let a throw tunnel through the ground
        .setLinearDamping(FLIGHT_DAMPING.linear)
        .setAngularDamping(FLIGHT_DAMPING.angular),
    );
    this.world.createCollider(
      stickShape(length, radius).setDensity(spec.density).setFriction(0.7).setRestitution(0).setCollisionGroups(STICK_GROUPS),
      body,
    );
    const [hue, sat, light] = spec.color;
    const baseColor = new THREE.Color().setHSL(
      hue + (rand() - 0.5) * 0.03,
      sat[0] + rand() * (sat[1] - sat[0]),
      light[0] + rand() * (light[1] - light[0]),
    );
    const piece: Stick = {
      id: this.list.length,
      kind,
      body,
      length,
      radius,
      heldBy: null,
      pos: position.clone(),
      quat: quaternion.clone(),
      baseColor,
      highlighted: false,
      drawnHighlighted: true, // forces the first sync to write the colour
      settling: false,
      hidden: false,
    };
    this.list.push(piece);
    this.mesh.count = this.list.length;
    return piece;
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
    if (stick.heldBy !== null || stick.hidden) return;
    const v = stick.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    const wantSettling = speed < SETTLE_BELOW_SPEED;
    if (wantSettling === stick.settling) return;
    stick.settling = wantSettling;
    const d = wantSettling ? RESTING_DAMPING : FLIGHT_DAMPING;
    stick.body.setLinearDamping(d.linear);
    stick.body.setAngularDamping(d.angular);
  }

  /** Drops a stray piece back near the spawn. */
  private respawn(stick: Stick): void {
    this.respawned++;
    const home = this.home;
    const x = home.x + (Math.random() - 0.5) * 6;
    const z = home.z - 3 - Math.random() * 3;
    stick.body.setTranslation({ x, y: this.options.surfaceAt(x, z) + 1, z }, true);
    stick.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    stick.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  private findSpot(rand: () => number, tier: Tier): { x: number; z: number } {
    const { spawn, isBlocked, surfaceAt, worldHalf } = this.options;
    for (let tries = 0; tries < 300; tries++) {
      let x: number;
      let z: number;
      if (tier === 'fan') {
        // A fan in front of the player (forward is -z), 2.5-5 m out.
        const a = (rand() - 0.5) * 2 * (Math.PI / 3);
        const d = 2.5 + rand() * 2.5;
        x = spawn.x + Math.sin(a) * d;
        z = spawn.z - Math.cos(a) * d;
      } else if (tier === 'near') {
        const a = rand() * Math.PI * 2;
        const d = 5.5 + Math.sqrt(rand()) * 11;
        x = spawn.x + Math.cos(a) * d;
        z = spawn.z + Math.sin(a) * d;
      } else {
        x = (rand() * 2 - 1) * (worldHalf - 10);
        z = (rand() * 2 - 1) * (worldHalf - 10);
      }
      const slope = Math.abs(surfaceAt(x + 1, z) - surfaceAt(x, z)) + Math.abs(surfaceAt(x, z + 1) - surfaceAt(x, z));
      if (slope < 0.6 && !isBlocked(x, z, tier === 'far' ? 0.4 : 0.2, true)) return { x, z };
    }
    return { x: spawn.x, z: spawn.z - 3 };
  }
}
