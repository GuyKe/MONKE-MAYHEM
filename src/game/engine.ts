import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { GameAudio } from '../audio';
import type { DesktopEmulator } from '../debug/desktop';
import { ArmSpan } from '../player/armSpan';
import { Hand, Hands } from '../player/hands';
import { Locomotion } from '../player/locomotion';
import { RAPIER, WORLD_GROUPS, createPhysicsWorld } from '../physics';
import { Settings, TURN_SPEED_DEG } from '../settings';
import type { PointerRay } from '../ui/laser';
import { Panels } from '../ui/panel';
import { SURFACES, setSurface, type SurfaceMaterial } from '../world/materials';
import { SubjectBody } from './avatar';

export interface EngineOptions {
  background: number;
  spawn: THREE.Vector3;
  killY: number;
}

/** Everything the game stands on: renderer, physics, the player's body and hands (gorilla-tag locomotion), sound and buttons. */
export interface Engine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: THREE.Group;
  world: RAPIER.World;
  hands: Hands;
  body: SubjectBody;
  locomotion: Locomotion;
  audio: GameAudio;
  panels: Panels;
  settings: Settings;
  emulator: DesktopEmulator | null;
  /** The head in the world, which way it faces, and the feet under it. */
  head: THREE.Vector3;
  headQuat: THREE.Quaternion;
  feet: THREE.Vector3;
  /** True while the headset (or emulator) is running the session. */
  presenting: boolean;
  controller(hand: 0 | 1): THREE.Object3D;
  /** A buzz in a hand (0 left, 1 right), 0 to 1, for some milliseconds. */
  buzz(hand: 0 | 1 | 'both', intensity: number, ms: number): void;
  respawn(at: THREE.Vector3): void;
  solid(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, surface?: SurfaceMaterial): RAPIER.Collider;
  removeSolid(c: RAPIER.Collider): void;
  updaters: Array<(dt: number) => void>;
  onPause: (() => void) | null;
  /** Called once a frame, after the player has moved. */
  onFrame: (dt: number) => void;
  time: number;
}

export async function createEngine(options: EngineOptions): Promise<Engine> {
  const params = new URLSearchParams(location.search);
  const settings = new Settings();
  Hand.hapticScale = settings.data.haptics;
  const forceEmulator = params.has('emulate');
  const hasRealVR = !forceEmulator && (await navigator.xr?.isSessionSupported('immersive-vr').catch(() => false));
  const emulator: DesktopEmulator | null = hasRealVR ? null : new (await import('../debug/desktop')).DesktopEmulator();
  const world = await createPhysicsWorld();

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.xr.setFoveation(1);
  renderer.xr.setFramebufferScaleFactor(0.9);
  renderer.toneMapping = THREE.NoToneMapping; // flat, bright, like fluorescent-lit concrete
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(options.background);
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 220);
  camera.position.set(0, 1.6, 0);
  const rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);

  const hands = new Hands(renderer, rig, scene);
  const body = new SubjectBody(scene);
  const locomotion = new Locomotion(world, rig);
  locomotion.speedScale = 1.35;
  const armSpan = new ArmSpan();
  const audio = new GameAudio();
  audio.setVolume(settings.data.volume);
  const panels = new Panels(scene);
  panels.onPress = (hand) => {
    hands.all[hand].pulse(0.5, 40);
    audio.play('click');
  };

  const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
  controllers.forEach((c) => rig.add(c));
  const rayOrigin = [new THREE.Vector3(), new THREE.Vector3()];
  const rayDir = [new THREE.Vector3(), new THREE.Vector3()];
  const rays: [PointerRay | null, PointerRay | null] = [null, null];
  const head = new THREE.Vector3();
  const headQuat = new THREE.Quaternion();
  const headLocal = new THREE.Vector3(0, 1.6, 0);
  const handLocals: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  locomotion.respawn(options.spawn);

  const engine: Engine = {
    renderer, scene, camera, rig, world, hands, body, locomotion, audio, panels, settings, emulator, head, headQuat, feet: new THREE.Vector3(), presenting: false,
    controller: (hand) => controllers[renderer.xr.getControllerGrip(1) === hands.all[hand].grip ? 1 : 0],
    buzz: (hand, intensity, ms) => {
      if (hand === 'both') hands.all.forEach((h) => h.pulse(intensity, ms));
      else hands.all[hand].pulse(intensity, ms);
    },
    respawn: (at) => locomotion.respawn(at),
    solid: (cx, cy, cz, hx, hy, hz, surface = SURFACES.stone) => {
      const c = world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setCollisionGroups(WORLD_GROUPS).setFriction(0.9));
      setSurface(c, surface);
      return c;
    },
    removeSolid: (c) => world.removeCollider(c, false),
    updaters: [],
    onPause: null,
    onFrame: () => {},
    time: 0,
  };

  const vrButton = VRButton.createButton(renderer);
  if (emulator) vrButton.textContent = 'ENTER VR (DESKTOP EMULATOR)';
  document.body.appendChild(vrButton);
  renderer.xr.addEventListener('sessionstart', () => audio.start());
  window.addEventListener('pointerdown', () => audio.start(), { once: true });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP' && !e.repeat) engine.onPause?.();
  });
  const hud = document.getElementById('hud');
  if (hud) hud.style.display = 'none';

  const clock = new THREE.Clock();
  let wasB = false;
  let lastTurnStick = 0;
  renderer.setAnimationLoop((_t, frame?: XRFrame) => {
    let dt = clock.getDelta();
    if (emulator) {
      dt = Math.min(dt, 1 / 30);
      emulator.update(dt);
    }
    engine.time += dt;
    engine.presenting = !!(frame && renderer.xr.isPresenting);
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
      armSpan.estimateFromHeight(headLocal.y);
      locomotion.reachScale = Math.min(1.12, Math.max(0.88, armSpan.scale));
      locomotion.update(dt, headLocal, [leftPos, rightPos]);
      hands.all.forEach((hand, i) => {
        const contact = locomotion.hands[i];
        hand.updateVisual(contact.position, contact.rawPosition, contact.touching);
        if (contact.justTouched) {
          hand.pulse(0.2, 25);
          audio.play('hand', contact.position, 0.5);
        }
      });
      // Turning with the right thumbstick.
      const stickX = right.stickX;
      if (settings.data.turning !== 'off') {
        if (settings.data.turning === 'snap') {
          if (Math.abs(stickX) > 0.7 && Math.abs(lastTurnStick) < 0.3) locomotion.turn((-Math.sign(stickX) * Number(settings.data.snapAngle) * Math.PI) / 180);
        } else if (Math.abs(stickX) > 0.2) {
          const rate = ((TURN_SPEED_DEG[settings.data.turnSpeed] * Math.PI) / 180) * Math.sign(stickX) * ((Math.abs(stickX) - 0.2) / 0.8);
          locomotion.turn(-rate * dt);
        }
      }
      lastTurnStick = stickX;
      camera.getWorldQuaternion(headQuat);
      locomotion.headWorld(head);
      engine.feet.set(head.x, head.y - 0.62, head.z);
      body.update(dt, head, headQuat, [left.tracked ? locomotion.hands[0].position : null, right.tracked ? locomotion.hands[1].position : null]);
      audio.listen(head, headQuat);
      for (let i = 0; i < 2; i++) {
        const c = engine.controller(i as 0 | 1);
        if (hands.all[i].tracked) {
          c.updateWorldMatrix(true, false);
          c.getWorldPosition(rayOrigin[i]);
          rayDir[i].set(0, 0, -1).transformDirection(c.matrixWorld);
          rays[i] = { origin: rayOrigin[i], dir: rayDir[i], trigger: hands.all[i].triggered };
        } else rays[i] = null;
      }
      panels.update([left.tracked ? locomotion.hands[0].position : null, right.tracked ? locomotion.hands[1].position : null], rays);
      // B or Y: the pause menu.
      const b = (right.source?.gamepad?.buttons[5]?.pressed ?? false) || (left.source?.gamepad?.buttons[5]?.pressed ?? false);
      if (b && !wasB) engine.onPause?.();
      wasB = b;
      if (rig.position.y < options.killY) locomotion.respawn(options.spawn);
    }
    for (const u of engine.updaters) u(dt);
    engine.onFrame(dt);
    world.timestep = Math.min(Math.max(dt, 1 / 144), 1 / 20);
    world.step();
    renderer.render(scene, camera);
  });
  return engine;
}
