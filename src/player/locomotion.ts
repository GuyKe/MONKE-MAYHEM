import * as THREE from 'three';
import { LOCOMOTION as C } from '../config';
import { PLAYER_GROUPS, QUERY_WORLD, RAPIER } from '../physics';

/** Per-hand contact state. */
export interface HandContact {
  /** Where the hand is in the world: the raw controller position, unless a surface stopped it. */
  readonly position: THREE.Vector3;
  /** Raw (arm-clamped) controller position in the world, for debug visuals. */
  readonly rawPosition: THREE.Vector3;
  touching: boolean;
  wasTouching: boolean;
  /** True on the frame the hand first touched a surface (for haptics / sounds). */
  justTouched: boolean;
  initialized: boolean;
}

const _v = new THREE.Vector3();
const _travel = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _corr = new THREE.Vector3();
const _rigStart = new THREE.Vector3();
const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Hand-driven movement with no thumbstick, in the style of Gorilla Tag.
 *
 * The player is a rig (the tracking-space origin) carrying a head and two
 * hands. Each frame:
 *  1. Each hand sweeps from where it was to where the controller now is. If it
 *     hits something, the hand stays put and the gap between controller and
 *     hand is applied to the rig in reverse, so pushing down lifts you and
 *     pulling back moves you forward.
 *  2. With no hand touching, gravity and the current velocity move the body.
 *  3. The body capsule moves through the world with Rapier's character
 *     controller, so you can't pass through solid scenery.
 *  4. While hands touch, the average recent body velocity is stored as the
 *     launch velocity you keep when you let go.
 */
export class Locomotion {
  readonly velocity = new THREE.Vector3();
  readonly hands: [HandContact, HandContact];
  grounded = false;

  private readonly headLocal = new THREE.Vector3(0, 1.6, 0);
  private readonly bodyCollider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly handShape: RAPIER.Ball;
  private readonly history: THREE.Vector3[] = [];
  private historyIndex = 0;

  constructor(
    private readonly world: RAPIER.World,
    readonly rig: THREE.Object3D,
  ) {
    const body = RAPIER.ColliderDesc.capsule(C.bodyHalfHeight, C.bodyRadius).setCollisionGroups(PLAYER_GROUPS);
    this.bodyCollider = world.createCollider(body);

    this.controller = world.createCharacterController(0.01);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
    this.controller.setMaxSlopeClimbAngle((60 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((50 * Math.PI) / 180);
    this.controller.disableAutostep();
    this.controller.disableSnapToGround();
    this.controller.setApplyImpulsesToDynamicBodies(true);

    this.handShape = new RAPIER.Ball(C.handRadius);

    const newHand = (): HandContact => ({
      position: new THREE.Vector3(),
      rawPosition: new THREE.Vector3(),
      touching: false,
      wasTouching: false,
      justTouched: false,
      initialized: false,
    });
    this.hands = [newHand(), newHand()];
    for (let i = 0; i < C.velocityHistorySize; i++) this.history.push(new THREE.Vector3());
  }

  get anyTouching(): boolean {
    return this.hands[0].touching || this.hands[1].touching;
  }

  /** World position of the head. */
  headWorld(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.rig.position).add(this.headLocal);
  }

  /** Puts the head over `feet` (world), standing on it, with no velocity. */
  respawn(feet: THREE.Vector3Like): void {
    const headAboveFeet = 2 * C.bodyHalfHeight + C.bodyRadius + 0.02;
    this.rig.position.set(feet.x - this.headLocal.x, feet.y + headAboveFeet - this.headLocal.y, feet.z - this.headLocal.z);
    this.placeBody(this.headWorld(_v));
    this.velocity.set(0, 0, 0);
    for (const h of this.history) h.set(0, 0, 0);
    for (const hand of this.hands) {
      hand.initialized = false;
      hand.touching = hand.wasTouching = hand.justTouched = false;
    }
  }

  /**
   * Advances the player one frame.
   * @param headLocal head position in tracking space
   * @param handLocals controller positions in tracking space (null = untracked)
   */
  update(dt: number, headLocal: THREE.Vector3, handLocals: [THREE.Vector3 | null, THREE.Vector3 | null]): void {
    if (dt <= 0) return;
    // Measure velocity over the real frame time, but simulate at most maxFrameDt
    // so a hitch can't tunnel us through things.
    const realDt = dt;
    dt = Math.min(dt, C.maxFrameDt);
    this.headLocal.copy(headLocal);
    _rigStart.copy(this.rig.position);

    // --- 1. Hand sweeps → rig correction -------------------------------------
    const headWorld = this.headWorld(new THREE.Vector3());
    const movement = new THREE.Vector3();
    let touchingCount = 0;
    const probe = Math.max(2 * C.gravity * dt * dt, C.contactProbe);

    for (let i = 0; i < 2; i++) {
      const hand = this.hands[i];
      const local = handLocals[i];
      hand.justTouched = false;
      if (!local) {
        hand.touching = hand.wasTouching = false;
        hand.initialized = false;
        continue;
      }
      const current = this.handWorld(local, headWorld, hand.rawPosition);
      if (!hand.initialized) {
        hand.position.copy(current);
        hand.initialized = true;
      }

      _travel.subVectors(current, hand.position);
      _travel.y -= probe;
      if (this.sweep(hand.position, _travel, _hit)) {
        // A hand already in contact stays exactly where it was. A hand that
        // just arrived stops at the surface.
        _corr.subVectors(hand.wasTouching ? hand.position : _hit, current);
        movement.add(_corr);
        touchingCount++;
        hand.touching = true;
      } else {
        hand.touching = false;
      }
    }
    if (touchingCount > 1) movement.divideScalar(touchingCount);

    // --- 2. Free flight --------------------------------------------------------
    if (touchingCount === 0) {
      this.velocity.y -= C.gravity * dt;
      this.velocity.multiplyScalar(Math.max(0, 1 - C.airDrag * dt));
      movement.addScaledVector(this.velocity, dt);
    }

    // --- 3. Move the body capsule through the world ----------------------------
    const bodyHead = this.bodyHead(new THREE.Vector3());
    const desired = headWorld.add(movement).sub(bodyHead); // headWorld is reused from here on
    this.controller.computeColliderMovement(this.bodyCollider, desired, undefined, QUERY_WORLD);
    const moved = this.controller.computedMovement();
    const newHead = bodyHead.add(moved);
    this.placeBody(newHead);
    this.rig.position.copy(newHead).sub(this.headLocal);
    this.grounded = this.controller.computedGrounded();

    if (touchingCount === 0) {
      // Remove velocity going into whatever we bumped.
      for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
        const n = this.controller.computedCollision(i)?.normal2;
        if (!n) continue;
        const into = this.velocity.x * n.x + this.velocity.y * n.y + this.velocity.z * n.z;
        if (into < 0) this.velocity.addScaledVector(_v.set(n.x, n.y, n.z), -into);
      }
      if (this.grounded) {
        if (this.velocity.y < 0) this.velocity.y = 0;
        const keep = Math.max(0, 1 - C.groundFriction * dt);
        this.velocity.x *= keep;
        this.velocity.z *= keep;
      }
    }

    // --- 4. Hands follow the moved rig, stopping at surfaces --------------------
    for (let i = 0; i < 2; i++) {
      const hand = this.hands[i];
      const local = handLocals[i];
      if (!local) continue;
      const current = this.handWorld(local, newHead, hand.rawPosition);
      _travel.subVectors(current, hand.position);
      if (this.sweep(hand.position, _travel, _hit)) {
        hand.position.copy(_hit);
        hand.touching = true;
      } else {
        hand.position.copy(current);
      }
    }

    // --- 5. Velocity history → launch velocity ---------------------------------
    const frameVelocity = this.history[this.historyIndex];
    frameVelocity.subVectors(this.rig.position, _rigStart).divideScalar(realDt);
    this.historyIndex = (this.historyIndex + 1) % this.history.length;

    if (this.anyTouching) {
      const average = _v.set(0, 0, 0);
      for (const h of this.history) average.add(h);
      average.divideScalar(this.history.length);
      const speed = average.length();
      if (speed > C.velocityLimit) {
        this.velocity.copy(average).multiplyScalar(C.jumpMultiplier);
        if (speed * C.jumpMultiplier > C.maxJumpSpeed) this.velocity.setLength(C.maxJumpSpeed);
      } else {
        this.velocity.set(0, 0, 0);
      }
    }

    for (const hand of this.hands) {
      hand.justTouched = hand.touching && !hand.wasTouching;
      hand.wasTouching = hand.touching;
    }
  }

  /** Arm-length-clamped world position for a hand at tracking-space `local`. */
  private handWorld(local: THREE.Vector3, headWorld: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    target.subVectors(local, this.headLocal).clampLength(0, C.maxArmLength);
    return target.add(headWorld);
  }

  /** Sweeps the hand sphere from `from` along `travel`; writes the stop point to `out`. */
  private sweep(from: THREE.Vector3, travel: THREE.Vector3, out: THREE.Vector3): boolean {
    if (travel.lengthSq() < 1e-12) return false;
    const hit = this.world.castShape(
      from,
      IDENTITY_ROT,
      travel,
      this.handShape,
      C.contactSkin,
      1,
      false,
      undefined,
      QUERY_WORLD,
      this.bodyCollider,
    );
    if (!hit) return false;
    out.copy(from).addScaledVector(travel, hit.time_of_impact);
    return true;
  }

  /** Head position implied by the body collider's current placement. */
  private bodyHead(target: THREE.Vector3): THREE.Vector3 {
    const t = this.bodyCollider.translation();
    return target.set(t.x, t.y + C.bodyHalfHeight, t.z);
  }

  /** Positions the capsule so its top sphere is centred on the head. */
  private placeBody(head: THREE.Vector3): void {
    this.bodyCollider.setTranslation({ x: head.x, y: head.y - C.bodyHalfHeight, z: head.z });
  }
}
