import * as THREE from 'three';
import type { Stick, Sticks } from '../world/sticks';
import { PULL_TO_TEAR, type TreeRope, type TreeRopes } from '../world/ropes';
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
/** A held stick is driven toward the hand no faster than this (m/s, rad/s). */
const MAX_HOLD_SPEED = 30;
const MAX_HOLD_SPIN = 40;
/**
 * How hard the held stick is pulled toward the hand, per second of error, on top of copying
 * the hand's own velocity. Kept modest so that a blocked stick never builds up a push big
 * enough to force its way through whatever blocks it.
 */
const HOLD_STIFFNESS = 14;
const HOLD_SPIN_STIFFNESS = 20;
/** The catch-up part of the drive never exceeds this (m/s, rad/s). */
const MAX_CATCHUP_SPEED = 2.5;
const MAX_CATCHUP_SPIN = 12;
/** If something blocks a held stick this far from the hand for a moment, it is dropped. */
const BREAK_DISTANCE = 0.45;
const BREAK_TIME = 0.2;

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
  /** How long the held stick has been stuck far from the hand. */
  blockedFor: number;
  /** Where the hand's orientation was on the latest frame. */
  readonly lastQuat: THREE.Quaternion;
  /** A rope this hand is pulling on, and where the hand was when it took hold. */
  rope: TreeRope | null;
  ropeStartY: number;
  ropeBuzz: number;
  /** Where the stick was meant to be on the previous frame, for the target's velocity. */
  readonly lastTarget: THREE.Vector3;
  hasLastTarget: boolean;
}

const _handP = new THREE.Vector3();
const _handQ = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _lin = new THREE.Vector3();
const _ang = new THREE.Vector3();
const _lever = new THREE.Vector3();
const _swing = new THREE.Vector3();
const _targetP = new THREE.Vector3();
const _targetQ = new THREE.Quaternion();
const _drive = new THREE.Vector3();
const _spin = new THREE.Vector3();
const _dq = new THREE.Quaternion();

/** A hand this close to a hanging rope can take hold of it (metres). */
const ROPE_GRAB_RADIUS = 0.3;

/** Optional ways for other systems to join in. */
export interface GrabHooks {
  /** A held piece was let go at `handPos`. Return true to take it (it is then removed from the world). */
  stash?(stick: Stick, handPos: THREE.Vector3): boolean;
  /** A thrown stick has landed more than FAR_THROW metres from where it left the hand. */
  onFarThrow?(): void;
  /** Ropes hanging in trees that a hand can take hold of and pull down. */
  ropes?: TreeRopes;
  /** A rope was torn off its tree (the new coil is already in the hand). */
  onRopePulled?(coil: Stick): void;
  /** Called when a squeezed empty hand has nothing else to take: may make something to hold (a berry). */
  pick?(handPos: THREE.Vector3): Stick | null;
  /** A piece was thrown with this speed (m/s). */
  onThrow?(speed: number, at: THREE.Vector3): void;
  /** Something was picked up. */
  onGrab?(stick: Stick, side: 'left' | 'right'): void;
}

/** How far a throw must go to count as a far throw (metres, along the ground). */
export const FAR_THROW = 8;

interface Flight {
  stick: Stick;
  from: THREE.Vector3;
  time: number;
}

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
  private flights: Flight[] = [];

  constructor(
    private readonly sticks: Sticks,
    private readonly hands: Hands,
    private readonly hooks: GrabHooks = {},
  ) {}

  held(i: 0 | 1): Stick | null {
    return this.states[i].held;
  }

  /** Where hand `i` is and how it is turned, as of the latest frame. */
  handPose(i: 0 | 1, position: THREE.Vector3, rotation: THREE.Quaternion): void {
    position.copy(this.states[i].lastPos);
    rotation.copy(this.states[i].lastQuat);
  }

  /** How fast hand `i` has been moving over the last tenth of a second (m/s, world frame). */
  velocity(i: 0 | 1, out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    this.handMotion(this.states[i], out, _ang.set(0, 0, 0));
    return out;
  }

  /** Puts `stick` straight into hand `i` (for things made in the hand, such as a new axe). */
  give(i: 0 | 1, stick: Stick): void {
    const state = this.states[i];
    if (state.held?.hidden) state.held = null;
    if (state.held && state.held !== stick) this.release(i, false);
    this.hold(i, stick, state.lastPos, state.lastQuat);
  }

  /** Call once per frame after the player and hands have moved. */
  update(dt: number, contacts: [HandContact, HandContact]): void {
    this.trackFlights(dt);
    // Something in a hand may have been used up (made into a tool, put in the book). Let go of it
    // without touching it: its body no longer exists.
    for (const state of this.states) {
      if (state.held?.hidden) state.held = null;
    }
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
      hand.worldQuaternion(_handQ);
      state.lastQuat.copy(_handQ);
      this.record(state, contact.rawPosition, _handQ, dt);

      const squeezed = hand.squeezed;
      if (squeezed && !state.wasSqueezed && !state.held) this.tryGrab(i, _handP, _handQ);
      if (!squeezed && state.wasSqueezed && state.held) this.release(i, true);
      state.wasSqueezed = squeezed;
      if (state.rope) this.pullRope(i, state, squeezed, _handP, dt);

      if (state.held) {
        this.follow(i, state, _handP, _handQ, dt);
        this.setHover(i, null);
      } else {
        const near = this.sticks.nearest(_handP, HOVER_RADIUS);
        this.setHover(i, near ? near.stick : null);
      }
    }
  }

  private tryGrab(i: number, handP: THREE.Vector3, handQ: THREE.Quaternion): void {
    const near = this.sticks.nearest(handP, GRAB_RADIUS);
    if (!near) {
      const picked = this.hooks.pick?.(handP);
      if (picked) {
        this.hold(i, picked, handP, handQ);
        return;
      }
      // Nothing to pick up: is there a rope hanging here to pull on?
      const rope = this.hooks.ropes?.nearest(handP, ROPE_GRAB_RADIUS);
      if (rope && !rope.held) {
        const state = this.states[i];
        state.rope = rope;
        rope.held = true;
        state.ropeStartY = handP.y;
        state.ropeBuzz = 0;
        this.hands.all[i].pulse(0.4, 40);
      }
      return;
    }
    this.hold(i, near.stick, handP, handQ);
  }

  /** Takes hold of `stick` with hand `i`, so that it stays where it is relative to the hand. */
  private hold(i: number, stick: Stick, handP: THREE.Vector3, handQ: THREE.Quaternion): void {
    const state = this.states[i];

    // Taking it from the other hand: that hand just lets go.
    if (stick.heldBy !== null) {
      const other = stick.heldBy === 'left' ? 0 : 1;
      if (other !== i) this.release(other, false);
    }

    stick.heldBy = i === 0 ? 'left' : 'right';
    state.held = stick;
    // The stick stays a real dynamic body, so it collides with the ground, trees and other
    // sticks (including one in your other hand) instead of passing through them. Gravity and
    // damping are off while it is held so it doesn't sag or lag behind the hand.
    stick.body.setGravityScale(0, true);
    stick.body.setLinearDamping(0);
    stick.body.setAngularDamping(0);
    state.blockedFor = 0;
    state.hasLastTarget = false;

    // Remember the stick's pose in the hand's frame so it doesn't jump.
    _inv.copy(handQ).invert();
    state.offsetPos.copy(stick.pos).sub(handP).applyQuaternion(_inv);
    state.offsetRot.copy(_inv).multiply(stick.quat);

    this.setHover(i, null);
    this.hands.all[i].pulse(0.6, 40);
    this.hooks.onGrab?.(stick, i === 0 ? 'left' : 'right');
  }

  /** The hand is pulling on a hanging rope: it stretches, and tears free if pulled down far enough. */
  private pullRope(i: number, state: HandState, squeezed: boolean, handP: THREE.Vector3, dt: number): void {
    const rope = state.rope!;
    if (!squeezed || rope.taken) {
      rope.held = false;
      state.rope = null; // let go early: it springs back up
      return;
    }
    rope.pull = Math.min(PULL_TO_TEAR, Math.max(0, state.ropeStartY - handP.y));
    state.ropeBuzz -= dt;
    if (state.ropeBuzz <= 0 && rope.pull > 0.02) {
      state.ropeBuzz = 0.08;
      this.hands.all[i].pulse(0.2 + 0.6 * (rope.pull / PULL_TO_TEAR), 50); // a growing strain
    }
    if (rope.pull >= PULL_TO_TEAR) {
      this.hooks.ropes!.take(rope);
      state.rope = null;
      // It comes away in your hand as a coil.
      const coil = this.sticks.craft('rope', handP.clone(), new THREE.Quaternion());
      if (coil) {
        this.give(i as 0 | 1, coil);
        this.hooks.onRopePulled?.(coil);
      }
      this.hands.all[i].pulse(1, 140);
    }
  }

  /**
   * Drives the held stick toward where the hand wants it with a velocity, rather than putting
   * it there. Contacts still win, so a stick pressed against another stick, a trunk or the
   * ground stops there while the hand carries on.
   */
  private follow(i: number, state: HandState, handP: THREE.Vector3, handQ: THREE.Quaternion, dt: number): void {
    const stick = state.held!;
    const step = Math.max(dt, 1 / 144);
    _targetP.copy(state.offsetPos).applyQuaternion(handQ).add(handP);
    _targetQ.copy(handQ).multiply(state.offsetRot);

    // Copy the target's own velocity, plus a bounded pull to close any gap.
    _drive.subVectors(_targetP, stick.pos);
    const gap = _drive.length();
    _drive.multiplyScalar(HOLD_STIFFNESS);
    if (_drive.length() > MAX_CATCHUP_SPEED) _drive.setLength(MAX_CATCHUP_SPEED);
    if (state.hasLastTarget) _drive.addScaledVector(_swing.subVectors(_targetP, state.lastTarget), 1 / step);
    state.lastTarget.copy(_targetP);
    state.hasLastTarget = true;
    if (_drive.length() > MAX_HOLD_SPEED) _drive.setLength(MAX_HOLD_SPEED);

    // Shortest rotation from the stick's pose to the target, as a world-frame rotation.
    _dq.copy(_targetQ).multiply(_inv.copy(stick.quat).invert());
    if (_dq.w < 0) _dq.set(-_dq.x, -_dq.y, -_dq.z, -_dq.w);
    const angle = 2 * Math.acos(Math.min(1, _dq.w));
    const s = Math.sqrt(Math.max(0, 1 - _dq.w * _dq.w));
    _spin.set(0, 0, 0);
    if (s > 1e-4) _spin.set(_dq.x / s, _dq.y / s, _dq.z / s).multiplyScalar(angle * HOLD_SPIN_STIFFNESS);
    if (_spin.length() > MAX_CATCHUP_SPIN) _spin.setLength(MAX_CATCHUP_SPIN);
    if (_spin.length() > MAX_HOLD_SPIN) _spin.setLength(MAX_HOLD_SPIN);

    stick.body.setLinvel(_drive, true);
    stick.body.setAngvel(_spin, true);

    // Wedged against something while the hand moved on: let go rather than fight it.
    state.blockedFor = gap > BREAK_DISTANCE ? state.blockedFor + dt : 0;
    if (state.blockedFor > BREAK_TIME) {
      this.release(i, false);
      this.hands.all[i].pulse(0.8, 60);
    }
  }

  /** Lets go. With `throwIt` the stick keeps the hand's velocity and spin. */
  private release(i: number, throwIt: boolean): void {
    const state = this.states[i];
    const stick = state.held;
    if (!stick) return;
    state.held = null;
    stick.heldBy = null;
    if (stick.hidden) return; // used up already: nothing left to let go of

    // Held up to the book: it takes the stick instead.
    if (this.hooks.stash?.(stick, state.lastPos)) {
      this.sticks.stash(stick);
      this.hands.all[i].pulse(0.5, 40);
      return;
    }

    const body = stick.body;
    body.setGravityScale(1, true);
    body.setLinearDamping(0.05);
    body.setAngularDamping(0.3);
    stick.settling = false;

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
    if (throwIt) {
      this.hands.all[i].pulse(Math.min(1, 0.2 + lin.length() / 12), 30);
      if (lin.length() > 4) this.flights.push({ stick, from: stick.pos.clone(), time: 0 });
      if (lin.length() > 2.5) this.hooks.onThrow?.(lin.length(), stick.pos);
    }
  }

  /** Watches thrown sticks until they land, to see whether one went far. */
  private trackFlights(dt: number): void {
    if (!this.flights.length) return;
    this.flights = this.flights.filter((f) => {
      f.time += dt;
      if (f.stick.heldBy !== null || f.stick.hidden) return false; // caught again or put away
      const v = f.stick.body.linvel();
      const landed = f.time > 0.3 && Math.hypot(v.x, v.y, v.z) < 0.8;
      if (!landed && f.time < 6) return true;
      if (Math.hypot(f.stick.pos.x - f.from.x, f.stick.pos.z - f.from.z) >= FAR_THROW) this.hooks.onFarThrow?.();
      return false;
    });
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
    blockedFor: 0,
    lastQuat: new THREE.Quaternion(),
    rope: null,
    ropeStartY: 0,
    ropeBuzz: 0,
    lastTarget: new THREE.Vector3(),
    hasLastTarget: false,
  };
}
