import * as THREE from 'three';
import { Baker } from '../world/baker';

/** Layer only the mirror looks at: the head is not drawn from the inside. */
export const MIRROR_LAYER = 3;

const FUR = 0x2b2420;
const FUR_LIGHT = 0x3b322b;
const SILVER = 0x9a958c;
const SKIN = 0x5a4537;
const SKIN_LIGHT = 0x806450;
const BONE = 0xece3c8;
const LEAF_COLORS = [0x2f7a30, 0x3f8f3a, 0x58a03a, 0x2a6a34, 0x6bb040];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _shoulder = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const blob = new THREE.IcosahedronGeometry(1, 1);
const lowBlob = new THREE.IcosahedronGeometry(1, 0);
const box = new THREE.BoxGeometry(1, 1, 1);
const cone = new THREE.ConeGeometry(1, 1, 5);
const leaf = new THREE.ConeGeometry(1, 1, 4).scale(1, 1, 0.22).translate(0, -0.5, 0); // hangs from its tip upward
const cyl = new THREE.CylinderGeometry(1, 1, 1, 6);

/** Adds a shape to a baker: position, size, optional rotation, colour. */
function put(baker: Baker, geometry: THREE.BufferGeometry, at: [number, number, number], size: [number, number, number], colour: number, rot: [number, number, number] = [0, 0, 0]): void {
  _m.compose(_p.set(...at), _q.setFromEuler(_e.set(...rot)), _s.set(...size));
  baker.add(geometry, _m, _c.set(colour));
}

/** The head, drawn only in the mirror. Forward is -Z; the origin is the eyes. */
function buildHead(): THREE.BufferGeometry {
  const b = new Baker();
  put(b, blob, [0, -0.01, 0.07], [0.13, 0.135, 0.14], FUR); // skull
  put(b, blob, [0, 0.1, 0.08], [0.05, 0.075, 0.13], FUR_LIGHT); // the crest
  put(b, box, [0, 0.045, -0.07], [0.21, 0.035, 0.06], FUR_LIGHT); // heavy brow
  put(b, blob, [0, -0.03, -0.065], [0.1, 0.105, 0.065], SKIN); // face
  put(b, blob, [0, -0.075, -0.1], [0.078, 0.06, 0.06], SKIN_LIGHT); // muzzle
  for (const sx of [-1, 1]) {
    put(b, lowBlob, [sx * 0.022, -0.06, -0.15], [0.012, 0.01, 0.01], 0x120d0a); // nostrils
    put(b, lowBlob, [sx * 0.042, 0.015, -0.115], [0.022, 0.02, 0.012], 0xf2eee0); // eyes
    put(b, lowBlob, [sx * 0.042, 0.015, -0.126], [0.011, 0.011, 0.008], 0x100a06);
    put(b, lowBlob, [sx * 0.135, -0.01, 0.07], [0.03, 0.04, 0.02], SKIN); // ears
    put(b, box, [sx * 0.068, -0.03, -0.12], [0.012, 0.055, 0.005], 0xc8402a, [0, 0, sx * 0.35]); // war paint
    put(b, box, [sx * 0.058, -0.045, -0.123], [0.012, 0.04, 0.005], 0xf0e6c8, [0, 0, sx * 0.35]);
  }
  put(b, box, [0, -0.108, -0.146], [0.07, 0.007, 0.01], 0x1a100c); // mouth
  // A crown of leaves and two feathers.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    put(b, leaf, [Math.cos(a) * 0.115, 0.1, 0.05 + Math.sin(a) * 0.115], [0.04, 0.12, 0.02], LEAF_COLORS[i % LEAF_COLORS.length], [Math.sin(a) * 0.5 - 0.2, -a, -Math.cos(a) * 0.5]);
  }
  put(b, cone, [0.045, 0.2, 0.06], [0.014, 0.17, 0.006], 0xd2342a, [0.3, 0, -0.3]);
  put(b, cone, [-0.02, 0.21, 0.07], [0.014, 0.19, 0.006], 0x2a7fd0, [0.35, 0, 0.2]);
  put(b, cone, [0.0, 0.2, 0.08], [0.012, 0.15, 0.006], 0xf0c030, [0.4, 0, 0.0]);
  return b.build();
}

/** Chest, belly, back, necklace and the leaf pants. Origin at the eyes, facing -Z, hanging below. */
function buildTorso(): THREE.BufferGeometry {
  const b = new Baker();
  put(b, blob, [0, -0.26, 0.04], [0.19, 0.14, 0.13], FUR); // chest
  put(b, blob, [0, -0.38, 0.04], [0.16, 0.12, 0.12], FUR_LIGHT); // belly
  put(b, blob, [0, -0.26, 0.12], [0.17, 0.12, 0.06], SILVER); // the silver saddle on the back
  put(b, blob, [0, -0.25, -0.05], [0.1, 0.09, 0.04], SKIN); // bare chest
  for (const sx of [-1, 1]) put(b, blob, [sx * 0.2, -0.2, 0.05], [0.085, 0.08, 0.085], FUR); // shoulders
  // Necklace of teeth on a vine.
  for (let i = 0; i < 9; i++) {
    const a = Math.PI + 0.3 + (i / 8) * (Math.PI - 0.6);
    put(b, cone, [Math.cos(a) * 0.12, -0.285 - 0.02 * Math.sin((i / 8) * Math.PI), -0.04 + Math.sin(a) * 0.1], [0.008, 0.032, 0.008], BONE, [Math.PI, 0, 0]);
  }
  // Leaf pants: two rings of hanging leaves, (no legs, like a gorilla tag model).
  for (let ring = 0; ring < 2; ring++) {
    const count = 14;
    for (let i = 0; i < count; i++) {
      const a = ((i + ring * 0.5) / count) * Math.PI * 2;
      const r = 0.15 + ring * 0.025;
      put(b, leaf, [Math.cos(a) * r, -0.44 + ring * 0.035, 0.04 + Math.sin(a) * r], [0.05, 0.19 - ring * 0.03, 0.03], LEAF_COLORS[(i + ring) % LEAF_COLORS.length], [Math.sin(a) * 0.4, -a, -Math.cos(a) * 0.4]);
    }
  }
  put(b, cyl, [0, -0.44, 0.04], [0.165, 0.025, 0.165], 0x6a4a28); // a vine belt
  return b.build();
}

/** A gorilla hand with the mitt's size: heel, four curled fingers and a thumb. Forward is -Z. */
export function buildHandGeometry(side: 1 | -1, radius: number): THREE.BufferGeometry {
  const b = new Baker();
  const k = radius / 0.07;
  const at = (x: number, y: number, z: number): [number, number, number] => [x * k * side, y * k, z * k];
  const sz = (x: number, y: number, z: number): [number, number, number] => [x * k, y * k, z * k];
  const shade = (n: number) => new THREE.Color(n, n, n).getHex();
  put(b, blob, at(0, 0, 0.01), sz(0.062, 0.04, 0.075), shade(0.78)); // palm
  for (let f = 0; f < 4; f++) {
    const x = (f - 1.5) * 0.034;
    const len = f === 1 || f === 2 ? 0.05 : 0.043;
    put(b, blob, at(x, -0.012, -0.075 - len * 0.2), sz(0.0165, 0.017, len * 0.7), shade(1), [0.35, 0, 0]); // curled fingers
    put(b, lowBlob, at(x, -0.036, -0.085 - len * 0.4), sz(0.014, 0.012, 0.014), shade(0.62)); // knuckle pads
  }
  put(b, blob, at(0.052, -0.004, -0.03), sz(0.018, 0.016, 0.04), shade(1), [0, -0.5, 0.2]); // thumb
  put(b, blob, at(0, 0.015, 0.075), sz(0.042, 0.03, 0.04), shade(0.9)); // wrist
  return b.build();
}

/** A segment of arm between two points, as a stretched, tapered cylinder. */
function placeSegment(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
  _dir.subVectors(to, from);
  const len = Math.max(0.001, _dir.length());
  mesh.position.copy(from).addScaledVector(_dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, _dir.divideScalar(len));
  mesh.scale.set(1, len, 1);
}

/**
 * The player's own body: a gorilla in leaf pants. You see its arms (shoulders to hands, with bends at the elbow),
 * its chest and belly if you look down, and in a mirror the whole of it, head and all.
 */
export class Body {
  readonly root = new THREE.Group();
  readonly head: THREE.Mesh;
  readonly torso: THREE.Mesh;
  private readonly upper: [THREE.Mesh, THREE.Mesh];
  private readonly fore: [THREE.Mesh, THREE.Mesh];
  private readonly elbows: [THREE.Mesh, THREE.Mesh];
  private readonly bands: [THREE.Mesh, THREE.Mesh];
  /** Where each forearm is, for things worn on it (the health gauge). */
  readonly forearm: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  private yaw = 0;
  private yawKnown = false;
  /** How much of the body is drawn (off in the test arena if wanted). */
  armLength = 0.4;

  private readonly materials: THREE.MeshLambertMaterial[] = [];

  /** `other`: another player's body, whose head you can see (your own is only in the mirror). */
  constructor(scene: THREE.Scene, other = false) {
    const fur = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.head = new THREE.Mesh(buildHead(), fur);
    this.head.layers.set(other ? 0 : MIRROR_LAYER);
    this.head.frustumCulled = false;
    this.torso = new THREE.Mesh(buildTorso(), fur);
    this.torso.frustumCulled = false;
    this.root.add(this.head, this.torso);

    const armGeo = new THREE.CylinderGeometry(0.052, 0.07, 1, 7);
    const foreGeo = new THREE.CylinderGeometry(0.04, 0.055, 1, 7);
    const upperMat = new THREE.MeshLambertMaterial({ color: FUR, flatShading: true });
    const foreMat = new THREE.MeshLambertMaterial({ color: FUR_LIGHT, flatShading: true });
    const elbowGeo = new THREE.IcosahedronGeometry(0.062, 0);
    const bandGeo = new THREE.CylinderGeometry(0.058, 0.058, 0.035, 8);
    const bandMat = new THREE.MeshLambertMaterial({ color: 0x3f8f3a, flatShading: true });
    const make = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      this.root.add(mesh);
      return mesh;
    };
    this.materials.push(fur, upperMat, foreMat);
    this.upper = [make(armGeo, upperMat), make(armGeo, upperMat)];
    this.fore = [make(foreGeo, foreMat), make(foreGeo, foreMat)];
    this.elbows = [make(elbowGeo, upperMat), make(elbowGeo, upperMat)];
    this.bands = [make(bandGeo, bandMat), make(bandGeo, bandMat)];
    scene.add(this.root);
  }

  /** Puts the body under the head, and the arms between the shoulders and the hands. */
  update(dt: number, head: THREE.Vector3, headQuat: THREE.Quaternion, hands: [THREE.Vector3 | null, THREE.Vector3 | null]): void {
    // The body turns after the head, a little behind it.
    _fwd.set(0, 0, -1).applyQuaternion(headQuat);
    if (Math.hypot(_fwd.x, _fwd.z) > 0.2) {
      const want = Math.atan2(-_fwd.x, -_fwd.z);
      if (!this.yawKnown) {
        this.yaw = want;
        this.yawKnown = true;
      }
      let d = want - this.yaw;
      d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 5);
    }
    this.torso.position.copy(head);
    this.torso.rotation.set(0, this.yaw, 0);
    this.head.position.copy(head);
    this.head.quaternion.copy(headQuat);

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const visible = hands[i] !== null;
      this.upper[i].visible = this.fore[i].visible = this.elbows[i].visible = this.bands[i].visible = visible;
      if (!hands[i]) continue;
      // The shoulder, in the body's frame.
      _shoulder.set(side * 0.2, -0.2, 0.05).applyAxisAngle(UP, this.yaw).add(head);
      const hand = hands[i]!;
      _v.subVectors(hand, _shoulder);
      const reach = _v.length();
      const natural = this.armLength * 2;
      const scale = Math.max(1, reach / (natural * 0.96));
      const l1 = this.armLength * scale;
      const l2 = this.armLength * scale;
      const d = Math.min(Math.max(reach, 0.05), l1 + l2 - 0.001);
      _dir.copy(_v).divideScalar(Math.max(reach, 1e-4));
      // Two-bone solve: the elbow sits out to the side and low, like a gorilla's.
      const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      _pole.set(side * 0.7, -1, 0.35).applyAxisAngle(UP, this.yaw);
      _pole.addScaledVector(_dir, -_pole.dot(_dir)).normalize();
      _elbow.copy(_shoulder).addScaledVector(_dir, a).addScaledVector(_pole, h);
      // The wrist sits a little short of the hand.
      _w.copy(hand).addScaledVector(_v.subVectors(hand, _elbow).normalize(), -0.03);
      placeSegment(this.upper[i], _shoulder, _elbow);
      placeSegment(this.fore[i], _elbow, _w);
      this.elbows[i].position.copy(_elbow);
      // A band of leaves just above the wrist.
      this.bands[i].position.copy(_w).addScaledVector(_v.subVectors(_elbow, _w), 0.2);
      this.bands[i].quaternion.setFromUnitVectors(UP, _v.normalize());
      this.forearm[i].copy(_elbow).lerp(_w, 0.55);
    }
  }

  /** Gives this body a colour of its own, so players can be told apart. */
  tint(hue: number): void {
    const c = new THREE.Color().setHSL(hue, 0.35, 0.62);
    for (const m of this.materials) m.color.copy(c);
  }

  /** Takes the body out of the scene. */
  dispose(scene: THREE.Scene): void {
    scene.remove(this.root);
  }

  /** Whether the head is drawn at all (hidden unless something is looking in a mirror). */
  setReflectionVisible(on: boolean): void {
    this.head.visible = on;
  }
}
