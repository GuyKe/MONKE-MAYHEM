import * as THREE from 'three';

const _r = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();

/**
 * Winding rope round something: the hand holding the rope circles around a point, close to it, with the
 * trigger held. It counts how many turns have been made. Used to lash an axe head and to tie a blueprint's joints.
 */
export class TieGesture {
  /** 0 to 1: how far through the turns needed. */
  progress = 0;
  private lastAngle: number | null = null;
  private idle = 0;

  constructor(
    /** Full turns of the hand needed to finish. */
    private readonly turns = 1.5,
    /** How close the hand must stay to the thing (metres), nearest and furthest. */
    private readonly near = 0.025,
    private readonly far = 0.24,
    /** How far along the axis the hand may be (metres, either way). */
    private readonly reach = 0.14,
  ) {}

  reset(): void {
    this.progress = 0;
    this.lastAngle = null;
    this.idle = 0;
  }

  /**
   * Call every frame. `center` and `axis` describe what is being wound; `hand` is where the rope hand is;
   * `active` is whether the trigger is held. Returns how much progress this frame added (0 if none).
   */
  update(dt: number, center: THREE.Vector3, axis: THREE.Vector3, hand: THREE.Vector3, active: boolean): number {
    const a = axis.clone().normalize();
    _r.subVectors(hand, center);
    const along = _r.dot(a);
    _r.addScaledVector(a, -along); // the part of the hand's offset around the axis
    const radial = _r.length();
    const valid = active && Math.abs(along) <= this.reach && radial >= this.near && radial <= this.far;

    if (!valid) {
      this.lastAngle = null;
      this.idle += dt;
      // Stopping for a moment is fine; walking away loses the turns.
      if (this.idle > 1.5) this.progress = Math.max(0, this.progress - dt * 0.3);
      return 0;
    }
    this.idle = 0;

    // An angle around the axis, in a frame that doesn't move.
    _e1.set(1, 0, 0);
    if (Math.abs(a.x) > 0.9) _e1.set(0, 1, 0);
    _e1.addScaledVector(a, -_e1.dot(a)).normalize();
    _e2.crossVectors(a, _e1);
    const angle = Math.atan2(_r.dot(_e2), _r.dot(_e1));

    let added = 0;
    if (this.lastAngle !== null) {
      let d = angle - this.lastAngle;
      d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
      added = Math.abs(d) / (Math.PI * 2 * this.turns);
      this.progress = Math.min(1, this.progress + added);
    }
    this.lastAngle = angle;
    return added;
  }
}
