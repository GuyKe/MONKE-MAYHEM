import * as THREE from 'three';
import type { Animals } from '../world/animals';
import type { Crocs } from '../world/crocs';
import { WEAPON_POWER, type Side, type Stick, type Sticks } from '../world/sticks';
import type { Grab } from './grab';

export interface CombatHooks {
  pulse(side: Side, strength: number, ms: number): void;
  burst(at: THREE.Vector3, count: number): void;
  say(text: string): void;
  /** A weapon struck something. */
  onHit?(): void;
}

/** A weapon has to be moving this fast (m/s) at the point of impact to hurt. */
const MIN_SPEED = 2.4;
/** A fist, hand speed needed and damage. */
const FIST_SPEED = 3.6;
const FIST_POWER = 0.45;
const _tip = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Fighting. Anything you swing hurts animals and crocodiles by how fast its business end is moving when it hits,
 * and how heavy a weapon it is: a club hits harder than a knife, but a knife is quick. Thrown spears and axes
 * hurt too. Bare hands do a little.
 */
export class Combat {
  private readonly lastTip = new Map<Stick, THREE.Vector3>();
  private readonly cooldown = new Map<object, number>();
  private readonly lastHand: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  private handKnown = [false, false];
  /** Hits so far, for tests. */
  hits = 0;

  constructor(
    private readonly sticks: Sticks,
    private readonly grab: Grab,
    private readonly animals: Animals | null,
    private readonly crocs: Crocs | null,
    private readonly hooks: CombatHooks,
  ) {}

  update(dt: number): void {
    for (const [k, t] of this.cooldown) {
      if (t - dt <= 0) this.cooldown.delete(k);
      else this.cooldown.set(k, t - dt);
    }
    for (const side of [0, 1] as const) {
      const held = this.grab.held(side);
      this.grab.handPose(side, _hand, _q);
      if (held && WEAPON_POWER[held.kind]) {
        this.weapon(held, dt, side);
      } else if (!held) {
        this.fist(side, dt);
      }
      if (held === null) {
        this.lastHand[side].copy(_hand);
        this.handKnown[side] = true;
      }
    }
    // Pieces in flight.
    for (const stick of this.sticks.list) {
      if (stick.hidden || stick.heldBy !== null) continue;
      const power = WEAPON_POWER[stick.kind];
      if (!power || stick.kind === 'stick' || stick.kind === 'log' || stick.kind === 'torch' || stick.kind === 'pole') continue;
      const v = stick.body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed < 5) {
        this.lastTip.delete(stick);
        continue;
      }
      this.sticks.headPosition(stick, _tip);
      // Spears fly point first, so the tip is the top end.
      if (stick.kind === 'spear') _tip.copy(stick.pos).addScaledVector(_v.set(0, 1, 0).applyQuaternion(stick.quat), stick.length / 2);
      this.strike(stick, _tip, speed * 0.85, power, null, true);
    }
  }

  private weapon(stick: Stick, dt: number, side: 0 | 1): void {
    const power = WEAPON_POWER[stick.kind]!;
    // The business end: the head on a tool, otherwise the far tip.
    if (stick.hasHead) this.sticks.headPosition(stick, _tip);
    else _tip.copy(stick.pos).addScaledVector(_v.set(0, 1, 0).applyQuaternion(stick.quat), stick.length / 2);
    const last = this.lastTip.get(stick);
    let speed = 0;
    if (last && dt > 0) speed = _w.subVectors(_tip, last).length() / dt;
    if (last) last.copy(_tip);
    else this.lastTip.set(stick, _tip.clone());
    if (speed < MIN_SPEED) return;
    this.strike(stick, _tip, speed, power, side === 0 ? 'left' : 'right', false);
  }

  private fist(side: 0 | 1, dt: number): void {
    if (!this.handKnown[side] || dt <= 0) return;
    const speed = _w.subVectors(_hand, this.lastHand[side]).length() / dt;
    if (speed < FIST_SPEED) return;
    this.strike(this.lastHand[side], _hand, speed, FIST_POWER, side === 0 ? 'left' : 'right', false);
  }

  private strike(who: object, at: THREE.Vector3, speed: number, power: number, side: Side | null, thrown: boolean): void {
    const animal = this.animals?.nearest(at, 0.28) ?? null;
    const croc = animal ? null : (this.crocs?.nearest(at, 0.4) ?? null);
    const target = animal ?? croc;
    if (!target || (this.cooldown.get(target) ?? 0) > 0) return;
    this.cooldown.set(target, 0.45);
    const damage = power * THREE.MathUtils.clamp(speed / 5, 0.5, 1.6);
    this.hits++;
    this.hooks.burst(at, 5);
    this.hooks.onHit?.();
    if (side) this.hooks.pulse(side, 1, 90);
    let killed = false;
    if (animal) killed = this.animals!.damage(animal, damage);
    else if (croc) killed = this.crocs!.damage(croc, damage);
    if (killed) this.hooks.say(croc ? 'The crocodile is dead.' : 'You killed it. It dropped meat.');
    if (thrown) {
      // A thrown weapon stops where it hits.
      const stick = who as Stick;
      stick.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
  }
}
