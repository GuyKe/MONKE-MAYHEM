import * as THREE from 'three';
import { RAPIER, WORLD_GROUPS } from '../physics';
import { SURFACES, setSurface } from './materials';
import { Noise2D, lerp, smoothstep } from './noise';

/** The playable square is WORLD_SIZE metres on a side, centred on the origin. */
export const WORLD_SIZE = 420;
export const WORLD_HALF = WORLD_SIZE / 2;
/** The map is cut into CHUNKS x CHUNKS squares so only the ones near the player are drawn. */
export const CHUNK_SIZE = 60;
export const CHUNKS = WORLD_SIZE / CHUNK_SIZE;
/** Distance between terrain grid points. */
const CELL = 2;
const N = WORLD_SIZE / CELL + 1;
const CELLS_PER_CHUNK = CHUNK_SIZE / CELL;

/** A flat spot carved into the hills (pond, puddles). Heights ease to `level` inside `inner`. */
export interface FlatSpot {
  x: number;
  z: number;
  inner: number;
  outer: number;
  level: number;
}

export interface Terrain {
  /** The smooth height function. Use it to place things before `build`. */
  heightAt(x: number, z: number): number;
  /** The exact height of the built mesh (and its collider) at (x, z). Only valid after `build`. */
  surfaceAt(x: number, z: number): number;
  /** Rise over run, 0 = flat. */
  slopeAt(x: number, z: number): number;
  addFlatSpot(spot: Omit<FlatSpot, 'level'> & { level?: number }): FlatSpot;
  /**
   * Builds the height grid, one mesh per chunk (indexed [cz][cx]) and the collider.
   * Call once, after every flat spot has been added.
   */
  build(scene: THREE.Scene, world: RAPIER.World): Array<Array<{ high: THREE.Mesh; low: THREE.Mesh }>>;
}

export function createTerrain(noise: Noise2D, spawn: { x: number; z: number }): Terrain {
  const spots: FlatSpot[] = [];
  let grid: Float32Array | null = null;

  const baseHeight = (x: number, z: number): number => {
    const broad = noise.fbm(x * 0.005 + 17, z * 0.005 - 3, 3) * 9;
    const hills = noise.fbm(x * 0.018 + 40, z * 0.018 + 40, 4) * 3.4;
    const detail = noise.get(x * 0.09, z * 0.09) * 0.22;
    // Dead flat at the spawn clearing, easing into hills around it.
    const r = Math.hypot(x - spawn.x, z - spawn.z);
    let h = (broad + hills + detail) * smoothstep(9, 26, r);
    // A ring of tall hills at the edge hides the end of the world.
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h += smoothstep(WORLD_HALF - 26, WORLD_HALF - 2, edge) * (10 + noise.get(x * 0.04, z * 0.04) * 3);
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

  /** Height of the mesh: the grid's own triangles, so it matches the collider exactly. */
  const surfaceAt = (x: number, z: number): number => {
    if (!grid) return heightAt(x, z);
    const fx = Math.min(N - 1.001, Math.max(0, (x + WORLD_HALF) / CELL));
    const fz = Math.min(N - 1.001, Math.max(0, (z + WORLD_HALF) / CELL));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = grid[j * N + i];
    const b = grid[j * N + i + 1];
    const d = grid[(j + 1) * N + i];
    const e = grid[(j + 1) * N + i + 1];
    // The cell is split along the b-d diagonal: triangles (a, d, b) and (b, d, e).
    return u + v <= 1 ? a + (b - a) * u + (d - a) * v : e + (d - e) * (1 - u) + (b - e) * (1 - v);
  };

  return {
    heightAt,
    surfaceAt,
    slopeAt,

    addFlatSpot(spot) {
      const full: FlatSpot = { ...spot, level: spot.level ?? baseHeight(spot.x, spot.z) };
      spots.push(full);
      return full;
    },

    build(scene, world) {
      // 1. Heights on the grid.
      const heights = new Float32Array(N * N);
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) heights[j * N + i] = heightAt(-WORLD_HALF + i * CELL, -WORLD_HALF + j * CELL);
      }
      grid = heights;
      const hAt = (i: number, j: number) => heights[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];

      // 2. Colour and normal per grid point (from the grid, so chunk edges match).
      const colors = new Float32Array(N * N * 3);
      const normals = new Float32Array(N * N * 3);
      const grass = new THREE.Color(0x5f8a3c);
      const moss = new THREE.Color(0x3f6b34);
      const dirt = new THREE.Color(0x7a6040);
      const c = new THREE.Color();
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const x = -WORLD_HALF + i * CELL;
          const z = -WORLD_HALF + j * CELL;
          const dx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * CELL);
          const dz = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * CELL);
          const k = (j * N + i) * 3;
          const len = Math.hypot(dx, 1, dz);
          normals[k] = -dx / len;
          normals[k + 1] = 1 / len;
          normals[k + 2] = -dz / len;

          const patch = noise.fbm(x * 0.06 + 11, z * 0.06 - 7, 3) * 0.5 + 0.5;
          c.copy(grass).lerp(moss, smoothstep(0.35, 0.7, patch));
          c.lerp(dirt, smoothstep(0.35, 0.8, Math.hypot(dx, dz)) * 0.8);
          const shade = 0.92 + noise.get(x * 0.4, z * 0.4) * 0.08;
          colors[k] = c.r * shade;
          colors[k + 1] = c.g * shade;
          colors[k + 2] = c.b * shade;
        }
      }

      // 3. One mesh per chunk.
      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      const meshes: Array<Array<{ high: THREE.Mesh; low: THREE.Mesh }>> = [];
      const side = CELLS_PER_CHUNK + 1;
      for (let cz = 0; cz < CHUNKS; cz++) {
        const row: Array<{ high: THREE.Mesh; low: THREE.Mesh }> = [];
        for (let cx = 0; cx < CHUNKS; cx++) {
          const pos = new Float32Array(side * side * 3);
          const col = new Float32Array(side * side * 3);
          const nor = new Float32Array(side * side * 3);
          for (let j = 0; j < side; j++) {
            for (let i = 0; i < side; i++) {
              const gi = cx * CELLS_PER_CHUNK + i;
              const gj = cz * CELLS_PER_CHUNK + j;
              const g = (gj * N + gi) * 3;
              const l = (j * side + i) * 3;
              pos[l] = -WORLD_HALF + gi * CELL;
              pos[l + 1] = heights[gj * N + gi];
              pos[l + 2] = -WORLD_HALF + gj * CELL;
              col[l] = colors[g];
              col[l + 1] = colors[g + 1];
              col[l + 2] = colors[g + 2];
              nor[l] = normals[g];
              nor[l + 1] = normals[g + 1];
              nor[l + 2] = normals[g + 2];
            }
          }
          const idx = new Uint32Array(CELLS_PER_CHUNK * CELLS_PER_CHUNK * 6);
          let t = 0;
          for (let j = 0; j < CELLS_PER_CHUNK; j++) {
            for (let i = 0; i < CELLS_PER_CHUNK; i++) {
              const a = j * side + i;
              const b = a + 1;
              const d = a + side;
              const e = d + 1;
              // Counter-clockwise seen from above so the faces point up.
              idx[t++] = a; idx[t++] = d; idx[t++] = b;
              idx[t++] = b; idx[t++] = d; idx[t++] = e;
            }
          }
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
          geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
          geometry.setIndex(new THREE.BufferAttribute(idx, 1));
          const mesh = new THREE.Mesh(geometry, material);
          mesh.frustumCulled = false; // chunks are shown or hidden by distance instead
          scene.add(mesh);
          const low = new THREE.Mesh(lowResChunk(cx, cz, heights, colors, normals), material);
          low.frustumCulled = false;
          low.visible = false;
          scene.add(low);
          row.push({ high: mesh, low });
        }
        meshes.push(row);
      }

      // 4. One collider for the whole map, from the same grid.
      const positions = new Float32Array(N * N * 3);
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const k = (j * N + i) * 3;
          positions[k] = -WORLD_HALF + i * CELL;
          positions[k + 1] = heights[j * N + i];
          positions[k + 2] = -WORLD_HALF + j * CELL;
        }
      }
      const indices = new Uint32Array((N - 1) * (N - 1) * 6);
      let t = 0;
      for (let j = 0; j < N - 1; j++) {
        for (let i = 0; i < N - 1; i++) {
          const a = j * N + i;
          const b = a + 1;
          const d = a + N;
          const e = d + 1;
          indices[t++] = a; indices[t++] = d; indices[t++] = b;
          indices[t++] = b; indices[t++] = d; indices[t++] = e;
        }
      }
      const collider = world.createCollider(
        RAPIER.ColliderDesc.trimesh(positions, indices).setCollisionGroups(WORLD_GROUPS).setFriction(0.9),
      );
      setSurface(collider, SURFACES.moss);
      return meshes;
    },
  };
}

/**
 * A coarser version of a chunk (every other grid point) for chunks far from the player, where the fog
 * hides the detail. A skirt hangs down around the edge so no gaps show against full-detail neighbours.
 */
function lowResChunk(cx: number, cz: number, heights: Float32Array, colors: Float32Array, normals: Float32Array): THREE.BufferGeometry {
  const cells = CELLS_PER_CHUNK / 2;
  const side = cells + 1;
  const SKIRT = 3;
  const verts = side * side + 4 * side; // the grid, then a lowered copy of each edge
  const pos = new Float32Array(verts * 3);
  const col = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const write = (v: number, gi: number, gj: number, drop: number) => {
    const g = (gj * N + gi) * 3;
    pos[v * 3] = -WORLD_HALF + gi * CELL;
    pos[v * 3 + 1] = heights[gj * N + gi] - drop;
    pos[v * 3 + 2] = -WORLD_HALF + gj * CELL;
    col.set([colors[g], colors[g + 1], colors[g + 2]], v * 3);
    nor.set([normals[g], normals[g + 1], normals[g + 2]], v * 3);
  };
  const g0i = cx * CELLS_PER_CHUNK;
  const g0j = cz * CELLS_PER_CHUNK;
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) write(j * side + i, g0i + i * 2, g0j + j * 2, 0);

  const idx: number[] = [];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * side + i;
      const b = a + 1;
      const d = a + side;
      const e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  // Skirts: a lowered copy of each edge, joined to it by a strip.
  let next = side * side;
  const edges: Array<Array<[number, number]>> = [[], [], [], []];
  for (let k = 0; k < side; k++) {
    edges[0].push([k, 0]);
    edges[1].push([k, side - 1]);
    edges[2].push([0, k]);
    edges[3].push([side - 1, k]);
  }
  for (const edge of edges) {
    const base = next;
    edge.forEach(([i, j], k) => write(base + k, g0i + i * 2, g0j + j * 2, SKIRT));
    next += edge.length;
    for (let k = 0; k < edge.length - 1; k++) {
      const top0 = edge[k][1] * side + edge[k][0];
      const top1 = edge[k + 1][1] * side + edge[k + 1][0];
      // Both windings, so the strip shows from outside whichever way the chunk faces.
      idx.push(top0, base + k, top1, top1, base + k, base + k + 1);
      idx.push(top0, top1, base + k, top1, base + k + 1, base + k);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setIndex(idx);
  return geometry;
}
