import * as THREE from 'three';
import { SPAWN } from '../config';
import { RAPIER, WORLD_GROUPS } from '../physics';
import { SURFACES, setSurface } from './materials';
import { Noise2D, lerp, smoothstep } from './noise';

/** The playable square is WORLD_SIZE metres on a side, centred on the origin. */
export const WORLD_SIZE = 140;
export const WORLD_HALF = WORLD_SIZE / 2;
const CELL = 1.5;

/** A flat spot carved into the hills (pond, puddles). Heights ease to `level` inside `inner`. */
export interface FlatSpot {
  x: number;
  z: number;
  inner: number;
  outer: number;
  level: number;
}

export interface Terrain {
  heightAt(x: number, z: number): number;
  /** Rise over run, 0 = flat. */
  slopeAt(x: number, z: number): number;
  addFlatSpot(spot: Omit<FlatSpot, 'level'> & { level?: number }): FlatSpot;
  /** Builds the mesh and collider. Call once, after every flat spot has been added. */
  build(scene: THREE.Scene, world: RAPIER.World): THREE.Mesh;
}

export function createTerrain(noise: Noise2D): Terrain {
  const spots: FlatSpot[] = [];

  const baseHeight = (x: number, z: number): number => {
    const hills = noise.fbm(x * 0.018 + 40, z * 0.018 + 40, 4) * 3.4;
    const detail = noise.get(x * 0.09, z * 0.09) * 0.22;
    // Dead flat at the spawn clearing, easing into hills around it.
    const r = Math.hypot(x - SPAWN.x, z - SPAWN.z);
    let h = (hills + detail) * smoothstep(9, 26, r);
    // A ring of tall hills at the edge hides the end of the world.
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h += smoothstep(WORLD_HALF - 20, WORLD_HALF - 2, edge) * (8 + noise.get(x * 0.05, z * 0.05) * 3);
    return h;
  };

  const heightAt = (x: number, z: number): number => {
    let h = baseHeight(x, z);
    for (const s of spots) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < s.outer) h = lerp(s.level, h, smoothstep(s.inner, s.outer, d));
    }
    return h;
  };

  const slopeAt = (x: number, z: number): number => {
    const e = 0.75;
    const dx = heightAt(x + e, z) - heightAt(x - e, z);
    const dz = heightAt(x, z + e) - heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  };

  return {
    heightAt,
    slopeAt,

    addFlatSpot(spot) {
      const full: FlatSpot = { ...spot, level: spot.level ?? baseHeight(spot.x, spot.z) };
      spots.push(full);
      return full;
    },

    build(scene, world) {
      const n = Math.round(WORLD_SIZE / CELL) + 1;
      const positions = new Float32Array(n * n * 3);
      const colors = new Float32Array(n * n * 3);
      const grass = new THREE.Color(0x5f8a3c);
      const moss = new THREE.Color(0x3f6b34);
      const dirt = new THREE.Color(0x7a6040);
      const c = new THREE.Color();

      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const x = -WORLD_HALF + i * CELL;
          const z = -WORLD_HALF + j * CELL;
          const h = heightAt(x, z);
          const k = (j * n + i) * 3;
          positions[k] = x;
          positions[k + 1] = h;
          positions[k + 2] = z;

          // Colour: grass and moss patches, bare dirt on steeper ground.
          const patch = noise.fbm(x * 0.06 + 11, z * 0.06 - 7, 3) * 0.5 + 0.5;
          c.copy(grass).lerp(moss, smoothstep(0.35, 0.7, patch));
          c.lerp(dirt, smoothstep(0.35, 0.8, slopeAt(x, z)) * 0.8);
          const shade = 0.92 + noise.get(x * 0.4, z * 0.4) * 0.08;
          colors[k] = c.r * shade;
          colors[k + 1] = c.g * shade;
          colors[k + 2] = c.b * shade;
        }
      }

      const indices = new Uint32Array((n - 1) * (n - 1) * 6);
      let t = 0;
      for (let j = 0; j < n - 1; j++) {
        for (let i = 0; i < n - 1; i++) {
          const a = j * n + i;
          const b = a + 1;
          const d = a + n;
          const e = d + 1;
          // Counter-clockwise seen from above so the faces point up.
          indices[t++] = a; indices[t++] = d; indices[t++] = b;
          indices[t++] = b; indices[t++] = d; indices[t++] = e;
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
      scene.add(mesh);

      const collider = world.createCollider(
        RAPIER.ColliderDesc.trimesh(positions, indices).setCollisionGroups(WORLD_GROUPS).setFriction(0.9),
      );
      setSurface(collider, SURFACES.moss);
      return mesh;
    },
  };
}
