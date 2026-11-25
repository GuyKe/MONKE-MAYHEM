import * as THREE from 'three';
import { DOOR_H, type Door } from './doors';
import type { Engine } from './engine';
import type { Facility } from './facility';
import { CATWALK_Y, FLOOR_Y, colOf, rowOf, type Spot } from './nav';
import { blob, box, cone, cyl, limb, low, mat, part, rnd, sphere, v3 } from './shapes';

export type MonsterKind = 'stalker' | 'skitter' | 'warden';
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
  stalker: { speedPatrol: 1.5, speedHunt: 4.3, sight: 24, fov: 1.2, hearing: 1.25, catchRadius: 1.0, crushStun: 4, batter: 0.5 },
  skitter: { speedPatrol: 2.8, speedHunt: 6.6, sight: 16, fov: 1.7, hearing: 1.0, catchRadius: 0.9, crushStun: 3, batter: 0.3 },
  warden: { speedPatrol: 1.2, speedHunt: 3.5, sight: 13, fov: 1.0, hearing: 1.7, catchRadius: 1.3, crushStun: 1.2, batter: 1.4 },
};

const SKIN = 0x9aa0a2;

/** The face the player model has, gone wrong: a cracked helmet and a visor with too many eyes. */
function brokenHead(g: THREE.Group, scale: [number, number, number], eyes: number, glow: number, mouth: boolean): THREE.Group {
  const head = new THREE.Group();
  part(head, sphere, SKIN, [0, 0, 0.03], [0.17 * scale[0], 0.17 * scale[1], 0.18 * scale[2]], [0, 0, 0], 0, 0.5, 0.2);
  part(head, sphere, 0x050608, [0, 0.01 * scale[1], -0.07 * scale[2]], [0.13 * scale[0], 0.09 * scale[1], 0.09 * scale[2]], [0, 0, 0], 0, 0.1, 0.6);
  for (let i = 0; i < eyes; i++) {
    const a = rnd(0, Math.PI * 2);
    const r = rnd(0.01, 0.06);
    part(head, sphere, glow, [Math.cos(a) * r * 1.5 * scale[0], 0.01 * scale[1] + Math.sin(a) * r * scale[1], -0.15 * scale[2]], [0.014, 0.014, 0.01], [0, 0, 0], glow);
  }
  if (mouth) {
    part(head, box, 0x120406, [0, -0.1 * scale[1], -0.15 * scale[2]], [0.02, 0.1 * scale[1], 0.02]);
    for (let i = -3; i <= 3; i++) part(head, cone, 0xe8e0d0, [i * 0.007, -0.1 * scale[1], -0.162 * scale[2]], [0.004, 0.02, 0.004], [Math.PI / 2, 0, 0]);
  }
  // A crack across the helmet, and a bent antenna.
  part(head, box, 0x101214, [0.04, 0.1 * scale[1], -0.02], [0.012, 0.12, 0.012], [0.3, 0, 0.5]);
  part(head, cyl, 0x40444c, [0.1, 0.22 * scale[1], 0.05], [0.008, 0.09, 0.008], [0.2, 0, -0.7]);
  g.add(head);
  return head;
}

function tendrils(g: THREE.Group, n: number, length: number, color: number, y: number): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const t = part(g, cone, color, [Math.cos(a) * 0.18, y - length / 2, Math.sin(a) * 0.18], [0.03, length, 0.03], [Math.PI, 0, 0], 0, 0.5, 0.1);
    out.push(t);
  }
  return out;
}

export interface Model {
  group: THREE.Group;
  head: THREE.Group;
  limbs: THREE.Group[];
  extra: THREE.Object3D[];
}

function buildStalker(): Model {
  const g = new THREE.Group();
  const limbs: THREE.Group[] = [];
  // A long, thin suit on a hover unit that has come apart into hanging tendrils.
  part(g, cyl, 0x1a1c22, [0, 0.95, 0], [0.22, 0.06, 0.22]);
  const ring = part(g, cone, 0xff2a2a, [0, 0.9, 0], [0.2, 0.04, 0.2], [Math.PI, 0, 0], 0xff2020);
  tendrils(g, 9, 0.95, 0x30343a, 0.92);
  part(g, cyl, SKIN, [0, 1.55, 0.0], [0.12, 1.2, 0.1]); // the long body
  for (let i = 0; i < 6; i++) part(g, cyl, 0xcfc8b8, [0, 1.15 + i * 0.16, -0.08], [0.15, 0.012, 0.09], [Math.PI / 2, 0, 0], 0x201010);
  part(g, sphere, 0x403c38, [0, 2.1, 0.0], [0.19, 0.08, 0.12]); // the shoulders
  part(g, cyl, SKIN, [0, 2.35, 0.0], [0.05, 0.4, 0.05]); // a stretched neck
  const head = brokenHead(g, [0.8, 1.35, 0.85], 9, 0xff3040, true);
  head.position.set(0, 2.7, -0.02);
  // Four arms: two enormous, two thin ones folded at the ribs.
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.2, 2.05, 0);
    limb(arm, v3(0, 0, 0), v3(sx * 0.1, -0.9, -0.1), 0.05, SKIN, 0.07);
    limb(arm, v3(sx * 0.1, -0.9, -0.1), v3(sx * 0.12, -1.75, -0.2), 0.04, SKIN, 0.05);
    // A glove too big for it, with long fingers.
    part(arm, sphere, 0xc05010, [sx * 0.12, -1.82, -0.22], [0.1, 0.12, 0.08]);
    for (let f = 0; f < 3; f++) limb(arm, v3(sx * 0.12 + (f - 1) * 0.05, -1.88, -0.22), v3(sx * 0.12 + (f - 1) * 0.07, -2.15, -0.3), 0.012, 0xc05010, 0.018);
    g.add(arm);
    limbs.push(arm);
    const small = new THREE.Group();
    small.position.set(sx * 0.1, 1.7, -0.05);
    limb(small, v3(0, 0, 0), v3(sx * 0.18, -0.3, -0.25), 0.02, SKIN, 0.03);
    limb(small, v3(sx * 0.18, -0.3, -0.25), v3(sx * 0.1, -0.15, -0.5), 0.015, SKIN, 0.02);
    g.add(small);
    limbs.push(small);
  }
  return { group: g, head, limbs, extra: [ring] };
}

function buildSkitter(): Model {
  const g = new THREE.Group();
  const limbs: THREE.Group[] = [];
  part(g, sphere, 0x16181c, [0, 0.62, 0.05], [0.4, 0.2, 0.55]);
  part(g, sphere, SKIN, [0, 0.75, 0.1], [0.3, 0.1, 0.4]);
  for (let i = 0; i < 6; i++) part(g, cyl, 0xcfc8b8, [0, 0.72, 0.35 - i * 0.13], [0.28 - i * 0.012, 0.012, 0.04], [0, 0, Math.PI / 2], 0x201010);
  part(g, cyl, 0x14161a, [0, 0.5, 0.05], [0.28, 0.04, 0.34]);
  part(g, cone, 0xff8020, [0, 0.47, 0.05], [0.22, 0.04, 0.28], [Math.PI, 0, 0], 0xff6a10);
  // Six jointed legs.
  for (let i = 0; i < 6; i++) {
    const sx = i % 2 ? 1 : -1;
    const row = Math.floor(i / 2);
    const leg = new THREE.Group();
    leg.position.set(sx * 0.3, 0.62, 0.35 - row * 0.35);
    const k = v3(sx * 0.7, 0.35, -0.1 + row * 0.1);
    const f = v3(sx * 1.1, -0.62, 0.2 - row * 0.15);
    limb(leg, v3(0, 0, 0), k, 0.035, 0x202228, 0.045);
    limb(leg, k, f, 0.022, SKIN, 0.034);
    part(leg, low, 0xcfc8b8, [f.x, f.y, f.z], [0.04, 0.04, 0.06]);
    g.add(leg);
    limbs.push(leg);
  }
  // The head is a player's helmet hung upside down at the front, its visor sideways.
  const head = new THREE.Group();
  const inner = brokenHead(head, [1, 1, 1], 5, 0xffb020, true);
  inner.rotation.z = Math.PI;
  inner.rotation.y = 0.2;
  head.position.set(0, 0.5, -0.45);
  g.add(head);
  return { group: g, head, limbs, extra: [] };
}

function buildWarden(): Model {
  const g = new THREE.Group();
  const limbs: THREE.Group[] = [];
  // A hulk: armour plates on a heavy hover unit, a head sunk between the shoulders.
  part(g, cyl, 0x14161a, [0, 0.55, 0.0], [0.55, 0.14, 0.55]);
  const glowRing = part(g, cone, 0xff7a10, [0, 0.46, 0], [0.5, 0.1, 0.5], [Math.PI, 0, 0], 0xff5a00);
  part(g, sphere, 0x4a4e56, [0, 1.35, 0.05], [0.7, 0.75, 0.45], [0, 0, 0], 0, 0.45, 0.6);
  for (let i = 0; i < 4; i++) part(g, box, 0x32363e, [0, 1.0 + i * 0.28, -0.4], [0.9 - i * 0.06, 0.2, 0.06], [0, 0, 0], 0, 0.4, 0.7);
  for (const sx of [-1, 1]) part(g, sphere, 0x6a2a20, [sx * 0.72, 1.85, 0.0], [0.32, 0.26, 0.3], [0, 0, 0], 0, 0.45, 0.5);
  for (let i = 0; i < 8; i++) part(g, low, 0x9aa0a4, [Math.cos(i) * 0.34, 1.0 + (i % 4) * 0.28, -0.44], [0.025, 0.025, 0.02]);
  const head = new THREE.Group();
  part(head, sphere, SKIN, [0, 0, 0], [0.22, 0.2, 0.22]);
  part(head, sphere, 0x040404, [0, 0, -0.14], [0.17, 0.12, 0.1]);
  part(head, sphere, 0xffa020, [0, 0, -0.22], [0.09, 0.09, 0.03], [0, 0, 0], 0xff8010);
  part(head, cyl, 0x40444c, [-0.14, 0.26, 0.0], [0.01, 0.14, 0.01], [0, 0, 0.5]);
  head.position.set(0, 2.1, -0.05);
  g.add(head);
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.85, 1.85, 0);
    limb(arm, v3(0, 0, 0), v3(sx * 0.2, -0.9, -0.1), 0.14, 0x4a4e56, 0.17);
    limb(arm, v3(sx * 0.2, -0.9, -0.1), v3(sx * 0.15, -1.7, -0.2), 0.12, 0x32363e, 0.15);
    part(arm, sphere, 0xc05010, [sx * 0.15, -1.9, -0.22], [0.26, 0.3, 0.22]);
    for (let f = 0; f < 3; f++) part(arm, cone, 0x20242a, [sx * 0.15 + (f - 1) * 0.12, -2.2, -0.26], [0.05, 0.25, 0.05], [Math.PI, 0, 0]);
    limb(arm, v3(sx * 0.3, -0.2, 0.1), v3(sx * 0.3, -0.9, 0.1), 0.04, 0xaaaaaa, 0.04); // a piston
    g.add(arm);
    limbs.push(arm);
  }
  return { group: g, head, limbs, extra: [glowRing] };
}

const glowCache = new Map<THREE.Material, THREE.Material>();

/** Gives a model a faint glow of its own colours, so even in the dark you can make out its shape. */
function selfGlow(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const original = m.material as THREE.MeshStandardMaterial;
    if (original.emissiveIntensity > 0 && original.emissive.getHex() !== 0) return;
    let c = glowCache.get(original);
    if (!c) {
      const clone = original.clone();
      clone.emissive.copy(original.color).multiplyScalar(0.22);
      clone.emissiveIntensity = 1;
      glowCache.set(original, clone);
      c = clone;
    }
    m.material = c;
  });
}

function build(kind: MonsterKind): Model {
  const m = kind === 'stalker' ? buildStalker() : kind === 'skitter' ? buildSkitter() : buildWarden();
  selfGlow(m.group);
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
      // Sight: close enough, in front of it, and not behind a wall.
      const range = this.spec.sight * (ctx.lit ? 1.5 : 1);
      const yaw = this.heading;
      const fwdX = -Math.sin(yaw);
      const fwdZ = -Math.cos(yaw);
      const cos = (toPlayer.x * fwdX + toPlayer.z * fwdZ) / Math.max(dist, 0.01);
      const inCone = Math.acos(Math.max(-1, Math.min(1, cos))) < this.spec.fov || dist < 4;
      const vertical = Math.abs(ctx.feet.y - this.pos.y) < 11;
      if (dist < range && inCone && vertical && (dist < 3 || f.clear(this.pos.x, this.pos.z, ctx.feet.x, ctx.feet.z))) this.sees(ctx);
      // Hearing.
      for (const n of ctx.noises) {
        if (n.id <= this.lastNoise) continue;
        const d = Math.hypot(n.pos.x - this.pos.x, n.pos.z - this.pos.z);
        if (d < n.radius * this.spec.hearing && Math.abs(n.pos.y - this.pos.y) < 14) {
          this.lastNoise = n.id;
          this.heard(f, n);
        }
      }
    }

    if (this.state === 'stunned') {
      if (this.stunned <= 0) this.state = 'search';
      this.animate(dt, 0);
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
    this.animate(dt, this.state === 'hunt' ? this.spec.speedHunt : this.spec.speedPatrol);

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

  private sees(ctx: MonsterContext): void {
    this.alert = 1;
    this.lastSeen.copy(ctx.feet);
    if (this.state !== 'hunt') {
      this.state = 'hunt';
      this.timer = 6;
      this.e.audio.play(this.kind === 'skitter' ? 'screech' : 'growl', this.pos, 1);
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
      this.stepTimer = this.kind === 'skitter' ? 0.22 : this.kind === 'warden' ? 0.7 : 0.55;
      const loud = Math.min(1, 14 / Math.max(3, this.e.head.distanceTo(this.pos)));
      this.e.audio.play(this.kind === 'skitter' ? 'skitter' : 'step', this.pos, loud);
    }
    if (this.growl <= 0 && this.state !== 'patrol') {
      this.growl = rnd(3, 6);
      this.e.audio.play(this.kind === 'skitter' ? 'screech' : 'growl', this.pos, 0.8);
    }
    void colOf;
    void rowOf;
  }

  private faceTo(x: number, z: number, dt: number): void {
    const want = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
    let d = want - this.heading;
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
    const rate = this.kind === 'warden' ? 2.2 : this.kind === 'stalker' ? 3 : 6;
    this.heading += Math.max(-rate * dt, Math.min(rate * dt, d));
  }

  private animate(dt: number, speed: number): void {
    const t = this.phase;
    const m = this.model;
    const moving = this.state !== 'stunned' && this.path.length > 0 ? 1 : 0.2;
    if (this.kind === 'stalker') {
      // It floats, sways, and its arms trail.
      this.group.position.y = this.pos.y + Math.sin(t * 2) * 0.06;
      m.limbs.forEach((l, i) => {
        l.rotation.x = Math.sin(t * 2 + i) * 0.12 - 0.1 * moving;
        l.rotation.z = Math.sin(t * 1.3 + i * 2) * 0.1 * (i % 2 ? 1 : -1);
      });
      m.head.rotation.z = Math.sin(t * 0.7) * 0.2 + (this.state === 'hunt' ? Math.sin(t * 40) * 0.05 : 0);
      m.head.rotation.x = 0.1 + Math.sin(t * 0.5) * 0.1;
    } else if (this.kind === 'skitter') {
      m.limbs.forEach((l, i) => {
        const ph = t * (6 + speed) + (i % 2 ? Math.PI : 0) + Math.floor(i / 2);
        l.rotation.x = Math.sin(ph) * 0.35 * moving;
        l.rotation.z = Math.cos(ph) * 0.1 * moving;
      });
      this.group.position.y = this.pos.y + Math.abs(Math.sin(t * (7 + speed))) * 0.05 * moving;
      m.head.rotation.z = Math.sin(t * 5) * 0.25;
    } else {
      this.group.position.y = this.pos.y + Math.sin(t * 1.4) * 0.05;
      m.limbs.forEach((l, i) => {
        l.rotation.x = Math.sin(t * 1.4 + i * Math.PI) * 0.18 * moving - 0.05;
      });
      m.head.rotation.y = Math.sin(t * 0.6) * 0.5;
    }
    // Their lights pulse faster when they are hunting.
    const hot = this.state === 'hunt';
    for (const o of m.extra) {
      const meshMat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
      meshMat.emissiveIntensity = (hot ? 2 : 1) * (1.0 + 0.4 * Math.sin(t * (hot ? 14 : 3)));
    }
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

export const _monsterShapes = { blob, mat };
