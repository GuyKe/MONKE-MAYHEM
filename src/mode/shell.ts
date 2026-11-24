import * as THREE from 'three';
import { goToMode } from './nav';
import type { Runtime } from './runtime';
import { WorldButton } from '../ui/panel';

/** A button that takes you back to the lobby (and the L key does too). */
export function addLobbyButton(rt: Runtime, at: THREE.Vector3, label = 'BACK TO LOBBY', width = 2.2): WorldButton {
  const b = rt.panels.add(new WorldButton(rt.scene, label, width, width * 0.25, '#2d4a6a', () => goToMode('hub')));
  b.mesh.position.copy(at);
  b.mesh.userData.billboard = true;
  return b;
}

/** The title in the corner of the desktop window, the L key, and the debugging hook. */
export function finishMode(rt: Runtime, title: string, color: string, hooks: Record<string, unknown>): void {
  const label = document.createElement('div');
  label.textContent = title;
  label.style.cssText = `position:fixed;top:12px;left:12px;z-index:100000;color:${color};font:600 13px/1.4 system-ui;letter-spacing:.15em;pointer-events:none`;
  document.body.appendChild(label);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyL' && !e.repeat) goToMode('hub');
  });
  Object.assign(window, {
    __mode: { rt, ...hooks },
    __monke: { THREE, renderer: rt.renderer, scene: rt.scene, camera: rt.camera, locomotion: rt.locomotion, rig: rt.rig, emulator: rt.emulator, panels: rt.panels },
  });
}

/** Black (or red) fade over the eyes. */
export class Fade {
  level = 0;
  target = 0;
  private readonly mesh: THREE.Mesh;

  constructor(rt: Runtime, color = 0x300000) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
    this.mesh.position.z = -0.3;
    this.mesh.renderOrder = 999;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    rt.camera.add(this.mesh);
  }

  update(dt: number): void {
    this.level += (this.target - this.level) * Math.min(1, dt * 5);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = this.level;
    this.mesh.visible = this.level > 0.01;
  }
}

/** Says something in a silly voice, if the browser can talk. */
export function say(text: string, pitch = 0.4, rate = 0.8, volume = 0.8): void {
  try {
    if (!('speechSynthesis' in window) || speechSynthesis.speaking || speechSynthesis.pending) return;
    const u = new SpeechSynthesisUtterance(text);
    u.pitch = pitch;
    u.rate = rate;
    u.volume = volume;
    speechSynthesis.speak(u);
  } catch {
    // no voice
  }
}
