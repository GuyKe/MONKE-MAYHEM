import * as THREE from 'three';
import { buildGorilla, cowboyHat, flashlightMesh, gorillaStatue, plinth, poseRun, blob, cyl, mat, part } from '../mode/figures';
import { beam, blender, car, chainsaw, chicken, drumstick, horse, kfcBucket, Screen, stove, ufo, vacuum, pillar } from '../mode/things';
import type { GameMode } from '../mode/nav';

/** A statue in the lobby: built facing -Z with its plinth at y = 0 (the hub turns it to face you). */
export interface Statue {
  group: THREE.Group;
  /** Called every frame while you are nearby. */
  update?(t: number, dt: number): void;
}

export interface StatueSpec {
  mode: GameMode;
  name: string;
  caption: string;
  color: string;
  button: string;
  light: number;
  build(scene: THREE.Scene): Statue;
}

const GORILLAS = {
  jungle: { fur: 0x4a382c, face: 0xb48c6a, belly: 0x6c5442 },
  orange: { fur: 0xc98a4a, face: 0xe6c9a8, belly: 0xe2b278 },
  grey: { fur: 0x808894, face: 0xd0c0b0, belly: 0xa8b0bc },
  blue: { fur: 0x3a68a8, face: 0xe0c8a8, belly: 0x6a98d0 },
  pink: { fur: 0xd870a0, face: 0xf0d0c0, belly: 0xf0a0c0 },
  monster: { fur: 0x3b2f2c, face: 0x5a4a42, belly: 0x4a3a34 },
  green: { fur: 0x4a9a52, face: 0xe0d0a8, belly: 0x80c080 },
};
export { GORILLAS };

function onPlinth(w: number, d: number, h = 0.5): THREE.Mesh {
  const p = plinth(w, h, d);
  return p;
}

function blood(parent: THREE.Object3D, x: number, z: number, r: number, y = 0.505): void {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 14), new THREE.MeshBasicMaterial({ color: 0x6a0808 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
}

function jungleStatue(scene: THREE.Scene): Statue {
  const group = new THREE.Group();
  const g = gorillaStatue(scene);
  g.scale.setScalar(2.9);
  g.position.y = 0.5;
  group.add(onPlinth(3.4, 3.4), g);
  return { group };
}

function horrorStatue(): Statue {
  const group = new THREE.Group();
  const scared = buildGorilla('scared', GORILLAS.orange);
  scared.group.scale.setScalar(2.5);
  scared.group.position.set(0, 0.5, 0);
  const torch = flashlightMesh();
  torch.position.set(0.07, -0.03, -0.5);
  scared.arms[1].add(torch);
  const monster = buildGorilla('monster', GORILLAS.monster);
  monster.group.scale.setScalar(2.4);
  monster.group.position.set(0, 0.5, -4.2);
  const p1 = onPlinth(3.4, 3.4);
  const p2 = onPlinth(3.4, 3.4);
  p2.position.z = -4.2;
  group.add(p1, p2, scared.group, monster.group);
  const torchGlow = new THREE.PointLight(0xfff2d0, 30, 14, 1.8);
  torchGlow.position.set(0.3, 3.4, -4);
  group.add(torchGlow);
  return {
    group,
    update(t) {
      torchGlow.intensity = 30 * (0.85 + 0.15 * Math.sin(t * 23) * Math.sin(t * 7.1));
      monster.group.scale.set(2.4, 2.4 * (1 + 0.006 * Math.sin(t * 1.6)), 2.4);
      monster.head.rotation.z = 0.18 + 0.03 * Math.sin(t * 0.7);
    },
  };
}

function madnessStatue(): Statue {
  const group = new THREE.Group();
  group.add(onPlinth(7.5, 5));
  const ape = buildGorilla('dummy', GORILLAS.pink);
  ape.group.scale.setScalar(2.3);
  ape.group.position.set(-1.6, 0.5, 0);
  // Feeding a chicken a drumstick.
  const stick = drumstick();
  stick.position.copy(ape.hands[1]).add(new THREE.Vector3(0.0, -0.04, -0.16));
  ape.group.add(stick);
  const hen = chicken();
  hen.scale.setScalar(2.3);
  hen.position.set(-1.6 + 0.12 * 2.3 + 0.1, 0.5 + 0.2, -0.36 * 2.3 * 0.1 - 1.6);
  hen.position.set(-1.1, 0.5, -1.95);
  hen.rotation.y = Math.PI * 0.85;
  // The horse and its bucket.
  const h = horse(0xc89a60, 0xf0e0c0);
  h.scale.setScalar(1.55);
  h.position.set(2.3, 0.5, -0.2);
  h.rotation.y = Math.PI * 0.4;
  const bucket = kfcBucket();
  bucket.scale.setScalar(2.4);
  bucket.position.set(0.9, 0.5, -3.0);
  // Above: a ufo; around: screens and other nonsense.
  const saucer = ufo();
  saucer.scale.setScalar(1.4);
  saucer.position.set(0.4, 9, -0.8);
  const tractor = beam(1.7, 8);
  (tractor.material as THREE.MeshBasicMaterial).opacity = 0.07;
  saucer.add(tractor);
  const screens: Screen[] = [];
  const spots: Array<[number, number, number, number]> = [[-3.4, 4.3, -1.5, 0.5], [3.7, 5.5, -2.4, -0.5], [-0.5, 7.0, -3.2, 0.1], [3.3, 2.8, 1.4, -0.9]];
  spots.forEach(([x, y, z, ry], i) => {
    const s = new Screen(2.4, 1.35, i);
    s.group.position.set(x, y, z);
    s.group.rotation.y = ry + Math.PI;
    screens.push(s);
    group.add(s.group);
  });
  const spinner = new THREE.Group();
  const spinHorse = horse(0x7a4a8a);
  spinHorse.scale.setScalar(0.5);
  spinner.add(spinHorse);
  spinner.position.set(-3.2, 7.2, 0.5);
  const miniCar = car(0xe0b020, true);
  miniCar.scale.setScalar(0.7);
  miniCar.position.set(3.0, 0.5, 1.2);
  miniCar.rotation.set(0, 0.5, 0.6);
  const carHorse = horse(0x30a060);
  carHorse.scale.setScalar(0.45);
  carHorse.position.set(0, 0.3, 0.3);
  miniCar.add(carHorse);
  group.add(ape.group, hen, h, bucket, saucer, spinner, miniCar);
  return {
    group,
    update(t) {
      saucer.position.y = 9 + Math.sin(t * 1.3) * 0.5;
      saucer.rotation.y = t * 1.8;
      spinner.rotation.y = t * 4;
      spinner.rotation.z = t * 1.5;
      hen.position.y = 0.5 + Math.abs(Math.sin(t * 9)) * 0.12;
      hen.rotation.x = Math.sin(t * 17) * 0.1;
      bucket.rotation.y = t * 0.8;
      for (const s of screens) s.tick(t);
    },
  };
}

function cookingStatue(): Statue {
  const group = new THREE.Group();
  group.add(onPlinth(8, 7));
  const victim = buildGorilla('scared', GORILLAS.green);
  victim.group.scale.setScalar(2.3);
  victim.group.position.set(0, 0.5, 1.4);
  victim.arms[0].rotation.x = 2.9;
  victim.arms[1].rotation.x = 2.9;
  victim.arms[1].rotation.z = -0.15;
  victim.arms[0].rotation.z = 0.15;
  const killer = buildGorilla('monster', GORILLAS.monster);
  killer.group.scale.setScalar(4.6);
  killer.group.position.set(0, 0.5, -3.4);
  killer.arms[0].rotation.x = 2.5;
  killer.arms[1].rotation.x = 2.5;
  const saw = chainsaw();
  saw.group.scale.setScalar(3.6);
  saw.group.position.set(0.0, 9.6, -6.6);
  saw.group.rotation.set(-1.0, 0, 0);
  saw.blood = 0.8;
  const bl = blender();
  bl.scale.setScalar(2.2);
  bl.position.set(-3.2, 0.5, -1.0);
  const st = stove();
  st.scale.setScalar(2.2);
  st.position.set(3.1, 0.5, -1.2);
  st.rotation.y = -0.4;
  const flame = new THREE.PointLight(0xff7020, 25, 10, 1.8);
  flame.position.set(3.1, 3.2, -1.2);
  group.add(victim.group, killer.group, saw.group, bl, st, flame);
  for (let i = 0; i < 9; i++) blood(group, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 5, 0.2 + Math.random() * 0.5);
  return {
    group,
    update(t, dt) {
      saw.update(dt, true);
      saw.group.rotation.z = Math.sin(t * 40) * 0.015;
      flame.intensity = 25 * (0.7 + 0.3 * Math.sin(t * 13) * Math.sin(t * 5));
      victim.group.rotation.z = Math.sin(t * 22) * 0.025;
      victim.group.position.y = 0.5 + Math.abs(Math.sin(t * 11)) * 0.05;
    },
  };
}

function hussStatue(): Statue {
  const group = new THREE.Group();
  const floor = onPlinth(6, 12);
  (floor.material as THREE.MeshStandardMaterial).color.set(0x9a8a30);
  group.add(floor);
  for (const [x, z] of [[-2.6, -4.5], [2.4, -1], [-2.0, 3.5]]) {
    const p = pillar(7, 1.2);
    p.position.set(x, 0.5 + 3.5, z);
    group.add(p);
  }
  const prey = buildGorilla('scared', GORILLAS.blue);
  prey.group.scale.setScalar(2.3);
  prey.group.position.set(0, 1.0, -1.5);
  prey.group.rotation.x = -0.2;
  poseRun(prey, 0.9, 1.1);
  const hunter = buildGorilla('monster', GORILLAS.monster);
  hunter.group.scale.setScalar(2.6);
  hunter.group.position.set(0, 0.9, 2.3);
  hunter.group.rotation.x = -0.3;
  poseRun(hunter, 2.4, 1.2);
  group.add(prey.group, hunter.group);
  return {
    group,
    update(t) {
      const ph = t * 6;
      poseRun(prey, ph, 1.1);
      poseRun(hunter, ph + 1.5, 1.2);
      prey.group.position.y = 0.6 + Math.abs(Math.sin(ph)) * 0.35;
      hunter.group.position.y = 0.5 + Math.abs(Math.sin(ph + 1.5)) * 0.35;
      hunter.group.position.z = 2.3 - Math.sin(t * 0.8) * 0.5;
    },
  };
}

function vacuumStatue(): Statue {
  const group = new THREE.Group();
  group.add(onPlinth(6, 7));
  const v = vacuum(0xd23a2a);
  v.group.scale.setScalar(3.2);
  v.group.position.set(0, 0.5, 0);
  const rider = buildGorilla('dummy', GORILLAS.orange);
  rider.group.scale.setScalar(2.2);
  rider.group.position.set(0, 0.5 + 0.62 * 3.2 - 0.1, 0.4);
  for (const [i, sx] of [[0, -1], [1, 1]] as Array<[0 | 1, number]>) {
    rider.legs[i].rotation.x = 1.2;
    rider.legs[i].rotation.z = -sx * 0.55;
  }
  rider.arms[1].rotation.x = 2.7;
  rider.arms[1].rotation.z = -0.3;
  rider.arms[0].rotation.x = 1.0;
  rider.head.add(cowboyHat());
  const lasso = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.06, 6, 20), mat(0xc8a060));
  lasso.position.set(1.6, 6.8, 0.4);
  lasso.rotation.x = Math.PI / 2;
  group.add(v.group, rider.group, lasso);
  return {
    group,
    update(t) {
      lasso.rotation.z = t * 7;
      lasso.position.y = 6.8 + Math.sin(t * 3) * 0.1;
      v.group.position.y = 0.5 + Math.abs(Math.sin(t * 5)) * 0.03;
      rider.group.position.y = 0.5 + 0.62 * 3.2 - 0.1 + Math.abs(Math.sin(t * 5)) * 0.03;
      rider.group.rotation.x = Math.sin(t * 2.5) * 0.08;
    },
  };
}

let algoTexture: THREE.Texture | null = null;
/** The picture (the keys with faces), loaded once. */
export function algoPicture(): THREE.Texture {
  if (!algoTexture) {
    algoTexture = new THREE.TextureLoader().load(new URL('../assets/algo.webp', import.meta.url).href);
    algoTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return algoTexture;
}

function algoStatue(): Statue {
  const group = new THREE.Group();
  const rock = onPlinth(6, 12);
  (rock.material as THREE.MeshStandardMaterial).color.set(0x6c6c70);
  group.add(rock);
  const prey = buildGorilla('scared', GORILLAS.grey);
  prey.group.scale.setScalar(2.3);
  prey.group.position.set(0, 0.8, -1.8);
  prey.group.rotation.x = -0.2;
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: algoPicture(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, toneMapped: false }));
  pic.position.set(0, 3.0, 2.2);
  pic.rotation.y = Math.PI;
  const glow = new THREE.PointLight(0xffd070, 30, 16, 1.8);
  glow.position.set(0, 3.4, 4);
  group.add(prey.group, pic, glow);
  for (const [x, z, r] of [[-2.3, -3.6, 0.5], [2.2, 1.2, 0.7], [-2.0, 3.8, 0.4]]) {
    const c = new THREE.Mesh(blob, mat(0x77777c));
    c.scale.set(r, r * 0.6, r);
    c.position.set(x, 0.5, z);
    group.add(c);
  }
  void cyl; void part;
  return {
    group,
    update(t) {
      poseRun(prey, t * 7, 1.1);
      prey.group.position.y = 0.6 + Math.abs(Math.sin(t * 7)) * 0.45;
      pic.position.y = 3.0 + Math.sin(t * 3) * 0.25;
      pic.position.z = 2.2 - Math.sin(t * 0.9) * 0.4;
      pic.rotation.z = Math.sin(t * 2.2) * 0.12;
      pic.rotation.y = Math.PI;
    },
  };
}

export const STATUES: StatueSpec[] = [
  { mode: 'jungle', name: 'JUNGLE', caption: 'the wilds', color: '#9be07a', button: '#2d6a3a', light: 0xfff0d0, build: jungleStatue },
  { mode: 'horror', name: 'HORROR', caption: 'the facility', color: '#e03030', button: '#8a1f1f', light: 0xc8d8ff, build: () => horrorStatue() },
  { mode: 'madness', name: 'ABSOLUTE MADNESS', caption: 'total chaos', color: '#ff5adf', button: '#a02a90', light: 0xffd0f0, build: () => madnessStatue() },
  { mode: 'cooking', name: 'COOKING SHOW!', caption: 'the chainsaw kitchen', color: '#ff9a30', button: '#a04a10', light: 0xffe0b0, build: () => cookingStatue() },
  { mode: 'huss', name: 'HUSS HUSS HUSS', caption: 'run', color: '#e8d848', button: '#7a6a10', light: 0xfff4a0, build: () => hussStatue() },
  { mode: 'vacuum', name: 'VACUUM', caption: 'the big house', color: '#ff6a5a', button: '#a03020', light: 0xffe8e0, build: () => vacuumStatue() },
  { mode: 'algo', name: 'O ALGO', caption: 'the moon', color: '#d8d8f0', button: '#4a4a7a', light: 0xe8ecff, build: () => algoStatue() },
];
