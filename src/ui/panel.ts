import * as THREE from 'three';
import { Laser, type PointerRay } from './laser';

/** A button floating in the world. Poke it with a hand or point a controller's laser at it and pull the trigger. */
export class WorldButton {
  readonly mesh: THREE.Mesh;
  hover = false;
  enabled = true;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private lastDraw = '';

  constructor(
    scene: THREE.Scene,
    private label: string,
    /** Size in metres. */
    readonly width: number,
    readonly height: number,
    private readonly color = '#2d6a3a',
    readonly onPress: () => void = () => {},
  ) {
    this.canvas.width = 512;
    this.canvas.height = Math.max(64, Math.round(512 * (height / width)));
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, fog: false }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.draw();
  }

  setLabel(label: string): void {
    this.label = label;
    this.draw();
  }

  draw(): void {
    const key = `${this.label}|${this.hover}|${this.enabled}`;
    if (key === this.lastDraw) return;
    this.lastDraw = key;
    const c = this.canvas.getContext('2d')!;
    const w = this.canvas.width;
    const h = this.canvas.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = !this.enabled ? '#555' : this.hover ? '#ffe28a' : this.color;
    c.beginPath();
    c.roundRect(6, 6, w - 12, h - 12, 28);
    c.fill();
    c.lineWidth = 6;
    c.strokeStyle = this.hover ? '#fff7d0' : 'rgba(255,255,255,0.55)';
    c.stroke();
    c.fillStyle = this.hover ? '#2a1d00' : '#f6f2dc';
    c.font = `bold ${Math.round(h * 0.45)}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(this.label, w / 2, h / 2 + 2);
    this.texture.needsUpdate = true;
  }
}

const _local = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _plane = new THREE.Plane();
const _ray = new THREE.Ray();
const _hit = new THREE.Vector3();
const _pos = new THREE.Vector3();

/** Looks after a set of world buttons: pokes, lasers and the highlight. */
export class Panels {
  readonly buttons: WorldButton[] = [];
  private readonly lasers: [Laser, Laser];
  private readonly armed = [true, true];
  private readonly lastTrigger = [false, false];
  /** Called when something is pressed, with the hand (for a buzz). */
  onPress: ((hand: 0 | 1) => void) | null = null;

  constructor(scene: THREE.Scene) {
    this.lasers = [new Laser(scene), new Laser(scene)];
  }

  add(button: WorldButton): WorldButton {
    this.buttons.push(button);
    return button;
  }

  update(hands: [THREE.Vector3 | null, THREE.Vector3 | null], rays: [PointerRay | null, PointerRay | null]): void {
    for (const b of this.buttons) b.hover = false;
    for (let i = 0; i < 2; i++) {
      const hand = i as 0 | 1;
      // Laser: the nearest button the beam crosses.
      const ray = rays[i];
      if (!ray) {
        this.lasers[i].hide();
        this.lastTrigger[i] = false;
      } else {
        let best: WorldButton | null = null;
        let bestT = Infinity;
        let bestPoint: THREE.Vector3 | null = null;
        for (const b of this.buttons) {
          if (!b.mesh.visible) continue;
          b.mesh.updateWorldMatrix(true, false);
          _normal.set(0, 0, 1).transformDirection(b.mesh.matrixWorld);
          if (ray.dir.dot(_normal) >= 0) continue;
          _plane.setFromNormalAndCoplanarPoint(_normal, b.mesh.getWorldPosition(_pos));
          _ray.set(ray.origin, ray.dir);
          const p = _ray.intersectPlane(_plane, _hit);
          if (!p) continue;
          const t = ray.origin.distanceTo(p);
          _local.copy(p);
          b.mesh.worldToLocal(_local);
          if (Math.abs(_local.x) <= b.width / 2 + 0.03 && Math.abs(_local.y) <= b.height / 2 + 0.03 && t < bestT) {
            best = b;
            bestT = t;
            bestPoint = p.clone();
          }
        }
        this.lasers[i].show(ray.origin, ray.dir, bestPoint, !!best);
        if (best) {
          best.hover = true;
          if (ray.trigger && !this.lastTrigger[i] && best.enabled) this.press(best, hand);
        }
        this.lastTrigger[i] = ray.trigger;
      }
      // Poke: a hand that comes in from the front and passes through the button.
      const p = hands[i];
      if (!p) continue;
      for (const b of this.buttons) {
        if (!b.mesh.visible) continue;
        b.mesh.updateWorldMatrix(true, false);
        _local.copy(p);
        b.mesh.worldToLocal(_local);
        const over = Math.abs(_local.x) <= b.width / 2 && Math.abs(_local.y) <= b.height / 2;
        if (!over) continue;
        if (_local.z > -0.14 && _local.z < 0.22) b.hover = true;
        if (_local.z > 0.12) this.armed[i] = true;
        else if (this.armed[i] && _local.z < 0.06 && _local.z > -0.14 && b.enabled) {
          this.armed[i] = false;
          this.press(b, hand);
        }
      }
    }
    for (const b of this.buttons) b.draw();
  }

  private press(b: WorldButton, hand: 0 | 1): void {
    this.onPress?.(hand);
    b.onPress();
  }
}
