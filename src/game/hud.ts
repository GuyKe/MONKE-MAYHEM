import * as THREE from 'three';
import type { Engine } from './engine';
import { WorldButton } from '../ui/panel';

/** Text banners in front of the eyes were removed: the class stays so callers need no changes. */
export class Toast {
  constructor(_camera: THREE.Camera) {}
  show(_text: string, _color = '#ffffff', _seconds = 3): void {}
  update(_dt: number): void {}
}

/** A colour that fades over your eyes (black, red, white). */
export class Fade {
  level = 0;
  target = 0;
  private readonly mesh: THREE.Mesh;

  constructor(camera: THREE.Camera, color = 0x000000) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
    this.mesh.position.z = -0.3;
    this.mesh.renderOrder = 999;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    camera.add(this.mesh);
  }

  setColor(c: number): void {
    (this.mesh.material as THREE.MeshBasicMaterial).color.setHex(c);
  }

  update(dt: number, speed = 5): void {
    this.level += (this.target - this.level) * Math.min(1, dt * speed);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = this.level;
    this.mesh.visible = this.level > 0.01;
  }
}

/** A small readout that floats above your left hand. */
export class Wrist {
  readonly button: WorldButton;
  private text = '';

  constructor(private readonly e: Engine) {
    this.button = e.panels.add(new WorldButton(e.scene, '', 0.26, 0.065, '#16222c'));
    this.button.enabled = false;
    this.button.moves = true;
  }

  set(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this.button.setLabel(text);
  }

  update(): void {
    const h = this.e.locomotion.hands[0].position;
    this.button.mesh.position.set(h.x, h.y + 0.11, h.z);
    this.button.mesh.lookAt(this.e.head);
    this.button.mesh.visible = this.e.hands.left.tracked;
  }
}
