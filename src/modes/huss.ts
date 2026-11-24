import * as THREE from 'three';
import { bakeGorilla } from '../mode/bake';
import { buildGorilla, poseRun, sign } from '../mode/figures';
import { createRuntime } from '../mode/runtime';
import { addLobbyButton, Fade, finishMode, say } from '../mode/shell';
import { pillar } from '../mode/things';
import { WorldButton } from '../ui/panel';
import { GORILLAS } from '../hub/statues';

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

interface Hunter {
  human: ReturnType<typeof buildGorilla>;
  x: number;
  z: number;
  heading: number;
  phase: number;
  speed: number;
  step: number;
}

const _a = new THREE.Vector3();

/**
 * HUSS HUSS HUSS: the backrooms, if the rooms were taken away. An endless yellow carpet under a yellow haze with a few pillars,
 * and monsters that are fast but cannot turn. Run, and put pillars between you and them. Every twenty seconds there is one more.
 */
export async function runHuss(): Promise<void> {
  const rt = await createRuntime({ background: 0xc4b04a, fog: new THREE.FogExp2(0xc4b04a, 0.017), spawn: new THREE.Vector3(0, 0, 0), killY: -30 });
  const { scene } = rt;
  scene.add(new THREE.HemisphereLight(0xfff4b0, 0x8a7a30, 2.2));
  const lamp = new THREE.DirectionalLight(0xfff8d0, 1.2);
  lamp.position.set(10, 30, 5);
  scene.add(lamp);

  // --- The yellow ------------------------------------------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#b09a3a';
  c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 700; i++) {
    c.fillStyle = Math.random() < 0.5 ? 'rgba(90,70,10,0.18)' : 'rgba(230,210,110,0.16)';
    c.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(160, 160);
  tex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex }));
  scene.add(ground);
  rt.solidBox(0, -0.5, 0, 600, 0.5, 600);

  // A few pillars.
  const pillars: Array<{ x: number; z: number; r: number }> = [];
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = rnd(14, 95);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const w = rnd(1.6, 3);
    const p = pillar(10, w);
    p.position.set(x, 5, z);
    scene.add(p);
    rt.solidBox(x, 5, z, w / 2, 5, w / 2);
    pillars.push({ x, z, r: w * 0.75 });
  }
  // Lights that hang in the haze.
  const panelMat = new THREE.MeshBasicMaterial({ color: 0xfffbe0, fog: false });
  const panels: THREE.Mesh[] = [];
  for (let i = 0; i < 36; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 1.2), panelMat);
    const a = Math.random() * Math.PI * 2;
    const d = rnd(0, 110);
    m.position.set(Math.cos(a) * d, 15, Math.sin(a) * d);
    scene.add(m);
    panels.push(m);
  }

  // --- The monsters --------------------------------------------------------------------------------------------
  const hunters: Hunter[] = [];
  const addHunter = (): void => {
    const human = bakeGorilla(buildGorilla('monster', GORILLAS.monster));
    human.group.scale.setScalar(1.15);
    scene.add(human.group);
    const a = Math.random() * Math.PI * 2;
    const d = rnd(45, 70);
    const h: Hunter = { human, x: rt.head.x + Math.cos(a) * d, z: rt.head.z + Math.sin(a) * d, heading: 0, phase: Math.random() * 6, speed: 0, step: 0 };
    hunters.push(h);
    place(h);
  };
  const place = (h: Hunter): void => {
    h.human.group.position.set(h.x, 0, h.z);
    h.human.group.rotation.y = h.heading;
  };

  const fade = new Fade(rt, 0x302800);
  let caught = 0;
  let survived = 0;
  let best = 0;
  let nextHunter = 20;
  let grace = 4;
  let respawning = 0;
  // A scoreboard on your wrist.
  const board = new WorldButton(scene, '0:00', 0.34, 0.085, '#3a3410');
  board.enabled = false;
  rt.panels.add(board);
  addLobbyButton(rt, new THREE.Vector3(0, 1.4, -3));
  const start = sign('HUSS HUSS HUSS', '#2a2000', 9);
  start.position.set(0, 8, -12);
  scene.add(start);
  for (let i = 0; i < 3; i++) addHunter();

  const reset = (): void => {
    rt.respawn();
    for (const h of hunters.splice(0)) scene.remove(h.human.group);
    for (let i = 0; i < 3; i++) addHunter();
    best = Math.max(best, survived);
    survived = 0;
    nextHunter = 20;
    grace = 4;
  };

  let time = 0;
  let buzz = 0;
  let voice = 4;
  rt.onFrame = (dt) => {
    time += dt;
    // The player's feet.
    const px = rt.head.x;
    const pz = rt.head.z;
    const py = rt.head.y - 0.6;
    if (respawning > 0) {
      respawning -= dt;
      if (respawning <= 0.4 && fade.target === 1) {
        reset();
        fade.target = 0;
      }
    } else {
      survived += dt;
      grace -= dt;
      nextHunter -= dt;
      if (nextHunter <= 0 && hunters.length < 9) {
        nextHunter = 20;
        addHunter();
        rt.audio.play('growl', undefined, 0.5);
      }
    }
    let nearest = Infinity;
    for (const h of hunters) {
      const dx = px - h.x;
      const dz = pz - h.z;
      const dist = Math.hypot(dx, dz);
      nearest = Math.min(nearest, dist);
      // Faces the way it is going and can only turn so fast.
      const want = Math.atan2(-dx, -dz); // the model faces -Z
      let diff = want - h.heading;
      diff -= Math.round(diff / (Math.PI * 2)) * Math.PI * 2;
      const turn = 1.15 * dt;
      h.heading += Math.max(-turn, Math.min(turn, diff));
      // Fast, but it slows when it has to turn sharply.
      const target = grace > 0 || respawning > 0 ? 0 : 6.4 * (Math.abs(diff) > 0.9 ? 0.45 : 1);
      h.speed += (target - h.speed) * Math.min(1, dt * 2.5);
      h.x += -Math.sin(h.heading) * h.speed * dt;
      h.z += -Math.cos(h.heading) * h.speed * dt;
      for (const p of pillars) {
        const ox = h.x - p.x;
        const oz = h.z - p.z;
        const od = Math.hypot(ox, oz);
        if (od < p.r + 0.6) {
          h.x = p.x + (ox / od) * (p.r + 0.6);
          h.z = p.z + (oz / od) * (p.r + 0.6);
          h.speed *= 0.6;
        }
      }
      h.phase += dt * (3 + h.speed * 0.9);
      poseRun(h.human, h.phase, Math.min(1.2, h.speed / 5));
      h.human.group.rotation.x = -0.12 - Math.min(0.2, h.speed * 0.03);
      place(h);
      h.human.group.position.y = Math.abs(Math.sin(h.phase)) * 0.15 * Math.min(1, h.speed / 4);
      h.step -= dt * h.speed;
      if (h.step <= 0 && dist < 45) {
        h.step = 2.2;
        rt.audio.play('step', _a.set(h.x, 0.1, h.z), Math.min(1, 14 / Math.max(3, dist)));
      }
      if (respawning <= 0 && dist < 0.85 && Math.abs(py) < 2.2) {
        caught++;
        respawning = 1.6;
        fade.target = 1;
        rt.audio.play('sting');
        rt.hands.all.forEach((hand) => hand.pulse(1, 300));
      }
    }
    fade.update(dt);
    // Sounds: the hum, and the shouting.
    buzz -= dt;
    if (buzz <= 0) {
      buzz = 1.2;
      rt.audio.play('buzz', undefined, 0.5);
    }
    voice -= dt;
    if (voice <= 0 && nearest < 40) {
      voice = rnd(4, 7);
      say('huss huss huss', 0.25, 0.85);
      rt.audio.play('growl', _a.set(hunters[0].x, 1.5, hunters[0].z), 0.8);
    }
    panels.forEach((p, i) => {
      p.visible = Math.sin(time * 40 + i * 7) * Math.sin(time * 6.3 + i) > -0.92;
    });
    // The scoreboard follows your left hand.
    const hand = rt.locomotion.hands[0].position;
    board.mesh.position.set(hand.x, hand.y + 0.12, hand.z);
    board.mesh.lookAt(rt.head);
    const m = Math.floor(survived / 60);
    const s = Math.floor(survived % 60);
    board.setLabel(`${m}:${String(s).padStart(2, '0')} · best ${Math.floor(best)}s · x${caught}`);
  };

  finishMode(rt, 'HUSS HUSS HUSS · run. They are fast and cannot turn. L = lobby', '#3a3000', { hunters, pillars, state: () => ({ caught, survived, best }) });
}
