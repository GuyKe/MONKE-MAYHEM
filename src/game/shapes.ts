import * as THREE from 'three';

/** Little building blocks for the procedural models. */
export const sphere = new THREE.IcosahedronGeometry(1, 2);
export const blob = new THREE.IcosahedronGeometry(1, 1);
export const low = new THREE.IcosahedronGeometry(1, 0);
export const box = new THREE.BoxGeometry(1, 1, 1);
export const cyl = new THREE.CylinderGeometry(1, 1, 1, 12);
export const cone = new THREE.ConeGeometry(1, 1, 8);
export const UP = new THREE.Vector3(0, 1, 0);
export const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

const cache = new Map<string, THREE.MeshStandardMaterial>();
/** A shared standard material for a colour (with optional glow). */
export function mat(color: number, emissive = 0, rough = 0.6, metal = 0.1): THREE.MeshStandardMaterial {
  const key = `${color}|${emissive}|${rough}|${metal}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: emissive ? 1.4 : 0, roughness: rough, metalness: metal });
    cache.set(key, m);
  }
  return m;
}

export function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number, at: [number, number, number], size: [number, number, number], rot: [number, number, number] = [0, 0, 0], emissive = 0, rough = 0.6, metal = 0.1): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat(color, emissive, rough, metal));
  m.position.set(...at);
  m.scale.set(...size);
  m.rotation.set(...rot);
  parent.add(m);
  return m;
}

/** A tapered cylinder between two points. */
export function limb(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, color: number, r2 = r, rough = 0.6): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r2, r, 1, 10);
  const m = new THREE.Mesh(g, mat(color, 0, rough));
  const len = a.distanceTo(b);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  m.scale.set(1, len, 1);
  parent.add(m);
  return m;
}

export function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export const hsl = (h: number, s = 0.7, l = 0.5): number => new THREE.Color().setHSL(h, s, l).getHex();
