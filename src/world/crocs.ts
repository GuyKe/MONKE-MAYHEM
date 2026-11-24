import * as THREE from 'three';
import { Baker } from './baker';
import type { ForestLake } from './forest';

type CrocState = 'lurk' | 'hunt' | 'retreat';

export interface Croc {
  x: number;
  y: number;
  z: number;
  heading: number;
  lake: ForestLake;
  state: CrocState;
  hp: number;
  cooldown: number;
  phase: number;
  tx: number;
  tz: number;
  /** How long it has lost you for. */
  lost: number;
  /** 0 to 1: how wide the jaws are open (snapping at you). */
  bite: number;
  group: THREE.Group;
  jaw: THREE.Mesh;
}

export interface CrocOptions {
  surfaceAt(x: number, z: number): number;
  waterLevelAt(x: number, z: number): number | null;
  /** The croc bit you. */
  onBite(damage: number, at: THREE.Vector3, target: string): void;
  /** A joined player hit a crocodile (its lake index): tell the host. */
  onRemoteHit?(lake: number, amount: number): void;
  /** One died (its lake index). */
  onDied?(lake: number): void;
  /** A croc died here. */
  onKill(at: THREE.Vector3): void;
}

const HP = 14;
const NOTICE = 28;
const BITE_REACH = 1.2;
const BITE_DAMAGE = 18;
/** How far from the water a crocodile will come after you (metres). */
const SHORE_REACH = 5;
const WATER_SPEED = 3.4;
const LAND_SPEED = 2.4;

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const blob = new THREE.IcosahedronGeometry(1, 1);
const cone = new THREE.ConeGeometry(1, 1, 5);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 5);

function part(b: Baker, geo: THREE.BufferGeometry, at: [number, number, number], size: [number, number, number], colour: number, rot: [number, number, number] = [0, 0, 0]): void {
  _m.compose(_p.set(...at), _q.setFromEuler(_e.set(...rot)), _s.set(...size));
  b.add(geo, _m, _c.set(colour));
}

const SKIN = 0x3f5c33;
const DARK = 0x2f4727;
const BELLY = 0x9fa86c;

/** Forward is +Z. */
function bodyGeometry(): THREE.BufferGeometry {
  const b = new Baker();
  part(b, blob, [0, 0.14, 0], [0.24, 0.15, 0.85], SKIN); // body
  part(b, blob, [0, 0.07, 0], [0.2, 0.09, 0.8], BELLY);
  part(b, blob, [0, 0.12, -0.95], [0.16, 0.1, 0.55], SKIN); // tail
  part(b, blob, [0, 0.1, -1.5], [0.1, 0.07, 0.5], SKIN);
  part(b, blob, [0, 0.08, -1.95], [0.05, 0.04, 0.35], DARK);
  part(b, blob, [0, 0.15, 0.95], [0.17, 0.11, 0.35], SKIN); // neck and head
  part(b, blob, [0, 0.14, 1.3], [0.13, 0.08, 0.4], SKIN); // upper snout
  for (const sx of [-1, 1]) {
    part(b, blob, [sx * 0.085, 0.27, 1.05], [0.045, 0.045, 0.05], 0xe8c030); // eyes
    part(b, blob, [sx * 0.085, 0.27, 1.07], [0.012, 0.03, 0.02], 0x120c06);
    // Legs, splayed.
    part(b, cyl, [sx * 0.26, 0.07, 0.45], [0.05, 0.14, 0.05], DARK, [0, 0, sx * -0.9]);
    part(b, cyl, [sx * 0.24, 0.07, -0.35], [0.055, 0.14, 0.055], DARK, [0, 0, sx * -0.9]);
    for (let k = 0; k < 4; k++) part(b, cone, [sx * 0.12, 0.2, 1.1 + k * 0.1], [0.01, 0.04, 0.01], 0xf4eed8, [Math.PI, 0, 0]); // teeth
  }
  // Ridges down the back.
  for (let i = 0; i < 9; i++) part(b, cone, [0, 0.27 - i * 0.008, 0.6 - i * 0.27], [0.04, 0.07, 0.04], DARK);
  return b.build();
}

function jawGeometry(): THREE.BufferGeometry {
  const b = new Baker();
  part(b, blob, [0, -0.02, 0.3], [0.11, 0.05, 0.38], BELLY);
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) part(b, cone, [sx * 0.09, 0.04, 0.2 + k * 0.1], [0.01, 0.04, 0.01], 0xf4eed8);
  return b.build();
}

/**
 * Crocodiles: the odd lake has one. It lurks with only its eyes above the water, and when you are in the water, or
 * near it, it comes for you, fast in water and slower on land (it will not follow you far from the shore).
 * Hit it hard with a weapon enough times and it dies.
 */
export class Crocs {
  readonly list: Croc[] = [];
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly bodyGeo = bodyGeometry();
  private readonly jawGeo = jawGeometry();
  private time = 0;
  /** Lakes whose crocodile has been killed (by index), for the save. */
  killed: number[] = [];
  /** Joined players do not simulate: they follow the host. */
  remote = false;
  private readonly lakes: ReadonlyArray<ForestLake>;

  constructor(
    private readonly scene: THREE.Scene,
    lakes: ReadonlyArray<ForestLake>,
    private readonly o: CrocOptions,
  ) {
    this.lakes = lakes;
    for (const lake of lakes) if (lake.croc) this.spawn(lake);
  }

  lakeIndex(c: Croc): number {
    return this.lakes.indexOf(c.lake);
  }

  /** What the host sends: [lake, x, z, heading, state, bite, hp] for each. */
  snapshot(): number[][] {
    return this.list.map((c) => [this.lakes.indexOf(c.lake), Math.round(c.x * 100) / 100, Math.round(c.z * 100) / 100, Math.round(c.heading * 100) / 100, c.state === 'lurk' ? 0 : c.state === 'hunt' ? 1 : 2, Math.round(c.bite * 100) / 100, c.hp]);
  }

  applySnapshot(list: number[][]): void {
    const states: CrocState[] = ['lurk', 'hunt', 'retreat'];
    for (const [lake, x, z, heading, state, bite, hp] of list) {
      const c = this.list.find((k) => this.lakes.indexOf(k.lake) === lake);
      if (!c) continue;
      c.tx = x;
      c.tz = z;
      c.heading = heading;
      c.state = states[state];
      c.bite = Math.max(c.bite, bite);
      c.hp = hp;
      if (Math.hypot(c.x - x, c.z - z) > 8) {
        c.x = x;
        c.z = z;
      }
    }
  }

  /** A crocodile died somewhere else. */
  killRemote(lake: number): void {
    const c = this.list.find((k) => this.lakes.indexOf(k.lake) === lake);
    if (!c) return;
    this.scene.remove(c.group);
    this.list.splice(this.list.indexOf(c), 1);
    this.killed.push(lake);
  }

  /** Removes the crocodiles of lakes where one was killed before. */
  restore(killed: number[]): void {
    this.killed = [...killed];
    for (const i of killed) {
      const lake = this.lakes[i];
      const c = this.list.find((k) => k.lake === lake);
      if (c) {
        this.scene.remove(c.group);
        this.list.splice(this.list.indexOf(c), 1);
      }
    }
  }

  private spawn(lake: ForestLake): void {
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.bodyGeo, this.material);
    body.frustumCulled = false;
    const jaw = new THREE.Mesh(this.jawGeo, this.material);
    jaw.position.set(0, 0.1, 0.9);
    jaw.frustumCulled = false;
    group.add(body, jaw);
    this.scene.add(group);
    const a = Math.random() * Math.PI * 2;
    const d = lake.r * 0.4 * Math.random();
    const x = lake.x + Math.cos(a) * d;
    const z = lake.z + Math.sin(a) * d;
    this.list.push({ x, y: lake.level, z, heading: Math.random() * 6.28, lake, state: 'lurk', hp: HP, cooldown: 0, phase: Math.random() * 10, tx: x, tz: z, lost: 0, bite: 0, group, jaw });
  }

  /** The nearest living croc within `reach` of a point (about 2.5 m long, low to the water). */
  nearest(point: THREE.Vector3, reach: number): Croc | null {
    let best: Croc | null = null;
    let bestD = reach;
    for (const c of this.list) {
      // Along its body: head and middle and tail.
      for (const along of [1.2, 0.3, -0.6, -1.4]) {
        const bx = c.x + Math.sin(c.heading) * along;
        const bz = c.z + Math.cos(c.heading) * along;
        const d = Math.hypot(bx - point.x, bz - point.z, Math.max(0, Math.abs(c.y + 0.15 - point.y) - 0.15));
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return best;
  }

  /** Hurts a croc; returns true if that killed it. */
  damage(c: Croc, amount: number): boolean {
    if (this.remote) {
      this.o.onRemoteHit?.(this.lakes.indexOf(c.lake), amount);
      return false;
    }
    c.hp -= amount;
    if (c.hp > 0) {
      if (c.hp < HP * 0.3) {
        c.state = 'retreat';
        c.lost = 0;
      }
      return false;
    }
    this.scene.remove(c.group);
    this.list.splice(this.list.indexOf(c), 1);
    this.killed.push(this.lakes.indexOf(c.lake));
    this.o.onDied?.(this.lakes.indexOf(c.lake));
    this.o.onKill(new THREE.Vector3(c.x, c.y + 0.2, c.z));
    return true;
  }

  /** `player` is the head position; `inWater` is whether the player is in a lake. */
  update(dt: number, player: THREE.Vector3, inWater: boolean, others: ReadonlyArray<{ pos: THREE.Vector3; inWater: boolean; id: string }> = []): void {
    this.time += dt;
    for (const c of this.list) {
      // It goes for whichever player is nearest.
      let tp = player;
      let tw = inWater;
      let tid = 'me';
      let dist = Math.hypot(player.x - c.x, player.z - c.z);
      for (const o of others) {
        const d = Math.hypot(o.pos.x - c.x, o.pos.z - c.z);
        if (d < dist) {
          dist = d;
          tp = o.pos;
          tw = o.inWater;
          tid = o.id;
        }
      }
      if (this.remote) {
        // Follow the host's crocodile.
        const k = Math.min(1, dt * 8);
        c.x += (c.tx - c.x) * k;
        c.z += (c.tz - c.z) * k;
        const level = this.o.waterLevelAt(c.x, c.z);
        c.y += ((level !== null ? level - (c.state === 'hunt' ? 0.08 : 0.15) : this.o.surfaceAt(c.x, c.z) + 0.02) - c.y) * Math.min(1, dt * 6);
        c.bite = Math.max(0, c.bite - dt * 3);
        c.group.visible = dist < 140;
        c.group.position.set(c.x, c.y, c.z);
        c.group.rotation.set(0, c.heading, 0);
        c.jaw.rotation.x = -c.bite * 0.55;
        continue;
      }
      c.cooldown = Math.max(0, c.cooldown - dt);
      c.bite = Math.max(0, c.bite - dt * 3);
      const lake = c.lake;
      if (dist > 140) {
        c.group.visible = false;
        continue;
      }
      c.group.visible = true;
      const toLake = Math.hypot(tp.x - lake.x, tp.z - lake.z);
      const reachable = tw && toLake < lake.r + 8 ? true : toLake < lake.r + SHORE_REACH + 4;
      const wants = reachable && dist < NOTICE;

      if (c.state === 'retreat') {
        c.lost += dt;
        c.tx = lake.x;
        c.tz = lake.z;
        if (c.lost > 12) {
          c.state = 'lurk';
          c.hp = Math.min(HP, c.hp + 6);
        }
      } else if (wants) {
        c.state = 'hunt';
        c.lost = 0;
      } else if (c.state === 'hunt') {
        c.lost += dt;
        if (c.lost > 5) c.state = 'lurk';
      }

      let speed = 0;
      let tx = c.tx;
      let tz = c.tz;
      if (c.state === 'hunt') {
        tx = tp.x;
        tz = tp.z;
        speed = WATER_SPEED;
      } else if (c.state === 'retreat') {
        speed = WATER_SPEED;
      } else {
        // Drift about the lake.
        if (Math.hypot(c.tx - c.x, c.tz - c.z) < 1.5 || Math.random() < dt * 0.05) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.sqrt(Math.random()) * lake.r * 0.8;
          c.tx = lake.x + Math.cos(a) * d;
          c.tz = lake.z + Math.sin(a) * d;
        }
        tx = c.tx;
        tz = c.tz;
        speed = 0.45;
      }

      const want = Math.atan2(tx - c.x, tz - c.z);
      let turn = want - c.heading;
      turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
      c.heading += turn * Math.min(1, dt * (c.state === 'hunt' ? 5 : 2));

      const stopAt = c.state === 'hunt' ? 0.9 : 0.3;
      if (speed > 0 && Math.hypot(tx - c.x, tz - c.z) > stopAt) {
        const wet = this.o.waterLevelAt(c.x, c.z) !== null;
        const step = (wet ? speed : LAND_SPEED) * dt;
        const nx = c.x + Math.sin(c.heading) * step;
        const nz = c.z + Math.cos(c.heading) * step;
        const nextWet = this.o.waterLevelAt(nx, nz) !== null;
        const shoreD = Math.hypot(nx - lake.x, nz - lake.z) - (lake.r + 7);
        if (nextWet || shoreD < SHORE_REACH - 3) {
          c.x = nx;
          c.z = nz;
        } else if (c.state === 'hunt') {
          // At the edge of where it will go: it waits, jaws working.
          c.bite = Math.max(c.bite, 0.35 + 0.35 * Math.sin(this.time * 6));
        }
      }

      // At the surface when in water, on the ground when out of it.
      const level = this.o.waterLevelAt(c.x, c.z);
      const targetY = level !== null ? level - (c.state === 'hunt' ? 0.08 : 0.15) : this.o.surfaceAt(c.x, c.z) + 0.02;
      c.y += (targetY - c.y) * Math.min(1, dt * 6);

      // Snap at you.
      if (c.state === 'hunt' && c.cooldown <= 0) {
        _p.set(c.x + Math.sin(c.heading) * 1.2, c.y, c.z + Math.cos(c.heading) * 1.2);
        const reach = Math.hypot(tp.x - _p.x, tp.z - _p.z);
        if (reach < BITE_REACH && Math.abs(tp.y - (c.y + 0.3)) < 1.4) {
          c.cooldown = 1.8;
          c.bite = 1;
          this.o.onBite(BITE_DAMAGE, _p.clone(), tid);
        }
      }

      c.group.position.set(c.x, c.y, c.z);
      c.group.rotation.set(0, c.heading + Math.sin(this.time * 2 + c.phase) * 0.03 * (speed > 0 ? 3 : 1), 0);
      c.jaw.rotation.x = -c.bite * 0.55;
    }
  }
}
