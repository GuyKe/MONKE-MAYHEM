import * as THREE from 'three';
import { Baker } from '../world/baker';
import { box, cyl, UP } from './shapes';

const sphere = new THREE.IcosahedronGeometry(1, 2);

/** The layer only a mirror sees: your own head is not drawn from the inside. */
export const MIRROR_LAYER = 3;

/** A hazmat suit's colours: the suit, the reflective visor, the creased/dirty shade, and the rubber gloves. */
export interface SkinDef {
  id: string;
  name: string;
  price: number;
  /** The suit fabric. */
  fur: number;
  /** The visor's reflective tint. */
  face: number;
  /** Creases and dirt: a darker shade of the suit. */
  belly: number;
  /** The rubber gloves. */
  glove: number;
}

const suit = (id: string, name: string, price: number, fur: number, face = 0x52e8f0, glove = 0x2a2a2e): SkinDef => ({
  id,
  name,
  price,
  fur,
  face,
  belly: new THREE.Color(fur).multiplyScalar(0.62).getHex(),
  glove,
});

export const SKINS: SkinDef[] = [
  suit('skin_green', 'MUSTARD HAZMAT', 0, 0xd4a82c),
  suit('skin_brown', 'MUD HAZMAT', 100, 0x7a5a38, 0x6af0e0, 0x1e1a18),
  suit('skin_black', 'NIGHT HAZMAT', 150, 0x2a2c32, 0x40d0ff, 0x101012),
  suit('skin_orange', 'SAFETY ORANGE', 150, 0xe86a1c, 0x60f0f0, 0x26262a),
  suit('skin_blue', 'DEEP BLUE', 200, 0x2f58b8, 0x80f4ff, 0x1c1c22),
  suit('skin_pink', 'BIOHAZARD PINK', 200, 0xe06aa0, 0x70ffe8, 0x2a2024),
  suit('skin_white', 'LAB WHITE', 250, 0xe6e6e0, 0x40e0ff, 0x4a4a50),
  suit('skin_purple', 'VIOLET HAZMAT', 300, 0x7a48c0, 0x90ffff, 0x1c1826),
  suit('skin_gold', 'GOLD HAZMAT', 800, 0xf0c020, 0xb0fff8, 0x3a2a10),
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

/** A big chunky rubber glove: a fat palm, two stubby fingers and a thumb, and a black cuff. Origin at the palm; fingers point -Z. */
export function buildGloveGeometry(side: 1 | -1, radius: number, color: number): THREE.BufferGeometry {
  const b = new Baker();
  const k = radius / 0.07;
  const at = (x: number, y: number, z: number): [number, number, number] => [x * k * side, y * k, z * k];
  const sz = (x: number, y: number, z: number): [number, number, number] => [x * k, y * k, z * k];
  const worn = new THREE.Color(color).multiplyScalar(1.5).getHex();
  put(b, sphere, at(0, 0, 0), sz(0.07, 0.05, 0.076), color); // the palm
  put(b, sphere, at(0, 0.012, 0.0), sz(0.05, 0.02, 0.05), worn); // a scuffed patch on the back
  for (let f = 0; f < 2; f++) {
    const x = (f - 0.5) * 0.058;
    put(b, sphere, at(x, -0.004, -0.095), sz(0.03, 0.03, 0.06), color, [0.1, 0, 0]);
    put(b, sphere, at(x, -0.012, -0.145), sz(0.027, 0.027, 0.03), color);
  }
  put(b, sphere, at(0.07, 0.0, -0.035), sz(0.03, 0.03, 0.05), color, [0, -0.6, 0.2]); // the thumb
  put(b, cyl, at(0, 0.004, 0.075), sz(0.06, 0.04, 0.06), 0x16161a, [Math.PI / 2, 0, 0]); // the black cuff strap
  return b.build();
}

const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });

const TAPE = 0x0e0e10;
const STRAP = 0x18181a;

function buildTorsoGeo(skin: SkinDef): THREE.BufferGeometry {
  const b = new Baker();
  put(b, sphere, [0, -0.27, 0.02], [0.15, 0.09, 0.13], skin.fur); // the collar
  put(b, sphere, [0, -0.35, 0.02], [0.25, 0.11, 0.15], skin.fur); // shoulders
  put(b, sphere, [0, -0.55, 0.03], [0.25, 0.3, 0.2], skin.fur); // a rounded bean body
  put(b, sphere, [0, -0.78, 0.03], [0.2, 0.12, 0.16], skin.fur); // the smooth rounded bottom
  put(b, sphere, [0, -0.82, 0.04], [0.14, 0.05, 0.12], skin.belly); // dirt where it drags
  for (const sx of [-1, 1]) {
    put(b, sphere, [sx * 0.25, -0.38, 0.02], [0.09, 0.09, 0.09], skin.fur); // shoulder balls
    put(b, box, [sx * 0.17, -0.42, -0.16], [0.012, 0.3, 0.012], STRAP, [0.2, 0, sx * -0.35]); // harness straps
    put(b, box, [sx * 0.2, -0.56, 0.0], [0.012, 0.2, 0.2], TAPE); // side seam tape
  }
  put(b, box, [0, -0.62, -0.19], [0.24, 0.016, 0.03], STRAP); // the waist strap
  put(b, box, [0, -0.5, -0.19], [0.012, 0.18, 0.03], TAPE); // the front zip, taped
  // Creases.
  for (const [x, y, w] of [[-0.1, -0.5, 0.07], [0.09, -0.56, 0.08], [-0.05, -0.68, 0.09], [0.12, -0.42, 0.05]] as const) put(b, sphere, [x, y, -0.185], [w, 0.012, 0.03], skin.belly, [0, 0, 0.3]);
  // The filter canister on the chest.
  put(b, cyl, [0.06, -0.44, -0.215], [0.06, 0.05, 0.06], 0x7c8086, [Math.PI / 2, 0, 0]);
  put(b, cyl, [0.06, -0.44, -0.25], [0.045, 0.02, 0.045], 0x4a4e54, [Math.PI / 2, 0, 0]);
  put(b, box, [0.06, -0.44, -0.265], [0.03, 0.006, 0.006], 0x202226);
  // Grime and scuffs.
  put(b, sphere, [-0.12, -0.72, -0.12], [0.07, 0.05, 0.03], skin.belly);
  put(b, sphere, [0.1, -0.74, 0.08], [0.06, 0.06, 0.05], skin.belly);
  return b.build();
}

function buildHeadGeo(skin: SkinDef): THREE.BufferGeometry {
  const b = new Baker();
  put(b, sphere, [0, 0.01, 0.04], [0.19, 0.19, 0.2], skin.fur); // the bulky hood
  put(b, sphere, [0, -0.1, 0.03], [0.2, 0.06, 0.2], skin.fur); // the hood's rolled collar
  put(b, sphere, [0, 0.03, -0.1], [0.14, 0.12, 0.08], 0x0c0e12); // the big dark visor
  put(b, sphere, [-0.04, 0.06, -0.164], [0.07, 0.04, 0.015], skin.face); // reflective shine
  put(b, sphere, [0.05, 0.0, -0.165], [0.04, 0.025, 0.012], skin.face);
  put(b, box, [0, 0.0, -0.093], [0.155, 0.135, 0.02], TAPE); // the black seam tape round the visor
  put(b, box, [0, 0.0, -0.1], [0.14, 0.12, 0.03], 0x0c0e12);
  put(b, box, [0, 0.0, -0.126], [0.13, 0.11, 0.015], new THREE.Color(skin.face).multiplyScalar(0.28).getHex());
  put(b, box, [0, -0.085, -0.15], [0.09, 0.06, 0.07], 0x6a6e72); // the boxy respirator built into the hood
  for (let i = -1; i <= 1; i++) put(b, box, [i * 0.025, -0.085, -0.187], [0.008, 0.04, 0.006], 0x202226); // its vents
  for (const sx of [-1, 1]) {
    put(b, box, [sx * 0.1, -0.09, -0.12], [0.012, 0.02, 0.1], STRAP, [0, sx * 0.4, 0]); // mask straps
    put(b, box, [sx * 0.185, 0.0, 0.04], [0.012, 0.19, 0.012], STRAP); // a strap round the hood
  }
  put(b, box, [0, 0.19, 0.03], [0.012, 0.012, 0.19], TAPE); // the seam over the top
  put(b, sphere, [-0.1, 0.12, 0.0], [0.07, 0.05, 0.07], skin.belly); // a dirty patch
  put(b, sphere, [0.08, 0.16, 0.1], [0.05, 0.02, 0.05], skin.belly); // a crease
  return b.build();
}

/** The player's own body: a hazmat survivor with long arms and no legs. You see its arms and gloves and, looking down, its chest canister; in a mirror, all of it. */
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
    const armGeo = new THREE.CylinderGeometry(0.058, 0.07, 1, 8);
    const foreGeo = new THREE.CylinderGeometry(0.052, 0.062, 1, 8);
    const elbowGeo = new THREE.IcosahedronGeometry(0.068, 1);
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
