import { XRDevice, metaQuest3 } from 'iwer';
import { LOCOMOTION } from '../config';

/**
 * Desktop test mode. Installs Meta's IWER WebXR emulator and drives the fake
 * headset and controllers from the keyboard and mouse, so the hand
 * locomotion can be tried without a headset.
 *
 *   Click        lock the mouse, then move it to look around
 *   W / S        knuckle-walk forward / backward (alternating arm strokes)
 *   A / D        strokes to the left / right
 *   Shift        faster strokes (builds speed so releasing launches you)
 *   Space        both hands slam down: jump
 *   Q / E        squeeze left / right grip
 *   T            T-pose arm calibration (both arms out, grips held)
 *   [ / ]        shorter / longer emulated arms (to test arm-span scaling)
 *   R            respawn
 */
/**
 * How far below the head a planted hand reaches. Resting on the body, the hand
 * meets the ground about 0.85 m below the head, so this pushes slightly into it.
 */
const PLANT_DEPTH = 0.95;
/** The emulated strokes were authored for a body 0.9 m tall; scale them to the current one. */
const BODY_FIT = LOCOMOTION.headAboveGround / 0.9;
const EMULATED_ARM_SPAN = 1.71;

export class DesktopEmulator {
  readonly device: XRDevice;
  private yaw = 0;
  private pitch = -0.5; // look down a little so the hands are in view
  private readonly keys = new Set<string>();
  private phase = 0;
  private jumpTime = -1;
  private tPoseTime = -1;
  /** Multiplies the emulated arms' reach. 1 is an average adult (1.7 m span). */
  armScale = 1;
  private readonly headHeight = 1.6;

  constructor() {
    this.device = new XRDevice(metaQuest3);
    this.device.installRuntime({ forceInstall: true });
    this.device.stereoEnabled = false;
    this.device.position.set(0, this.headHeight, 0);

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space' && this.jumpTime < 0) this.jumpTime = 0;
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'KeyT' && this.tPoseTime < 0) this.tPoseTime = 0;
      if (e.code === 'BracketLeft') this.armScale = Math.max(0.7, +(this.armScale - 0.05).toFixed(2));
      if (e.code === 'BracketRight') this.armScale = Math.min(1.3, +(this.armScale + 0.05).toFixed(2));
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      this.yaw -= e.movementX * 0.0025;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - e.movementY * 0.0025));
    });
    document.addEventListener('click', (e) => {
      if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
      if (!document.pointerLockElement) document.body.requestPointerLock?.();
    });
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Updates the emulated head and controller poses. Call once per frame. */
  update(dt: number): void {
    // Scripted strokes need small steps to behave like a real arm; on a slow
    // machine the emulator runs in slow motion instead of taking big jumps.
    dt = Math.min(dt, 1 / 30);
    const d = this.device;
    const head = { x: 0, y: this.headHeight, z: 0 };
    d.position.set(head.x, head.y, head.z);
    setYawPitch(d.quaternion, this.yaw, this.pitch);

    const fwd = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
    const right = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };

    // Stroke direction in head-yaw space: x = right, z = forward.
    let sx = 0;
    let sz = 0;
    if (this.keys.has('KeyW')) sz += 1;
    if (this.keys.has('KeyS')) sz -= 1;
    if (this.keys.has('KeyD')) sx += 1;
    if (this.keys.has('KeyA')) sx -= 1;
    const moving = sx !== 0 || sz !== 0;
    const len = Math.hypot(sx, sz) || 1;
    sx /= len;
    sz /= len;

    const rate = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 2.4 : 1.5;
    if (moving) this.phase = (this.phase + dt * rate) % 1;

    const sides: Array<['left' | 'right', number]> = [['left', -1], ['right', 1]];
    for (const [name, side] of sides) {
      // Hand position relative to the head: a = along stroke, s = sideways, y = down.
      let along: number;
      let lateral = side * 0.25;
      let down: number;

      if (this.jumpTime >= 0) {
        // Both hands: quick push down and back, then lift.
        const t = this.jumpTime;
        const push = 0.16;
        if (t < 0.08) {
          along = 0.25;
          down = 0.85;
        } else if (t < 0.08 + push) {
          const s = (t - 0.08) / push;
          along = 0.25 - 0.35 * s;
          down = 0.85 + 0.55 * s;
        } else {
          along = -0.1;
          down = 0.45;
        }
      } else if (moving) {
        const p = (this.phase + (side > 0 ? 0.5 : 0)) % 1;
        if (p < 0.5) {
          // Power stroke: hand planted, sweeping from front to back.
          const s = p / 0.5;
          along = 0.55 - 0.75 * s;
          down = PLANT_DEPTH;
        } else {
          // Recovery: lift and swing forward again.
          const s = (p - 0.5) / 0.5;
          along = -0.2 + 0.75 * s * s * (3 - 2 * s); // ease so the hand lands vertically
          down = PLANT_DEPTH - 0.5 * Math.sin(Math.PI * s);
        }
      } else {
        // Resting pose in front of the chest.
        along = 0.3;
        down = 0.45;
        lateral = side * 0.22;
      }

      const dirX = this.jumpTime >= 0 || !moving ? 0 : sx;
      const dirZ = this.jumpTime >= 0 || !moving ? 1 : sz;
      // Stroke axis (in head-yaw space) and its perpendicular for the side offset.
      const ax = dirX * right.x + dirZ * fwd.x;
      const az = dirX * right.z + dirZ * fwd.z;
      const px = lateral * (dirZ * right.x - dirX * fwd.x);
      const pz = lateral * (dirZ * right.z - dirX * fwd.z);

      const c = d.controllers[name];
      if (!c) continue;
      if (this.tPoseTime >= 0) {
        // T-pose: arms straight out to the sides at head height, grips held.
        const half = EMULATED_ARM_SPAN * this.armScale * 0.5;
        c.position.set(head.x + right.x * side * half, head.y, head.z + right.z * side * half);
        setYawPitch(c.quaternion, this.yaw, 0);
        c.updateButtonValue('squeeze', 1);
        continue;
      }
      const k = this.armScale;
      c.position.set(head.x + (ax * along + px) * k, head.y - down * BODY_FIT * k, head.z + (az * along + pz) * k);
      setYawPitch(c.quaternion, this.yaw, 0);
      c.updateButtonValue('squeeze', this.keys.has(name === 'left' ? 'KeyQ' : 'KeyE') ? 1 : 0);
    }

    if (this.tPoseTime >= 0) {
      this.tPoseTime += dt;
      if (this.tPoseTime > 2.2) this.tPoseTime = -1;
    }
    if (this.jumpTime >= 0) {
      this.jumpTime += dt;
      if (this.jumpTime > 0.45) this.jumpTime = this.keys.has('Space') ? 0 : -1;
    }
  }
}

function setYawPitch(q: { set(x: number, y: number, z: number, w: number): unknown }, yaw: number, pitch: number): void {
  // q = yaw (about Y) * pitch (about X)
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  q.set(cy * sp, sy * cp, -sy * sp, cy * cp);
}
