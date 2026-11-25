import * as THREE from 'three';
import { LOCOMOTION as C } from '../config';
import { PLAYER_GROUPS, QUERY_TERRAIN, QUERY_WORLD, RAPIER } from '../physics';
import { DEFAULT_SURFACE, surfaceOf, type SurfaceMaterial } from '../world/materials';

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
  /** Material of the surface the hand is touching (last one touched when not touching). */
  surface: SurfaceMaterial;
  /** Outward normal of the surface the hand is touching (last one when not touching). */
  readonly normal: THREE.Vector3;
  /** How far the controller has moved away from the surface since contact began. */
  lift: number;
}

const _v = new THREE.Vector3();
const _travel = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _corr = new THREE.Vector3();
const _rigStart = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _pinned = new THREE.Vector3();
const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };
/** Water this deep (metres, at the feet) and you are swimming rather than wading. */
const SWIM_DEPTH = 0.4;
/** Body speed (m/s) gained per metre a submerged hand is pulled through the water. */
const SWIM_GAIN = 3.4;
const SWIM_DRAG = 1.35;
const SWIM_VERTICAL_DRAG = 3.2;
const _arm = new THREE.Vector3();
const _hl = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _turnQ = new THREE.Quaternion();
const _stroke = new THREE.Vector3();

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
  /** Walking and running on the ground goes this many times faster than the hands push (1 = normal). */
  speedScale = 1;
  /** Multiplies every hand offset from the head. Set from the player's arm span. */
  reachScale = 1;
  /** While true, hands pass through built structures (so a joint can be tied). */
  handsIgnoreStructures = false;
  /** Material under the body when standing or sliding on the ground. */
  groundSurface: SurfaceMaterial = DEFAULT_SURFACE;
  /** Height of the water surface at (x, z), or null where there is none. Set by the game. */
  waterAt: ((x: number, z: number) => number | null) | null = null;
  /** In water too deep to stand in: hands paddle instead of pushing off the ground. */
  swimming = false;
  /** The head is under the surface. */
  headUnderwater = false;
  /** Water surface height under the player (valid while in water). */
  waterLevel = -Infinity;
  /** True when any part of the body is in water (wading or swimming). */
  inWater = false;
  private readonly lastArm: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly armKnown = [false, false];

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
      surface: DEFAULT_SURFACE,
      normal: new THREE.Vector3(0, 1, 0),
      lift: 0,
    });
    this.hands = [newHand(), newHand()];
    for (let i = 0; i < C.velocityHistorySize; i++) this.history.push(new THREE.Vector3());
  }

  get anyTouching(): boolean {
    return this.hands[0].touching || this.hands[1].touching;
  }

  /** World position of the head. */
  headWorld(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.headLocal).applyQuaternion(this.rig.quaternion).add(this.rig.position);
  }

  /** While paused: the hands simply follow the controllers (no physics), and start afresh when play resumes. */
  follow(headLocal: THREE.Vector3, handLocals: [THREE.Vector3 | null, THREE.Vector3 | null]): void {
    this.headLocal.copy(headLocal);
    const head = this.headWorld(new THREE.Vector3());
    for (let i = 0; i < 2; i++) {
      const hand = this.hands[i];
      const local = handLocals[i];
      if (!local) continue;
      this.handWorld(local, head, hand.rawPosition);
      hand.position.copy(hand.rawPosition);
      hand.touching = hand.wasTouching = false;
      hand.initialized = false;
    }
  }

  /** Turns the player about the vertical through the head (positive is to the left), keeping the head where it is. */
  turn(angle: number): void {
    const head = this.headWorld(_v).clone();
    this.rig.quaternion.premultiply(_turnQ.setFromAxisAngle(_yAxis, angle));
    this.rig.position.copy(head).sub(_hl.copy(this.headLocal).applyQuaternion(this.rig.quaternion));
    for (const hand of this.hands) hand.initialized = false; // the hands start again from the head, so none is left inside a surface
  }

  /** Moves the whole player by `delta` without any physics (riding a vehicle). */
  carry(delta: THREE.Vector3): void {
    this.rig.position.add(delta);
    this.placeBody(this.headWorld(_v));
    for (const hand of this.hands) hand.position.add(delta);
    this.velocity.set(0, 0, 0);
  }

  /** Puts the head over `feet` (world), standing on it, with no velocity. */
  respawn(feet: THREE.Vector3Like): void {
    const headAboveFeet = 2 * C.bodyHalfHeight + C.bodyRadius + 0.02;
    _hl.copy(this.headLocal).applyQuaternion(this.rig.quaternion);
    this.rig.position.set(feet.x - _hl.x, feet.y + headAboveFeet - _hl.y, feet.z - _hl.z);
    this.placeBody(this.headWorld(_v));
    this.velocity.set(0, 0, 0);
    for (const h of this.history) h.set(0, 0, 0);
    for (const hand of this.hands) {
      hand.initialized = false;
      hand.touching = hand.wasTouching = hand.justTouched = false;
      hand.lift = 0;
    }
    this.armKnown[0] = this.armKnown[1] = false;
    this.swimming = this.headUnderwater = this.inWater = false;
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
    // Water: deep enough and you swim.
    const level = this.waterAt ? this.waterAt(headWorld.x, headWorld.z) : null;
    const feetY = headWorld.y - (2 * C.bodyHalfHeight + C.bodyRadius + 0.02);
    this.swimming = level !== null && level - feetY > SWIM_DEPTH;
    this.inWater = level !== null && level > feetY + 0.05;
    this.headUnderwater = level !== null && headWorld.y < level;
    this.waterLevel = level ?? -Infinity;
    _stroke.set(0, 0, 0);
    let touchingCount = 0;
    let floorHits = 0;
    const probe = Math.max(2 * C.gravity * dt * dt, C.contactProbe);

    for (let i = 0; i < 2; i++) {
      const hand = this.hands[i];
      const local = handLocals[i];
      hand.justTouched = false;
      if (!local) {
        hand.touching = hand.wasTouching = false;
        hand.initialized = false;
        this.armKnown[i] = false;
        continue;
      }
      const current = this.handWorld(local, headWorld, hand.rawPosition);
      // Paddling: a hand pulled through water pushes the body the other way.
      _arm.subVectors(current, headWorld);
      if (this.swimming && this.armKnown[i] && current.y < this.waterLevel) _stroke.add(this.lastArm[i]).sub(_arm);
      this.lastArm[i].copy(_arm);
      this.armKnown[i] = true;
      if (!hand.initialized) {
        // First frame, respawn or tracking regained: start the hand at the head
        // and let the sweep carry it out to the controller. It then stops at any
        // surface in between instead of starting inside one, where sweeps ignore it.
        hand.position.copy(headWorld);
        hand.initialized = true;
        hand.lift = 0;
      }

      _travel.subVectors(current, hand.position);

      // A resting hand is nudged into its surface so contact is kept. That
      // nudge must not outlast a lift: track how far the controller has moved
      // away from the surface and drop the nudge once it passes releaseLift.
      let push = probe;
      if (hand.wasTouching) {
        hand.lift = Math.max(0, hand.lift + _travel.dot(hand.normal));
        if (hand.lift > C.releaseLift) push = 0;
        _travel.addScaledVector(hand.normal, -push);
      } else {
        hand.lift = 0;
        _travel.y -= push;
      }
      const hit = this.sweep(hand.position, _travel, _hit, _normal);
      if (hit) {
        hand.normal.copy(_normal);
        hand.surface = surfaceOf(hit.collider);
        // A hand already in contact stays exactly where it was. A hand that
        // just arrived stops at the surface.
        _pinned.copy(hand.wasTouching ? hand.position : _hit);
        _corr.subVectors(_pinned, current);

        // Slip: part of the sideways motion along the surface is lost. The
        // hand slides along with the controller by that part, and only the
        // rest moves the body. Pushing straight into the surface is unaffected.
        const slip = hand.surface.slip;
        if (slip > 0) {
          _tangent.copy(_corr).addScaledVector(_normal, -_corr.dot(_normal));
          _corr.addScaledVector(_tangent, -slip);
          _pinned.addScaledVector(_tangent, -slip);
        }
        hand.position.copy(_pinned);

        movement.add(_corr);
        touchingCount++;
        if (_normal.y > 0.6) floorHits++;
        hand.touching = true;
      } else {
        // No contact. The hand carries on from where the controller is, not
        // from where it was pinned, so it can't re-grab a point it has left.
        hand.position.copy(current);
        hand.touching = false;
        hand.lift = 0;
      }
    }
    if (touchingCount > 1) movement.divideScalar(touchingCount);
    // Pushing off the ground carries you further (the walking speed setting).
    if (touchingCount > 0 && floorHits === touchingCount && this.speedScale !== 1) {
      movement.x *= this.speedScale;
      movement.z *= this.speedScale;
    }

    // --- 2. Free flight --------------------------------------------------------
    if (touchingCount === 0) {
      if (this.swimming) {
        this.velocity.addScaledVector(_stroke, SWIM_GAIN);
        // The water holds you up, with your head just above the surface.
        this.velocity.y += (this.waterLevel + 0.1 - headWorld.y) * 10 * dt;
        const keep = 1 / (1 + SWIM_DRAG * dt);
        this.velocity.x *= keep;
        this.velocity.z *= keep;
        this.velocity.y *= 1 / (1 + SWIM_VERTICAL_DRAG * dt);
      } else {
        this.velocity.y -= (this.inWater ? C.gravity * 0.6 : C.gravity) * dt;
        const drag = this.inWater ? 1.2 : C.airDrag;
        this.velocity.multiplyScalar(Math.max(0, 1 - drag * dt));
      }
      movement.addScaledVector(this.velocity, dt);
    }

    // --- 3. Move the body capsule through the world ----------------------------
    const bodyHead = this.bodyHead(new THREE.Vector3());
    const desired = headWorld.add(movement).sub(bodyHead); // headWorld is reused from here on
    this.controller.computeColliderMovement(this.bodyCollider, desired, undefined, QUERY_WORLD);
    const moved = this.controller.computedMovement();
    const newHead = bodyHead.add(moved);
    this.placeBody(newHead);
    this.rig.position.copy(newHead).sub(_hl.copy(this.headLocal).applyQuaternion(this.rig.quaternion));
    this.grounded = this.controller.computedGrounded();

    if (touchingCount === 0) {
      // Remove velocity going into whatever we bumped.
      let groundSlip = 0;
      for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
        const collision = this.controller.computedCollision(i);
        if (!collision) continue;
        const n = collision.normal1; // outward surface normal, points against the motion
        const into = this.velocity.x * n.x + this.velocity.y * n.y + this.velocity.z * n.z;
        if (into < 0) this.velocity.addScaledVector(_v.set(n.x, n.y, n.z), -into);
        if (n.y > 0.5) {
          this.groundSurface = surfaceOf(collision.collider);
          groundSlip = this.groundSurface.slip;
        }
      }
      if (this.grounded) {
        if (this.velocity.y < 0) this.velocity.y = 0;
        // Slippery ground keeps you sliding: friction shrinks as slip grows.
        const keep = Math.max(0, 1 - C.groundFriction * (1 - groundSlip) * dt);
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

      // The move above can carry a hand off its surface (the other hand's push
      // lifts the body, say). Only stay in contact if the surface is still
      // right there.
      if (hand.touching) {
        _travel.copy(hand.normal).multiplyScalar(-(2 * C.contactProbe + C.contactSkin));
        if (!this.sweep(hand.position, _travel, _hit)) {
          hand.touching = false;
          hand.lift = 0;
        }
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
    target.subVectors(local, this.headLocal).multiplyScalar(this.reachScale).clampLength(0, C.maxArmLength).applyQuaternion(this.rig.quaternion);
    return target.add(headWorld);
  }

  /** Sweeps the hand sphere from `from` along `travel`; writes the stop point to `out`. */
  private sweep(
    from: THREE.Vector3,
    travel: THREE.Vector3,
    out: THREE.Vector3,
    outNormal?: THREE.Vector3,
  ): RAPIER.ColliderShapeCastHit | null {
    if (travel.lengthSq() < 1e-12) return null;
    const hit = this.world.castShape(
      from,
      IDENTITY_ROT,
      travel,
      this.handShape,
      C.contactSkin,
      1,
      false,
      undefined,
      this.handsIgnoreStructures ? QUERY_TERRAIN : QUERY_WORLD,
      this.bodyCollider,
    );
    if (!hit) return null;
    out.copy(from).addScaledVector(travel, hit.time_of_impact);
    // Hit normals from World.castShape are outward on the hit collider, in world space.
    outNormal?.set(hit.normal1.x, hit.normal1.y, hit.normal1.z);
    return hit;
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
