import * as THREE from 'three';
import { RAPIER, STICK_GROUPS } from '../physics';
import { mulberry32 } from './noise';

export type Side = 'left' | 'right';

/** What a piece is. Everything you can pick up is a piece; sticks and stones are the raw materials. */
export type PieceKind = 'stick' | 'pole' | 'torch' | 'spear' | 'stone' | 'rope' | 'log' | 'axe' | 'axe2' | 'club' | 'knife' | 'mirror' | 'fruit' | 'meat';

/** Food goes through these as the days pass. */
export type FoodState = 'raw' | 'roast' | 'rotten';

/** How a piece looks and is built: a long thin prism, a rounded stone, or a flat coil of rope. */
type Shape = 'prism' | 'stone' | 'coil';

interface KindSpec {
  shape: Shape;
  length: [number, number];
  radius: [number, number];
  density: number;
  /** [hue, saturation range, lightness range] */
  color: [number, [number, number], [number, number]];
}

const KINDS: Record<PieceKind, KindSpec> = {
  stick: { shape: 'prism', length: [0.6, 1.2], radius: [0.018, 0.03], density: 400, color: [0.07, [0.3, 0.45], [0.2, 0.32]] },
  pole: { shape: 'prism', length: [2.0, 2.0], radius: [0.036, 0.036], density: 450, color: [0.09, [0.35, 0.4], [0.38, 0.45]] },
  torch: { shape: 'prism', length: [0.85, 0.85], radius: [0.03, 0.03], density: 400, color: [0.06, [0.3, 0.35], [0.12, 0.16]] },
  spear: { shape: 'prism', length: [1.75, 1.75], radius: [0.02, 0.02], density: 450, color: [0.1, [0.15, 0.2], [0.42, 0.5]] },
  log: { shape: 'prism', length: [1.1, 1.3], radius: [0.1, 0.13], density: 600, color: [0.07, [0.3, 0.38], [0.2, 0.28]] },
  axe: { shape: 'prism', length: [0.6, 0.9], radius: [0.022, 0.026], density: 450, color: [0.08, [0.3, 0.4], [0.28, 0.36]] },
  axe2: { shape: 'prism', length: [0.6, 0.9], radius: [0.022, 0.026], density: 450, color: [0.08, [0.3, 0.4], [0.28, 0.36]] },
  stone: { shape: 'stone', length: [0.1, 0.15], radius: [0.05, 0.075], density: 1600, color: [0.1, [0.03, 0.08], [0.36, 0.5]] },
  rope: { shape: 'coil', length: [0.05, 0.05], radius: [0.12, 0.12], density: 300, color: [0.11, [0.35, 0.45], [0.45, 0.55]] },
  club: { shape: 'prism', length: [0.85, 0.95], radius: [0.035, 0.04], density: 650, color: [0.07, [0.3, 0.4], [0.18, 0.24]] },
  knife: { shape: 'prism', length: [0.34, 0.34], radius: [0.014, 0.014], density: 450, color: [0.08, [0.3, 0.4], [0.3, 0.36]] },
  mirror: { shape: 'prism', length: [0.32, 0.32], radius: [0.016, 0.016], density: 450, color: [0.09, [0.3, 0.4], [0.3, 0.36]] },
  fruit: { shape: 'stone', length: [0.07, 0.09], radius: [0.035, 0.05], density: 900, color: [0.0, [0.7, 0.8], [0.45, 0.55]] },
  meat: { shape: 'stone', length: [0.14, 0.16], radius: [0.075, 0.095], density: 1000, color: [0.0, [0.55, 0.6], [0.42, 0.48]] },
};

/** The heads on tools: where along the handle (from the tip), how big, and what colour. */
export const HEADS: Partial<Record<PieceKind, { along: number; scale: [number, number, number]; color: [number, number, number] }>> = {
  axe: { along: -0.03, scale: [0.085, 0.07, 0.035], color: [0.1, 0.05, 0.42] },
  axe2: { along: -0.03, scale: [0.085, 0.07, 0.035], color: [0.1, 0.05, 0.42] },
  club: { along: -0.1, scale: [0.075, 0.13, 0.075], color: [0.07, 0.35, 0.2] },
  knife: { along: -0.08, scale: [0.02, 0.1, 0.007], color: [0.58, 0.05, 0.6] },
};
/** Pieces that do damage, and how much (before swing speed). */
export const WEAPON_POWER: Partial<Record<PieceKind, number>> = { stick: 0.7, pole: 1.2, spear: 3.2, axe: 2.6, axe2: 4, club: 3.4, knife: 2.2, torch: 0.9, log: 1.5 };

/** Food that heals, and by how much (raw meat is a poor meal). */
export const FOOD_VALUE = { fruit: 12, meat: { raw: 8, roast: 35, rotten: 0 } } as const;

/** Kinds that are sticks of wood: they rub together to make fire, and so on. */
export function isWood(kind: PieceKind): boolean {
  return KINDS[kind].shape === 'prism';
}

export interface Stick {
  readonly id: number;
  kind: PieceKind;
  readonly shape: Shape;
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
  /** Out of the world: stashed in the book or used up. */
  hidden: boolean;
  /** Axes wear out: uses left before it breaks. */
  durability: number;
  readonly maxDurability: number;
  /** How much rope is wound around the head (0 to 1), drawn on an axe. */
  wrap: number;
  /** Tools carry a head (stone blade, club knob), and a lashed axe has rope wound round it. */
  hasHead: boolean;
  /** Food: how it is doing, and how many game days old it is. */
  state: FoodState;
  age: number;
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
  /** Loose stones, hand sized. Default 120. */
  stones?: number;
  seed?: number;
}

/** What can be asked for when making a piece. */
export interface PieceOptions {
  length?: number;
  radius?: number;
  durability?: number;
  wrap?: number;
  color?: THREE.ColorRepresentation;
  state?: FoodState;
  age?: number;
}

/** Room in each mesh beyond the pieces scattered at the start, for crafted ones and loot. */
const SPARE = 300;
/** Pieces further than this from the player are not drawn (the fog hides them anyway). */
const DRAW_DISTANCE = 100;
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
/** The torus used for coils has this outer radius. */
const COIL_OUTER = 0.13;

/** Corners of the stick's six-sided, slightly tapered prism, matching its mesh. */
function prismShape(length: number, radius: number): RAPIER.ColliderDesc {
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

const DODECA = new THREE.DodecahedronGeometry(1, 0);
const DODECA_CORNERS = (() => {
  const pos = DODECA.getAttribute('position');
  const seen = new Map<string, THREE.Vector3>();
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    seen.set(`${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`, v);
  }
  return [...seen.values()];
})();

/** A rounded stone: a squashed dodecahedron, the same shape as drawn. */
function stoneShape(radius: number, offset: THREE.Vector3Like = { x: 0, y: 0, z: 0 }, scale: [number, number, number] = [1, 0.8, 1]): RAPIER.ColliderDesc {
  const pts = new Float32Array(DODECA_CORNERS.length * 3);
  DODECA_CORNERS.forEach((v, i) => {
    pts[i * 3] = v.x * radius * scale[0] + offset.x;
    pts[i * 3 + 1] = v.y * radius * scale[1] + offset.y;
    pts[i * 3 + 2] = v.z * radius * scale[2] + offset.z;
  });
  return RAPIER.ColliderDesc.convexHull(pts) ?? RAPIER.ColliderDesc.ball(radius * 0.9);
}

/** The head of an axe: a flat stone blade lashed across the top of the handle. */
export const AXE_HEAD = { along: -0.03, scale: [0.085, 0.07, 0.035] as [number, number, number] };
const headOf = (kind: PieceKind) => HEADS[kind];

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _color = new THREE.Color();
const _off = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

interface Slots {
  mesh: THREE.InstancedMesh;
  /** How many instances were written this frame. */
  used: number;
}

/**
 * Everything you can pick up: sticks, stones, rope, logs, and the tools made from them. Each is a real physics
 * body, so it can be kicked, dropped, thrown and will tumble and come to rest. Pieces collide with the world and
 * each other, but never block your hands or body.
 */
export class Sticks {
  readonly list: Stick[] = [];
  /** Every instanced mesh that draws pieces (add them to the scene). */
  readonly meshes: THREE.InstancedMesh[] = [];
  /** How many pieces have fallen out of the world and been put back (should stay 0). */
  respawned = 0;
  private frame = 0;
  private readonly home: THREE.Vector3Like;
  private readonly world: RAPIER.World;
  private readonly slots: Record<'prism' | 'stone' | 'coil' | 'head' | 'wrap', Slots>;

  constructor(scene: THREE.Scene, world: RAPIER.World, private readonly options: SticksOptions) {
    this.world = world;
    this.home = options.spawn;
    const sticks = options.count ?? 280;
    const stones = options.stones ?? 120;
    const rand = mulberry32((options.seed ?? 99) + 7);
    const material = new THREE.MeshLambertMaterial({ flatShading: true });
    const torus = new THREE.TorusGeometry(0.1, 0.03, 5, 12).rotateX(Math.PI / 2); // lies flat; axis is Y
    const make = (geometry: THREE.BufferGeometry, capacity: number, mat: THREE.Material = material): Slots => {
      const mesh = new THREE.InstancedMesh(geometry, mat, capacity);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.meshes.push(mesh);
      return { mesh, used: 0 };
    };
    this.slots = {
      prism: make(new THREE.CylinderGeometry(TAPER, 1, 1, 6), sticks + SPARE),
      stone: make(DODECA, stones + SPARE),
      coil: make(torus, SPARE),
      head: make(DODECA, 64),
      wrap: make(torus, 64, new THREE.MeshLambertMaterial({ color: 0xc9ac6e, flatShading: true })),
    };

    for (let i = 0; i < sticks; i++) {
      const tier: Tier = i < FAN_COUNT ? 'fan' : i < FAN_COUNT + NEAR_COUNT ? 'near' : 'far';
      this.scatter('stick', this.findSpot(rand, tier), rand);
    }
    for (let i = 0; i < stones; i++) {
      const tier: Tier = i < 6 ? 'near' : 'far';
      this.scatter('stone', this.findSpot(rand, tier, true), rand);
    }

    // Let them all drop and settle (and fall asleep) before the player sees them.
    for (let i = 0; i < 300; i++) {
      world.step();
      this.updateDamping();
    }
    this.sync();
    for (const mesh of this.meshes) scene.add(mesh);
  }

  /** Creates a crafted piece in the world and returns it. */
  craft(kind: PieceKind, position: THREE.Vector3, quaternion: THREE.Quaternion, extra: PieceOptions = {}): Stick | null {
    const spec = KINDS[kind];
    const length = extra.length ?? (spec.length[0] + Math.random() * (spec.length[1] - spec.length[0]));
    const radius = extra.radius ?? spec.radius[0] + Math.random() * (spec.radius[1] - spec.radius[0]);
    return this.addPiece(kind, length, radius, position, quaternion, Math.random, extra);
  }

  /** Takes a piece out of the world (into the book, or used up). */
  stash(stick: Stick): void {
    if (stick.hidden) return;
    stick.hidden = true;
    stick.heldBy = null;
    stick.highlighted = false;
    this.world.removeRigidBody(stick.body);
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

  /** Where the working end of an axe is (the head), in the world. */
  headPosition(stick: Stick, out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, stick.length / 2 + (headOf(stick.kind)?.along ?? AXE_HEAD.along), 0).applyQuaternion(stick.quat).add(stick.pos);
  }

  /**
   * Copies body poses to the meshes. With `viewer` only pieces within drawing distance are drawn (each is written
   * into the next free place in its mesh), and far ones are only looked at now and then.
   */
  sync(viewer?: THREE.Vector3): void {
    this.frame++;
    for (const slots of Object.values(this.slots)) slots.used = 0;
    for (const stick of this.list) {
      if (stick.hidden) continue;
      if (viewer && stick.pos.distanceToSquared(viewer) > DRAW_DISTANCE * DRAW_DISTANCE && (this.frame + stick.id) % 30 !== 0) continue;
      // Held pieces are real bodies too, so the pose always comes from the physics.
      const t = stick.body.translation();
      const r = stick.body.rotation();
      stick.pos.set(t.x, t.y, t.z);
      stick.quat.set(r.x, r.y, r.z, r.w);
      if (t.y < -20) this.respawn(stick); // fell out of the world
      this.updateStickDamping(stick);
      if (viewer && stick.pos.distanceToSquared(viewer) > DRAW_DISTANCE * DRAW_DISTANCE) continue;

      const slots = this.slotsFor(stick.shape);
      const at = slots.used;
      if (at >= slots.mesh.instanceMatrix.count) continue;
      slots.used++;
      if (stick.shape === 'prism') _s.set(stick.radius, stick.length, stick.radius);
      else if (stick.shape === 'stone') _s.set(stick.radius, stick.radius * 0.8, stick.radius);
      else _s.setScalar(stick.radius / COIL_OUTER);
      _m.compose(stick.pos, stick.quat, _s);
      slots.mesh.setMatrixAt(at, _m);
      slots.mesh.setColorAt(at, stick.highlighted ? HIGHLIGHT : _color.copy(stick.baseColor));

      // A tool: a head at the top of the handle (and rope wound round an axe's).
      const spec = headOf(stick.kind);
      if (stick.hasHead && spec) {
        const head = this.slots.head;
        const wrap = this.slots.wrap;
        if (head.used < head.mesh.instanceMatrix.count) {
          _off.set(0, stick.length / 2 + spec.along, 0).applyQuaternion(stick.quat).add(stick.pos);
          _m.compose(_off, stick.quat, _s.set(...spec.scale));
          head.mesh.setMatrixAt(head.used, _m);
          head.mesh.setColorAt(head.used, _color.setHSL(...spec.color));
          head.used++;
        }
        if (stick.kind === 'axe2' && wrap.used < wrap.mesh.instanceMatrix.count) {
          _off.set(0, stick.length / 2 + spec.along - 0.045, 0).applyQuaternion(stick.quat).add(stick.pos);
          _m.compose(_off, stick.quat, _s.setScalar(0.32 * Math.max(0.001, stick.wrap)));
          wrap.mesh.setMatrixAt(wrap.used, _m);
          wrap.used++;
        }
      }
    }
    for (const slots of Object.values(this.slots)) {
      slots.mesh.count = slots.used;
      slots.mesh.instanceMatrix.needsUpdate = true;
      if (slots.mesh.instanceColor) slots.mesh.instanceColor.needsUpdate = true;
    }
  }

  private slotsFor(shape: Shape): Slots {
    return this.slots[shape];
  }

  /** Puts a loose piece lying on the ground at a spot (x, z). */
  private scatter(kind: PieceKind, spot: { x: number; z: number }, rand: () => number): void {
    const { surfaceAt } = this.options;
    const spec = KINDS[kind];
    const length = spec.length[0] + rand() * (spec.length[1] - spec.length[0]);
    const radius = spec.radius[0] + rand() * (spec.radius[1] - spec.radius[0]);

    // Lie along the contour of the slope so both ends touch the ground.
    const e = 0.5;
    const gx = surfaceAt(spot.x + e, spot.z) - surfaceAt(spot.x - e, spot.z);
    const gz = surfaceAt(spot.x, spot.z + e) - surfaceAt(spot.x, spot.z - e);
    const yaw = rand() * Math.PI * 2;
    const dir = Math.hypot(gx, gz) > 0.02 ? new THREE.Vector3(-gz, 0, gx).normalize() : new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    if (spec.shape !== 'prism') q.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6)); // stones lie any way up

    // Start above the highest ground under the piece's whole length, then let it drop the last few
    // centimetres. Starting even slightly inside the (thin, one-sided) terrain mesh makes the solver push
    // it out through the underside, and it falls out of the world.
    let ground = -Infinity;
    for (let k = -2; k <= 2; k++) {
      const t = (k / 2) * (length / 2 + radius);
      ground = Math.max(ground, surfaceAt(spot.x + dir.x * t, spot.z + dir.z * t));
    }
    this.addPiece(kind, length, radius, new THREE.Vector3(spot.x, ground + radius * 1.1 + 0.04, spot.z), q, rand);
  }

  private addPiece(
    kind: PieceKind,
    length: number,
    radius: number,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    rand: () => number,
    extra: PieceOptions = {},
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
    const shape =
      spec.shape === 'prism'
        ? prismShape(length, radius)
        : spec.shape === 'stone'
          ? stoneShape(radius)
          : RAPIER.ColliderDesc.cylinder(length / 2, radius);
    this.world.createCollider(shape.setDensity(spec.density).setFriction(0.7).setRestitution(0).setCollisionGroups(STICK_GROUPS), body);

    const headSpec = headOf(kind);
    if (headSpec) {
      // The head is part of the same body.
      const head = stoneShape(1, { x: 0, y: length / 2 + headSpec.along, z: 0 }, headSpec.scale);
      this.world.createCollider(head.setDensity(kind === 'club' ? 900 : 1600).setFriction(0.7).setRestitution(0).setCollisionGroups(STICK_GROUPS), body);
    }

    const [hue, sat, light] = spec.color;
    const baseColor = new THREE.Color().setHSL(
      hue + (rand() - 0.5) * 0.03,
      sat[0] + rand() * (sat[1] - sat[0]),
      light[0] + rand() * (light[1] - light[0]),
    );
    const max = extra.durability ?? (kind === 'axe' ? 22 : kind === 'axe2' ? 60 : 0);
    const piece: Stick = {
      id: this.list.length,
      kind,
      shape: spec.shape,
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
      durability: max,
      maxDurability: max,
      wrap: extra.wrap ?? (kind === 'axe2' ? 1 : 0),
      hasHead: !!headSpec,
      state: extra.state ?? 'raw',
      age: extra.age ?? 0,
    };
    if (extra.color !== undefined) baseColor.set(extra.color);
    this.list.push(piece);
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

  private findSpot(rand: () => number, tier: Tier, wide = false): { x: number; z: number } {
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
        const d = 5.5 + Math.sqrt(rand()) * (wide ? 16 : 11);
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
