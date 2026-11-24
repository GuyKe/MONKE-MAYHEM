import * as THREE from 'three';
import { VIGNETTE_STRENGTH, type SettingsData } from './settings';

const _q = new THREE.Quaternion();
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The comfort vignette: when you are moving fast, launching, riding or turning your head quickly, the edges of the view
 * darken and the clear circle in the middle closes in. It comes on quickly and fades gently, and is the same strength
 * every time so your eyes can rely on it. Strength is a setting (or off).
 */
export class Comfort {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  private level = 0;
  private readonly lastQuat = new THREE.Quaternion();
  private known = false;
  /** 0 to 1: how much the vignette is on right now. */
  amount = 0;

  constructor(camera: THREE.Camera) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const c = canvas.getContext('2d')!;
    const g = c.createRadialGradient(128, 128, 40, 128, 128, 128);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 256);
    this.material = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false, opacity: 0 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.position.z = -0.26;
    this.mesh.renderOrder = 998;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    camera.add(this.mesh);
  }

  setLevel(level: SettingsData['vignette']): void {
    this.level = VIGNETTE_STRENGTH[level];
  }

  /** `speed` is how fast you are going (m/s, vehicle included); `quat` is where the head points. */
  update(dt: number, speed: number, quat: THREE.Quaternion): void {
    let turn = 0;
    if (this.known && dt > 0) {
      _q.copy(this.lastQuat).invert().multiply(quat);
      turn = (2 * Math.acos(Math.min(1, Math.abs(_q.w)))) / dt;
    }
    this.lastQuat.copy(quat);
    this.known = true;
    const want = Math.max(smooth(2.5, 7, speed), 0.6 * smooth(2.2, 4.5, turn));
    // Quick to come on, slow to leave.
    const rate = want > this.amount ? 9 : 1.6;
    this.amount += (want - this.amount) * Math.min(1, dt * rate);
    const shown = this.amount * this.level;
    this.material.opacity = shown;
    this.mesh.visible = shown > 0.01;
    // The clear circle shrinks as it comes on (the plane is 1.4 m across at 0.26 m: wider than the view).
    const size = 1.9 - 1.1 * this.amount * this.level;
    this.mesh.scale.set(size, size, 1);
  }
}
