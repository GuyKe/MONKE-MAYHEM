import * as THREE from 'three';
import { buildHuman, flashlightMesh, gorillaStatue, plinth, sign } from '../mode/figures';
import { createRuntime } from '../mode/runtime';
import { WorldButton } from '../ui/panel';

/** Where a statue's Play button sends you. */
export type GameMode = 'jungle' | 'horror' | 'hub';

/** Goes to another mode. (A new page: the headset leaves VR, and the mode's own menu is shown.) */
export function goToMode(mode: GameMode): void {
  const old = new URLSearchParams(location.search);
  const params = new URLSearchParams();
  params.set('mode', mode);
  for (const keep of ['emulate', 'signal', 'netdebug']) if (old.has(keep)) params.set(keep, old.get(keep) ?? '');
  location.href = `${location.pathname}?${params.toString().replace(/=(&|$)/g, '$1')}`;
}

/**
 * The lobby: a long black platform in the dark. You start at one end; at the far end are the modes, each a statue with a Play
 * button. Jungle (the gorilla with a stick) is the game. To its right is Horror: a frightened person with a flashlight, and
 * behind them something that looks just like them, smiling.
 */
export async function runHub(): Promise<void> {
  const rt = await createRuntime({ background: 0x000000, spawn: new THREE.Vector3(0, 0, 26), killY: -8 });
  const { scene } = rt;

  // --- The platform ------------------------------------------------------------------
  const LENGTH = 64;
  const WIDTH = 12;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(WIDTH, 0.5, LENGTH), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.35, metalness: 0.6 }));
  floor.position.y = -0.25;
  scene.add(floor);
  rt.solidBox(0, -0.25, 0, WIDTH / 2, 0.25, LENGTH / 2);
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x2a4a8a });
  for (const sx of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, LENGTH), edgeMat);
    strip.position.set(sx * (WIDTH / 2 - 0.1), 0.012, 0);
    scene.add(strip);
  }
  // Faint guide marks down the middle, so you can feel how long it is.
  const markMat = new THREE.MeshBasicMaterial({ color: 0x14203a });
  for (let z = -LENGTH / 2 + 2; z < LENGTH / 2; z += 4) {
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 1.4), markMat);
    mark.position.set(0, 0.008, z);
    scene.add(mark);
  }
  // Stars.
  const stars = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2;
    const e = Math.acos(1 - Math.random() * 0.95);
    const r = 160;
    stars[i * 3] = Math.sin(e) * Math.cos(a) * r;
    stars[i * 3 + 1] = Math.cos(e) * r;
    stars[i * 3 + 2] = Math.sin(e) * Math.sin(a) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9aa6c0, size: 0.9, sizeAttenuation: false, fog: false })));

  scene.add(new THREE.AmbientLight(0x2a2a38, 0.9));

  // --- Jungle ------------------------------------------------------------------------------
  const STATUE_Z = -22;
  const jungle = new THREE.Group();
  jungle.position.set(-5, 0, STATUE_Z);
  jungle.rotation.y = Math.PI; // they face the player
  const gorilla = gorillaStatue(scene);
  gorilla.scale.setScalar(4.2);
  gorilla.position.y = 0.5;
  jungle.add(plinth(3, 0.5, 3), gorilla);
  scene.add(jungle);
  const jungleLight = new THREE.SpotLight(0xfff0d0, 260, 40, 0.42, 0.6, 1.4);
  jungleLight.position.set(-5, 13, STATUE_Z + 7);
  jungleLight.target.position.set(-5, 2, STATUE_Z);
  scene.add(jungleLight, jungleLight.target);
  const jungleSign = sign('JUNGLE', '#9be07a', 4.6);
  jungleSign.position.set(-5, 8.4, STATUE_Z);
  scene.add(jungleSign);

  // --- Horror: the frightened one and, behind, the other ----------------------------------------
  const scared = buildHuman('scared', { skin: 0xe2b896, hair: 0x4a3322, shirt: 0x3a5a8a, pants: 0x34404c, shoes: 0xdddddd });
  scared.group.scale.setScalar(2.0);
  scared.group.position.set(5, 0.5, STATUE_Z);
  scared.group.rotation.y = Math.PI;
  const torch = flashlightMesh();
  torch.position.set(0.07, -0.02, -0.5);
  scared.arms[1].add(torch);
  const torchLight = new THREE.SpotLight(0xfff2d0, 80, 26, 0.5, 0.4, 1.2);
  torchLight.position.set(0.07, -0.02, -0.55);
  torchLight.target.position.set(0.07, -0.6, -9);
  scared.arms[1].add(torchLight, torchLight.target);
  const monster = buildHuman('monster', { skin: 0xc9c2b2, hair: 0x14100d, shirt: 0x231b18, pants: 0x1a1816, shoes: 0x0d0d0d });
  monster.group.scale.setScalar(2.1);
  monster.group.position.set(5, 0.5, STATUE_Z - 4.2);
  monster.group.rotation.y = Math.PI;
  scene.add(plinthAt(5, STATUE_Z), plinthAt(5, STATUE_Z - 4.2), scared.group, monster.group);
  const horrorLight = new THREE.SpotLight(0xc8d8ff, 150, 40, 0.5, 0.7, 1.4);
  horrorLight.position.set(5, 13, STATUE_Z + 8);
  horrorLight.target.position.set(5, 2, STATUE_Z - 2);
  const redLight = new THREE.PointLight(0xb01010, 40, 14, 1.6);
  redLight.position.set(5, 1.2, STATUE_Z - 6.5);
  scene.add(horrorLight, horrorLight.target, redLight);
  const horrorSign = sign('HORROR', '#e03030', 4.6);
  horrorSign.position.set(5, 8.4, STATUE_Z - 1);
  scene.add(horrorSign);

  // --- Play buttons ---------------------------------------------------------------------------------
  const playJungle = rt.panels.add(new WorldButton(scene, 'PLAY', 1.7, 0.6, '#2d6a3a', () => goToMode('jungle')));
  playJungle.mesh.position.set(-5, 1.0, STATUE_Z + 4.2);
  const playHorror = rt.panels.add(new WorldButton(scene, 'PLAY', 1.7, 0.6, '#8a1f1f', () => goToMode('horror')));
  playHorror.mesh.position.set(5, 1.0, STATUE_Z + 4.2);
  // A caption under each.
  const caption = (text: string, x: number) => {
    const s = sign(text, '#c8c8c8', 2.2);
    s.position.set(x, 0.42, STATUE_Z + 4.2);
    scene.add(s);
  };
  caption('the wilds', -5);
  caption('the facility', 5);

  // --- Life ----------------------------------------------------------------------------------------------
  let time = 0;
  rt.onFrame = (dt) => {
    time += dt;
    // The torch flickers, and the monster breathes.
    torchLight.intensity = 80 * (0.85 + 0.15 * Math.sin(time * 23) * Math.sin(time * 7.1));
    redLight.intensity = 40 * (0.8 + 0.2 * Math.sin(time * 2.2));
    monster.group.scale.set(2.1, 2.1 * (1 + 0.006 * Math.sin(time * 1.6)), 2.1);
    monster.head.rotation.z = 0.18 + 0.03 * Math.sin(time * 0.7);
    // The buttons turn to face wherever you are.
    for (const b of [playJungle, playHorror]) b.mesh.lookAt(rt.head.x, b.mesh.position.y, rt.head.z);
  };
  const label = document.createElement('div');
  label.textContent = 'NATURE MONKE · LOBBY';
  label.style.cssText = 'position:fixed;top:12px;left:12px;z-index:100000;color:#9aa6c0;font:600 13px/1.4 system-ui;letter-spacing:.2em;pointer-events:none';
  document.body.appendChild(label);
  Object.assign(window, { __hub: { rt, playJungle, playHorror, goToMode, scared, monster, gorilla }, __monke: { THREE, renderer: rt.renderer, scene: rt.scene, camera: rt.camera, locomotion: rt.locomotion, rig: rt.rig, emulator: rt.emulator, panels: rt.panels } });
}

function plinthAt(x: number, z: number): THREE.Mesh {
  const p = plinth(3, 0.5, 3);
  p.position.set(x, 0.25, z);
  return p;
}
