import * as THREE from 'three';
import type { Runtime } from './runtime';
import { gun } from './things';

/** Something you can pick up (grip), carry and throw. It falls under its own gravity when let go. */
export interface Item {
  obj: THREE.Object3D;
  /** How close a hand has to be to take it, beyond this radius. */
  radius: number;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  /** -1 while loose, else the hand holding it. */
  held: -1 | 0 | 1;
  gravity: number;
  floorY: number;
  /** Height of the item's centre above the floor when it rests. */
  rest: number;
  bounce: number;
  /** Where it sits relative to the hand (hand's space) and how it is turned in the hand. */
  holdOffset: THREE.Vector3;
  holdQuat: THREE.Quaternion;
  canGrab: boolean;
  /** Called every frame while held, with the trigger state of that hand. */
  onHeld?(item: Item, hand: 0 | 1, triggered: boolean, dt: number): void;
  onGrab?(item: Item, hand: 0 | 1): void;
  onDrop?(item: Item): void;
  /** Called every frame (held or not) after the movement. */
  tick?(item: Item, dt: number): void;
  data: Record<string, unknown>;
}

export function makeItem(obj: THREE.Object3D, radius = 0.2, extra: Partial<Item> = {}): Item {
  return {
    obj, radius, vel: new THREE.Vector3(), spin: new THREE.Vector3(), held: -1, gravity: 9.8, floorY: 0, rest: 0.05, bounce: 0.3,
    holdOffset: new THREE.Vector3(), holdQuat: new THREE.Quaternion(), canGrab: true, data: {}, ...extra,
  };
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Picks things up with the grip buttons and moves them about. */
export class Grabbables {
  readonly items: Item[] = [];
  /** Height of the ground (or a table) under a place. */
  floorAt: (x: number, z: number) => number = () => 0;
  /** Which hands are allowed to take things. */
  allowed: [boolean, boolean] = [true, true];
  private readonly last = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly handVel = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly wasSqueezed = [false, false];
  private readonly holding: [Item | null, Item | null] = [null, null];
  private ready = false;

  constructor(private readonly rt: Runtime) {}

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

  /** Puts `item` in `hand` (let go of what it holds). */
  take(item: Item, hand: 0 | 1): void {
    this.drop(hand);
    item.held = hand;
    this.holding[hand] = item;
  }

  drop(hand: 0 | 1): void {
    const item = this.holding[hand];
    if (!item) return;
    item.held = -1;
    item.vel.copy(this.handVel[hand]).multiplyScalar(1.1);
    item.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(6);
    this.holding[hand] = null;
    item.onDrop?.(item);
  }

  update(dt: number): void {
    const rt = this.rt;
    dt = Math.min(dt, 1 / 20);
    for (const h of [0, 1] as const) {
      const pos = rt.locomotion.hands[h].position;
      if (this.ready && dt > 0) this.handVel[h].lerp(_p.subVectors(pos, this.last[h]).divideScalar(dt), 0.35);
      this.last[h].copy(pos);
      const hand = rt.hands.all[h];
      const squeezed = hand.tracked && hand.squeezed;
      if (squeezed && !this.wasSqueezed[h] && !this.holding[h] && this.allowed[h]) this.tryGrab(h, pos);
      if (!squeezed && this.holding[h]) this.drop(h);
      this.wasSqueezed[h] = squeezed;
    }
    this.ready = true;
    for (const item of this.items) {
      if (item.held !== -1) {
        const h: 0 | 1 = item.held;
        const pos = rt.locomotion.hands[h].position;
        rt.controllerFor(h).getWorldQuaternion(_q);
        item.obj.quaternion.copy(_q).multiply(item.holdQuat);
        item.obj.position.copy(pos).add(_p.copy(item.holdOffset).applyQuaternion(_q));
        item.vel.set(0, 0, 0);
        item.onHeld?.(item, h, rt.hands.all[h].triggered, dt);
      } else if (item.gravity !== 0 || item.vel.lengthSq() > 0) {
        item.vel.y -= item.gravity * dt;
        item.obj.position.addScaledVector(item.vel, dt);
        _e.set(item.spin.x * dt, item.spin.y * dt, item.spin.z * dt);
        item.obj.quaternion.multiply(_q.setFromEuler(_e));
        const floor = Math.max(item.floorY, this.floorAt(item.obj.position.x, item.obj.position.z));
        if (item.obj.position.y < floor + item.rest) {
          item.obj.position.y = floor + item.rest;
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
      if (!item.canGrab || item.held >= 0) continue;
      const d = item.obj.getWorldPosition(_p).distanceTo(pos) - item.radius;
      if (d < 0.22 && d < bestD) {
        bestD = d;
        best = item;
      }
    }
    if (!best) return;
    best.held = h;
    this.holding[h] = best;
    this.rt.hands.all[h].pulse(0.4, 40);
    best.onGrab?.(best, h);
  }
}

/** A short-lived line for a shot. */
export class Tracers {
  private readonly lines: Array<{ line: THREE.Line; life: number }> = [];
  private n = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < 10; i++) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0xfff0a0, transparent: true, fog: false }));
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      this.lines.push({ line, life: 0 });
    }
  }

  fire(from: THREE.Vector3, to: THREE.Vector3): void {
    const t = this.lines[this.n++ % this.lines.length];
    const pos = t.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.line.visible = true;
    t.life = 0.08;
  }

  update(dt: number): void {
    for (const t of this.lines) {
      if (!t.line.visible) continue;
      t.life -= dt;
      if (t.life <= 0) t.line.visible = false;
    }
  }
}

/**
 * Makes a gun you can pick up. Pulling the trigger fires `onFire(origin, direction)`. The gun is held by its grip, pointing along
 * the controller.
 */
export function addGun(rt: Runtime, grabbables: Grabbables, tracers: Tracers, at: THREE.Vector3, onFire: (origin: THREE.Vector3, dir: THREE.Vector3) => THREE.Vector3 | null, color?: number): Item {
  const obj = gun(color);
  obj.position.copy(at);
  rt.scene.add(obj);
  const muzzle = obj.userData.muzzle as THREE.Vector3;
  const flash = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), new THREE.MeshBasicMaterial({ color: 0xffe080, fog: false }));
  flash.position.copy(muzzle);
  flash.visible = false;
  obj.add(flash);
  let cooldown = 0;
  let wasDown = false;
  let flashT = 0;
  const _o = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const item = makeItem(obj, 0.18, {
    rest: 0.05,
    onHeld: (it, hand, trigger, dt) => {
      cooldown -= dt;
      if (flashT > 0) {
        flashT -= dt;
        if (flashT <= 0) flash.visible = false;
      }
      if (trigger && !wasDown && cooldown <= 0) {
        cooldown = 0.18;
        _o.copy(muzzle);
        it.obj.localToWorld(_o);
        _d.set(0, 0, -1).transformDirection(it.obj.matrixWorld);
        flash.visible = true;
        flashT = 0.05;
        rt.audio.play('bang', _o, 1);
        rt.hands.all[hand].pulse(0.7, 60);
        const hit = onFire(_o.clone(), _d.clone());
        tracers.fire(_o, hit ?? _o.clone().addScaledVector(_d, 60));
      }
      wasDown = trigger;
    },
  });
  grabbables.add(item);
  return item;
}

/** Rays against spheres: the distance along the ray to the first sphere hit, or null. */
export function raySphere(origin: THREE.Vector3, dir: THREE.Vector3, centre: THREE.Vector3, radius: number): number | null {
  const ox = centre.x - origin.x;
  const oy = centre.y - origin.y;
  const oz = centre.z - origin.z;
  const t = ox * dir.x + oy * dir.y + oz * dir.z;
  if (t < 0) return null;
  const d2 = ox * ox + oy * oy + oz * oz - t * t;
  if (d2 > radius * radius) return null;
  return t - Math.sqrt(radius * radius - d2);
}
