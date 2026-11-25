import * as THREE from 'three';
import type { Engine } from './engine';

/** Something you can pick up with a grip, carry and throw. */
export interface Item {
  obj: THREE.Object3D;
  /** How close a hand has to be (beyond this radius) to take it. */
  radius: number;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  /** The hand holding it, or -1. */
  held: -1 | 0 | 1;
  gravity: number;
  /** Height of the item's centre above the ground when it rests. */
  rest: number;
  bounce: number;
  holdOffset: THREE.Vector3;
  holdQuat: THREE.Quaternion;
  canGrab: boolean;
  /** What kind of thing it is: 'glow', 'torch', 'radar'. */
  kind: string;
  onHeld?(item: Item, hand: 0 | 1, trigger: boolean, dt: number): void;
  onGrab?(item: Item, hand: 0 | 1): void;
  onDrop?(item: Item): void;
  /** Called when it lands hard (for noise). */
  onImpact?(item: Item, speed: number): void;
  tick?(item: Item, dt: number): void;
  data: Record<string, unknown>;
}

export function makeItem(obj: THREE.Object3D, kind: string, radius = 0.15, extra: Partial<Item> = {}): Item {
  return {
    obj, kind, radius, vel: new THREE.Vector3(), spin: new THREE.Vector3(), held: -1, gravity: 9.8, rest: 0.04, bounce: 0.3,
    holdOffset: new THREE.Vector3(), holdQuat: new THREE.Quaternion(), canGrab: true, data: {}, ...extra,
  };
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Picks things up with the grip buttons and moves them. Items fall to whatever `floorAt` says. */
export class Grabbables {
  readonly items: Item[] = [];
  floorAt: (x: number, y: number, z: number) => number = () => 0;
  private readonly last = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly handVel = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly wasSqueezed = [false, false];
  private readonly holding: [Item | null, Item | null] = [null, null];
  private ready = false;

  constructor(private readonly e: Engine) {}

  add(item: Item): Item {
    this.items.push(item);
    return item;
  }

  remove(item: Item): void {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    for (const h of [0, 1] as const) if (this.holding[h] === item) this.holding[h] = null;
    item.held = -1;
  }

  heldBy(hand: 0 | 1): Item | null {
    return this.holding[hand];
  }

  drop(hand: 0 | 1): void {
    const item = this.holding[hand];
    if (!item) return;
    item.held = -1;
    item.vel.copy(this.handVel[hand]).multiplyScalar(1.1);
    item.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(5);
    this.holding[hand] = null;
    item.onDrop?.(item);
  }

  update(dt: number): void {
    const e = this.e;
    dt = Math.min(dt, 1 / 20);
    for (const h of [0, 1] as const) {
      const pos = e.locomotion.hands[h].position;
      if (this.ready && dt > 0) this.handVel[h].lerp(_p.subVectors(pos, this.last[h]).divideScalar(dt), 0.35);
      this.last[h].copy(pos);
      const hand = e.hands.all[h];
      const squeezed = hand.tracked && hand.squeezed;
      if (squeezed && !this.wasSqueezed[h] && !this.holding[h]) this.tryGrab(h, pos);
      if (!squeezed && this.holding[h]) this.drop(h);
      this.wasSqueezed[h] = squeezed;
    }
    this.ready = true;
    for (const item of this.items) {
      if (item.held !== -1) {
        const h: 0 | 1 = item.held;
        const pos = e.locomotion.hands[h].position;
        e.controller(h).getWorldQuaternion(_q);
        item.obj.quaternion.copy(_q).multiply(item.holdQuat);
        item.obj.position.copy(pos).add(_p.copy(item.holdOffset).applyQuaternion(_q));
        item.vel.set(0, 0, 0);
        item.onHeld?.(item, h, e.hands.all[h].triggered, dt);
      } else if (item.gravity !== 0 || item.vel.lengthSq() > 0) {
        item.vel.y -= item.gravity * dt;
        item.obj.position.addScaledVector(item.vel, dt);
        _e.set(item.spin.x * dt, item.spin.y * dt, item.spin.z * dt);
        item.obj.quaternion.multiply(_q.setFromEuler(_e));
        const floor = this.floorAt(item.obj.position.x, item.obj.position.y, item.obj.position.z);
        if (item.obj.position.y < floor + item.rest) {
          item.obj.position.y = floor + item.rest;
          if (item.vel.y < -2) item.onImpact?.(item, -item.vel.y);
          if (item.vel.y < 0) item.vel.y = -item.vel.y * item.bounce;
          if (Math.abs(item.vel.y) < 0.6) item.vel.y = 0;
          item.vel.x *= 1 - Math.min(1, dt * 5);
          item.vel.z *= 1 - Math.min(1, dt * 5);
          item.spin.multiplyScalar(1 - Math.min(1, dt * 6));
        }
      }
      item.tick?.(item, dt);
    }
  }

  private tryGrab(h: 0 | 1, pos: THREE.Vector3): void {
    let best: Item | null = null;
    let bestD = Infinity;
    for (const item of this.items) {
      if (!item.canGrab || item.held !== -1) continue;
      const d = item.obj.getWorldPosition(_p).distanceTo(pos) - item.radius;
      if (d < 0.24 && d < bestD) {
        bestD = d;
        best = item;
      }
    }
    if (!best) return;
    best.held = h;
    this.holding[h] = best;
    this.e.hands.all[h].pulse(0.4, 40);
    best.onGrab?.(best, h);
  }
}
