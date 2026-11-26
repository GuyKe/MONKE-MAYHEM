import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The one material every plain-coloured static piece shares (its colour is in the vertices). */
export const vertexMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

const _col = new THREE.Color();

/** A cloned geometry ready to merge (world-ish matrix applied), and the material group it belongs to. */
function prepare(m: THREE.Mesh, rel: THREE.Matrix4, shared: THREE.Material): { geo: THREE.BufferGeometry; material: THREE.Material } {
  const material = m.material as THREE.MeshLambertMaterial;
  const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
  const plain = material.isMeshLambertMaterial && !material.map && !material.vertexColors && material.emissive.getHex() === 0;
  const colored = material.vertexColors || plain;
  for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv' && !(name === 'color' && material.vertexColors)) geo.deleteAttribute(name);
  const count = geo.getAttribute('position').count;
  if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  if (plain) {
    _col.copy(material.color);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([_col.r, _col.g, _col.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  } else if (material.vertexColors && !geo.getAttribute('color')) {
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  }
  geo.applyMatrix4(rel);
  return { geo, material: plain ? shared : colored && material.vertexColors ? material : material };
}

const _inv = new THREE.Matrix4();
const _rel = new THREE.Matrix4();
const _p = new THREE.Vector3();

function dynamicAbove(o: THREE.Object3D, stop: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n && n !== stop.parent; n = n.parent) if (n.userData.dynamic) return true;
  return false;
}

/** Can this mesh be folded into a batch? */
function batchable(m: THREE.Mesh): boolean {
  if ((m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return false;
  const material = m.material as THREE.Material;
  if ((material.transparent && !material.userData.batchable) || m.userData.keep) return false;
  const g = m.geometry;
  return !!g.getAttribute('position') && !!g.getAttribute('normal');
}

/**
 * Folds a lot of small static meshes into a few big ones: one per material per 24 m block (so the parts out of view are still
 * skipped). Anything marked `userData.dynamic` (or inside something marked so) is left alone. A scene of thousands of pieces
 * becomes a few hundred draw calls.
 */
export function batchStatic(root: THREE.Object3D, cell = 40): number {
  root.updateWorldMatrix(true, true);
  _inv.copy(root.matrixWorld).invert();
  const groups = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[] }>();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !batchable(m) || dynamicAbove(m, root)) return;
    // Hidden things stay hidden: leave them be.
    for (let n: THREE.Object3D | null = m; n && n !== root.parent; n = n.parent) if (!n.visible) return;
    meshes.push(m);
  });
  for (const m of meshes) {
    m.getWorldPosition(_p);
    _rel.multiplyMatrices(_inv, m.matrixWorld);
    const { geo, material } = prepare(m, _rel, vertexMaterial);
    const key = `${material.uuid}|${Math.floor(_p.x / cell)}|${Math.floor(_p.z / cell)}`;
    let g = groups.get(key);
    if (!g) {
      g = { material, geos: [] };
      groups.set(key, g);
    }
    g.geos.push(geo);
    m.parent?.remove(m);
  }
  let made = 0;
  for (const g of groups.values()) {
    const merged = mergeGeometries(g.geos, false);
    for (const geo of g.geos) geo.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, g.material);
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    made++;
  }
  return made;
}

/**
 * For a model that animates (a monster): merges the static pieces inside each moving part into one mesh per material, so a
 * creature of hundreds of pieces costs a handful of draw calls but its limbs and head still move on their own.
 */
export function mergeUnits(units: THREE.Object3D[], shared: THREE.Material = vertexMaterial): void {
  const all = new Set(units);
  const root = units[0];
  root.updateWorldMatrix(true, true);
  for (const unit of units) {
    unit.updateWorldMatrix(true, false);
    _inv.copy(unit.matrixWorld).invert();
    const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const meshes: THREE.Mesh[] = [];
    const walk = (o: THREE.Object3D): void => {
      for (const c of o.children) {
        if (all.has(c) || c.userData.dynamic) continue;
        const m = c as THREE.Mesh;
        if (m.isMesh && batchable(m)) meshes.push(m);
        walk(c);
      }
    };
    walk(unit);
    for (const m of meshes) {
      m.updateWorldMatrix(true, false);
      _rel.multiplyMatrices(_inv, m.matrixWorld);
      const { geo, material } = prepare(m, _rel, shared);
      const list = groups.get(material) ?? [];
      list.push(geo);
      groups.set(material, list);
      m.parent?.remove(m);
    }
    for (const [material, geos] of groups) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (merged) unit.add(new THREE.Mesh(merged, material));
    }
  }
}
