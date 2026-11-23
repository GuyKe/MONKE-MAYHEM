import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { LOCOMOTION, SPAWN } from './config';
import { RAPIER, createPhysicsWorld } from './physics';
import { buildTestArena } from './world/testArena';
import { buildForest } from './world/forest';
import { Hands } from './player/hands';
import { Locomotion } from './player/locomotion';
import { ArmSpan } from './player/armSpan';
import { Grab } from './player/grab';
import { Sticks } from './world/sticks';
import type { DesktopEmulator } from './debug/desktop';

async function main(): Promise<void> {
  // Use the desktop emulator when asked to (?emulate) or when there's no real VR.
  const forceEmulator = new URLSearchParams(location.search).has('emulate');
  const hasRealVR = !forceEmulator && (await navigator.xr?.isSessionSupported('immersive-vr').catch(() => false));
  const emulator: DesktopEmulator | null = hasRealVR
    ? null
    : new (await import('./debug/desktop')).DesktopEmulator(); // loaded only when needed

  const world = await createPhysicsWorld();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.xr.setFoveation(1);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 250);
  camera.position.set(0, 1.6, 0);

  // The rig is the tracking-space origin; the head and controllers move inside it.
  const rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);

  // The forest is the game. `?arena` loads the flat movement test course instead.
  const spawn = new THREE.Vector3(SPAWN.x, SPAWN.y, SPAWN.z);
  let worldStats = 'test arena';
  let forestRef: ReturnType<typeof buildForest> | null = null;
  if (new URLSearchParams(location.search).has('arena')) {
    buildTestArena(scene, world);
  } else {
    const forest = buildForest(scene, world);
    forestRef = forest;
    rig.add(forest.sky);
    spawn.copy(forest.spawn);
    const s = forest.stats;
    worldStats = `forest: ${s.trees} trees, ${s.rocks} rocks, ${s.logs} logs, ${s.colliders} colliders`;
  }
  world.step(); // populate the broad phase so queries see the static scenery

  const sticks = new Sticks(scene, world, {
    heightAt: forestRef ? forestRef.heightAt : () => 0,
    isBlocked: forestRef ? forestRef.isBlocked : () => false,
    spawn,
  });

  const hands = new Hands(renderer, rig, scene);
  const grab = new Grab(sticks, hands);
  const locomotion = new Locomotion(world, rig);
  const armSpan = new ArmSpan();
  let calibrationTick = 0;
  locomotion.respawn(spawn);

  const vrButton = VRButton.createButton(renderer);
  if (emulator) vrButton.textContent = 'ENTER VR (DESKTOP EMULATOR)';
  document.body.appendChild(vrButton);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') locomotion.respawn(spawn);
  });

  const hud = document.getElementById('hud')!;
  const headLocal = new THREE.Vector3(0, 1.6, 0);
  const handLocals: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  const clock = new THREE.Clock();
  let fpsFrames = 0;
  let fpsTime = 0;
  let fps = 0;

  renderer.setAnimationLoop((_time, frame?: XRFrame) => {
    const frameDt = clock.getDelta(); // real frame time, for the fps counter
    let dt = frameDt;
    if (emulator) {
      dt = Math.min(dt, 1 / 30); // keep emulator and simulation in step on slow machines
      emulator.update(dt);
    }

    if (frame && renderer.xr.isPresenting) {
      const refSpace = renderer.xr.getReferenceSpace();
      const pose = refSpace ? frame.getViewerPose(refSpace) : undefined;
      if (pose) {
        const p = pose.transform.position;
        headLocal.set(p.x, p.y, p.z);
      }
      const [left, right] = hands.all;
      const leftPos = left.localPosition(handLocals[0]);
      const rightPos = right.localPosition(handLocals[1]);

      // Arm span: estimate from height at the start, refine with the T-pose gesture.
      armSpan.estimateFromHeight(headLocal.y);
      const cal = armSpan.update(dt, headLocal, leftPos, rightPos, left.squeezed, right.squeezed);
      if (cal.finished) {
        hands.all.forEach((h) => h.pulse(1, 250));
        calibrationTick = 0;
      } else if (cal.progress > 0) {
        const tick = Math.floor(cal.progress * 10);
        if (tick !== calibrationTick) {
          calibrationTick = tick;
          hands.all.forEach((h) => h.pulse(0.1 + 0.4 * cal.progress, 40));
        }
      } else {
        calibrationTick = 0;
      }
      locomotion.reachScale = armSpan.scale;

      locomotion.update(dt, headLocal, [leftPos, rightPos]);

      hands.all.forEach((hand, i) => {
        const contact = locomotion.hands[i];
        hand.updateVisual(contact.position, contact.rawPosition, contact.touching);
        if (contact.justTouched) hand.pulse(0.3, 25);
      });

      grab.update(dt, locomotion.hands);

      if (rig.position.y < LOCOMOTION.killY) locomotion.respawn(spawn);
    }

    // Step physics by the real frame time so sticks fall at the right speed whatever
    // the refresh rate, in steps of at most 1/60 s so slow frames don't make the
    // contacts mushy.
    const physicsDt = Math.min(Math.max(dt, 1 / 144), 1 / 20);
    const substeps = Math.ceil(physicsDt / (1 / 60) - 1e-6);
    world.timestep = physicsDt / substeps;
    for (let i = 0; i < substeps; i++) world.step();
    sticks.sync();

    fpsFrames++;
    fpsTime += frameDt;
    if (fpsTime >= 0.5) {
      fps = Math.round(fpsFrames / fpsTime);
      fpsFrames = 0;
      fpsTime = 0;
    }
    hud.textContent = hudText(renderer, locomotion, armSpan, grab, fps, emulator !== null, worldStats);

    renderer.render(scene, camera);
  });

  // Handy for debugging from the console and for automated tests.
  Object.assign(window, { __monke: { locomotion, hands, world, rig, emulator, armSpan, renderer, scene, spawn, forest: forestRef, sticks, grab, RAPIER } });
}

function hudText(
  renderer: THREE.WebGLRenderer,
  loco: Locomotion,
  arms: ArmSpan,
  grab: Grab,
  fps: number,
  emulated: boolean,
  worldStats: string,
): string {
  if (!renderer.xr.isPresenting) {
    return emulated
      ? 'No VR headset found: using the desktop emulator.\nPress ENTER VR below to start.'
      : '';
  }
  const v = loco.velocity;
  const lines = [
    `fps      ${fps}  (${worldStats})`,
    `speed    ${Math.hypot(v.x, v.z).toFixed(2)} m/s  (vy ${v.y.toFixed(2)})`,
    `hands    L ${loco.hands[0].touching ? '●' : '○'}  R ${loco.hands[1].touching ? '●' : '○'}`,
    `grounded ${loco.grounded ? 'yes' : 'no'}`,
    `surface  L ${surfaceLabel(loco, 0)}  R ${surfaceLabel(loco, 1)}`,
    `holding  L ${grab.held(0) ? 'stick' : '-'}  R ${grab.held(1) ? 'stick' : '-'}`,
    `reach    x${arms.scale.toFixed(2)}  (arm span ${arms.span.toFixed(2)} m, ${arms.calibrated ? 'calibrated' : 'estimated'})`,
  ];
  if (emulated) {
    lines.push(
      '',
      'click   look with the mouse',
      'W A S D knuckle-walk',
      'shift   faster strokes',
      'space   jump',
      'Q / E   squeeze left / right grip (grab and throw)',
      'T       T-pose arm calibration',
      '[ ]     shorter / longer emulated arms',
      'R       respawn',
    );
  }
  return lines.join('\n');
}

function surfaceLabel(loco: Locomotion, i: 0 | 1): string {
  const hand = loco.hands[i];
  return hand.touching ? `${hand.surface.name} ${Math.round(hand.surface.slip * 100)}%` : '-';
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#900;padding:16px">${String(err)}</pre>`);
});
