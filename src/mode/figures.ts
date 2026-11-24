import * as THREE from 'three';
import { Body, buildHandGeometry } from '../player/body';

const STONE = 0x9c9c94;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

const blob = new THREE.IcosahedronGeometry(1, 1);
const lowBlob = new THREE.IcosahedronGeometry(1, 0);
const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
const cone = new THREE.ConeGeometry(1, 1, 6);

const materials = new Map<number, THREE.MeshLambertMaterial>();
function mat(color: number, emissive = 0): THREE.MeshLambertMaterial {
  const key = color * 31 + emissive;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true, emissive });
    materials.set(key, m);
  }
  return m;
}

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number, at: [number, number, number], size: [number, number, number], rot: [number, number, number] = [0, 0, 0], emissive = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat(color, emissive));
  m.position.set(...at);
  m.scale.set(...size);
  m.rotation.set(...rot);
  parent.add(m);
  return m;
}

/** A limb: a tapered cylinder from point `a` to point `b`. */
function limb(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(cyl, mat(color));
  const len = a.distanceTo(b);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, _v.subVectors(b, a).normalize());
  m.scale.set(r, len, r);
  parent.add(m);
  return m;
}

const p3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface HumanOptions {
  skin: number;
  hair: number;
  shirt: number;
  pants: number;
  shoes: number;
}

export interface Human {
  group: THREE.Group;
  head: THREE.Group;
  legs: [THREE.Group, THREE.Group];
  arms: [THREE.Group, THREE.Group];
}

const BLOOD = 0x8d0d10;
const BLOOD_DARK = 0x5c080a;

/** The head: a round face with the expression that makes the character. Faces -Z; origin at the neck. */
function buildHead(opts: HumanOptions, kind: 'scared' | 'monster'): THREE.Group {
  const head = new THREE.Group();
  const monster = kind === 'monster';
  const s = monster ? 1.12 : 1;
  part(head, blob, opts.skin, [0, 0.17 * s, 0], [0.12 * s, 0.14 * s, 0.125 * s]); // skull
  // Hair: messy tufts on top.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    part(head, cone, opts.hair, [Math.cos(a) * 0.08 * s, 0.29 * s, Math.sin(a) * 0.07 * s + 0.01], [0.035, 0.1, 0.035], [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7]);
  }
  part(head, blob, opts.hair, [0, 0.27 * s, 0.03], [0.125 * s, 0.07, 0.12 * s]);
  // Ears and nose.
  for (const sx of [-1, 1]) part(head, lowBlob, opts.skin, [sx * 0.125 * s, 0.17 * s, 0.01], [0.025, 0.04, 0.02]);
  part(head, lowBlob, opts.skin, [0, 0.15 * s, -0.125 * s], [0.025, 0.03, 0.03]);
  if (monster) {
    // Hollow black eyes with a pinprick of light, and a grin too wide for the face.
    for (const sx of [-1, 1]) {
      part(head, blob, 0x050505, [sx * 0.05 * s, 0.2 * s, -0.105 * s], [0.04, 0.05, 0.03]);
      part(head, lowBlob, 0xffffff, [sx * 0.05 * s, 0.2 * s, -0.132 * s], [0.008, 0.008, 0.005], [0, 0, 0], 0xffffff);
      part(head, box, 0x120505, [sx * 0.055 * s, 0.245 * s, -0.115 * s], [0.05, 0.012, 0.01], [0, 0, sx * -0.35]); // heavy brow
    }
    part(head, box, 0x1a0404, [0, 0.085 * s, -0.12 * s], [0.17 * s, 0.045, 0.02]); // the mouth
    for (let i = -7; i <= 7; i++) {
      const x = i * 0.0115 * s;
      const y = 0.085 * s + 0.026 + Math.abs(i) * -0.0009 + (Math.abs(i) > 4 ? 0.012 : 0);
      part(head, box, 0xeeeadc, [x, y, -0.128 * s], [0.008, 0.022, 0.01]); // top teeth
      part(head, box, 0xeeeadc, [x, y - 0.043, -0.128 * s], [0.008, 0.02, 0.01]); // bottom teeth
    }
    // The corners of the smile curl up the cheeks.
    for (const sx of [-1, 1]) part(head, box, 0x1a0404, [sx * 0.098 * s, 0.108 * s, -0.112 * s], [0.03, 0.01, 0.01], [0, 0, sx * 0.9]);
    // Blood: spattered over the face, running from the mouth and the eyes.
    const spots: Array<[number, number, number, number]> = [[-0.06, 0.25, -0.1, 0.028], [0.07, 0.23, -0.105, 0.022], [0.03, 0.12, -0.125, 0.03], [-0.08, 0.14, -0.1, 0.026], [0.1, 0.16, -0.085, 0.02], [0, 0.03, -0.11, 0.04], [-0.04, 0.07, -0.125, 0.02]];
    for (const [x, y, z, r] of spots) part(head, blob, BLOOD, [x * s, y * s, z * s], [r, r * 0.8, r * 0.4]);
    for (const [x, len] of [[-0.03, 0.12], [0.02, 0.15], [0.06, 0.09], [-0.07, 0.07]]) part(head, cyl, BLOOD_DARK, [x * s, (0.05 - len / 2 + 0.02) * s, -0.118 * s], [0.007, len * s, 0.007]); // drips
    part(head, blob, BLOOD, [0, -0.02, -0.07], [0.07, 0.06, 0.05]); // the chin and neck
  } else {
    // Wide, white, frightened eyes with tiny pupils, eyebrows up, an open mouth.
    for (const sx of [-1, 1]) {
      part(head, blob, 0xffffff, [sx * 0.05, 0.19, -0.105], [0.038, 0.045, 0.03]);
      part(head, lowBlob, 0x1a1a1a, [sx * 0.05, 0.185, -0.133], [0.011, 0.014, 0.008]);
      part(head, box, opts.hair, [sx * 0.05, 0.255, -0.113], [0.055, 0.012, 0.01], [0, 0, sx * 0.4]);
    }
    part(head, blob, 0x2a0a0a, [0, 0.085, -0.115], [0.028, 0.038, 0.02]); // the open mouth
    part(head, blob, 0xa8d8f0, [0.115, 0.27, -0.06], [0.012, 0.02, 0.012]); // sweat
    part(head, blob, 0xa8d8f0, [-0.11, 0.24, -0.07], [0.01, 0.017, 0.01]);
  }
  return head;
}

/**
 * A person, built from simple shapes, facing -Z with feet at the origin. `scared`: knees together, one arm up in front of the
 * face and a torch held out in the other hand. `monster`: taller, hunched, long arms with claws, a grin, and blood.
 */
export function buildHuman(kind: 'scared' | 'monster', opts: HumanOptions): Human {
  const group = new THREE.Group();
  const monster = kind === 'monster';
  const height = monster ? 1.12 : 1;
  const hip = 0.92 * height;
  const legs: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  const arms: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  group.add(...legs, ...arms);
  // Legs, hung from the hip. Scared: knock-kneed.
  [-1, 1].forEach((sx, i) => {
    const leg = legs[i];
    leg.position.set(sx * 0.11, hip, 0);
    const knee = monster ? p3(sx * 0.02, -0.46 * height, -0.03) : p3(-sx * 0.015, -0.45, -0.08);
    const foot = monster ? p3(sx * 0.02, -0.9 * height, 0.02) : p3(sx * 0.07, -0.88, 0.02);
    limb(leg, p3(0, 0, 0), knee, 0.075, opts.pants);
    limb(leg, knee, foot, 0.06, opts.pants);
    part(leg, box, opts.shoes, [foot.x, foot.y - 0.03, foot.z - 0.06], [0.1, 0.07, 0.24]);
  });
  // Torso.
  const torsoLean = monster ? -0.25 : 0.12;
  const torso = new THREE.Group();
  torso.position.set(0, hip, 0);
  torso.rotation.x = torsoLean;
  group.add(torso);
  part(torso, blob, opts.shirt, [0, 0.3 * height, 0], [0.2, 0.3 * height, 0.12]);
  part(torso, blob, opts.pants, [0, 0.02, 0], [0.18, 0.1, 0.11]);
  const neck = p3(0, 0.62 * height, 0);
  const head = buildHead(opts, kind);
  head.position.copy(neck);
  head.rotation.set(monster ? 0.28 : -0.12, 0, monster ? 0.18 : 0);
  torso.add(head);
  // Arms, from the shoulders.
  [-1, 1].forEach((sx, i) => {
    const arm = arms[i];
    arm.position.set(sx * 0.22, hip + 0.5 * height, 0);
    arm.rotation.x = torsoLean;
    const shoulder = p3(0, 0, 0);
    let elbow: THREE.Vector3;
    let hand: THREE.Vector3;
    if (monster) {
      elbow = p3(sx * 0.1, -0.34, -0.1);
      hand = p3(sx * 0.07, -0.78, -0.2);
    } else if (sx < 0) {
      elbow = p3(-0.12, -0.22, -0.18); // the left arm comes up in front of the face
      hand = p3(-0.03, 0.12, -0.3);
    } else {
      elbow = p3(0.14, -0.2, -0.22); // the right arm holds the torch out
      hand = p3(0.07, -0.02, -0.5);
    }
    limb(arm, shoulder, elbow, 0.055, opts.shirt);
    limb(arm, elbow, hand, 0.045, monster ? opts.skin : opts.skin);
    part(arm, blob, opts.skin, [hand.x, hand.y, hand.z], [0.055, 0.055, 0.05]);
    if (monster) {
      for (let c = -1; c <= 1; c++) part(arm, cone, 0xd8d2c0, [hand.x + c * 0.025, hand.y - 0.09, hand.z - 0.02], [0.012, 0.11, 0.012], [0.15, 0, c * 0.1]); // claws
      part(arm, blob, BLOOD, [hand.x, hand.y - 0.02, hand.z], [0.06, 0.07, 0.05]);
      part(arm, blob, BLOOD, [elbow.x, elbow.y, elbow.z], [0.06, 0.09, 0.06]);
    }
  });
  if (monster) {
    // Blood down the shirt, and tears in it.
    for (const [x, y, z, r] of [[0, 0.45, -0.1, 0.12], [-0.08, 0.28, -0.11, 0.1], [0.09, 0.2, -0.1, 0.09], [0.02, 0.1, -0.1, 0.08], [-0.12, 0.5, -0.07, 0.06]]) {
      const b = part(torso, blob, BLOOD, [x, y * height, z], [r, r * 1.5, 0.03]);
      b.rotation.z = x;
    }
    for (const x of [-0.08, 0.04, 0.1]) part(torso, cyl, BLOOD_DARK, [x, 0.0, -0.11], [0.01, 0.16, 0.01]);
  }
  return { group, head: head as THREE.Group, legs, arms };
}

/** The flashlight in the scared statue's hand (a body and a faint beam). */
export function flashlightMesh(): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl, 0x2b2b30, [0, 0, 0], [0.035, 0.22, 0.035], [Math.PI / 2, 0, 0]);
  part(g, cyl, 0xcfcfd4, [0, 0, -0.13], [0.052, 0.05, 0.052], [Math.PI / 2, 0, 0]);
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 2.6, 20, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -1.5),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }),
  );
  g.add(beam);
  return g;
}

/**
 * The jungle player as a statue: the gorilla body, in stone, standing with a stick. Returns a group with its feet at the origin,
 * facing -Z, at its own (small) size: scale it up.
 */
export function gorillaStatue(scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group();
  const body = new Body(scene, true);
  scene.remove(body.root);
  group.add(body.root);
  const head = new THREE.Vector3(0, 0.67, 0);
  const handL = new THREE.Vector3(-0.3, 0.2, -0.3);
  const handR = new THREE.Vector3(0.32, 0.18, -0.34);
  body.update(1, head, _q.identity(), [handL, handR]);
  // Stone, not fur.
  const stone = new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.92, flatShading: true });
  body.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.material = stone;
  });
  body.root.updateMatrixWorld(true);
  // Hands, and the stick the right one holds.
  for (const [side, at] of [[1, handL], [-1, handR]] as Array<[1 | -1, THREE.Vector3]>) {
    const hand = new THREE.Mesh(buildHandGeometry(side, 0.07), stone);
    hand.position.copy(at);
    group.add(hand);
  }
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 1.05, 7), stone);
  stick.position.set(handR.x + 0.06, handR.y + 0.3, handR.z - 0.03);
  stick.rotation.set(-0.2, 0, -0.28);
  group.add(stick);
  return group;
}

/** A stone plinth to stand a statue on. */
export function plinth(width: number, height: number, depth: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.6, metalness: 0.2 }));
  m.position.y = height / 2;
  return m;
}

/** A glowing sign (a name over a statue). */
export function sign(text: string, color: string, width = 3): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 192;
  const c = canvas.getContext('2d')!;
  c.fillStyle = 'rgba(0,0,0,0)';
  c.clearRect(0, 0, 768, 192);
  c.shadowColor = color;
  c.shadowBlur = 24;
  c.fillStyle = color;
  c.font = 'bold 120px Georgia, serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, 384, 100);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, fog: false }));
  return m;
}
