/**
 * All movement tunables live here so the feel can be iterated on quickly.
 * Distances are metres, times are seconds.
 */
export const LOCOMOTION = {
  /** Downward acceleration applied while no hand is touching anything. */
  gravity: 9.8,
  /** Hands are clamped to this distance from the head (stops infinite reach). */
  maxArmLength: 1.2,
  /** Radius of the sphere swept for each hand. */
  handRadius: 0.07,

  /**
   * The body is a capsule hanging below the head. The head sits at the centre
   * of the capsule's top sphere, so the lowest point of the body is
   * `2 * bodyHalfHeight + bodyRadius` (0.9 m) below the head.
   */
  bodyRadius: 0.2,
  bodyHalfHeight: 0.35,

  /** Frames of body velocity averaged to decide the launch velocity. */
  velocityHistorySize: 6,
  /** Pushes slower than this (m/s) don't launch you when you let go. */
  velocityLimit: 0.4,
  /** Launch velocity = average hand-driven velocity × this. */
  jumpMultiplier: 1.15,
  /** Launch speed cap. */
  maxJumpSpeed: 6.5,

  /** Horizontal speed lost per second while the body slides on the ground. */
  groundFriction: 6,
  /** Fraction of speed lost per second while airborne. */
  airDrag: 0.05,

  /** Gap the hand sweep keeps from surfaces. */
  contactSkin: 0.001,
  /** Minimum downward probe per frame so a resting hand stays in contact. */
  contactProbe: 0.004,

  /** Longer frames than this are simulated as this long (prevents tunnelling). */
  maxFrameDt: 1 / 30,
  /** Falling below this height respawns you. */
  killY: -30,
} as const;

export const SPAWN = { x: 0, y: 0, z: 2 } as const;
