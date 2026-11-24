import * as THREE from 'three';
import { sign } from '../mode/figures';
import { STATUES, type Statue } from './statues';
import { createRuntime } from '../mode/runtime';
import { WorldButton } from '../ui/panel';

export { goToMode, type GameMode } from '../mode/nav';
import { goToMode } from '../mode/nav';

/**
 * The lobby: a huge black platform in the dark. You start at one end; down its length are the modes, each a statue with a name
 * and a Play button, two to a row.
 */
export async function runHub(): Promise<void> {
  const ROW = 34;
  const FIRST = -26;
  const LENGTH = 176;
  const WIDTH = 46;
  const CENTER = -64;
  const rt = await createRuntime({ background: 0x000000, spawn: new THREE.Vector3(0, 0, 18), killY: -8 });
  const { scene } = rt;

  // --- The platform ------------------------------------------------------------------
  const floor = new THREE.Mesh(new THREE.BoxGeometry(WIDTH, 0.5, LENGTH), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.35, metalness: 0.6 }));
  floor.position.set(0, -0.25, CENTER);
  scene.add(floor);
  rt.solidBox(0, -0.25, CENTER, WIDTH / 2, 0.25, LENGTH / 2);
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x2a4a8a });
  for (const sx of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, LENGTH), edgeMat);
    strip.position.set(sx * (WIDTH / 2 - 0.2), 0.012, CENTER);
    scene.add(strip);
  }
  // Faint guide marks down the middle, so you can feel how long it is.
  const markMat = new THREE.MeshBasicMaterial({ color: 0x14203a });
  for (let z = CENTER - LENGTH / 2 + 2; z < CENTER + LENGTH / 2; z += 4) {
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.012, 1.6), markMat);
    mark.position.set(0, 0.008, z);
    scene.add(mark);
  }
  // Stars.
  const stars = new Float32Array(1200 * 3);
  for (let i = 0; i < 1200; i++) {
    const a = Math.random() * Math.PI * 2;
    const e = Math.acos(1 - Math.random() * 0.95);
    const r = 190;
    stars[i * 3] = Math.sin(e) * Math.cos(a) * r;
    stars[i * 3 + 1] = Math.cos(e) * r;
    stars[i * 3 + 2] = Math.sin(e) * Math.sin(a) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3));
  const starPoints = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9aa6c0, size: 0.9, sizeAttenuation: false, fog: false }));
  scene.add(starPoints);
  scene.add(new THREE.AmbientLight(0x3a3a4c, 1.7));

  // --- The statues ---------------------------------------------------------------------------
  interface Placed { spec: (typeof STATUES)[number]; statue: Statue; x: number; z: number; button: WorldButton }
  const placed: Placed[] = [];
  const buttons: Record<string, WorldButton> = {};
  STATUES.forEach((spec, i) => {
    const row = Math.floor(i / 2);
    const alone = i === STATUES.length - 1 && i % 2 === 0;
    const x = alone ? 0 : i % 2 === 0 ? -12 : 12;
    const z = FIRST - row * ROW;
    const statue = spec.build(scene);
    statue.group.position.set(x, 0, z);
    statue.group.rotation.y = Math.PI; // they face the player
    scene.add(statue.group);
    const title = sign(spec.name, spec.color, 9);
    title.position.set(x, 11.5, z);
    scene.add(title);
    const button = rt.panels.add(new WorldButton(scene, 'PLAY', 2.0, 0.7, spec.button, () => goToMode(spec.mode)));
    button.mesh.position.set(x, 1.1, z + 6.4);
    const cap = sign(spec.caption, '#c8c8c8', 3);
    cap.position.set(x, 0.45, z + 7.2);
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = 0.02;
    scene.add(cap);
    buttons[spec.mode] = button;
    placed.push({ spec, statue, x, z, button });
  });

  // A few spotlights that follow you down the hall and light the nearest statues.
  const pool = [0, 1, 2, 3].map(() => {
    const l = new THREE.SpotLight(0xffffff, 420, 60, 0.55, 0.6, 1.4);
    scene.add(l, l.target);
    return l;
  });
  let lightTimer = 0;
  const relight = () => {
    // The ones ahead of you, nearest first (the ones you have walked past stay dark).
    const rank = (p: Placed): number => Math.hypot(p.x - rt.head.x, p.z - rt.head.z) + (p.z > rt.head.z + 4 ? 80 : 0);
    const near = placed.slice().sort((a, b) => rank(a) - rank(b));
    pool.forEach((l, i) => {
      const p = near[i];
      l.visible = !!p;
      if (!p) return;
      l.color.set(p.spec.light);
      l.position.set(p.x, 17, p.z + 11);
      l.target.position.set(p.x, 3, p.z - 1);
    });
  };
  relight();

  // --- Life ----------------------------------------------------------------------------------------------
  let time = 0;
  rt.onFrame = (dt) => {
    time += dt;
    lightTimer -= dt;
    if (lightTimer <= 0) {
      lightTimer = 0.4;
      relight();
    }
    for (const p of placed) {
      // Statues only move while you are near them.
      if (Math.abs(p.z - rt.head.z) < 70 && p.statue.update) p.statue.update(time, dt);
      // The buttons turn to face wherever you are.
      p.button.mesh.lookAt(rt.head.x, p.button.mesh.position.y, rt.head.z);
    }
    starPoints.position.set(rt.head.x, 0, rt.head.z);
  };
  const label = document.createElement('div');
  label.textContent = 'NATURE MONKE · LOBBY';
  label.style.cssText = 'position:fixed;top:12px;left:12px;z-index:100000;color:#9aa6c0;font:600 13px/1.4 system-ui;letter-spacing:.2em;pointer-events:none';
  document.body.appendChild(label);
  Object.assign(window, { __hub: { rt, buttons, playJungle: buttons.jungle, playHorror: buttons.horror, goToMode, placed }, __monke: { THREE, renderer: rt.renderer, scene: rt.scene, camera: rt.camera, locomotion: rt.locomotion, rig: rt.rig, emulator: rt.emulator, panels: rt.panels } });
}
