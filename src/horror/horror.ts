import * as THREE from 'three';
import { createRuntime } from '../mode/runtime';
import { WorldButton } from '../ui/panel';
import { goToMode } from '../hub/hub';
import { buildFacility, CELL, WALL_HEIGHT } from './facility';
import { Monster } from './monster';

/**
 * Horror: a dark facility. You wake in the green safe room with a torch. Somewhere in the maze of corridors is a way out, and
 * something that hunts. It cannot come into the safe room. Light on it slows it. If it catches you, you wake in the safe room again.
 */
export async function runHorror(): Promise<void> {
  const rt = await createRuntime({ background: 0x000000, fog: new THREE.Fog(0x000000, 1.5, 34), spawn: new THREE.Vector3(3, 0, 3), killY: -10 });
  const { scene } = rt;
  scene.add(new THREE.AmbientLight(0x1a2028, 1.1));
  const facility = buildFacility(rt, Number(new URLSearchParams(location.search).get('seed')) || 1337);
  const safeCenter = facility.center(facility.safe);
  rt.spawn.set(safeCenter.x, 0, safeCenter.z);
  rt.respawn();
  const exitCenter = facility.center(facility.exit);

  // A few real lights, moved to the nearest working fixtures.
  const pool = [0, 1, 2, 3].map(() => {
    const l = new THREE.PointLight(0xd0e0ff, 12, 13, 1.7);
    scene.add(l);
    return l;
  });

  // The torch: in the right hand.
  const torch = new THREE.SpotLight(0xfff0d8, 95, 32, 0.46, 0.55, 1.2);
  const controller = rt.controllerFor(1);
  controller.add(torch, torch.target);
  torch.target.position.set(0, 0, -1);
  const torchBody = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.16, 10).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x2b2b30 }));
  const torchHead = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.024, 0.05, 10).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
  torchHead.position.z = -0.1;
  controller.add(torchBody, torchHead);

  // The monster.
  const monster = new Monster(scene, facility, {
    growl: (at) => rt.audio.play('growl', at, 1),
    step: (at, loud) => rt.audio.play('step', at, loud),
  });

  // Fading to black (and red) when caught.
  const fade = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ color: 0x300000, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
  fade.position.z = -0.3;
  fade.renderOrder = 999;
  fade.frustumCulled = false;
  rt.camera.add(fade);
  let fadeTarget = 0;
  let fadeLevel = 0;

  // Buttons: back to the lobby from the safe room, and at the exit.
  const leave = rt.panels.add(new WorldButton(scene, 'BACK TO LOBBY', 2.0, 0.5, '#2d4a6a', () => goToMode('hub')));
  leave.mesh.position.set(safeCenter.x, 1.1, safeCenter.z - CELL / 2 + 0.3);
  const status = new WorldButton(scene, 'Caught: 0', 1.4, 0.35, '#3a3a3a');
  status.enabled = false;
  status.mesh.position.set(safeCenter.x - 1.6, 1.1, safeCenter.z - CELL / 2 + 0.3);
  rt.panels.add(status);
  const escaped = rt.panels.add(new WorldButton(scene, 'YOU ESCAPED! BACK TO LOBBY', 3.0, 0.6, '#2d6a3a', () => goToMode('hub')));
  escaped.mesh.position.set(exitCenter.x, 1.2, exitCenter.z + 1.7);
  escaped.mesh.visible = false;

  let time = 0;
  let lightTimer = 0;
  let heartbeat = 0;
  let ambient = 6;
  let won = false;
  let caughtTimer = 0;
  const feet = new THREE.Vector3();
  const _o = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _m = new THREE.Vector3();

  rt.onFrame = (dt) => {
    time += dt;
    feet.set(rt.head.x, rt.head.y - 0.62, rt.head.z);
    const cell = facility.cellAt(feet.x, feet.z);
    const inSafe = !!cell && facility.isSafe(cell);

    // Fixtures flicker; the nearest few light the way.
    for (const f of facility.flicker) {
      const s = Math.sin(time * 30 + f.phase) * Math.sin(time * 7.3 + f.phase * 3);
      f.material.color.setScalar(s > 0.55 ? 0.25 : 0.85 + 0.15 * s);
    }
    lightTimer -= dt;
    if (lightTimer <= 0) {
      lightTimer = 0.35;
      const near = facility.lights.slice().sort((a, b) => a.pos.distanceToSquared(rt.head) - b.pos.distanceToSquared(rt.head)).slice(0, pool.length);
      pool.forEach((l, i) => {
        l.visible = !!near[i];
        if (near[i]) l.position.copy(near[i].pos);
      });
    }

    // Is the torch on the monster?
    controller.updateWorldMatrix(true, false);
    controller.getWorldPosition(_o);
    _d.set(0, 0, -1).transformDirection(controller.matrixWorld);
    _m.set(monster.x, 1.1, monster.z).sub(_o);
    const dist = _m.length();
    const lit = dist < 11 && _m.normalize().dot(_d) > 0.93;

    if (!won) {
      const caught = monster.update(dt, feet, inSafe, lit);
      if (caught && caughtTimer <= 0) {
        caughtTimer = 2.2;
        fadeTarget = 1;
        rt.audio.play('sting');
        rt.hands.all.forEach((h) => h.pulse(1, 300));
        status.setLabel(`Caught: ${monster.catches}`);
      }
      if (caughtTimer > 0) {
        caughtTimer -= dt;
        if (caughtTimer <= 1.2 && fadeTarget === 1) {
          // Wake in the safe room.
          rt.respawn();
          monster.sendAway(16);
          fadeTarget = 0;
        }
      }
      // The way out.
      if (Math.hypot(feet.x - exitCenter.x, feet.z - exitCenter.z) < 1.4 && feet.y < 1.2) {
        won = true;
        rt.award(200, 'ESCAPED!');
        escaped.mesh.visible = true;
        rt.audio.play('unlock');
        monster.sendAway(9999);
      }
    }
    fadeLevel += (fadeTarget - fadeLevel) * Math.min(1, dt * 5);
    (fade.material as THREE.MeshBasicMaterial).opacity = fadeLevel;
    fade.visible = fadeLevel > 0.01;
    for (const b of [leave, status, escaped]) if (b.mesh.visible) b.mesh.rotation.y = 0;

    // Sound: a heartbeat that quickens as it nears, and distant things in the dark.
    heartbeat -= dt;
    const near = monster.distance < 22 && !inSafe;
    if (near && heartbeat <= 0) {
      const closeness = 1 - monster.distance / 22;
      heartbeat = 1.15 - 0.7 * closeness;
      rt.audio.play('thump', undefined, 0.4 + 0.6 * closeness);
      setTimeout(() => rt.audio.play('thump', undefined, 0.3 + 0.5 * closeness), 160);
      rt.hands.all.forEach((h) => h.pulse(0.1 + 0.3 * closeness, 60));
    }
    ambient -= dt;
    if (ambient <= 0) {
      ambient = 7 + Math.random() * 9;
      const a = Math.random() * Math.PI * 2;
      rt.audio.play(Math.random() < 0.5 ? 'creak' : 'thump', _o.set(rt.head.x + Math.cos(a) * 12, 1, rt.head.z + Math.sin(a) * 12), 0.5);
    }
  };

  rt.onA = () => goToMode('hub'); // A on the right controller
  const label = document.createElement('div');
  label.textContent = 'HORROR · find the EXIT. The green room is safe.';
  label.style.cssText = 'position:fixed;top:12px;left:12px;z-index:100000;color:#d04040;font:600 13px/1.4 system-ui;letter-spacing:.15em;pointer-events:none';
  document.body.appendChild(label);
  Object.assign(window, { __horror: { rt, facility, monster, status, escaped, leave, torch, state: () => ({ won, caught: monster.catches }) }, __monke: { THREE, renderer: rt.renderer, scene: rt.scene, camera: rt.camera, locomotion: rt.locomotion, rig: rt.rig, emulator: rt.emulator, panels: rt.panels } });
  void WALL_HEIGHT;
}
