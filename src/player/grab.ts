import * as THREE from 'three';
import { RAPIER } from '../physics';
import type { Stick, Sticks } from '../world/sticks';
import type { HandContact } from './locomotion';
import type { Hands } from './hands';

/** A stick this close to your hand (surface to hand centre, metres) can be grabbed. */
const GRAB_RADIUS = 0.13;
/** Sticks this close are highlighted so you can see what you would grab. */
const HOVER_RADIUS = 0.2;
/** Thrown sticks never leave the hand faster than this. */
const MAX_THROW_SPEED = 25;
/** Hand motion over this long before release gives the throw velocity. */
const THROW_WINDOW = 0.1;

interface Sample {
  readonly p: THREE.Vector3;
  readonly q: THREE.Quaternion;
  dt: number;
}

interface HandState {
  held: Stick | null;
  wasSqueezed: boolean;
  hovered: Stick | null;
  /** Where the stick sits relative to the hand when grabbed. */
  readonly offsetPos: THREE.Vector3;
  readonly offsetRot: THREE.Quaternion;
  /** Recent hand poses, newest last, for throw velocity. */
  readonly history: Sample[];
  /** Where this hand was on the latest frame. */
  readonly lastPos: THREE.Vector3;
}

const _handP = new THREE.Vector3();
const _handQ = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _lin = new THREE.Vector3();
const _ang = new THREE.Vector3();
const _lever = new THREE.Vector3();
const _swing = new THREE.Vector3();
const _dq = new THREE.Quaternion();

/**
 * Grabbing with the grip button.
 *
 * Squeeze the grip with a stick within reach to pick it up. It stays exactly where
 * you took hold of it relative to your hand. Let go to throw it: it keeps the
 * velocity and spin of your hand. Grabbing a stick the other hand is holding takes
 * it over. Squeezing while holding nothing in reach does nothing; the grip must be
 * pressed anew to grab.
 */
export class Grab {
  private readonly states: [HandState, HandState] = [newState(), newState()];

  constructor(
    private readonly sticks: Sticks,
    private readonly hands: Hands,
  ) {}

  held(i: 0 | 1): Stick | null {
    return this.states[i].held;
  }

  /** Call once per frame after the player and hands have moved. */
  update(dt: number, contacts: [HandContact, HandContact]): void {
    for (let i = 0; i < 2; i++) {
      const hand = this.hands.all[i];
      const state = this.states[i];
      const contact = contacts[i];

      if (!hand.tracked || !hand.grip) {
        if (state.held) this.release(i, false);
        state.wasSqueezed = false;
        state.history.length = 0;
        this.setHover(i, null);
        continue;
      }

      _handP.copy(contact.position);
      state.lastPos.copy(_handP);
      _handQ.copy(hand.grip.quaternion); // the rig is never rotated, so this is a world rotation
      this.record(state, contact.rawPosition, _handQ, dt);

      const squeezed = hand.squeezed;
      if (squeezed && !state.wasSqueezed && !state.held) this.tryGrab(i, _handP, _handQ);
      if (!squeezed && state.wasSqueezed && state.held) this.release(i, true);
      state.wasSqueezed = squeezed;

      if (state.held) {
        this.follow(state, _handP, _handQ);
        this.setHover(i, null);
      } else {
        const near = this.sticks.nearest(_handP, HOVER_RADIUS);
        this.setHover(i, near ? near.stick : null);
      }
    }
  }

  private tryGrab(i: number, handP: THREE.Vector3, handQ: THREE.Quaternion): void {
    const near = this.sticks.nearest(handP, GRAB_RADIUS);
    if (!near) return;
    const stick = near.stick;
    const state = this.states[i];

    // Taking it from the other hand: that hand just lets go.
    if (stick.heldBy !== null) {
      const other = stick.heldBy === 'left' ? 0 : 1;
      if (other !== i) this.release(other, false);
    }

    stick.heldBy = i === 0 ? 'left' : 'right';
    state.held = stick;
    stick.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);

    // Remember the stick's pose in the hand's frame so it doesn't jump.
    _inv.copy(handQ).invert();
    state.offsetPos.copy(stick.pos).sub(handP).applyQuaternion(_inv);
    state.offsetRot.copy(_inv).multiply(stick.quat);

    this.setHover(i, null);
    this.hands.all[i].pulse(0.6, 40);
  }

  private follow(state: HandState, handP: THREE.Vector3, handQ: THREE.Quaternion): void {
    const stick = state.held!;
    stick.pos.copy(state.offsetPos).applyQuaternion(handQ).add(handP);
    stick.quat.copy(handQ).multiply(state.offsetRot);
    stick.body.setNextKinematicTranslation(stick.pos);
    stick.body.setNextKinematicRotation(stick.quat);
  }

  /** Lets go. With `throwIt` the stick keeps the hand's velocity and spin. */
  private release(i: number, throwIt: boolean): void {
    const state = this.states[i];
    const stick = state.held;
    if (!stick) return;
    state.held = null;
    stick.heldBy = null;

    const body = stick.body;
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    body.setTranslation(stick.pos, true);
    body.setRotation(stick.quat, true);

    const lin = _lin.set(0, 0, 0);
    const ang = _ang.set(0, 0, 0);
    if (throwIt) {
      this.handMotion(state, lin, ang);
      // The stick's centre is away from the hand, so it also swings with the hand's spin.
      _lever.copy(stick.pos).sub(state.lastPos);
      lin.add(_swing.copy(ang).cross(_lever));
      if (lin.length() > MAX_THROW_SPEED) lin.setLength(MAX_THROW_SPEED);
    }

    body.setLinvel(lin, true);
    body.setAngvel(ang, true);
    if (throwIt) this.hands.all[i].pulse(Math.min(1, 0.2 + lin.length() / 12), 30);
  }

  /** Velocity and angular velocity of the hand over the last moments. */
  private handMotion(state: HandState, lin: THREE.Vector3, ang: THREE.Vector3): void {
    const h = state.history;
    if (h.length < 2) return;
    let first = h.length - 1;
    let t = 0;
    while (first > 0 && t < THROW_WINDOW) {
      t += h[first].dt;
      first--;
    }
    if (t <= 1e-4) return;
    const a = h[first];
    const b = h[h.length - 1];
    lin.subVectors(b.p, a.p).divideScalar(t);

    // Angular velocity: the rotation that took the hand from `a` to `b`, spread over t.
    _dq.copy(a.q).invert().premultiply(b.q); // b * inverse(a), a world-frame rotation
    if (_dq.w < 0) _dq.set(-_dq.x, -_dq.y, -_dq.z, -_dq.w);
    const angle = 2 * Math.acos(Math.min(1, _dq.w));
    const s = Math.sqrt(Math.max(0, 1 - _dq.w * _dq.w));
    if (s > 1e-4) ang.set(_dq.x / s, _dq.y / s, _dq.z / s).multiplyScalar(angle / t);
  }

  private record(state: HandState, rawPos: THREE.Vector3, q: THREE.Quaternion, dt: number): void {
    const h = state.history;
    // Reuse the oldest sample's objects once the buffer is full.
    const sample = h.length >= 8 ? h.shift()! : { p: new THREE.Vector3(), q: new THREE.Quaternion(), dt: 0 };
    sample.p.copy(rawPos);
    sample.q.copy(q);
    sample.dt = dt;
    h.push(sample);
  }

  private setHover(i: number, stick: Stick | null): void {
    const state = this.states[i];
    if (state.hovered === stick) return;
    if (state.hovered && !this.states.some((s, k) => k !== i && s.hovered === state.hovered)) state.hovered.highlighted = false;
    state.hovered = stick;
    if (stick) {
      stick.highlighted = true;
      this.hands.all[i].pulse(0.12, 15); // a small tick when something becomes grabbable
    }
  }
}

function newState(): HandState {
  return {
    held: null,
    wasSqueezed: false,
    hovered: null,
    offsetPos: new THREE.Vector3(),
    offsetRot: new THREE.Quaternion(),
    history: [],
    lastPos: new THREE.Vector3(),
  };
}
