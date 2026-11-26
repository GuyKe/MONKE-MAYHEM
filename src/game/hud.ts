import * as THREE from 'three';
import type { Engine } from './engine';
import { WorldButton } from '../ui/panel';

/** A banner that floats in front of your eyes for a moment. */
export class Toast {
  private readonly canvas = document.createElement('canvas');
  private readonly tex: THREE.CanvasTexture;
  private readonly mesh: THREE.Mesh;
  private lines: Array<{ text: string; color: string; time: number }> = [];

  constructor(camera: THREE.Camera) {
    this.canvas.width = 768;
    this.canvas.height = 200;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.156), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    this.mesh.position.set(0, 0.2, -0.8);
    this.mesh.renderOrder = 998;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    camera.add(this.mesh);
  }

  show(text: string, color = '#ffffff', seconds = 3): void {
    this.lines.push({ text, color, time: seconds });
    if (this.lines.length > 3) this.lines.shift();
    this.draw();
  }

  update(dt: number): void {
    if (!this.lines.length) return;
    for (const l of this.lines) l.time -= dt;
    const n = this.lines.length;
    this.lines = this.lines.filter((l) => l.time > 0);
    if (this.lines.length !== n) this.draw();
  }

  private draw(): void {
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, 768, 200);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = 8;
    c.strokeStyle = 'rgba(0,0,0,0.75)';
    this.lines.forEach((l, i) => {
      const last = i === this.lines.length - 1;
      c.font = `bold ${last ? 54 : 40}px system-ui, sans-serif`;
      c.fillStyle = l.color;
      const y = 180 - (this.lines.length - i) * 56;
      c.strokeText(l.text, 384, y);
      c.fillText(l.text, 384, y);
    });
    this.tex.needsUpdate = true;
    this.mesh.visible = this.lines.length > 0;
  }
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
