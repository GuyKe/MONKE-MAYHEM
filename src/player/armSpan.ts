import * as THREE from 'three';

/** Arm length (shoulder to controller) the game is tuned for. About a 1.7 m arm span. */
export const REFERENCE_ARM_LENGTH = 0.85;

const MIN_SPAN = 1.0;
const MAX_SPAN = 2.4;
/** Eye height is about 93.6% of standing height, and arm span is about equal to height. */
const EYE_HEIGHT_TO_SPAN = 1 / 0.936;
const STORAGE_KEY = 'monke.armSpan';

/** T-pose calibration gesture. */
const HOLD_SECONDS = 1.5;
const SETTLE_SECONDS = 0.4; // ignore the first moments while the arms are still moving
const MIN_HANDS_APART = 1.0;
const MAX_HEIGHT_OFFSET = 0.35; // hands must be roughly at head height

export interface CalibrationState {
  /** 0-1 while the T-pose is being held, 0 otherwise. */
  progress: number;
  /** True for exactly one update, when a calibration just finished. */
  finished: boolean;
}

/**
 * Tracks the player's real arm span so reach feels the same for everyone.
 *
 * All hand offsets from the head are multiplied by `scale`
 * (reference arm length ÷ the player's arm length) before the game uses them.
 * A short-armed player's real arm motion is scaled up and a long-armed
 * player's is scaled down, so a fully stretched arm always reaches the
 * same virtual distance and one real arm swing gives the same push.
 *
 * Where the arm span comes from:
 *  1. A saved T-pose calibration from an earlier visit.
 *  2. Otherwise an estimate from standing eye height, taken at the start.
 *  3. A new calibration at any time: hold both grips with arms stretched out
 *     to the sides, at head height, for about 1.5 seconds.
 */
export class ArmSpan {
  /** Fingertip-to-fingertip style arm span in metres. */
  span = REFERENCE_ARM_LENGTH * 2;
  calibrated = false;
  private estimated = false;

  private holdTime = 0;
  private samples = 0;
  private sum = 0;

  constructor() {
    const saved = readSaved();
    if (saved) {
      this.span = saved;
      this.calibrated = true;
    }
  }

  get armLength(): number {
    return this.span / 2;
  }

  get scale(): number {
    return REFERENCE_ARM_LENGTH / this.armLength;
  }

  /** Estimates the arm span from standing eye height, once, unless already calibrated. */
  estimateFromHeight(eyeHeight: number): void {
    if (this.calibrated || this.estimated || eyeHeight < 0.6) return;
    this.span = clampSpan(eyeHeight * EYE_HEIGHT_TO_SPAN);
    this.estimated = true;
  }

  setSpan(span: number, remember = true): void {
    this.span = clampSpan(span);
    this.calibrated = true;
    if (remember) save(this.span);
  }

  /** Forgets any calibration and re-estimates from height. */
  reset(): void {
    this.calibrated = false;
    this.estimated = false;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage can be unavailable (private windows etc.) */
    }
  }

  /** Call every frame with real (unscaled) tracking-space positions. */
  update(
    dt: number,
    head: THREE.Vector3,
    left: THREE.Vector3 | null,
    right: THREE.Vector3 | null,
    leftSqueezed: boolean,
    rightSqueezed: boolean,
  ): CalibrationState {
    const state: CalibrationState = { progress: 0, finished: false };
    const posing =
      left !== null &&
      right !== null &&
      leftSqueezed &&
      rightSqueezed &&
      left.distanceTo(right) >= MIN_HANDS_APART &&
      Math.abs(left.y - head.y) <= MAX_HEIGHT_OFFSET &&
      Math.abs(right.y - head.y) <= MAX_HEIGHT_OFFSET;

    if (!posing) {
      this.holdTime = this.samples = this.sum = 0;
      return state;
    }

    this.holdTime += dt;
    if (this.holdTime >= SETTLE_SECONDS) {
      this.sum += left.distanceTo(right);
      this.samples++;
    }
    state.progress = Math.min(1, this.holdTime / HOLD_SECONDS);

    if (this.holdTime >= HOLD_SECONDS && this.samples > 0) {
      this.setSpan(this.sum / this.samples);
      this.holdTime = this.samples = this.sum = 0;
      state.finished = true;
      state.progress = 0;
    }
    return state;
  }
}

function clampSpan(span: number): number {
  return Math.min(MAX_SPAN, Math.max(MIN_SPAN, span));
}

function readSaved(): number | null {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value >= MIN_SPAN && value <= MAX_SPAN ? value : null;
  } catch {
    return null;
  }
}

function save(span: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(span));
  } catch {
    /* ignore */
  }
}
