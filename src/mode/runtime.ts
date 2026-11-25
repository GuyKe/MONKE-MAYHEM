import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { GameAudio } from '../audio';
import { RAPIER, WORLD_GROUPS, createPhysicsWorld } from '../physics';
import { SURFACES, setSurface } from '../world/materials';
import { ArmSpan } from '../player/armSpan';
import { Body } from '../player/body';
import { Hands } from '../player/hands';
import { Locomotion } from '../player/locomotion';
import type { DesktopEmulator } from '../debug/desktop';
import type { PointerRay } from '../ui/laser';
import { Panels } from '../ui/panel';
import { Settings } from '../settings';
import { Progress } from '../progress';
import { Toast, wear, rankLine } from './rank';

export interface RuntimeOptions {
  background: number;
  fog?: THREE.Fog | THREE.FogExp2;
  /// Where the player starts (feet).
  spawn: THREE.Vector3;
  /** Falling below this respawns the player. */
  killY?: number;
  /** Text under the VR button before entering VR. */
  title?: string;
  /** How much faster than normal you walk (the lobby is quickest). */
  walkSpeed?: number;
}

/**
 * What every mode (the lobby, the horror facility) needs: the renderer, a physics world, the player's body and hands moving with
 * hand locomotion, the desktop emulator, sound, laser-and-poke buttons. A mode builds its scene on top of this and gets `onFrame`.
 */
export interface Runtime {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: THREE.Group;
  world: RAPIER.World;
  hands: Hands;
  body: Body;
  locomotion: Locomotion;
  audio: GameAudio;
  panels: Panels;
  emulator: DesktopEmulator | null;
  settings: Settings;
  /** The player's head in the world, and where it faces. */
  head: THREE.Vector3;
  headQuat: THREE.Quaternion;
  /** The right controller's object (a flashlight can be parented to it). */
  controllerFor(hand: 0 | 1): THREE.Object3D;
  respawn(): void;
  /** Your level and rank (kept in this browser). */
  progress: Progress;
  /** Gives XP, with a little banner (and a bigger one for a new level). */
  award(xp: number, why?: string): void;
  toast: Toast;
  /** Things that run every frame before `onFrame`. */
  updaters: Array<(dt: number) => void>;
  /** Called when the A button (right controller) is pressed. */
  onA: (() => void) | null;
  /** Called every frame after the player has moved. */
  onFrame: (dt: number) => void;
  /** Adds a static solid box to the physics world. */
  solidBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void;
  spawn: THREE.Vector3;
}

export async function createRuntime(options: RuntimeOptions): Promise<Runtime> {
  const params = new URLSearchParams(location.search);
  const settings = new Settings();
  const forceEmulator = params.has('emulate');
  const hasRealVR = !forceEmulator && (await navigator.xr?.isSessionSupported('immersive-vr').catch(() => false));
  const emulator: DesktopEmulator | null = hasRealVR ? null : new (await import('../debug/desktop')).DesktopEmulator();
  const world = await createPhysicsWorld();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.xr.setFoveation(1);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(options.background);
  if (options.fog) scene.fog = options.fog;
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 250);
  camera.position.set(0, 1.6, 0);
  const rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);

  const hands = new Hands(renderer, rig, scene);
  const body = new Body(scene);
  const locomotion = new Locomotion(world, rig);
  locomotion.speedScale = options.walkSpeed ?? 1.6;
  const progress = new Progress();
  const toast = new Toast(camera);
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
  const spawn = options.spawn.clone();
  locomotion.respawn(spawn);

  const runtime: Runtime = {
    renderer, scene, camera, rig, world, hands, body, locomotion, audio, panels, emulator, settings, head, headQuat, spawn,
    controllerFor: (hand) => controllers[renderer.xr.getControllerGrip(1) === hands.all[hand].grip ? 1 : 0],
    respawn: () => locomotion.respawn(spawn),
    onFrame: () => {},
    onA: null,
    progress,
    toast,
    updaters: [],
    award: (xp, why) => {
      const levelled = progress.add(xp);
      toast.show(`+${xp} XP${why ? ' · ' + why : ''}`, '#ffe9a0', 1.6);
      if (levelled) {
        toast.show(`LEVEL UP! ${rankLine(progress)}`, progress.rank.color, 4);
        wear(runtime, progress.level);
        audio.play('unlock');
      }
    },
    solidBox: (cx, cy, cz, hx, hy, hz) => {
      const c = world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setCollisionGroups(WORLD_GROUPS).setFriction(0.9));
      setSurface(c, SURFACES.stone);
    },
  };

  wear(runtime, progress.level);
  const vrButton = VRButton.createButton(renderer);
  if (emulator) vrButton.textContent = 'ENTER VR (DESKTOP EMULATOR)';
  document.body.appendChild(vrButton);
  renderer.xr.addEventListener('sessionstart', () => audio.start());
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  const hud = document.getElementById('hud');
  if (hud) hud.style.display = 'none';

  let wasA = false;
  const clock = new THREE.Clock();
  const killY = options.killY ?? -30;
  renderer.setAnimationLoop((_t, frame?: XRFrame) => {
    const frameDt = clock.getDelta();
    let dt = frameDt;
    if (emulator) {
      dt = Math.min(dt, 1 / 30);
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
      armSpan.estimateFromHeight(headLocal.y);
      armSpan.update(dt, headLocal, leftPos, rightPos, left.squeezed, right.squeezed);
      locomotion.reachScale = armSpan.scale;
      locomotion.update(dt, headLocal, [leftPos, rightPos]);
      hands.all.forEach((hand, i) => {
        const contact = locomotion.hands[i];
        hand.updateVisual(contact.position, contact.rawPosition, contact.touching);
        if (contact.justTouched) hand.pulse(0.25, 25);
      });
      camera.getWorldQuaternion(headQuat);
      locomotion.headWorld(head);
      body.update(dt, head, headQuat, [hands.left.tracked ? locomotion.hands[0].position : null, hands.right.tracked ? locomotion.hands[1].position : null]);
      audio.listen(head, headQuat);
      for (let i = 0; i < 2; i++) {
        const c = runtime.controllerFor(i as 0 | 1);
        if (hands.all[i].tracked) {
          c.updateWorldMatrix(true, false);
          c.getWorldPosition(rayOrigin[i]);
          rayDir[i].set(0, 0, -1).transformDirection(c.matrixWorld);
          rays[i] = { origin: rayOrigin[i], dir: rayDir[i], trigger: hands.all[i].triggered };
        } else rays[i] = null;
      }
      panels.update([hands.left.tracked ? locomotion.hands[0].position : null, hands.right.tracked ? locomotion.hands[1].position : null], rays);
      const a = hands.right.tracked && hands.right.faceButton;
      if (a && !wasA) runtime.onA?.();
      wasA = a;
      if (rig.position.y < killY) locomotion.respawn(spawn);
    }
    toast.update(dt);
    for (const u of runtime.updaters) u(dt);
    runtime.onFrame(dt);
    const physicsDt = Math.min(Math.max(dt, 1 / 144), 1 / 20);
    world.timestep = physicsDt;
    world.step();
    renderer.render(scene, camera);
  });
  void options.title;
  return runtime;
}
