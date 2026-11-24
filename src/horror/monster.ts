import * as THREE from 'three';
import { buildHuman, type Human } from '../mode/figures';
import { CELL, type Cell, type Facility } from './facility';

export type MonsterState = 'patrol' | 'hunt' | 'lurk' | 'away';

const _a = new THREE.Vector3();

/**
 * The thing in the facility. It patrols, and once it knows where you are it hunts you down the corridors, a little slower than
 * you can run but never tiring. It will not step into the safe room: it waits at the door and glares in, then loses interest.
 * Shine your torch on it and it flinches and slows.
 */
export class Monster {
  readonly group: THREE.Group;
  readonly human: Human;
  state: MonsterState = 'patrol';
  x: number;
  z: number;
  heading = 0;
  /** True while a torch beam is on it. */
  stunned = false;
  /** Times it has caught the player. */
  catches = 0;
  /** Distance to the player, for the heartbeat. */
  distance = Infinity;
  private path: Cell[] = [];
  private pathTimer = 0;
  private timer = 0;
  private cooldown = 0;
  private phase = 0;
  private target: Cell | null = null;
  private stepTimer = 0;
  private bob = 0;

  constructor(
    scene: THREE.Scene,
    private readonly f: Facility,
    private readonly hooks: { growl(at: THREE.Vector3): void; step(at: THREE.Vector3, loud: number): void },
  ) {
    this.human = buildHuman('monster', { skin: 0xc9c2b2, hair: 0x14100d, shirt: 0x231b18, pants: 0x1a1816, shoes: 0x0d0d0d });
    this.group = this.human.group;
    scene.add(this.group);
    const c = f.center(f.monsterStart);
    this.x = c.x;
    this.z = c.z;
    this.place();
  }

  /** Moves it far away (after it catches the player). */
  sendAway(seconds: number): void {
    const far = this.f.cells.flat().filter((c) => !this.f.isSafe(c) && Math.hypot(this.f.center(c).x - this.x, this.f.center(c).z - this.z) > 25);
    const c = far[Math.floor(Math.random() * far.length)] ?? this.f.monsterStart;
    const p = this.f.center(c);
    this.x = p.x;
    this.z = p.z;
    this.state = 'away';
    this.timer = seconds;
    this.path = [];
    this.place();
  }

  private place(): void {
    this.group.position.set(this.x, this.bob, this.z);
    this.group.rotation.y = this.heading;
  }

  /** The cell path from where it is to `to` (never through the safe room), or []. */
  private route(to: Cell): Cell[] {
    const from = this.f.cellAt(this.x, this.z);
    if (!from) return [];
    const prev = new Map<Cell, Cell | null>([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const c = queue.shift()!;
      if (c === to) break;
      for (const o of this.f.neighbours(c)) {
        if (prev.has(o) || this.f.isSafe(o)) continue;
        prev.set(o, c);
        queue.push(o);
      }
    }
    if (!prev.has(to)) return [];
    const out: Cell[] = [];
    for (let c: Cell | null = to; c; c = prev.get(c) ?? null) out.unshift(c);
    return out;
  }

  /**
   * `player` is the player's feet; `safe` is whether they are in the safe room; `lit` whether the torch is on the monster.
   * Returns true on the frame it catches the player.
   */
  update(dt: number, player: THREE.Vector3, safe: boolean, lit: boolean): boolean {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.timer -= dt;
    this.stunned = lit;
    const here = this.f.cellAt(this.x, this.z);
    const there = this.f.cellAt(player.x, player.z);
    this.distance = Math.hypot(player.x - this.x, player.z - this.z);

    // What it wants.
    if (this.state === 'away') {
      if (this.timer <= 0) this.state = 'patrol';
    } else if (safe) {
      // Out of reach: go to the doorway and wait.
      if (this.state === 'hunt') {
        this.state = 'lurk';
        this.timer = 18 + Math.random() * 10;
        this.target = null;
      }
      if (this.state === 'lurk' && this.timer <= 0) {
        this.state = 'away';
        this.timer = 12;
        this.cooldown = 10;
        this.sendTowards();
      }
    } else if (this.state === 'lurk') {
      this.state = 'hunt';
    } else if (this.state !== 'hunt' && this.cooldown <= 0 && here && there) {
      // Notices you when you are close, by the corridors.
      const route = this.route(there);
      if (route.length > 0 && route.length <= 5) {
        this.state = 'hunt';
        this.hooks.growl(_a.set(this.x, 1.5, this.z));
      }
    }

    // Where to.
    this.pathTimer -= dt;
    if (this.pathTimer <= 0) {
      this.pathTimer = 0.4;
      if (this.state === 'hunt' && there && !this.f.isSafe(there)) this.path = this.route(there);
      else if (this.state === 'lurk' && !this.target) {
        // The doorway nearest the safe room.
        const door = this.f.neighbours(this.f.safe).sort((a, b) => this.f.center(a).distanceTo(_a.set(this.x, 0, this.z)) - this.f.center(b).distanceTo(_a.set(this.x, 0, this.z)))[0];
        if (door) {
          this.target = door;
          this.path = this.route(door);
        }
      } else if (this.state === 'patrol' && (this.path.length === 0 || !this.target)) {
        const options = this.f.cells.flat().filter((c) => !this.f.isSafe(c));
        this.target = options[Math.floor(Math.random() * options.length)];
        this.path = this.route(this.target);
      } else if (this.state === 'lurk' && this.target) this.path = this.route(this.target);
      if (this.path.length && here && this.path[0] === here) this.path.shift();
    }

    // Move.
    let speed = this.state === 'hunt' ? 3.0 : this.state === 'patrol' ? 1.3 : this.state === 'away' ? 2.2 : 0;
    if (this.stunned) speed *= 0.25;
    let goalX = this.x;
    let goalZ = this.z;
    if (this.state === 'hunt' && here && there && here === there) {
      goalX = player.x;
      goalZ = player.z;
    } else if (this.path.length) {
      const next = this.f.center(this.path[0]);
      goalX = next.x;
      goalZ = next.z;
      if (Math.hypot(goalX - this.x, goalZ - this.z) < 0.35) {
        this.path.shift();
        if (!this.path.length && this.state === 'patrol') this.target = null;
      }
    } else if (this.state === 'lurk') {
      // Staring into the safe room.
      const s = this.f.center(this.f.safe);
      goalX = this.x;
      goalZ = this.z;
      this.faceTowards(s.x, s.z, dt);
    }
    const dx = goalX - this.x;
    const dz = goalZ - this.z;
    const d = Math.hypot(dx, dz);
    let moved = 0;
    if (d > 0.05 && speed > 0) {
      const step = Math.min(d, speed * dt);
      this.x += (dx / d) * step;
      this.z += (dz / d) * step;
      this.faceTowards(this.x + dx, this.z + dz, dt);
      moved = step;
    }
    // Never into the safe room.
    const c = this.f.cellAt(this.x, this.z);
    if (c && this.f.isSafe(c)) {
      this.x -= (dx / (d || 1)) * Math.max(moved, 0.05) * 1.5;
      this.z -= (dz / (d || 1)) * Math.max(moved, 0.05) * 1.5;
    }
    this.animate(dt, moved / Math.max(dt, 1e-4));
    this.place();

    // Footsteps you can hear coming.
    if (moved > 0) {
      this.stepTimer -= dt * (speed / 1.3);
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.55;
        this.hooks.step(_a.set(this.x, 0.1, this.z), Math.min(1, 6 / Math.max(2, this.distance)));
      }
    }

    // Caught?
    if (!safe && (this.state === 'hunt' || this.state === 'patrol') && Math.hypot(player.x - this.x, player.z - this.z) < 0.9 && Math.abs(player.y - 0.4) < 2.4) {
      this.catches++;
      return true;
    }
    return false;
  }

  private sendTowards(): void {
    this.path = [];
    this.target = null;
  }

  private faceTowards(x: number, z: number, dt: number): void {
    const want = Math.atan2(-(x - this.x), -(z - this.z)); // the model faces -Z
    let d = want - this.heading;
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
    this.heading += d * Math.min(1, dt * 6);
  }

  private animate(dt: number, speed: number): void {
    this.phase += dt * (3 + speed * 1.6);
    const swing = Math.min(1, speed / 2) * 0.7;
    this.human.legs[0].rotation.x = Math.sin(this.phase) * swing;
    this.human.legs[1].rotation.x = -Math.sin(this.phase) * swing;
    this.human.arms[0].rotation.x = -0.25 - Math.sin(this.phase) * swing * 0.5;
    this.human.arms[1].rotation.x = -0.25 + Math.sin(this.phase) * swing * 0.5;
    this.bob = Math.abs(Math.sin(this.phase)) * 0.04 * Math.min(1, speed);
    this.human.head.rotation.z = 0.18 + Math.sin(this.phase * 0.5) * 0.04 + (this.stunned ? Math.sin(performance.now() * 0.05) * 0.2 : 0);
    // Heavier when it is hunting: it leans in.
    this.human.group.rotation.x = this.state === 'hunt' ? 0.12 : 0;
  }
}

export const CELL_SIZE = CELL;
