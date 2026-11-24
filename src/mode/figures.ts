import * as THREE from 'three';

const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export const blob = new THREE.IcosahedronGeometry(1, 1);
export const lowBlob = new THREE.IcosahedronGeometry(1, 0);
export const box = new THREE.BoxGeometry(1, 1, 1);
export const cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
export const cone = new THREE.ConeGeometry(1, 1, 6);

const materials = new Map<number, THREE.MeshLambertMaterial>();
export function mat(color: number, emissive = 0): THREE.MeshLambertMaterial {
  const key = color * 31 + emissive;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true, emissive });
    materials.set(key, m);
  }
  return m;
}

export function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number, at: [number, number, number], size: [number, number, number], rot: [number, number, number] = [0, 0, 0], emissive = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat(color, emissive));
  m.position.set(...at);
  m.scale.set(...size);
  m.rotation.set(...rot);
  parent.add(m);
  return m;
}

/** A limb: a tapered cylinder from point `a` to point `b`. */
export function limb(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(cyl, mat(color));
  const len = a.distanceTo(b);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, _v.subVectors(b, a).normalize());
  m.scale.set(r, len, r);
  parent.add(m);
  return m;
}

export const p3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface GorillaOptions {
  /** Fur colour. */
  fur: number;
  /** Bare skin of the face, hands and feet. */
  face: number;
  /** Chest and belly. */
  belly: number;
}

export interface Human {
  group: THREE.Group;
  head: THREE.Group;
  legs: [THREE.Group, THREE.Group];
  arms: [THREE.Group, THREE.Group];
  /** Where the hands are, in the figure's own space (for holding things). */
  hands: [THREE.Vector3, THREE.Vector3];
}

export type GorillaKind = 'dummy' | 'scared' | 'monster';

const BLOOD = 0x8d0d10;
const BLOOD_DARK = 0x5c080a;
const SKIN_DARK = 0x2a211d;

let seedState = 1;
const rand = (): number => {
  seedState = (seedState * 1664525 + 1013904223) >>> 0;
  return seedState / 4294967296;
};

/** Fur: short tufts standing out of the surface of an ellipsoid. `skip` drops the ones that would cover the front. */
function furTufts(parent: THREE.Object3D, centre: [number, number, number], radii: [number, number, number], count: number, color: number, length: number, skip?: (n: THREE.Vector3) => boolean): void {
  for (let i = 0; i < count; i++) {
    const n = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
    if (skip?.(n)) continue;
    const m = new THREE.Mesh(cone, mat(color));
    m.position.set(centre[0] + n.x * radii[0], centre[1] + n.y * radii[1], centre[2] + n.z * radii[2]);
    // Lean down a little (fur hangs).
    const dir = n.clone().add(new THREE.Vector3(0, -0.45, 0)).normalize();
    m.quaternion.setFromUnitVectors(UP, dir);
    const l = length * (0.7 + rand() * 0.6);
    m.scale.set(length * 0.3, l, length * 0.3);
    m.position.addScaledVector(dir, l * 0.3);
    parent.add(m);
  }
}

/** The face, which is what makes each one who it is. Faces -Z; origin at the neck. */
function buildHead(o: GorillaOptions, kind: GorillaKind): THREE.Group {
  const head = new THREE.Group();
  const scared = kind === 'scared';
  const monster = kind === 'monster';
  part(head, blob, o.fur, [0, 0.11, 0.0], [0.115, 0.12, 0.12]); // skull
  part(head, blob, o.fur, [0, 0.21, 0.02], [0.07, 0.06, 0.1]); // the crown (sagittal crest)
  furTufts(head, [0, 0.12, 0.02], [0.11, 0.11, 0.11], 26, o.fur, 0.05, (n) => n.z < -0.45 && n.y < 0.5);
  // Ears with the pale inside.
  for (const sx of [-1, 1]) {
    part(head, blob, o.fur, [sx * 0.125, 0.115, 0.02], [0.03, 0.045, 0.025]);
    part(head, lowBlob, o.face, [sx * 0.14, 0.115, 0.012], [0.014, 0.03, 0.016]);
  }
  // Bare face: a brow ridge, a face patch, a muzzle with nostrils.
  part(head, box, SKIN_DARK, [0, scared ? 0.175 : 0.158, -0.105], [0.125, 0.026, 0.045], [scared ? -0.2 : 0.2, 0, 0]);
  part(head, blob, o.face, [0, 0.11, -0.092], [0.088, 0.085, 0.045]);
  part(head, blob, o.face, [0, 0.065, -0.14], [0.058, 0.044, 0.05]);
  part(head, blob, o.belly, [0, 0.032, -0.14], [0.05, 0.022, 0.044]); // the lip
  for (const sx of [-1, 1]) part(head, lowBlob, 0x120d0b, [sx * 0.016, 0.078, -0.187], [0.009, 0.007, 0.005]); // nostrils
  part(head, blob, o.face, [0, -0.005, -0.1], [0.04, 0.03, 0.04]); // chin
  if (monster) {
    // Hollow black eyes with a pinprick of light.
    for (const sx of [-1, 1]) {
      part(head, blob, 0x040404, [sx * 0.04, 0.128, -0.115], [0.026, 0.034, 0.02]);
      part(head, lowBlob, 0xffffff, [sx * 0.04, 0.13, -0.134], [0.006, 0.006, 0.004], [0, 0, 0], 0xffffff);
      part(head, box, 0x0a0505, [sx * 0.046, 0.168, -0.112], [0.05, 0.012, 0.012], [0, 0, sx * -0.42]); // heavy brow
    }
    // A grin too wide for the face, with teeth.
    part(head, box, 0x1a0404, [0, 0.04, -0.168], [0.108, 0.04, 0.018]);
    for (let i = -6; i <= 6; i++) {
      part(head, box, 0xeeeadc, [i * 0.0083, 0.062 + (Math.abs(i) > 3 ? 0.008 : 0), -0.178], [0.0066, 0.02, 0.008]);
      part(head, box, 0xeeeadc, [i * 0.0083, 0.021, -0.178], [0.0066, 0.017, 0.008]);
    }
    for (const sx of [-1, 1]) part(head, box, 0x1a0404, [sx * 0.058, 0.058, -0.158], [0.03, 0.008, 0.01], [0, 0, sx * 0.9]);
    // Blood: spattered over the face, running from the mouth and the eyes.
    const spots: Array<[number, number, number, number]> = [[-0.05, 0.16, -0.108, 0.026], [0.06, 0.15, -0.112, 0.02], [0.02, 0.09, -0.16, 0.026], [-0.07, 0.09, -0.115, 0.022], [0.09, 0.1, -0.09, 0.02], [0, 0.0, -0.14, 0.036], [-0.035, 0.05, -0.17, 0.018]];
    for (const [x, y, z, r] of spots) part(head, blob, BLOOD, [x, y, z], [r, r * 0.8, r * 0.4]);
    for (const [x, len] of [[-0.03, 0.12], [0.02, 0.15], [0.06, 0.09], [-0.065, 0.07], [0.045, 0.06]]) part(head, cyl, BLOOD_DARK, [x, 0.04 - len / 2 + 0.02, -0.168], [0.006, len, 0.006]);
    part(head, blob, BLOOD, [0, -0.04, -0.07], [0.07, 0.05, 0.05]);
    part(head, blob, BLOOD_DARK, [0.04, 0.22, 0.0], [0.04, 0.025, 0.06]);
  } else if (scared) {
    // Wide white eyes with pin-prick pupils, brows up, mouth open, sweat.
    for (const sx of [-1, 1]) {
      part(head, blob, 0xffffff, [sx * 0.04, 0.128, -0.114], [0.03, 0.037, 0.022]);
      part(head, lowBlob, 0x1a1a1a, [sx * 0.04, 0.124, -0.134], [0.008, 0.011, 0.005]);
    }
    part(head, blob, 0x2a0a0a, [0, 0.036, -0.17], [0.03, 0.034, 0.02]);
    part(head, blob, 0xa8d8f0, [0.115, 0.18, -0.05], [0.011, 0.019, 0.011]);
    part(head, blob, 0xa8d8f0, [-0.11, 0.15, -0.065], [0.009, 0.016, 0.009]);
  } else {
    // The plain, calm face of the dummy: round eyes and a small straight mouth.
    for (const sx of [-1, 1]) {
      part(head, blob, 0xfaf6e8, [sx * 0.04, 0.128, -0.114], [0.024, 0.027, 0.018]);
      part(head, lowBlob, 0x120d0b, [sx * 0.04, 0.128, -0.13], [0.012, 0.014, 0.006]);
    }
    part(head, box, SKIN_DARK, [0, 0.042, -0.19], [0.05, 0.005, 0.006]);
  }
  return head;
}

/** A hand with four fingers and a thumb (palm facing down). Origin at the wrist. `claws` adds sharp tips. */
function buildGorillaHand(parent: THREE.Object3D, at: THREE.Vector3, sx: number, o: GorillaOptions, claws: boolean): void {
  const hand = new THREE.Group();
  hand.position.copy(at);
  parent.add(hand);
  part(hand, blob, SKIN_DARK, [0, -0.02, -0.03], [0.055, 0.032, 0.062]); // palm
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.026;
    const len = 0.062 - Math.abs(i - 1.5) * 0.006;
    part(hand, box, SKIN_DARK, [x, -0.032, -0.09 - len / 2 + 0.02], [0.021, 0.02, len], [0.28, 0, 0]);
    if (claws) part(hand, cone, 0xd8d2c0, [x, -0.05, -0.15 - len / 2 + 0.02], [0.009, 0.05, 0.009], [-Math.PI / 2 - 0.4, 0, 0]);
  }
  part(hand, box, SKIN_DARK, [-sx * 0.048, -0.028, -0.06], [0.022, 0.02, 0.05], [0.1, sx * 0.5, 0]); // thumb
  part(hand, blob, o.fur, [0, 0.015, 0.02], [0.04, 0.03, 0.04]); // fur at the wrist
}

/**
 * The gorilla-tag style ape, built from simple shapes: a round head with a muzzle, brow and ears, a barrel chest, long arms
 * with proper hands, short bent legs, and fur tufts. Faces -Z, feet at the origin, about 1.2 tall.
 * `dummy` stands plain and calm; `scared` is wide-eyed with a hand up and one holding out a torch; `monster` is bigger,
 * hunched, clawed, bloody, and smiling.
 */
export function buildGorilla(kind: GorillaKind, o: GorillaOptions): Human {
  seedState = kind === 'dummy' ? 11 : kind === 'scared' ? 23 : 37;
  const outer = new THREE.Group();
  const group = new THREE.Group();
  const size = kind === 'monster' ? 1.18 : 1;
  group.scale.setScalar(size);
  outer.add(group);
  const monster = kind === 'monster';
  const hip = 0.45;
  const lean = monster ? -0.42 : kind === 'scared' ? -0.12 : -0.3;
  const legs: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  const arms: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  group.add(...legs, ...arms);

  // Legs: short and bent, with a broad foot. The scared one is knock-kneed.
  [-1, 1].forEach((sx, i) => {
    const leg = legs[i];
    leg.position.set(sx * 0.13, hip, 0);
    const knee = kind === 'scared' ? p3(-sx * 0.01, -0.22, -0.11) : p3(sx * 0.04, -0.21, -0.1);
    const foot = kind === 'scared' ? p3(sx * 0.05, -0.43, -0.02) : p3(sx * 0.05, -0.43, -0.03);
    part(leg, blob, o.fur, [0, -0.04, 0], [0.1, 0.1, 0.1]);
    limb(leg, p3(0, 0, 0), knee, 0.085, o.fur);
    limb(leg, knee, foot, 0.068, o.fur);
    furTufts(leg, [knee.x / 2, knee.y / 2, knee.z / 2], [0.09, 0.14, 0.09], 8, o.fur, 0.045);
    part(leg, blob, SKIN_DARK, [foot.x, foot.y - 0.012, foot.z - 0.05], [0.065, 0.032, 0.095]); // the foot
    for (let t = -1; t <= 1; t++) part(leg, blob, SKIN_DARK, [foot.x + t * 0.03, foot.y - 0.014, foot.z - 0.14], [0.018, 0.02, 0.03]); // toes
  });

  // Torso: a barrel chest with a pale front, a hump of shoulders and a lot of fur.
  const torso = new THREE.Group();
  torso.position.set(0, hip, 0);
  torso.rotation.x = lean;
  group.add(torso);
  part(torso, blob, o.fur, [0, 0.29, 0], [0.22, 0.3, 0.17]);
  part(torso, blob, o.belly, [0, 0.27, -0.12], [0.15, 0.2, 0.06]);
  part(torso, blob, o.belly, [0, 0.12, -0.12], [0.13, 0.12, 0.06]);
  part(torso, blob, o.fur, [0, 0.02, 0], [0.18, 0.1, 0.14]);
  part(torso, blob, o.fur, [0, 0.5, 0.01], [0.3, 0.13, 0.15]); // shoulders
  part(torso, blob, o.fur, [0, 0.52, 0.09], [0.2, 0.12, 0.1]); // the back hump
  furTufts(torso, [0, 0.3, 0], [0.22, 0.3, 0.17], 46, o.fur, 0.07, (n) => n.z < -0.4 && n.y < 0.75);
  furTufts(torso, [0, 0.5, 0.04], [0.28, 0.13, 0.15], 18, o.fur, 0.07);
  const head = buildHead(o, kind);
  head.position.set(0, 0.6, monster ? -0.1 : -0.05);
  head.rotation.set(-lean * 0.9 + (kind === 'scared' ? -0.1 : 0), 0, monster ? 0.18 : 0);
  torso.add(head);

  // Arms: long, from the shoulders; the hands hang low.
  const shoulderLocal = (sx: number): THREE.Vector3 => p3(sx * 0.29, 0.5, 0).applyAxisAngle(p3(1, 0, 0), lean);
  const hands: [THREE.Vector3, THREE.Vector3] = [p3(0, 0, 0), p3(0, 0, 0)];
  [-1, 1].forEach((sx, i) => {
    const arm = arms[i];
    const sh = shoulderLocal(sx);
    arm.position.set(sh.x, hip + sh.y, sh.z);
    let elbow: THREE.Vector3;
    let hand: THREE.Vector3;
    if (monster) {
      elbow = p3(sx * 0.09, -0.3, -0.1);
      hand = p3(sx * 0.06, -0.64, -0.2);
    } else if (kind === 'scared') {
      if (sx < 0) {
        elbow = p3(-0.13, -0.22, -0.18); // up in front of the face
        hand = p3(-0.03, 0.14, -0.3);
      } else {
        elbow = p3(0.14, -0.2, -0.22); // holding the torch out
        hand = p3(0.07, -0.03, -0.5);
      }
    } else if (sx < 0) {
      elbow = p3(-0.08, -0.29, -0.06);
      hand = p3(-0.08, -0.58, -0.11);
    } else {
      elbow = p3(0.1, -0.26, -0.15); // holding the stick
      hand = p3(0.11, -0.36, -0.36);
    }
    hands[i] = hand.clone().add(arm.position);
    part(arm, blob, o.fur, [0, -0.01, 0], [0.1, 0.1, 0.1]);
    limb(arm, p3(0, 0, 0), elbow, 0.075, o.fur);
    limb(arm, elbow, hand, 0.062, o.fur);
    part(arm, blob, o.fur, [elbow.x, elbow.y, elbow.z], [0.075, 0.075, 0.075]);
    furTufts(arm, [elbow.x * 0.5, elbow.y * 0.5, elbow.z * 0.5], [0.075, 0.17, 0.075], 12, o.fur, 0.05);
    furTufts(arm, [(elbow.x + hand.x) / 2, (elbow.y + hand.y) / 2, (elbow.z + hand.z) / 2], [0.065, 0.16, 0.065], 10, o.fur, 0.045);
    buildGorillaHand(arm, hand, sx, o, monster);
    if (monster) {
      part(arm, blob, BLOOD, [hand.x, hand.y - 0.01, hand.z - 0.04], [0.065, 0.06, 0.08]);
      part(arm, blob, BLOOD, [elbow.x, elbow.y, elbow.z - 0.04], [0.07, 0.09, 0.05]);
      part(arm, cyl, BLOOD_DARK, [hand.x * 0.5 + elbow.x * 0.5, (hand.y + elbow.y) / 2, (hand.z + elbow.z) / 2 - 0.05], [0.012, 0.2, 0.012]);
    }
  });
  if (monster) {
    for (const [x, y, z, r] of [[0, 0.4, -0.15, 0.12], [-0.08, 0.26, -0.16, 0.1], [0.09, 0.2, -0.15, 0.09], [0.02, 0.1, -0.15, 0.08], [-0.13, 0.46, -0.1, 0.06]]) {
      const b = part(torso, blob, BLOOD, [x, y, z], [r, r * 1.4, 0.03]);
      b.rotation.z = x;
    }
    for (const x of [-0.08, 0.04, 0.1]) part(torso, cyl, BLOOD_DARK, [x, 0.05, -0.17], [0.01, 0.2, 0.01]);
  }
  void outer;
  return { group: outer, head, legs, arms, hands };
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
 * The jungle player's dummy: the gorilla, calm, standing with a stick in its right hand. Feet at the origin, facing -Z, at its
 * own (small) size: scale it up.
 */
export function gorillaStatue(_scene?: THREE.Scene): THREE.Group {
  const dummy = buildGorilla('dummy', { fur: 0x4a382c, face: 0xb48c6a, belly: 0x6c5442 });
  const hand = dummy.hands[1];
  const wood = new THREE.MeshLambertMaterial({ color: 0x6b4a2b, flatShading: true });
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.024, 1.0, 7), wood);
  stick.position.set(hand.x, hand.y + 0.3, hand.z - 0.02);
  stick.rotation.set(-0.12, 0, -0.1);
  for (let i = 0; i < 3; i++) {
    const knot = new THREE.Mesh(lowBlob, wood);
    knot.position.set(0, -0.2 + i * 0.25, 0.02);
    knot.scale.setScalar(0.02);
    stick.add(knot);
  }
  dummy.group.add(stick);
  return dummy.group;
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
  let size = 120;
  c.font = `bold ${size}px Georgia, serif`;
  while (c.measureText(text).width > 720 && size > 30) {
    size -= 6;
    c.font = `bold ${size}px Georgia, serif`;
  }
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, 384, 100);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, fog: false }));
  return m;
}

/** A running pose, frozen or animated: `phase` in radians. */
export function poseRun(h: Human, phase: number, amount = 0.9): void {
  const s = Math.sin(phase) * amount;
  h.legs[0].rotation.x = s;
  h.legs[1].rotation.x = -s;
  h.arms[0].rotation.x = -s * 1.1;
  h.arms[1].rotation.x = s * 1.1;
}

/** A cowboy hat for a gorilla's head (add it to `human.head`). */
export function cowboyHat(): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl, 0x6b4a2b, [0, 0.235, 0.0], [0.2, 0.012, 0.2]);
  part(g, cyl, 0x7a5532, [0, 0.285, 0.0], [0.105, 0.09, 0.105]);
  part(g, cyl, 0x2a1c10, [0, 0.255, 0.0], [0.108, 0.018, 0.108]);
  for (const sx of [-1, 1]) part(g, box, 0x6b4a2b, [sx * 0.2, 0.25, 0], [0.03, 0.012, 0.15], [0, 0, sx * 0.35]);
  return g;
}

/** A chef's hat. */
export function chefHat(): THREE.Group {
  const g = new THREE.Group();
  part(g, cyl, 0xf4f4f0, [0, 0.25, 0], [0.1, 0.05, 0.1]);
  part(g, blob, 0xf8f8f4, [0, 0.35, 0], [0.13, 0.09, 0.13]);
  return g;
}
