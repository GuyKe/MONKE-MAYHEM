import * as THREE from 'three';
import { WorldButton } from '../ui/panel';
import type { Engine } from './engine';

export interface PauseHooks {
  toLobby(): void;
  toggleMic(): void;
  micOn(): boolean;
}

/** The pause menu: a panel that floats in front of you (B or Y, or P on the desktop). The world keeps going. */
export class PauseMenu {
  open = false;
  private readonly group = new THREE.Group();
  private readonly buttons: WorldButton[] = [];
  private readonly labels: Array<() => string> = [];

  constructor(
    private readonly e: Engine,
    hooks: PauseHooks,
  ) {
    const mk = (label: () => string, color: string, fn: () => void): void => {
      const b = e.panels.add(new WorldButton(e.scene, label(), 0.62, 0.1, color, () => {
        fn();
        this.refresh();
      }));
      b.moves = true;
      b.mesh.position.set(0, 0.26 - this.buttons.length * 0.125, 0);
      this.group.add(b.mesh);
      this.buttons.push(b);
      this.labels.push(label);
    };
    const s = e.settings;
    mk(() => 'RESUME', '#2d7a3a', () => this.hide());
    mk(() => 'RETURN TO LOBBY', '#8a3a22', () => {
      this.hide();
      hooks.toLobby();
    });
    mk(() => `TURNING: ${s.data.turning.toUpperCase()}`, '#2d4a6a', () => s.set('turning', s.data.turning === 'snap' ? 'smooth' : s.data.turning === 'smooth' ? 'off' : 'snap'));
    mk(() => `VOLUME: ${Math.round(s.data.volume * 100)}%`, '#2d4a6a', () => {
      const v = s.data.volume >= 0.99 ? 0.3 : Math.round((s.data.volume + 0.2) * 10) / 10;
      s.set('volume', Math.min(1, v));
      e.audio.setVolume(s.data.volume);
    });
    mk(() => `BUZZ: ${s.data.haptics >= 1 ? 'FULL' : s.data.haptics > 0 ? 'HALF' : 'OFF'}`, '#2d4a6a', () => {
      s.set('haptics', s.data.haptics >= 1 ? 0.5 : s.data.haptics > 0 ? 0 : 1);
      import('../player/hands').then((m) => (m.Hand.hapticScale = s.data.haptics));
    });
    mk(() => `MIC: ${hooks.micOn() ? 'ON' : 'OFF'}`, '#2d4a6a', () => hooks.toggleMic());
    e.scene.add(this.group);
    this.group.visible = false;
    for (const b of this.buttons) b.mesh.visible = false;
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  show(): void {
    this.open = true;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.e.headQuat);
    f.y = 0;
    f.normalize();
    this.group.position.copy(this.e.head).addScaledVector(f, 1.0);
    this.group.position.y = this.e.head.y - 0.05;
    this.group.lookAt(this.e.head.x, this.group.position.y, this.e.head.z);
    this.group.visible = true;
    for (const b of this.buttons) b.mesh.visible = true;
    this.refresh();
  }

  hide(): void {
    this.open = false;
    this.group.visible = false;
    for (const b of this.buttons) b.mesh.visible = false;
  }

  refresh(): void {
    this.buttons.forEach((b, i) => b.setLabel(this.labels[i]()));
  }
}
