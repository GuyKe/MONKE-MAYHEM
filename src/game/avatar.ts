import * as THREE from 'three';
import { Baker } from '../world/baker';
import { blob, box, cone, cyl, low, mat, part, sphere, UP } from './shapes';

/** The layer only a mirror sees: your own head is not drawn from the inside. */
export const MIRROR_LAYER = 3;

/** A suit: the colours of a test subject. */
export interface SkinDef {
  id: string;
  name: string;
  price: number;
  suit: number;
  trim: number;
  /** The glow of the visor and the lights. */
  glow: number;
  glove: number;
}

export const SKINS: SkinDef[] = [
  { id: 'skin_orange', name: 'ORANGE SUIT', price: 0, suit: 0xe8731a, trim: 0x2a2a30, glow: 0x40e0ff, glove: 0xd05a10 },
  { id: 'skin_hazmat', name: 'HAZMAT WHITE', price: 150, suit: 0xe8ecee, trim: 0xe0b020, glow: 0x60ff90, glove: 0xf4c020 },
  { id: 'skin_black', name: 'BLACK OPS', price: 300, suit: 0x1c1e24, trim: 0x50545c, glow: 0xff3a3a, glove: 0x101114 },
  { id: 'skin_crimson', name: 'CRIMSON', price: 200, suit: 0x9a1620, trim: 0x2a2a30, glow: 0xffd060, glove: 0x6a0e16 },
  { id: 'skin_neon', name: 'NEON RAVE', price: 400, suit: 0x6a2cff, trim: 0x20e0b0, glow: 0xff40d0, glove: 0x20e0b0 },
  { id: 'skin_gold', name: 'GOLD STANDARD', price: 1000, suit: 0xd8a820, trim: 0x2a2010, glow: 0xffffff, glove: 0xb88810 },
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

/** A big, round, three-fingered work glove. Origin at the palm; fingers point -Z. */
export function buildGloveGeometry(side: 1 | -1, radius: number, color: number): THREE.BufferGeometry {
  const b = new Baker();
  const k = radius / 0.07;
  const at = (x: number, y: number, z: number): [number, number, number] => [x * k * side, y * k, z * k];
  const sz = (x: number, y: number, z: number): [number, number, number] => [x * k, y * k, z * k];
  const dark = new THREE.Color(color).multiplyScalar(0.7).getHex();
  put(b, sphere, at(0, 0, 0), sz(0.062, 0.04, 0.072), color);
  for (let f = 0; f < 3; f++) {
    const x = (f - 1) * 0.04;
    const len = f === 1 ? 0.062 : 0.052;
    put(b, sphere, at(x, -0.006, -0.08 - len * 0.15), sz(0.021, 0.022, len * 0.78), color, [0.25, 0, 0]);
    put(b, low, at(x, -0.02, -0.1 - len * 0.5), sz(0.017, 0.012, 0.016), dark);
  }
  put(b, sphere, at(0.055, 0.0, -0.03), sz(0.02, 0.02, 0.045), color, [0, -0.6, 0.2]);
  put(b, cyl, at(0, 0.006, 0.07), sz(0.05, 0.03, 0.05), dark, [Math.PI / 2, 0, 0]); // the cuff
  put(b, box, at(0, 0.036, 0.0), sz(0.05, 0.006, 0.04), 0x303036); // a pad on the back
  return b.build();
}

const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 });

function buildTorsoGeo(skin: SkinDef): THREE.BufferGeometry {
  const b = new Baker();
  put(b, cyl, [0, -0.19, 0.02], [0.075, 0.03, 0.075], skin.trim); // the neck ring
  put(b, sphere, [0, -0.42, 0.03], [0.21, 0.2, 0.14], skin.suit); // chest
  put(b, sphere, [0, -0.56, 0.03], [0.17, 0.16, 0.12], skin.suit); // belly
  put(b, box, [0, -0.47, -0.105], [0.17, 0.12, 0.03], skin.trim); // chest plate
  for (const sx of [-1, 1]) {
    put(b, sphere, [sx * 0.25, -0.3, 0.03], [0.085, 0.07, 0.085], skin.trim); // shoulder pads
    put(b, box, [sx * 0.07, -0.58, -0.13], [0.04, 0.12, 0.012], skin.glove, [0, 0, sx * 0.2]);
  }
  put(b, cone, [0, -0.78, 0.03], [0.17, 0.2, 0.17], skin.trim, [Math.PI, 0, 0]); // the taper to the hover unit
  put(b, cyl, [0, -0.9, 0.03], [0.22, 0.045, 0.22], 0x1a1c22); // the hover unit
  return b.build();
}

function buildHeadGeo(skin: SkinDef): THREE.BufferGeometry {
  const b = new Baker();
  put(b, sphere, [0, 0.0, 0.035], [0.165, 0.17, 0.175], skin.suit); // helmet
  put(b, box, [0, -0.115, -0.07], [0.09, 0.03, 0.05], skin.trim); // chin guard
  for (const sx of [-1, 1]) put(b, cyl, [sx * 0.165, 0.0, 0.03], [0.045, 0.03, 0.045], skin.trim, [0, 0, Math.PI / 2]); // ear pods
  put(b, cyl, [0.095, 0.2, 0.06], [0.008, 0.07, 0.008], 0x40444c); // antenna stalk
  put(b, sphere, [0, 0.17, 0.03], [0.07, 0.02, 0.07], skin.trim); // a crest
  return b.build();
}

/** The player's own body: a test subject on a hover unit. You see its arms and gloves and, looking down, its chest; in a mirror, all of it. */
export class SubjectBody {
  readonly root = new THREE.Group();
  readonly head = new THREE.Group();
  readonly torso = new THREE.Group();
  private torsoMesh: THREE.Mesh;
  private headMesh: THREE.Mesh;
  private readonly upper: [THREE.Mesh, THREE.Mesh];
  private readonly fore: [THREE.Mesh, THREE.Mesh];
  private readonly elbows: [THREE.Mesh, THREE.Mesh];
  private visor!: THREE.Mesh;
  private glowParts: THREE.Mesh[] = [];
  private readonly armMat = new THREE.MeshStandardMaterial({ color: 0xe8731a, roughness: 0.5, metalness: 0.15 });
  private readonly foreMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.5, metalness: 0.3 });
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
    const armGeo = new THREE.CylinderGeometry(0.05, 0.062, 1, 8);
    const foreGeo = new THREE.CylinderGeometry(0.042, 0.052, 1, 8);
    const elbowGeo = new THREE.IcosahedronGeometry(0.058, 1);
    this.upper = [mk(armGeo, this.armMat), mk(armGeo, this.armMat)];
    this.fore = [mk(foreGeo, this.foreMat), mk(foreGeo, this.foreMat)];
    this.elbows = [mk(elbowGeo, this.foreMat), mk(elbowGeo, this.foreMat)];
    this.torso.frustumCulled = this.head.frustumCulled = false;
    this.setSkin(SKINS[0]);
    scene.add(this.root);
  }

  /** Puts on a suit. */
  setSkin(skin: SkinDef): void {
    this.torsoMesh.geometry.dispose();
    this.headMesh.geometry.dispose();
    this.torsoMesh.geometry = buildTorsoGeo(skin);
    this.headMesh.geometry = buildHeadGeo(skin);
    this.armMat.color.setHex(skin.suit);
    this.foreMat.color.setHex(skin.trim);
    // Glowing parts: the visor, the chest light, the hover ring.
    for (const g of this.glowParts) g.parent?.remove(g);
    this.glowParts = [];
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x0a1218, emissive: skin.glow, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.6 });
    this.visor = new THREE.Mesh(sphere, visorMat);
    this.visor.position.set(0, 0.01, -0.095);
    this.visor.scale.set(0.125, 0.075, 0.075);
    this.head.add(this.visor);
    const strip = part(this.head, box, skin.glow, [0, 0.01, -0.165], [0.1, 0.012, 0.008], [0, 0, 0], skin.glow);
    const bulb = part(this.head, sphere, skin.glow, [0.095, 0.275, 0.06], [0.02, 0.02, 0.02], [0, 0, 0], skin.glow);
    const chest = part(this.torso, blob, skin.glow, [0, -0.4, -0.125], [0.035, 0.035, 0.012], [0, 0, 0], skin.glow);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 28), new THREE.MeshBasicMaterial({ color: skin.glow }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, -0.935, 0.03);
    this.torso.add(ring);
    this.glowParts.push(this.visor, strip, bulb, chest, ring);
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
      shoulder.set(side * 0.25, -0.3, 0.04).applyAxisAngle(UP, this.yaw).add(head);
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

  /** Tints the glow, for others later. */
  glow(color: number): void {
    mat(color);
  }
}
