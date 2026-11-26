import * as THREE from 'three';
import { Baker } from '../world/baker';
import { box, cone, cyl, low, UP } from './shapes';

const sphere = new THREE.IcosahedronGeometry(1, 2);

/** The layer only a mirror sees: your own head is not drawn from the inside. */
export const MIRROR_LAYER = 3;

/** A monkey's colours: the fur, the bare face and ears, the belly. */
export interface SkinDef {
  id: string;
  name: string;
  price: number;
  fur: number;
  face: number;
  belly: number;
  /** The hands (the fur, a touch darker). */
  glove: number;
}

export const SKINS: SkinDef[] = [
  { id: 'skin_green', name: 'GREEN MONKEY', price: 0, fur: 0x3fae3a, face: 0xbcc0c4, belly: 0xbcc0c4, glove: 0x34952f },
  { id: 'skin_brown', name: 'BROWN MONKEY', price: 100, fur: 0x7a4a2a, face: 0xe0b890, belly: 0xe0b890, glove: 0x683e22 },
  { id: 'skin_black', name: 'SHADOW MONKEY', price: 150, fur: 0x26262a, face: 0x8a8a92, belly: 0x6a6a72, glove: 0x1a1a1e },
  { id: 'skin_orange', name: 'ORANGE MONKEY', price: 150, fur: 0xe07a20, face: 0xf0d8b0, belly: 0xf0d8b0, glove: 0xc06a18 },
  { id: 'skin_blue', name: 'BLUE MONKEY', price: 200, fur: 0x3a6ad8, face: 0xc8d4e8, belly: 0xc8d4e8, glove: 0x3058b8 },
  { id: 'skin_pink', name: 'PINK MONKEY', price: 200, fur: 0xe070a8, face: 0xf8d8e0, belly: 0xf8d8e0, glove: 0xc05c90 },
  { id: 'skin_white', name: 'SNOW MONKEY', price: 250, fur: 0xeeeeee, face: 0xd0a898, belly: 0xdddddd, glove: 0xd0d0d0 },
  { id: 'skin_purple', name: 'PURPLE MONKEY', price: 300, fur: 0x7a48c0, face: 0xd8c8f0, belly: 0xd8c8f0, glove: 0x6a3aa8 },
  { id: 'skin_gold', name: 'GOLDEN MONKEY', price: 800, fur: 0xd8a820, face: 0xfff0b0, belly: 0xfff0b0, glove: 0xb88810 },
];

export function skinById(id: string): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

function put(b: Baker, geo: THREE.BufferGeometry, at: [number, number, number], size: [number, number, number], color: number, rot: [number, number, number] = [0, 0, 0]): void {
  _m.compose(_p.set(...at), _q.setFromEuler(_e.set(...rot)), _s.set(...size));
  b.add(geo, _m, _c.set(color));
}

/** A monkey's hand: a round palm, three fat fingers and a thumb. Origin at the palm; fingers point -Z. */
export function buildGloveGeometry(side: 1 | -1, radius: number, color: number): THREE.BufferGeometry {
  const b = new Baker();
  const k = radius / 0.07;
  const at = (x: number, y: number, z: number): [number, number, number] => [x * k * side, y * k, z * k];
  const sz = (x: number, y: number, z: number): [number, number, number] => [x * k, y * k, z * k];
  const pad = new THREE.Color(color).multiplyScalar(0.75).getHex();
  put(b, sphere, at(0, 0, 0), sz(0.062, 0.042, 0.072), color);
  put(b, sphere, at(0, -0.02, -0.01), sz(0.045, 0.02, 0.05), pad); // the pad
  for (let f = 0; f < 3; f++) {
    const x = (f - 1) * 0.04;
    const len = f === 1 ? 0.068 : 0.058;
    put(b, sphere, at(x, -0.006, -0.085 - len * 0.15), sz(0.021, 0.022, len * 0.8), color, [0.25, 0, 0]);
    put(b, low, at(x, -0.018, -0.105 - len * 0.5), sz(0.016, 0.012, 0.016), pad);
  }
  put(b, sphere, at(0.058, 0.0, -0.03), sz(0.02, 0.02, 0.045), color, [0, -0.6, 0.2]); // the thumb
  put(b, cyl, at(0, 0.004, 0.07), sz(0.05, 0.03, 0.05), color, [Math.PI / 2, 0, 0]); // the wrist
  return b.build();
}

const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });

function buildTorsoGeo(skin: SkinDef): THREE.BufferGeometry {
  const b = new Baker();
  put(b, sphere, [0, -0.26, 0.03], [0.14, 0.09, 0.12], skin.fur); // the neck, into the shoulders
  put(b, sphere, [0, -0.34, 0.02], [0.24, 0.1, 0.14], skin.fur); // shoulders
  put(b, sphere, [0, -0.5, 0.03], [0.21, 0.27, 0.15], skin.fur); // a round body
  put(b, sphere, [0, -0.5, -0.1], [0.14, 0.2, 0.06], skin.belly); // the belly patch
  put(b, sphere, [0, -0.72, 0.03], [0.16, 0.1, 0.12], skin.fur); // the rounded bottom
  for (const sx of [-1, 1]) put(b, sphere, [sx * 0.23, -0.36, 0.02], [0.08, 0.08, 0.08], skin.fur); // shoulder balls
  // A little curled tail.
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    put(b, sphere, [0, -0.72 + Math.sin(t * 2.4) * 0.12, 0.12 + t * 0.2], [0.035 - t * 0.012, 0.035 - t * 0.012, 0.04], i === 5 ? skin.belly : skin.fur);
  }
  return b.build();
}

function buildHeadGeo(skin: SkinDef): THREE.BufferGeometry {
  const b = new Baker();
  put(b, sphere, [0, 0.0, 0.035], [0.17, 0.17, 0.17], skin.fur); // a round head
  put(b, sphere, [0, 0.0, -0.1], [0.125, 0.115, 0.07], skin.face); // the bare face
  put(b, sphere, [0, -0.055, -0.14], [0.072, 0.055, 0.05], skin.face); // the muzzle
  for (const sx of [-1, 1]) {
    put(b, sphere, [sx * 0.178, 0.0, 0.04], [0.055, 0.065, 0.04], skin.fur); // ears
    put(b, sphere, [sx * 0.192, 0.0, 0.036], [0.034, 0.045, 0.02], skin.face); // inside the ears
    put(b, sphere, [sx * 0.058, 0.035, -0.152], [0.043, 0.047, 0.026], 0xf6f6f2); // eyes
    put(b, sphere, [sx * 0.058, 0.03, -0.172], [0.022, 0.026, 0.012], 0x0a0a0c); // pupils
    put(b, sphere, [sx * 0.052, 0.04, -0.178], [0.007, 0.007, 0.005], 0xffffff); // a glint
    put(b, sphere, [sx * 0.022, -0.045, -0.185], [0.009, 0.007, 0.006], 0x303034); // nostrils
    put(b, box, [sx * 0.06, 0.082, -0.15], [0.05, 0.01, 0.01], skin.fur, [0, 0, sx * 0.2]); // brows
  }
  put(b, box, [0, -0.085, -0.17], [0.07, 0.007, 0.008], 0x3a3a40); // a small flat mouth
  for (let i = 0; i < 3; i++) put(b, cone, [(i - 1) * 0.045, 0.19, 0.0], [0.022, 0.08 - Math.abs(i - 1) * 0.02, 0.022], skin.fur, [0, 0, (i - 1) * -0.4]); // a tuft of hair
  return b.build();
}

/** The player's own body: a monkey with long arms and no legs. You see its arms and hands and, looking down, its belly; in a mirror, all of it. */
export class SubjectBody {
  readonly root = new THREE.Group();
  readonly head = new THREE.Group();
  readonly torso = new THREE.Group();
  private torsoMesh: THREE.Mesh;
  private headMesh: THREE.Mesh;
  private readonly upper: [THREE.Mesh, THREE.Mesh];
  private readonly fore: [THREE.Mesh, THREE.Mesh];
  private readonly elbows: [THREE.Mesh, THREE.Mesh];
  private readonly armMat = new THREE.MeshLambertMaterial({ color: 0x3fae3a });
  readonly forearm: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  private yaw = 0;
  private yawKnown = false;
  armLength = 0.4;
  /** Slots things can be worn in. */
  readonly sockets = { head: this.head, torso: this.torso };

  constructor(scene: THREE.Scene, private readonly other = false) {
    this.torsoMesh = new THREE.Mesh(new THREE.BufferGeometry(), bodyMat);
    this.headMesh = new THREE.Mesh(new THREE.BufferGeometry(), bodyMat);
    this.torso.add(this.torsoMesh);
    this.head.add(this.headMesh);
    this.root.add(this.torso, this.head);
    const mk = (geo: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(geo, material);
      m.frustumCulled = false;
      this.root.add(m);
      return m;
    };
    const armGeo = new THREE.CylinderGeometry(0.048, 0.062, 1, 8);
    const foreGeo = new THREE.CylinderGeometry(0.04, 0.05, 1, 8);
    const elbowGeo = new THREE.IcosahedronGeometry(0.056, 1);
    this.upper = [mk(armGeo, this.armMat), mk(armGeo, this.armMat)];
    this.fore = [mk(foreGeo, this.armMat), mk(foreGeo, this.armMat)];
    this.elbows = [mk(elbowGeo, this.armMat), mk(elbowGeo, this.armMat)];
    this.torso.frustumCulled = this.head.frustumCulled = false;
    this.setSkin(SKINS[0]);
    scene.add(this.root);
  }

  /** Changes the colours. */
  setSkin(skin: SkinDef): void {
    this.torsoMesh.geometry.dispose();
    this.headMesh.geometry.dispose();
    this.torsoMesh.geometry = buildTorsoGeo(skin);
    this.headMesh.geometry = buildHeadGeo(skin);
    this.armMat.color.setHex(skin.fur);
    this.applyLayers();
  }

  private applyLayers(): void {
    this.head.traverse((o) => o.layers.set(this.other ? 0 : MIRROR_LAYER));
  }

  /** Marks something worn on the head (so the head's mirror-only layer reaches it). */
  wearOnHead(obj: THREE.Object3D): void {
    this.head.add(obj);
    this.applyLayers();
  }

  update(dt: number, head: THREE.Vector3, headQuat: THREE.Quaternion, hands: [THREE.Vector3 | null, THREE.Vector3 | null]): void {
    const fwd = _p.set(0, 0, -1).applyQuaternion(headQuat);
    if (Math.hypot(fwd.x, fwd.z) > 0.2) {
      const want = Math.atan2(-fwd.x, -fwd.z);
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
    const shoulder = new THREE.Vector3();
    const v = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const pole = new THREE.Vector3();
    const elbow = new THREE.Vector3();
    const wrist = new THREE.Vector3();
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const hand = hands[i];
      this.upper[i].visible = this.fore[i].visible = this.elbows[i].visible = hand !== null;
      if (!hand) continue;
      shoulder.set(side * 0.24, -0.34, 0.03).applyAxisAngle(UP, this.yaw).add(head);
      v.subVectors(hand, shoulder);
      const reach = v.length();
      const natural = this.armLength * 2;
      const scale = Math.max(1, reach / (natural * 0.96));
      const l1 = this.armLength * scale;
      const l2 = l1;
      const d = Math.min(Math.max(reach, 0.05), l1 + l2 - 0.001);
      dir.copy(v).divideScalar(Math.max(reach, 1e-4));
      const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      pole.set(side * 0.6, -1, 0.4).applyAxisAngle(UP, this.yaw);
      pole.addScaledVector(dir, -pole.dot(dir)).normalize();
      elbow.copy(shoulder).addScaledVector(dir, a).addScaledVector(pole, h);
      wrist.copy(hand).addScaledVector(v.subVectors(hand, elbow).normalize(), -0.04);
      this.segment(this.upper[i], shoulder, elbow);
      this.segment(this.fore[i], elbow, wrist);
      this.elbows[i].position.copy(elbow);
      this.forearm[i].copy(elbow).lerp(wrist, 0.55);
    }
  }

  private segment(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
    const dir = _p.subVectors(to, from);
    const len = Math.max(0.001, dir.length());
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(len));
    mesh.scale.set(1, len, 1);
  }

  /** Whether the head is drawn (it must be while a mirror looks). */
  setReflectionVisible(on: boolean): void {
    this.head.visible = on;
  }
}
