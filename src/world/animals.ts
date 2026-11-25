import * as THREE from 'three';
import { Baker } from './baker';
import { mulberry32 } from './noise';
import type { Tree } from './forest';

export interface AnimalsOptions {
  seed: number;
  /** Exact ground height. */
  surfaceAt(x: number, z: number): number;
  /** True where something (a tree, pond, rock) is in the way. */
  isBlocked(x: number, z: number, pad?: number, ignoreSpawn?: boolean): boolean;
  worldHalf: number;
  trees: ReadonlyArray<Tree>;
  /** Fewer or no animals when off. */
  enabled?: boolean;
  /** Called when an animal is killed, with where it died. */
  onKill?(species: Species, at: THREE.Vector3): void;
  /** An animal died (its id), for telling the other players. */
  onDied?(id: number): void;
  /** On a joined player's machine: an animal was hit, to tell the host. */
  onRemoteHit?(id: number, amount: number): void;
}

export type Species = 'rabbit' | 'deer';

type GroundState = 'idle' | 'wander' | 'flee';

export interface Ground {
  /** The same on every machine. */
  id: number;
  species: Species;
  x: number;
  z: number;
  y: number;
  heading: number;
  state: GroundState;
  timer: number;
  tx: number;
  tz: number;
  phase: number;
  tint: THREE.Color;
  hp: number;
}

interface Bird {
  /** 'perched' on a treetop, 'flying' to another, or 'circling' overhead with its flock. */
  state: 'perched' | 'flying' | 'circling';
  x: number;
  y: number;
  z: number;
  heading: number;
  // Perched / flying
  treeIndex: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  toTree: number;
  t: number;
  duration: number;
  // Circling
  cx: number;
  cz: number;
  radius: number;
  altitude: number;
  angle: number;
  spin: number;
  flap: number;
  tint: THREE.Color;
}

/** Animals further than this from the player aren't simulated or drawn. */
const DEFAULT_ACTIVE_RADIUS = 95;
const RABBITS = 260;
const DEER = 80;
const PERCHED_BIRDS = 60;
const FLOCKS = 16;
const BIRDS_PER_FLOCK = 4;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** Builds a low-poly animal out of blobs and sticks. Forward is +Z. */
function build(parts: Array<{ geo: THREE.BufferGeometry; at: [number, number, number]; scale: [number, number, number]; rot?: [number, number, number]; color: number }>): THREE.BufferGeometry {
  const baker = new Baker();
  for (const part of parts) {
    _m.compose(_p.set(...part.at), _q.setFromEuler(_e.set(...(part.rot ?? [0, 0, 0]))), _s.set(...part.scale));
    baker.add(part.geo, _m, _c.set(part.color));
  }
  return baker.build();
}

const blob = new THREE.IcosahedronGeometry(1, 0);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 4);
const cone = new THREE.ConeGeometry(1, 1, 5);

const RABBIT_GEO = build([
  { geo: blob, at: [0, 0.12, 0], scale: [0.1, 0.1, 0.17], color: 0x9a8468 },
  { geo: blob, at: [0, 0.18, 0.16], scale: [0.065, 0.065, 0.075], color: 0xa68f72 },
  { geo: cone, at: [0.03, 0.29, 0.14], scale: [0.02, 0.11, 0.02], rot: [-0.25, 0, 0.1], color: 0xb09878 },
  { geo: cone, at: [-0.03, 0.29, 0.14], scale: [0.02, 0.11, 0.02], rot: [-0.25, 0, -0.1], color: 0xb09878 },
  { geo: blob, at: [0, 0.14, -0.17], scale: [0.045, 0.045, 0.045], color: 0xf2efe6 },
]);

const DEER_GEO = build([
  { geo: blob, at: [0, 0.95, 0], scale: [0.2, 0.22, 0.5], color: 0xa8794a },
  { geo: cyl, at: [0, 1.2, 0.5], scale: [0.07, 0.4, 0.07], rot: [0.5, 0, 0], color: 0xa8794a },
  { geo: blob, at: [0, 1.42, 0.68], scale: [0.09, 0.1, 0.17], color: 0xb08556 },
  { geo: cyl, at: [0.12, 0.4, 0.32], scale: [0.035, 0.8, 0.035], color: 0x8a6238 },
  { geo: cyl, at: [-0.12, 0.4, 0.32], scale: [0.035, 0.8, 0.035], color: 0x8a6238 },
  { geo: cyl, at: [0.12, 0.4, -0.32], scale: [0.035, 0.8, 0.035], color: 0x8a6238 },
  { geo: cyl, at: [-0.12, 0.4, -0.32], scale: [0.035, 0.8, 0.035], color: 0x8a6238 },
  { geo: cone, at: [0.06, 1.62, 0.62], scale: [0.012, 0.22, 0.012], rot: [0, 0, -0.5], color: 0xd8c9a8 },
  { geo: cone, at: [-0.06, 1.62, 0.62], scale: [0.012, 0.22, 0.012], rot: [0, 0, 0.5], color: 0xd8c9a8 },
  { geo: blob, at: [0, 1.0, -0.5], scale: [0.07, 0.08, 0.06], color: 0xf2efe6 },
]);

const BIRD_GEO = build([
  { geo: blob, at: [0, 0, 0], scale: [0.06, 0.055, 0.13], color: 0x4a4038 },
  { geo: blob, at: [0, 0.01, 0.12], scale: [0.04, 0.04, 0.045], color: 0x4a4038 },
  { geo: cone, at: [0, 0.01, 0.17], scale: [0.012, 0.045, 0.012], rot: [Math.PI / 2, 0, 0], color: 0xd9a63a },
  { geo: cyl, at: [0.17, 0.04, 0], scale: [0.17, 0.008, 0.07], rot: [0, 0, 0.35], color: 0x3a332c },
  { geo: cyl, at: [-0.17, 0.04, 0], scale: [0.17, 0.008, 0.07], rot: [0, 0, -0.35], color: 0x3a332c },
  { geo: cone, at: [0, 0, -0.17], scale: [0.04, 0.12, 0.012], rot: [-Math.PI / 2, 0, 0], color: 0x3a332c },
]);

/**
 * Wildlife: rabbits that hop and bolt when you get close, deer that freeze and watch you before running,
 * and birds that sit in the treetops, take off when you come near, and circle high overhead by day.
 *
 * Only animals near the player are simulated and drawn. They don't use the physics engine: they walk on the
 * ground height and steer around trees.
 */
export class Animals {
  readonly stats = { rabbits: RABBITS, deer: DEER, birds: PERCHED_BIRDS + FLOCKS * BIRDS_PER_FLOCK, active: 0 };
  readonly ground: Ground[] = [];
  /** Joined players do not simulate animals: they follow what the host says. */
  remote = false;
  /** Ids of animals that have died, for new players. */
  readonly deadIds: number[] = [];
  private readonly birds: Bird[] = [];
  private readonly rabbitMesh: THREE.InstancedMesh;
  private readonly deerMesh: THREE.InstancedMesh;
  private readonly birdMesh: THREE.InstancedMesh;
  private readonly rand: () => number;
  private time = 0;
  /** Animals further than this from the player are not simulated (lowered when the frame rate is low). */
  activeRadius = DEFAULT_ACTIVE_RADIUS;
  private readonly enabled: boolean;

  constructor(
    scene: THREE.Scene,
    private readonly o: AnimalsOptions,
  ) {
    this.enabled = o.enabled ?? true;
    this.rand = mulberry32(o.seed + 4242);
    const rand = this.rand;
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const instanced = (geo: THREE.BufferGeometry, n: number) => {
      const mesh = new THREE.InstancedMesh(geo, material, n);
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      return mesh;
    };
    this.rabbitMesh = instanced(RABBIT_GEO, RABBITS);
    this.deerMesh = instanced(DEER_GEO, DEER);
    this.birdMesh = instanced(BIRD_GEO, PERCHED_BIRDS + FLOCKS * BIRDS_PER_FLOCK);
    if (!this.enabled) return;

    const spot = (): { x: number; z: number } | null => {
      for (let i = 0; i < 40; i++) {
        const x = (rand() * 2 - 1) * (o.worldHalf - 25);
        const z = (rand() * 2 - 1) * (o.worldHalf - 25);
        if (!o.isBlocked(x, z, 0.6, true)) return { x, z };
      }
      return null;
    };
    const place = (species: Species, count: number) => {
      for (let i = 0; i < count; i++) {
        const at = spot();
        if (!at) continue;
        this.ground.push({
          id: this.ground.length,
          species,
          x: at.x,
          z: at.z,
          y: o.surfaceAt(at.x, at.z),
          heading: rand() * Math.PI * 2,
          state: 'idle',
          timer: rand() * 4,
          tx: at.x,
          tz: at.z,
          phase: rand() * 10,
          tint: new THREE.Color().setHSL(0.08, 0.1, 0.9 + rand() * 0.2),
          hp: species === 'rabbit' ? 2 : 6,
        });
      }
    };
    place('rabbit', RABBITS);
    place('deer', DEER);

    // Birds: some sit in treetops, and flocks wheel overhead.
    const tall = o.trees.map((t, i) => ({ t, i })).filter(({ t }) => t.height > 14);
    for (let i = 0; i < PERCHED_BIRDS && tall.length; i++) {
      const { i: treeIndex } = tall[Math.floor(rand() * tall.length)];
      this.birds.push(this.newBird('perched', treeIndex));
    }
    for (let f = 0; f < FLOCKS; f++) {
      const cx = (rand() * 2 - 1) * (o.worldHalf - 40);
      const cz = (rand() * 2 - 1) * (o.worldHalf - 40);
      const radius = 10 + rand() * 8;
      const altitude = 26 + rand() * 12;
      const spin = (0.18 + rand() * 0.12) * (rand() < 0.5 ? -1 : 1);
      for (let b = 0; b < BIRDS_PER_FLOCK; b++) {
        const bird = this.newBird('circling', 0);
        Object.assign(bird, { cx, cz, radius: radius + rand() * 3, altitude: altitude + rand() * 3, angle: rand() * Math.PI * 2, spin });
        this.birds.push(bird);
      }
    }
  }

  /** Moves the animals and draws the ones near `viewer`. `night` is 0 by day, 1 at night: the birds roost. */
  update(dt: number, viewer: THREE.Vector3, night: number, others: ReadonlyArray<THREE.Vector3> = []): void {
    if (!this.enabled) return;
    this.time += dt;
    let rabbits = 0;
    let deer = 0;
    for (const a of this.ground) {
      // Animals keep away from whichever player is nearest, and move if any player is near enough to see them.
      let dx = a.x - viewer.x;
      let dz = a.z - viewer.z;
      let dist = Math.hypot(dx, dz);
      const mine = dist <= this.activeRadius;
      for (const o of others) {
        const d = Math.hypot(a.x - o.x, a.z - o.z);
        if (d < dist) {
          dist = d;
          dx = a.x - o.x;
          dz = a.z - o.z;
        }
      }
      if (dist > this.activeRadius) continue;
      if (this.remote) {
        // Follow the host's animal.
        const k = Math.min(1, dt * 9);
        a.x += (a.tx - a.x) * k;
        a.z += (a.tz - a.z) * k;
        a.y += (this.o.surfaceAt(a.x, a.z) - a.y) * Math.min(1, dt * 14);
      } else this.stepGround(a, dt, dist, dx, dz);
      if (!mine) continue;
      const hop = a.species === 'rabbit' ? this.hop(a) : this.gallop(a);
      _m.compose(_p.set(a.x, a.y + hop, a.z), _q.setFromAxisAngle(UP, a.heading), _s.set(1, 1, 1));
      const mesh = a.species === 'rabbit' ? this.rabbitMesh : this.deerMesh;
      const n = a.species === 'rabbit' ? rabbits++ : deer++;
      mesh.setMatrixAt(n, _m);
      mesh.setColorAt(n, a.tint);
    }
    this.rabbitMesh.count = rabbits;
    this.deerMesh.count = deer;
    for (const mesh of [this.rabbitMesh, this.deerMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    let birds = 0;
    for (const b of this.birds) {
      if (b.state === 'circling' && night > 0.55) continue; // roosting
      if (Math.hypot(b.state === 'circling' ? b.cx - viewer.x : b.x - viewer.x, b.state === 'circling' ? b.cz - viewer.z : b.z - viewer.z) > this.activeRadius + 20) continue;
      this.stepBird(b, dt, viewer, night);
      const span = b.state === 'perched' ? 0.45 : 0.55 + 0.45 * Math.abs(Math.sin(b.flap));
      _q.setFromEuler(_e.set(b.state === 'flying' ? -0.15 : 0, b.heading, 0, 'YXZ'));
      _m.compose(_p.set(b.x, b.y, b.z), _q, _s.set(span, 1, 1));
      this.birdMesh.setMatrixAt(birds, _m);
      this.birdMesh.setColorAt(birds, b.tint);
      birds++;
    }
    this.birdMesh.count = birds;
    this.birdMesh.instanceMatrix.needsUpdate = true;
    if (this.birdMesh.instanceColor) this.birdMesh.instanceColor.needsUpdate = true;
    this.stats.active = rabbits + deer + birds;
  }

  // --- Ground animals -----------------------------------------------------------

  private stepGround(a: Ground, dt: number, dist: number, dx: number, dz: number): void {
    const rabbit = a.species === 'rabbit';
    // They keep an eye on where you are without ever turning to stare: they just keep their distance.
    const fleeAt = rabbit ? 8 : 13;
    const calmAt = rabbit ? 22 : 34;

    if (dist < fleeAt) {
      if (a.state !== 'flee') a.state = 'flee';
      a.timer = 0;
    } else if (a.state === 'flee' && dist > calmAt) {
      a.state = 'idle';
      a.timer = 2 + this.rand() * 3;
    }

    let speed = 0;
    let want = a.heading;
    switch (a.state) {
      case 'idle':
        a.timer -= dt;
        if (a.timer <= 0) {
          const ang = this.rand() * Math.PI * 2;
          const d = (rabbit ? 3 : 8) + this.rand() * (rabbit ? 6 : 14);
          a.tx = a.x + Math.cos(ang) * d;
          a.tz = a.z + Math.sin(ang) * d;
          a.state = 'wander';
        }
        break;
      case 'wander': {
        want = Math.atan2(a.tx - a.x, a.tz - a.z);
        speed = rabbit ? 1.1 : 1.5;
        if (Math.hypot(a.tx - a.x, a.tz - a.z) < 0.6) {
          a.state = 'idle';
          a.timer = (rabbit ? 1.5 : 3) + this.rand() * 4;
        }
        break;
      }
      case 'flee':
        want = Math.atan2(dx, dz) + Math.sin(this.time * 3 + a.phase) * 0.35; // run away, a little zig-zag
        speed = rabbit ? 6.5 : 9;
        break;
    }

    // Turn toward where it wants to go.
    let turn = want - a.heading;
    turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
    a.heading += turn * Math.min(1, dt * (a.state === 'flee' ? 9 : 4));

    if (speed > 0) {
      const step = speed * dt;
      let moved = false;
      // Try straight ahead, then veer away from whatever is in the way.
      for (const veer of [0, 0.6, -0.6, 1.2, -1.2]) {
        const h = a.heading + veer;
        const nx = a.x + Math.sin(h) * step;
        const nz = a.z + Math.cos(h) * step;
        if (Math.abs(nx) > this.o.worldHalf - 12 || Math.abs(nz) > this.o.worldHalf - 12) continue;
        if (this.o.isBlocked(nx, nz, 0.5, true)) continue;
        a.x = nx;
        a.z = nz;
        a.heading += veer * Math.min(1, dt * 6);
        moved = true;
        break;
      }
      if (!moved && a.state === 'wander') {
        a.state = 'idle';
        a.timer = 1;
      }
    }
    a.y += (this.o.surfaceAt(a.x, a.z) - a.y) * Math.min(1, dt * 14);
  }

  /** Puts a new animal on the ground. Returns it. */
  spawn(species: Species, x: number, z: number): Ground {
    const a: Ground = {
      id: this.ground.reduce((m, g) => Math.max(m, g.id), -1) + 1,
      species,
      x,
      z,
      y: this.o.surfaceAt(x, z),
      heading: Math.random() * Math.PI * 2,
      state: 'idle',
      timer: 2,
      tx: x,
      tz: z,
      phase: Math.random() * 10,
      tint: new THREE.Color().setHSL(0.08, 0.1, 0.9 + Math.random() * 0.2),
      hp: species === 'rabbit' ? 2 : 6,
    };
    this.ground.push(a);
    return a;
  }

  /** Hurts an animal. It runs; if it is out of health it dies and drops what it carried. */
  damage(a: Ground, amount: number): boolean {
    if (this.remote) {
      this.o.onRemoteHit?.(a.id, amount);
      a.state = 'flee';
      return false;
    }
    a.hp -= amount;
    if (a.hp > 0) {
      a.state = 'flee';
      a.timer = 0;
      return false;
    }
    this.remove(a);
    this.o.onKill?.(a.species, _p.set(a.x, a.y + 0.2, a.z).clone());
    this.o.onDied?.(a.id);
    return true;
  }

  private remove(a: Ground): void {
    const i = this.ground.indexOf(a);
    if (i >= 0) this.ground.splice(i, 1);
    this.deadIds.push(a.id);
  }

  /** An animal died somewhere else (no meat: whoever killed it made that). */
  killRemote(id: number): void {
    const a = this.ground.find((g) => g.id === id);
    if (a) this.remove(a);
  }

  /** What the host sends: animals near any player, as [id, x, z, heading, state, hp]. */
  snapshot(viewers: ReadonlyArray<THREE.Vector3>, radius: number): number[][] {
    const out: number[][] = [];
    for (const a of this.ground) {
      if (!viewers.some((v) => Math.hypot(a.x - v.x, a.z - v.z) < radius)) continue;
      out.push([a.id, Math.round(a.x * 100) / 100, Math.round(a.z * 100) / 100, Math.round(a.heading * 100) / 100, a.state === 'idle' ? 0 : a.state === 'wander' ? 1 : 2, a.hp]);
    }
    return out;
  }

  /** Takes what the host sent. */
  applySnapshot(list: number[][]): void {
    const states: GroundState[] = ['idle', 'wander', 'flee'];
    for (const [id, x, z, heading, state, hp] of list) {
      const a = this.ground[id] && this.ground[id].id === id ? this.ground[id] : this.ground.find((g) => g.id === id);
      if (!a) continue;
      a.tx = x;
      a.tz = z;
      let d = heading - a.heading;
      d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
      a.heading += d * 0.5;
      a.state = states[state];
      a.hp = hp;
      if (Math.hypot(a.x - x, a.z - z) > 6) {
        a.x = x;
        a.z = z;
      }
    }
  }

  /** The nearest living ground animal within `reach` of a point (they are about a metre long). */
  nearest(point: THREE.Vector3, reach: number): Ground | null {
    let best: Ground | null = null;
    let bestD = reach;
    for (const a of this.ground) {
      const h = a.species === 'deer' ? 0.9 : 0.15;
      const d = Math.hypot(a.x - point.x, a.z - point.z, Math.max(0, Math.abs(a.y + h - point.y) - h));
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  private hop(a: Ground): number {
    if (a.state === 'flee') return Math.abs(Math.sin(this.time * 11 + a.phase)) * 0.2;
    if (a.state === 'wander') return Math.abs(Math.sin(this.time * 6 + a.phase)) * 0.06;
    return 0;
  }

  private gallop(a: Ground): number {
    if (a.state === 'flee') return Math.abs(Math.sin(this.time * 9 + a.phase)) * 0.12;
    if (a.state === 'wander') return Math.abs(Math.sin(this.time * 3.2 + a.phase)) * 0.03;
    return 0;
  }

  // --- Birds --------------------------------------------------------------------

  private newBird(state: Bird['state'], treeIndex: number): Bird {
    const rand = this.rand;
    const bird: Bird = {
      state,
      x: 0,
      y: 0,
      z: 0,
      heading: rand() * Math.PI * 2,
      treeIndex,
      fromX: 0,
      fromY: 0,
      fromZ: 0,
      toTree: 0,
      t: 0,
      duration: 1,
      cx: 0,
      cz: 0,
      radius: 12,
      altitude: 30,
      angle: 0,
      spin: 0.2,
      flap: rand() * 6,
      tint: new THREE.Color().setHSL(rand() < 0.5 ? 0.07 : 0.6, 0.15, 0.55 + rand() * 0.5),
    };
    if (state === 'perched') this.perch(bird, treeIndex);
    return bird;
  }

  private perch(b: Bird, treeIndex: number): void {
    const t = this.o.trees[treeIndex];
    b.state = 'perched';
    b.treeIndex = treeIndex;
    b.x = t.x + (this.rand() - 0.5) * 0.6;
    b.z = t.z + (this.rand() - 0.5) * 0.6;
    b.y = this.o.surfaceAt(t.x, t.z) + t.height + 0.15;
  }

  private stepBird(b: Bird, dt: number, viewer: THREE.Vector3, night: number): void {
    if (b.state === 'circling') {
      b.angle += b.spin * dt;
      b.x = b.cx + Math.cos(b.angle) * b.radius;
      b.z = b.cz + Math.sin(b.angle) * b.radius;
      b.y = b.altitude + Math.sin(this.time * 0.5 + b.angle * 3) * 1.2;
      b.heading = Math.atan2(-Math.sin(b.angle) * Math.sign(b.spin), Math.cos(b.angle) * Math.sign(b.spin));
      b.flap += dt * 9;
      return;
    }
    if (b.state === 'perched') {
      // Startled when you come close, but at night they stay put.
      if (this.o.trees[b.treeIndex].felled || (night < 0.55 && Math.hypot(b.x - viewer.x, b.z - viewer.z) < 14)) {
        const here = this.o.trees[b.treeIndex];
        let best = b.treeIndex;
        for (let i = 0; i < 12; i++) {
          const k = Math.floor(this.rand() * this.o.trees.length);
          const t = this.o.trees[k];
          const d = Math.hypot(t.x - here.x, t.z - here.z);
          if (t.height > 14 && !t.felled && d > 35 && d < 100) {
            best = k;
            break;
          }
        }
        if (best !== b.treeIndex) {
          b.state = 'flying';
          b.fromX = b.x;
          b.fromY = b.y;
          b.fromZ = b.z;
          b.toTree = best;
          b.t = 0;
          const to = this.o.trees[best];
          b.duration = Math.hypot(to.x - b.x, to.z - b.z) / 9;
        }
      }
      return;
    }
    // Flying to another treetop.
    const to = this.o.trees[b.toTree];
    const toY = this.o.surfaceAt(to.x, to.z) + to.height + 0.15;
    b.t = Math.min(1, b.t + dt / b.duration);
    const k = b.t * b.t * (3 - 2 * b.t);
    const nx = b.fromX + (to.x - b.fromX) * k;
    const nz = b.fromZ + (to.z - b.fromZ) * k;
    b.heading = Math.atan2(nx - b.x, nz - b.z) || b.heading;
    b.x = nx;
    b.z = nz;
    b.y = b.fromY + (toY - b.fromY) * k + Math.sin(Math.PI * b.t) * 5;
    b.flap += dt * 16;
    if (b.t >= 1) this.perch(b, b.toTree);
  }
}
