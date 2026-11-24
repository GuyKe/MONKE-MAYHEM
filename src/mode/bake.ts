import * as THREE from 'three';
import { Baker } from '../world/baker';
import type { Human } from './figures';

const flat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
export const bakedMaterial = flat;

const _inv = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();

/** Merges every mesh under `root` into one vertex-coloured mesh in `root`'s own space (does not change the scene). */
export function bakeGroup(root: THREE.Object3D): THREE.Mesh {
  root.updateWorldMatrix(true, true);
  _inv.copy(root.matrixWorld).invert();
  const baker = new Baker();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry.getAttribute('normal')) return;
    const material = Array.isArray(m.material) ? m.material[0] : m.material;
    const color = (material as THREE.MeshLambertMaterial).color;
    _c.copy(color ?? _c.setRGB(1, 1, 1));
    const emissive = (material as THREE.MeshLambertMaterial).emissive;
    if (emissive && emissive.getHex() !== 0) _c.copy(emissive).multiplyScalar(1.2);
    _m.multiplyMatrices(_inv, m.matrixWorld);
    baker.add(m.geometry, _m, _c);
  });
  const mesh = new THREE.Mesh(baker.build(), flat);
  mesh.frustumCulled = true;
  return mesh;
}

/** Replaces everything inside `group` by one baked mesh. */
export function bakeInto(group: THREE.Object3D): void {
  const mesh = bakeGroup(group);
  while (group.children.length) group.remove(group.children[0]);
  group.add(mesh);
}

/** A gorilla as 5 draw calls (torso+head, two arms, two legs), still able to swing its limbs. The head no longer moves on its own. */
export function bakeGorilla(h: Human): Human {
  for (const limb of [...h.legs, ...h.arms]) bakeInto(limb);
  const inner = h.group.children[0];
  for (const child of inner.children) if (!h.legs.includes(child as THREE.Group) && !h.arms.includes(child as THREE.Group)) bakeInto(child);
  h.head = new THREE.Group();
  return h;
}
