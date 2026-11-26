import * as THREE from 'three';
import { DOOR_H, type Door } from './doors';
import type { Engine } from './engine';
import type { Facility } from './facility';
import { CATWALK_Y, FLOOR_Y, colOf, rowOf, type Spot } from './nav';
import { cone, cyl, dyn, limb, rnd, sphere, v3 } from './shapes';
import { mergeUnits } from './batch';


export type MonsterKind = 'shade';
export type MonsterState = 'patrol' | 'investigate' | 'hunt' | 'search' | 'stunned';

/** A sound the monsters can hear. */
export interface Noise {
  id: number;
  pos: THREE.Vector3;
  radius: number;
  kind: string;
  age: number;
}

export interface MonsterContext {
  e: Engine;
  facility: Facility;
  /** The player's feet and head, and whether they can be hunted (not in the lobby, alive). */
  feet: THREE.Vector3;
  head: THREE.Vector3;
  huntable: boolean;
  /** The player is shut in a locker: sight cannot find them. */
  hidden: boolean;
  /** Which layer the player is on (0 the floor, 1 the catwalk). */
  layer: 0 | 1;
  /** Their light is on (they can be seen further away). */
  lit: boolean;
  noises: Noise[];
  /** Is the monster close enough to catch? */
  caught: (m: Monster) => void;
}

interface Spec {
  speedPatrol: number;
  speedHunt: number;
  sight: number;
  fov: number;
  hearing: number;
  catchRadius: number;
  crushStun: number;
  batter: number;
}

const SPECS: Record<MonsterKind, Spec> = {
  shade: { speedPatrol: 1.7, speedHunt: 5.1, sight: 24, fov: 1.3, hearing: 1.3, catchRadius: 1.1, crushStun: 3.5, batter: 0.9 },
};

export interface Model {
  group: THREE.Group;
  head: THREE.Group;
  limbs: THREE.Group[];
  extra: THREE.Object3D[];
  /** Per-frame animation of the details: time and whether it is hunting. */
  anim: Array<(t: number, hot: boolean) => void>;
}

const BLACK = new THREE.MeshBasicMaterial({ color: 0x000000 });
const WHITE = new THREE.MeshBasicMaterial({ color: 0xffffff });
const BLOOD = new THREE.MeshBasicMaterial({ color: 0x7e0a10 });
const BLOOD_DARK = new THREE.MeshBasicMaterial({ color: 0x4a0508 });

function piece(parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, at: [number, number, number], size: [number, number, number], rot: [number, number, number] = [0, 0, 0]): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...at);
  m.scale.set(...size);
  m.rotation.set(...rot);
  parent.add(m);
  return m;
}

/**
 * The shade: a monster that is entirely pitch black (it does not even take the light), with two white glowing pupils, blood
 * splattered over it in random places, and a wide frown full of sharp teeth.
 */
function buildShade(): Model {
  const g = new THREE.Group();
  const limbs: THREE.Group[] = [];
  const anim: Model['anim'] = [];
  const quat = new THREE.Quaternion();
  // A tall round body that tapers to a ragged hem; it has no legs.
  piece(g, sphere, BLACK, [0, 1.25, 0.05], [0.42, 0.6, 0.34]);
  piece(g, sphere, BLACK, [0, 0.8, 0.06], [0.36, 0.45, 0.3]);
  piece(g, cone, BLACK, [0, 0.4, 0.06], [0.34, 0.8, 0.3], [Math.PI, 0, 0]);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    piece(g, cone, BLACK, [Math.cos(a) * 0.26, 0.08, 0.06 + Math.sin(a) * 0.24], [0.07, 0.4 + (i % 3) * 0.12, 0.07], [Math.PI, 0, 0]);
  }
  piece(g, sphere, BLACK, [0, 1.62, 0.02], [0.3, 0.14, 0.24]);
  // The head: big and round.
  const head = new THREE.Group();
  head.position.set(0, 2.0, -0.04);
  piece(head, sphere, BLACK, [0, 0, 0], [0.42, 0.38, 0.38]);
  g.add(head);
  // Two white glowing pupils.
  const glow: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    piece(head, sphere, WHITE, [sx * 0.14, 0.07, -0.34], [0.045, 0.05, 0.03]);
    const halo = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    halo.position.set(sx * 0.14, 0.07, -0.34);
    halo.scale.setScalar(0.12);
    head.add(halo);
    glow.push(halo);
  }
  // A wide frown (the corners drop) with sharp teeth, upper and lower.
  const teeth = new THREE.Group();
  const N = 15;
  for (let i = 0; i < N; i++) {
    const x = -0.26 + (i / (N - 1)) * 0.52;
    const curve = -0.07 - Math.pow(x / 0.26, 2) * 0.13; // ends hang lower than the middle
    const size = 0.05 + (1 - Math.abs(x) / 0.26) * 0.03 + (i % 2) * 0.012;
    piece(teeth, cone, WHITE, [x, curve + 0.01, -0.35 + Math.abs(x) * 0.25], [0.017, size, 0.017], [Math.PI, 0, 0]); // hang down
    piece(teeth, cone, WHITE, [x * 0.97, curve - 0.075, -0.34 + Math.abs(x) * 0.25], [0.015, size * 0.8, 0.015], [0, 0, 0]); // push up
  }
  head.add(teeth);
  // Blood splattered on it in random places.
  const surfaces: Array<{ parent: THREE.Object3D; centre: [number, number, number]; radii: [number, number, number] }> = [
    { parent: head, centre: [0, 0, 0], radii: [0.42, 0.38, 0.38] },
    { parent: g, centre: [0, 1.25, 0.05], radii: [0.42, 0.6, 0.34] },
    { parent: g, centre: [0, 0.8, 0.06], radii: [0.36, 0.45, 0.3] },
  ];
  for (let i = 0; i < 22; i++) {
    const sf = surfaces[Math.floor(Math.random() * surfaces.length)];
    const n = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    if (sf.parent === head && n.z > 0.2 && Math.random() < 0.5) n.z *= -1; // more on the face than the back of the head
    quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const e = new THREE.Euler().setFromQuaternion(quat);
    const r = 0.03 + Math.random() * 0.09;
    const at: [number, number, number] = [sf.centre[0] + n.x * sf.radii[0] * 1.02, sf.centre[1] + n.y * sf.radii[1] * 1.02, sf.centre[2] + n.z * sf.radii[2] * 1.02];
    piece(sf.parent, sphere, i % 3 ? BLOOD : BLOOD_DARK, at, [r, 0.012, r * (0.6 + Math.random() * 0.8)], [e.x, e.y, e.z]);
    if (Math.random() < 0.4) piece(sf.parent, cyl, BLOOD, [at[0], at[1] - 0.08, at[2]], [0.006, 0.1 + Math.random() * 0.12, 0.006]); // a drip
  }
  // Long, dangling arms with big clawed hands.
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.46, 1.5, 0.0);
    limb(arm, v3(0, 0, 0), v3(sx * 0.12, -0.9, -0.08), 0.1, 0x000000, 0.13);
    limb(arm, v3(sx * 0.12, -0.9, -0.08), v3(sx * 0.1, -1.7, -0.16), 0.08, 0x000000, 0.1);
    piece(arm, sphere, BLACK, [sx * 0.1, -1.8, -0.17], [0.13, 0.16, 0.1]);
    for (let f = 0; f < 4; f++) piece(arm, cone, WHITE, [sx * 0.1 + (f - 1.5) * 0.06, -2.02, -0.2], [0.014, 0.17, 0.014], [Math.PI, 0, 0]);
    piece(arm, sphere, BLOOD, [sx * 0.1, -1.84, -0.24], [0.08, 0.04, 0.05]);
    g.add(arm);
    limbs.push(arm);
  }
  // limb() uses the shared lit materials: make the arms black like the rest.
  for (const a of limbs) a.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (m.material as THREE.Material) !== WHITE && (m.material as THREE.Material) !== BLOOD) m.material = BLACK;
  });
  for (const h of glow) dyn(h);
  anim.push((t, hot) => {
    glow.forEach((h, i) => h.scale.setScalar(0.12 + 0.03 * Math.sin(t * (hot ? 18 : 4) + i) + (hot ? 0.04 : 0)));
    head.rotation.z = Math.sin(t * 0.8) * 0.12;
    teeth.scale.y = hot ? 1.25 : 1;
  });
  return { group: g, head, limbs, extra: [], anim };
}

function build(_kind: MonsterKind): Model {
  const m = buildShade();
  mergeUnits([m.group, m.head, ...m.limbs]);
  return m;
}

const _a = new THREE.Vector3();

/**
 * A thing from the hazard zone. It walks the halls, hears you move, run, shout or break something, sees you if you stand in the light,
 * and hunts you through the doors and up the stairs. It cannot be fought. It can be shut out, jammed out, and crushed (briefly).
 */
export class Monster {
  readonly group = new THREE.Group();
  readonly model: Model;
  readonly spec: Spec;
  state: MonsterState = 'patrol';
  /** Where its feet are. */
  readonly pos = new THREE.Vector3();
  layer: 0 | 1 = 0;
  heading = 0;
  private path: Spot[] = [];
  private pathTimer = 0;
  private timer = 0;
  private stunned = 0;
  private lastNoise = 0;
  private lastSeen = new THREE.Vector3();
  private phase = Math.random() * 10;
  private stepTimer = 0;
  private growl = 3;
  private batterTimer = 0;
  private waiting = 0;
  /** 0 to 1: how aware of the player. */
  alert = 0;
  private lookTimer = Math.random() * 0.15;

  constructor(
    private readonly e: Engine,
    readonly kind: MonsterKind,
    spawn: THREE.Vector3,
  ) {
    this.spec = SPECS[kind];
    this.model = build(kind);
    this.group.add(this.model.group);
    e.scene.add(this.group);
    this.place(spawn);
  }

  place(p: THREE.Vector3, layer: 0 | 1 = 0): void {
    this.pos.set(p.x, layer === 0 ? FLOOR_Y : CATWALK_Y, p.z);
    this.layer = layer;
    this.path = [];
    this.state = 'patrol';
    this.stunned = 0;
    this.alert = 0;
    this.sync();
  }

  private sync(): void {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
  }

  private spotNow(f: Facility): Spot {
    return f.nav.spotFor(this.pos.x, this.pos.z, this.layer);
  }

  private repath(f: Facility, to: Spot): void {
    this.path = f.nav.path(this.spotNow(f), to, true);
  }

  update(dt: number, ctx: MonsterContext): void {
    const f = ctx.facility;
    this.phase += dt;
    this.stepTimer -= dt;
    this.growl -= dt;
    this.stunned = Math.max(0, this.stunned - dt);
    this.timer -= dt;
    this.pathTimer -= dt;
    const toPlayer = _a.subVectors(ctx.feet, this.pos);
    const dist = Math.hypot(toPlayer.x, toPlayer.z);
    this.alert = Math.max(0, this.alert - dt * 0.12);

    // What it notices.
    if (ctx.huntable && this.state !== 'stunned') {
      this.lookTimer -= dt;
      if (!ctx.hidden && this.lookTimer <= 0) {
        this.lookTimer = 0.12 + Math.random() * 0.06;
        this.look(ctx, f, toPlayer, dist);
      }
      // Hearing.
      this.listen(ctx, f);
    }
    if (this.state === 'stunned') {
      if (this.stunned <= 0) this.state = 'search';
      this.animate(dt);
      this.sync();
      return;
    }

    // What it does about it.
    if (this.state === 'hunt') {
      if (!ctx.huntable) this.state = 'patrol';
      else if (this.pathTimer <= 0) {
        this.pathTimer = 0.45;
        this.repath(f, f.nav.spotFor(ctx.feet.x, ctx.feet.z, ctx.layer));
      }
      if (this.alert < 0.25 && this.timer <= 0) {
        this.state = 'search';
        this.timer = 8;
        this.repath(f, f.nav.spotFor(this.lastSeen.x, this.lastSeen.z, this.layer));
      }
    } else if (this.state === 'investigate' || this.state === 'search') {
      if (this.timer <= 0 || (!this.path.length && this.waiting <= 0)) {
        if (this.timer <= -3 || this.state === 'search') this.state = 'patrol';
        if (this.state === 'investigate' && this.timer > -3) this.timer = Math.min(this.timer, -0.01);
      }
      if (this.state === 'investigate' && !this.path.length && this.timer < 0) this.state = 'patrol';
    }
    if (this.state === 'patrol' && (!this.path.length || this.pathTimer <= -10) && this.pathTimer <= 0) {
      this.pathTimer = 1.5;
      const s = f.randomSpot();
      this.repath(f, f.nav.spotFor(s.x, s.z, 0));
    }

    this.follow(dt, ctx);
    this.animate(dt);

    // Crushed under a door?
    for (const d of f.doors) {
      if (d.crushes(this.pos, this.pos.y, this.pos.y + 2.2, 0.7)) {
        this.stunned = this.spec.crushStun;
        this.state = 'stunned';
        this.path = [];
        this.e.audio.play('doorCrush', this.pos, 1);
        this.e.audio.play('screech', this.pos, 1);
        d.speed = 0;
        d.drive(1);
        break;
      }
    }
    // Caught you?
    if (ctx.huntable && dist < this.spec.catchRadius && Math.abs(ctx.feet.y - this.pos.y) < 2.6) ctx.caught(this);
    this.sync();
    void DOOR_H;
  }

  /** Sight: close enough, in front of it, and not behind a wall. */
  private look(ctx: MonsterContext, f: Facility, toPlayer: THREE.Vector3, dist: number): void {
    const range = this.spec.sight * (ctx.lit ? 1.5 : 1);
    const fwdX = -Math.sin(this.heading);
    const fwdZ = -Math.cos(this.heading);
    const cos = (toPlayer.x * fwdX + toPlayer.z * fwdZ) / Math.max(dist, 0.01);
    const inCone = Math.acos(Math.max(-1, Math.min(1, cos))) < this.spec.fov || dist < 4;
    const vertical = Math.abs(ctx.feet.y - this.pos.y) < 11;
    if (dist < range && inCone && vertical && (dist < 3 || f.clear(this.pos.x, this.pos.z, ctx.feet.x, ctx.feet.z))) this.sees(ctx);
  }

  /** Hearing: new noises within earshot. */
  private listen(ctx: MonsterContext, f: Facility): void {
    for (const n of ctx.noises) {
      if (n.id <= this.lastNoise) continue;
      const d = Math.hypot(n.pos.x - this.pos.x, n.pos.z - this.pos.z);
      if (d < n.radius * this.spec.hearing && Math.abs(n.pos.y - this.pos.y) < 14) {
        this.lastNoise = n.id;
        this.heard(f, n);
      }
    }
  }

  private sees(ctx: MonsterContext): void {
    this.alert = 1;
    this.lastSeen.copy(ctx.feet);
    if (this.state !== 'hunt') {
      this.state = 'hunt';
      this.timer = 6;
      this.e.audio.play('growl', this.pos, 1);
      this.pathTimer = 0;
    } else this.timer = 4;
  }

  private heard(f: Facility, n: Noise): void {
    this.alert = Math.max(this.alert, 0.6);
    if (this.state === 'hunt') return;
    this.state = 'investigate';
    this.timer = 12;
    this.repath(f, f.nav.spotFor(n.pos.x, n.pos.z, n.pos.y > -9 ? 1 : 0));
  }

  /** Walks along the path, opening (or battering) doors. */
  private follow(dt: number, ctx: MonsterContext): void {
    const f = ctx.facility;
    const speed = this.state === 'hunt' ? this.spec.speedHunt : this.state === 'search' || this.state === 'investigate' ? (this.spec.speedPatrol + this.spec.speedHunt) / 2 : this.spec.speedPatrol;
    if (this.waiting > 0) {
      this.waiting -= dt;
      return;
    }
    // Hunting at close range: go straight for the player if nothing is between.
    let goalX: number;
    let goalZ: number;
    let goalLayer: 0 | 1 = this.layer;
    const next = this.path[0];
    if (this.state === 'hunt' && !next && ctx.huntable) {
      goalX = ctx.feet.x;
      goalZ = ctx.feet.z;
    } else if (next) {
      goalX = next.x;
      goalZ = next.z;
      goalLayer = next.layer;
    } else return;
    // A door in the way?
    if (next) {
      const door = f.nav.doorBetween(this.spotNow(f), next);
      if (door && !door.passable) {
        this.waiting = 0;
        if (door.jam !== 'none') {
          this.batterTimer -= dt;
          if (this.batterTimer <= 0) {
            this.batterTimer = 1.1 / (this.spec.batter + 0.5);
            door.batter();
            this.e.audio.play('growl', this.pos, 0.6);
          }
        } else if (!door.auto) {
          door.drive(1);
        }
        this.faceTo(goalX, goalZ, dt);
        return;
      }
    }
    const dx = goalX - this.pos.x;
    const dz = goalZ - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) {
      if (next) {
        this.path.shift();
        this.layer = goalLayer;
      }
      return;
    }
    this.faceTo(goalX, goalZ, dt);
    // Turning slows it a little.
    let turnPenalty = 1;
    let diff = Math.atan2(-dx, -dz) - this.heading;
    diff -= Math.round(diff / (Math.PI * 2)) * Math.PI * 2;
    if (Math.abs(diff) > 1.0) turnPenalty = 0.45;
    const step = Math.min(d, speed * turnPenalty * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    // Height: stairs glide between the catwalk and the floor.
    const targetY = goalLayer === 1 || this.layer === 1 ? (next && next.layer !== this.layer ? (this.layer === 1 ? CATWALK_Y - ((CATWALK_Y - FLOOR_Y) * Math.max(0, 1 - d / 8)) : FLOOR_Y + (CATWALK_Y - FLOOR_Y) * Math.max(0, 1 - d / 8)) : CATWALK_Y) : FLOOR_Y;
    this.pos.y += (targetY - this.pos.y) * Math.min(1, dt * 3);
    if (this.stepTimer <= 0 && step > 0) {
      this.stepTimer = 0.55;
      const loud = Math.min(1, 14 / Math.max(3, this.e.head.distanceTo(this.pos)));
      this.e.audio.play('step', this.pos, loud);
    }
    if (this.growl <= 0 && this.state !== 'patrol') {
      this.growl = rnd(3, 6);
      this.e.audio.play('growl', this.pos, 0.8);
    }
    void colOf;
    void rowOf;
  }

  private faceTo(x: number, z: number, dt: number): void {
    const want = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
    let d = want - this.heading;
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
    const rate = 3.2;
    this.heading += Math.max(-rate * dt, Math.min(rate * dt, d));
  }

  private animate(dt: number): void {
    const t = this.phase;
    const m = this.model;
    const moving = this.state !== 'stunned' && this.path.length > 0 ? 1 : 0.2;
    // It drifts, its long arms trailing, the head turning slowly.
    this.group.position.y = this.pos.y + Math.sin(t * 1.8) * 0.07;
    m.limbs.forEach((l, i) => {
      l.rotation.x = Math.sin(t * 2 + i * Math.PI) * 0.16 * (0.5 + moving) - 0.08 * moving;
      l.rotation.z = Math.sin(t * 1.3 + i * 2) * 0.08 * (i % 2 ? 1 : -1);
    });
    for (const a of m.anim) a(t, this.state === 'hunt');
    void dt;
  }

  /** It can no longer move: a door has it. */
  stun(seconds: number): void {
    this.stunned = seconds;
    this.state = 'stunned';
    this.path = [];
  }

  /** Is it by this door (to react to being shut out)? */
  nearDoor(d: Door): boolean {
    return Math.hypot(this.pos.x - d.center.x, this.pos.z - d.center.z) < 4;
  }
}

