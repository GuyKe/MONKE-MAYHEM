import * as THREE from 'three';
import type { Tree } from './forest';
import type { Hands } from '../player/hands';
import type { Locomotion } from '../player/locomotion';

const YELLOW = 0xd0a020;
const DARK = 0x2c2c2c;
const STEEL = 0xa8aeb4;

export interface LoggerHooks {
  say(text: string): void;
  pulse(side: 'left' | 'right', strength: number, ms: number): void;
  /** Brings a tree down. */
  fell(tree: Tree, fromX: number, fromZ: number): boolean;
  surfaceAt(x: number, z: number): number;
  nearestTree(x: number, z: number, pad: number): Tree | null;
  waterLevelAt(x: number, z: number): number | null;
  /** A short sound: the saw biting. */
  sound(name: 'whoosh' | 'crash' | 'click' | 'scrape', at: THREE.Vector3): void;
}

/** How far in front of its middle the saw blade is. */
const SAW_AHEAD = 2.55;
const TOP_SPEED = 5;
const REVERSE_SPEED = -2.2;
const _fwd = new THREE.Vector3();
const _bar = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _hq = new THREE.Quaternion();

/**
 * The wood-cutting vehicle: a little yellow tractor with a circular saw on the front. Grab its handlebar to climb on.
 * While you hold on it goes where you face; push your gripping hand forward to go faster, pull it back to slow and
 * reverse. Squeeze a trigger and the saw spins and brings down any tree it reaches. Let go and you step off.
 */
export class Logger {
  readonly group = new THREE.Group();
  x: number;
  z: number;
  heading: number;
  /** The hand holding the bar, or null. */
  rider: 0 | 1 | null = null;
  speed = 0;
  sawing = false;
  /** Trees felled so far. */
  felled = 0;
  private readonly saw: THREE.Mesh;
  private readonly wheels: THREE.Mesh[] = [];
  private cooldown = 0;
  private told = false;

  constructor(
    scene: THREE.Scene,
    x: number,
    z: number,
    heading: number,
    private readonly hooks: LoggerHooks,
  ) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    const mat = (color: number, flat = true) => new THREE.MeshLambertMaterial({ color, flatShading: flat });
    const add = (geo: THREE.BufferGeometry, material: THREE.Material, at: [number, number, number], rot: [number, number, number] = [0, 0, 0]): THREE.Mesh => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(...at);
      m.rotation.set(...rot);
      this.group.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(1.3, 0.35, 2.3), mat(YELLOW), [0, 0.6, 0]); // chassis
    add(new THREE.BoxGeometry(0.95, 0.45, 0.8), mat(YELLOW), [0, 0.98, 0.75]); // engine
    add(new THREE.BoxGeometry(0.9, 0.06, 0.5), mat(DARK), [0, 1.22, 0.75]); // grille top
    add(new THREE.BoxGeometry(0.6, 0.12, 0.55), mat(0x222222), [0, 0.93, -0.5]); // seat
    add(new THREE.BoxGeometry(0.6, 0.45, 0.1), mat(0x222222), [0, 1.18, -0.8]); // back rest
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), mat(DARK), [0.3, 1.5, 0.95]); // exhaust
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), mat(STEEL), [0, 1.0, 0.1], [0.5, 0, 0]); // steering column
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), mat(STEEL), [0, 1.33, 0.28], [0, 0, Math.PI / 2]); // the handlebar
    const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 12).rotateZ(Math.PI / 2);
    for (const [wx, wz] of [[-0.75, 0.75], [0.75, 0.75], [-0.75, -0.7], [0.75, -0.7]]) this.wheels.push(add(wheelGeo, mat(DARK), [wx, 0.38, wz]));
    // The saw: an arm out front with a toothed blade on its end.
    add(new THREE.BoxGeometry(0.14, 0.12, 1.5), mat(STEEL), [0, 0.75, 1.75]);
    this.saw = add(new THREE.CylinderGeometry(0.62, 0.62, 0.035, 20).rotateZ(Math.PI / 2), mat(STEEL), [0, 0.78, SAW_AHEAD]);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 3), mat(0xdde3e8));
      tooth.position.set(0, Math.cos(a) * 0.66, Math.sin(a) * 0.66);
      tooth.rotation.x = a - Math.PI / 2 + 0.4;
      this.saw.add(tooth);
    }
    scene.add(this.group);
    this.place();
  }

  /** World position of the handlebar. */
  barPosition(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 1.33, 0.28);
    return this.group.localToWorld(out);
  }

  private place(): void {
    const y = this.hooks.surfaceAt(this.x, this.z);
    this.group.position.set(this.x, y, this.z);
    this.group.rotation.set(0, this.heading, 0);
  }

  /** Is `p` close enough to the handlebar to take hold? */
  private near(p: THREE.Vector3): boolean {
    return this.barPosition(_bar).distanceTo(p) < 0.4;
  }

  update(dt: number, head: THREE.Vector3, camQuat: THREE.Quaternion, hands: Hands, locomotion: Locomotion): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    _hq.copy(camQuat);
    // Climbing on: squeeze with a free hand at the handlebar.
    if (this.rider === null) {
      for (const i of [0, 1] as const) {
        if (hands.all[i].squeezed && locomotion.hands[i].initialized && this.near(locomotion.hands[i].position)) {
          this.rider = i;
          this.speed = 0;
          if (!this.told) {
            this.told = true;
            this.hooks.say('You are on. Face where you want to go and push your hand forward. Squeeze a trigger to run the saw.');
          }
          this.hooks.pulse(i === 0 ? 'left' : 'right', 0.8, 120);
          this.hooks.sound('click', this.group.position);
          break;
        }
      }
      this.speed *= 0.9;
    } else {
      const hand = hands.all[this.rider];
      if (!hand.squeezed) {
        this.rider = null;
        this.sawing = false;
      }
    }

    if (this.rider !== null) {
      // Steer towards where the head faces; the gripping hand is the throttle.
      _fwd.set(0, 0, -1).applyQuaternion(_hq);
      const want = Math.atan2(_fwd.x, _fwd.z);
      const turn = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
      this.heading += THREE.MathUtils.clamp(turn, -1.4 * dt, 1.4 * dt);
      const handPos = locomotion.hands[this.rider].position;
      const ahead = (handPos.x - head.x) * Math.sin(this.heading) + (handPos.z - head.z) * Math.cos(this.heading);
      const target = THREE.MathUtils.clamp((ahead - 0.45) * 8, REVERSE_SPEED, TOP_SPEED);
      this.speed += (target - this.speed) * Math.min(1, dt * 2.5);
      this.sawing = hands.left.triggered || hands.right.triggered;
    } else {
      this.sawing = false;
    }

    // Drive. It stops at trunks and the water's edge.
    if (Math.abs(this.speed) > 0.02) {
      const step = this.speed * dt;
      const nx = this.x + Math.sin(this.heading) * step;
      const nz = this.z + Math.cos(this.heading) * step;
      const ahead = step > 0 ? 1.0 : -1.0;
      const px = nx + Math.sin(this.heading) * ahead;
      const pz = nz + Math.cos(this.heading) * ahead;
      const blocked = this.hooks.nearestTree(px, pz, 0.7) !== null || this.hooks.waterLevelAt(px, pz) !== null || Math.abs(nx) > 205 || Math.abs(nz) > 205;
      if (blocked && !this.sawing) this.speed = 0;
      else if (!blocked) {
        this.x = nx;
        this.z = nz;
      }
    }
    this.place();
    for (const w of this.wheels) w.rotation.x += (this.speed / 0.38) * dt;

    // Carry the rider: they sit just behind the handlebar.
    if (this.rider !== null) {
      const seatX = this.x - Math.sin(this.heading) * 0.35;
      const seatZ = this.z - Math.cos(this.heading) * 0.35;
      _delta.set(seatX - head.x, 0, seatZ - head.z);
      if (_delta.lengthSq() > 1e-6) locomotion.carry(_delta);
    }

    // The saw.
    if (this.sawing) {
      this.saw.rotation.x += 40 * dt;
      const sx = this.x + Math.sin(this.heading) * SAW_AHEAD;
      const sz = this.z + Math.cos(this.heading) * SAW_AHEAD;
      const tree = this.hooks.nearestTree(sx, sz, 0.9);
      if (tree && this.cooldown <= 0) {
        this.cooldown = 0.6;
        if (this.hooks.fell(tree, this.x, this.z)) {
          this.felled++;
          this.hooks.sound('scrape', this.group.position);
          if (this.rider !== null) this.hooks.pulse(this.rider === 0 ? 'left' : 'right', 1, 200);
        }
      }
    }
  }
}
