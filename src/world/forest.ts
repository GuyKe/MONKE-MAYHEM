import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAPIER, WORLD_GROUPS } from '../physics';
import { Baker } from './baker';
import { SURFACES, setSurface, type SurfaceMaterial } from './materials';
import { axisQuaternion, designRuin, type Ruin, type RuinType } from './ruins';
import type { PieceKind } from './sticks';
import { Noise2D, mulberry32 } from './noise';
import { CHUNKS, CHUNK_SIZE, WORLD_HALF, createTerrain } from './terrain';

export interface ForestOptions {
  /** The same seed always gives the same forest. */
  seed: number;
  /** Where the player starts; the ground is flattened into a clearing here. */
  spawn: { x: number; z: number };
  /** Distance between tree planting points in metres (smaller = denser). Default 4.8. */
  treeSpacing?: number;
  /** How far chunks are drawn. Default 78. */
  viewRadius?: number;
  grass?: boolean;
}

export interface Tree {
  x: number;
  z: number;
  height: number;
  radius: number;
}

/** A rope hanging down a tree trunk, within reach of the ground, that can be pulled down. */
export interface RopeSpot {
  /** Where the rope hangs (against the trunk). */
  x: number;
  z: number;
  /** Heights of the top (tied up in the tree) and the bottom end. */
  top: number;
  bottom: number;
}

/** A ruin to find: where it is and what is lying inside it. */
export interface PoiInfo {
  id: string;
  type: RuinType;
  label: string;
  x: number;
  z: number;
  yaw: number;
  /** Ground height at its centre. */
  baseY: number;
  footprint: number;
  loot: Array<{ kind: PieceKind; x: number; y: number; z: number }>;
}

export interface Forest {
  seed: number;
  /** Old buildings and stone circles scattered through the forest, to look around and find. */
  pois: ReadonlyArray<PoiInfo>;
  /** The smooth ground height. */
  heightAt(x: number, z: number): number;
  /** The exact ground height of the mesh and collider. */
  surfaceAt(x: number, z: number): number;
  slopeAt(x: number, z: number): number;
  /**
   * True if (x, z) is within `pad` metres of a tree, pond or puddle, or of the spawn clearing
   * (unless `ignoreSpawn`, for things that belong in the clearing, like sticks).
   */
  isBlocked(x: number, z: number, pad?: number, ignoreSpawn?: boolean): boolean;
  /** The tree whose trunk is within `pad` metres of (x, z), or null. */
  nearestTree(x: number, z: number, pad: number): Tree | null;
  /** Where the player starts, standing on the ground. */
  spawn: THREE.Vector3;
  trees: ReadonlyArray<Tree>;
  /** Ropes hanging in trees. */
  ropes: ReadonlyArray<RopeSpot>;
  /** The frozen ponds and mud puddles (circles), for the map. */
  water: ReadonlyArray<{ x: number; z: number; r: number; ice: boolean }>;
  /** Shows the chunks near `viewer` and hides the rest. Call every frame (it is cheap). */
  update(viewer: THREE.Vector3): void;
  /** Changes how far chunks are drawn. */
  setViewRadius(metres: number): void;
  setGrass(on: boolean): void;
  stats: { trees: number; branches: number; rocks: number; logs: number; ponds: number; puddles: number; colliders: number };
}

/** Chunks nearer than this (metres, to their nearest edge) are drawn. Fog hides the cut-off. */
export const VIEW_RADIUS = 78;
/** Chunks nearer than this get full detail; farther ones get a cheaper version. */
const DETAIL_RADIUS = 34;
/** Grass tufts are only drawn this close. */
const GRASS_RADIUS = 42;

/** A circle trees, rocks and grass keep out of. */
interface Keepout {
  x: number;
  z: number;
  r: number;
  /** The spawn clearing, which some things may ignore. */
  spawn?: boolean;
}

interface Chunk {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  terrain: { high: THREE.Mesh; low: THREE.Mesh };
  props: Baker;
  /** The same chunk with cheaper trees, drawn when it is far away. */
  propsLow: Baker;
  tufts: Baker;
  propsMesh?: THREE.Mesh;
  propsLowMesh?: THREE.Mesh;
  tuftsMesh?: THREE.Mesh;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Builds a large random forest: terrain, trees, rocks, logs, grass, frozen ponds and mud puddles.
 *
 * The map is cut into 60 m chunks. Everything in a chunk that doesn't move is baked into one mesh,
 * and only the chunks near the player are drawn, so a 420 m map costs about as much to render as a
 * small one. Colliders are all created up front.
 */
export function buildForest(scene: THREE.Scene, world: RAPIER.World, options: ForestOptions): Forest {
  const { seed, spawn } = options;
  const noise = new Noise2D(seed);
  const rand = mulberry32(seed + 1);
  const range = (a: number, b: number) => a + rand() * (b - a);
  const terrain = createTerrain(noise, spawn);
  const keepouts: Keepout[] = [{ x: spawn.x, z: spawn.z, r: 9, spawn: true }];
  let colliders = 0;

  const addCollider = (desc: RAPIER.ColliderDesc, surface: SurfaceMaterial): void => {
    setSurface(world.createCollider(desc.setCollisionGroups(WORLD_GROUPS).setFriction(0.9)), surface);
    colliders++;
  };
  const blocked = (x: number, z: number, pad = 0, ignoreSpawn = false): boolean =>
    keepouts.some((k) => !(ignoreSpawn && k.spawn) && Math.hypot(x - k.x, z - k.z) < k.r + pad);
  const inside = (x: number, z: number, margin: number) => Math.abs(x) < WORLD_HALF - margin && Math.abs(z) < WORLD_HALF - margin;

  // --- Slippery spots ---------------------------------------------------------
  // Flat discs lying on flat ground: frozen ponds and mud puddles. A frozen puddle and a mud patch
  // sit by the spawn so the slip is easy to try straight away.
  const pads: Array<{ x: number; z: number; r: number; surface: SurfaceMaterial; level: number }> = [];
  let ponds = 0;
  let puddles = 0;
  const addPad = (x: number, z: number, r: number, surface: SurfaceMaterial, inner: number, outer: number) => {
    const spot = terrain.addFlatSpot({ x, z, inner, outer });
    pads.push({ x, z, r, surface, level: spot.level });
    keepouts.push({ x, z, r: outer });
  };
  addPad(spawn.x - 5.5, spawn.z + 7, 2.3, SURFACES.ice, 3.2, 4.5);
  addPad(spawn.x + 5.5, spawn.z + 7.5, 2.2, SURFACES.mud, 3, 4.5);
  const farFromOthers = (x: number, z: number, gap: number) => !keepouts.some((k) => Math.hypot(x - k.x, z - k.z) < k.r + gap);
  const place = (want: number, tryLimit: number, ok: (x: number, z: number) => boolean, make: (x: number, z: number) => void) => {
    for (let tries = 0, made = 0; made < want && tries < tryLimit; tries++) {
      const x = range(-WORLD_HALF + 50, WORLD_HALF - 50);
      const z = range(-WORLD_HALF + 50, WORLD_HALF - 50);
      if (ok(x, z)) {
        make(x, z);
        made++;
      }
    }
  };
  place(
    6,
    400,
    (x, z) => Math.hypot(x - spawn.x, z - spawn.z) > 45 && terrain.slopeAt(x, z) < 0.12 && farFromOthers(x, z, 10),
    (x, z) => {
      const r = range(4, 7);
      addPad(x, z, r, SURFACES.ice, r + 1.5, r + 7);
      ponds++;
    },
  );
  place(
    45,
    900,
    (x, z) => Math.hypot(x - spawn.x, z - spawn.z) > 14 && terrain.slopeAt(x, z) < 0.25 && farFromOthers(x, z, 5),
    (x, z) => {
      addPad(x, z, range(1.4, 2.6), SURFACES.mud, 3, 4.5);
      puddles++;
    },
  );

  // --- Places to find ----------------------------------------------------------
  // Chosen now so the ground can be levelled and trees kept away. The first is a short walk from the start.
  const plans: Array<{ ruin: Ruin; x: number; z: number; yaw: number }> = [];
  const ruinTypes: RuinType[] = ['camp', 'cabin', 'stones', 'tower', 'cabin', 'camp', 'stones', 'tower', 'cabin', 'camp', 'tower', 'stones'];
  ruinTypes.forEach((type, k) => {
    const ruin = designRuin(type, rand);
    for (let tries = 0; tries < 500; tries++) {
      let x: number;
      let z: number;
      if (k === 0) {
        const a = rand() * Math.PI * 2;
        const d = 48 + rand() * 30;
        x = spawn.x + Math.cos(a) * d;
        z = spawn.z + Math.sin(a) * d;
      } else {
        x = range(-WORLD_HALF + 45, WORLD_HALF - 45);
        z = range(-WORLD_HALF + 45, WORLD_HALF - 45);
        if (Math.hypot(x - spawn.x, z - spawn.z) < 40) continue;
      }
      if (!inside(x, z, 45) || terrain.slopeAt(x, z) > 0.14) continue;
      if (plans.some((p) => Math.hypot(p.x - x, p.z - z) < 70)) continue;
      if (keepouts.some((kp) => Math.hypot(x - kp.x, z - kp.z) < kp.r + ruin.footprint + 4)) continue;
      terrain.addFlatSpot({ x, z, inner: ruin.footprint + 1.5, outer: ruin.footprint + 9 });
      keepouts.push({ x, z, r: ruin.footprint + 3 });
      plans.push({ ruin, x, z, yaw: rand() * Math.PI * 2 });
      return;
    }
  });

  const terrainMeshes = terrain.build(scene, world);
  const { heightAt, surfaceAt, slopeAt } = terrain;

  const chunks: Chunk[][] = [];
  for (let cz = 0; cz < CHUNKS; cz++) {
    const row: Chunk[] = [];
    for (let cx = 0; cx < CHUNKS; cx++) {
      row.push({
        minX: -WORLD_HALF + cx * CHUNK_SIZE,
        maxX: -WORLD_HALF + (cx + 1) * CHUNK_SIZE,
        minZ: -WORLD_HALF + cz * CHUNK_SIZE,
        maxZ: -WORLD_HALF + (cz + 1) * CHUNK_SIZE,
        terrain: terrainMeshes[cz][cx],
        props: new Baker(),
        propsLow: new Baker(),
        tufts: new Baker(),
      });
    }
    chunks.push(row);
  }
  const idx = (v: number) => Math.min(CHUNKS - 1, Math.max(0, Math.floor((v + WORLD_HALF) / CHUNK_SIZE)));
  const chunkAt = (x: number, z: number) => chunks[idx(z)][idx(x)];

  for (const pad of pads) {
    const h = 0.03;
    const geo = new THREE.CylinderGeometry(pad.r, pad.r, h, 24);
    _m.compose(_p.set(pad.x, pad.level + h / 2, pad.z), _q.identity(), _s.set(1, 1, 1));
    const padChunk = chunkAt(pad.x, pad.z);
    padChunk.props.add(geo, _m, _c.set(pad.surface.color));
    padChunk.propsLow.add(geo, _m, _c.set(pad.surface.color));
    addCollider(RAPIER.ColliderDesc.cylinder(h / 2, pad.r).setTranslation(pad.x, pad.level + h / 2, pad.z), pad.surface);
  }

  // --- Trees ------------------------------------------------------------------
  interface TreeData extends Tree {
    y: number;
    pine: boolean;
    width: number;
  }
  const trees: TreeData[] = [];
  const SPACING = options.treeSpacing ?? 4.8;
  for (let gx = -WORLD_HALF + 2; gx < WORLD_HALF - 1; gx += SPACING) {
    for (let gz = -WORLD_HALF + 2; gz < WORLD_HALF - 1; gz += SPACING) {
      const x = gx + range(-2, 2);
      const z = gz + range(-2, 2);
      if (!inside(x, z, 3)) continue;
      if (blocked(x, z, 1.2) || slopeAt(x, z) > 0.6) continue;
      const density = 0.5 + 0.5 * noise.fbm(x * 0.03 + 5, z * 0.03 - 9, 2);
      const edge = Math.max(Math.abs(x), Math.abs(z));
      const chance = edge > WORLD_HALF - 22 ? 0.95 : 0.3 + 0.6 * density;
      if (rand() > chance) continue;
      const pine = rand() < 0.6;
      // Tall and thick, with the odd giant.
      const giant = rand() < 0.06;
      const height = (pine ? range(15, 27) : range(10, 17)) * (giant ? 1.3 : 1);
      trees.push({
        x,
        z,
        y: surfaceAt(x, z) - 0.35,
        height,
        radius: (0.3 + height * 0.022 + range(0, 0.18)) * (giant ? 1.5 : 1),
        pine,
        width: range(0.85, 1.25),
      });
    }
  }

  const trunkGeo = new THREE.CylinderGeometry(0.72, 1, 1, 6, 1, true).translate(0, 0.5, 0); // open ended: both ends are hidden
  const pineGeo = mergeGeometries([
    new THREE.ConeGeometry(0.2, 0.45, 6).translate(0, 0.4, 0),
    new THREE.ConeGeometry(0.16, 0.4, 6).translate(0, 0.62, 0),
    new THREE.ConeGeometry(0.11, 0.35, 6).translate(0, 0.82, 0),
  ])!;
  const leafGeo = new THREE.SphereGeometry(1, 6, 4);
  // Far-away versions: one cone for a pine, a plain 20-sided blob for a broadleaf.
  const pineLowGeo = new THREE.ConeGeometry(0.2, 0.75, 5).translate(0, 0.55, 0);
  const leafLowGeo = new THREE.IcosahedronGeometry(1, 0);

  for (const t of trees) {
    const chunk = chunkAt(t.x, t.z);
    const trunkH = t.height + 0.35;
    _m.compose(_p.set(t.x, t.y, t.z), _q.setFromAxisAngle(UP, rand() * 6.28), _s.set(t.radius, trunkH, t.radius));
    const barkColor = _c.setHSL(0.07 + range(-0.01, 0.015), 0.35, range(0.2, 0.3));
    chunk.props.add(trunkGeo, _m, barkColor);
    if (!t.pine) chunk.propsLow.add(trunkGeo, _m, barkColor);
    addCollider(RAPIER.ColliderDesc.cylinder(trunkH / 2, t.radius * 0.86).setTranslation(t.x, t.y + trunkH / 2, t.z), SURFACES.bark);

    if (t.pine) {
      const w = t.height * t.width * 0.75;
      _m.compose(_p.set(t.x, t.y + 0.35, t.z), _q.setFromAxisAngle(UP, rand() * 6.28), _s.set(w, t.height, w));
      const needles = _c.setHSL(0.36 + range(-0.02, 0.02), 0.45, range(0.16, 0.25));
      chunk.props.add(pineGeo, _m, needles);
      chunk.propsLow.add(pineLowGeo, _m, needles);
    } else {
      const w = t.height * 0.24 * t.width;
      _m.compose(_p.set(t.x, t.y + 0.35 + t.height * 0.78, t.z), _q.setFromAxisAngle(UP, rand() * 6.28), _s.set(w, w * 0.8, w));
      const foliage = _c.setHSL(0.27 + range(-0.03, 0.03), 0.5, range(0.26, 0.36));
      chunk.props.add(leafGeo, _m, foliage);
      chunk.propsLow.add(leafLowGeo, _m, foliage);
    }
  }

  // Low branches to grab and climb on.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  let branches = 0;
  for (const t of trees) {
    if (rand() > 0.55) continue;
    const count = 1 + Math.floor(rand() * 2);
    for (let b = 0; b < count; b++) {
      const angle = rand() * Math.PI * 2;
      const len = range(0.9, 1.6);
      const quat = new THREE.Quaternion()
        .setFromAxisAngle(UP, Math.atan2(Math.cos(angle), Math.sin(angle)))
        .multiply(_qa.setFromAxisAngle(X_AXIS, -range(0.1, 0.35))); // outer end rises
      const reach = t.radius * 0.5 + len / 2;
      const px = t.x + Math.cos(angle) * reach;
      const py = t.y + 0.35 + range(0.9, 5.5); // the higher ones you climb up to
      const pz = t.z + Math.sin(angle) * reach;
      _m.compose(_p.set(px, py, pz), quat, _s.set(0.11, 0.11, len));
      chunkAt(px, pz).props.add(boxGeo, _m, _c.set(SURFACES.wood.color));
      addCollider(
        RAPIER.ColliderDesc.cuboid(0.07, 0.07, len / 2)
          .setTranslation(px, py, pz)
          .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }),
        SURFACES.wood,
      );
      branches++;
    }
  }

  // Ropes hanging down some of the bigger trunks, ending within reach of the ground.
  const ropes: RopeSpot[] = [];
  const addRope = (t: TreeData) => {
    const angle = rand() * Math.PI * 2;
    const x = t.x + Math.cos(angle) * (t.radius + 0.05);
    const z = t.z + Math.sin(angle) * (t.radius + 0.05);
    const ground = surfaceAt(x, z);
    ropes.push({ x, z, top: ground + Math.min(t.height * 0.5, 9), bottom: ground + range(1.15, 1.4) });
  };
  for (const t of trees) if (t.radius > 0.55 && rand() < 0.07) addRope(t);
  // Always a few close to where you start.
  const byDistance = [...trees].sort((p, q) => Math.hypot(p.x - spawn.x, p.z - spawn.z) - Math.hypot(q.x - spawn.x, q.z - spawn.z));
  let nearRopes = ropes.filter((r) => Math.hypot(r.x - spawn.x, r.z - spawn.z) < 45).length;
  for (const t of byDistance) {
    if (nearRopes >= 4) break;
    const d = Math.hypot(t.x - spawn.x, t.z - spawn.z);
    if (d > 12 && d < 40 && t.radius > 0.45) {
      addRope(t);
      nearRopes++;
    }
  }

  // Spatial lookup so isBlocked stays fast with thousands of trees.
  // Trees, and later rocks and logs, go in a grid of buckets.
  interface Obstacle {
    x: number;
    z: number;
    radius: number;
    tree?: Tree;
  }
  const BUCKET = 8;
  const buckets = new Map<number, Obstacle[]>();
  const bucketKey = (ix: number, iz: number) => ix * 100003 + iz;
  const addObstacle = (o: Obstacle) => {
    const key = bucketKey(Math.floor(o.x / BUCKET), Math.floor(o.z / BUCKET));
    const list = buckets.get(key);
    if (list) list.push(o);
    else buckets.set(key, [o]);
  };
  for (const t of trees) addObstacle({ x: t.x, z: t.z, radius: t.radius, tree: t });
  const treeNear = (x: number, z: number, pad: number): boolean => {
    const reach = Math.ceil((pad + 3) / BUCKET); // rocks and logs can be a few metres across
    const ix = Math.floor(x / BUCKET);
    const iz = Math.floor(z / BUCKET);
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        const list = buckets.get(bucketKey(ix + dx, iz + dz));
        if (list && list.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + pad)) return true;
      }
    }
    return false;
  };

  const nearestTree = (x: number, z: number, pad: number): Tree | null => {
    const reach = Math.ceil((pad + 2) / BUCKET);
    const ix = Math.floor(x / BUCKET);
    const iz = Math.floor(z / BUCKET);
    let best: Tree | null = null;
    let bestD = Infinity;
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        for (const o of buckets.get(bucketKey(ix + dx, iz + dz)) ?? []) {
          if (!o.tree) continue;
          const d = Math.hypot(o.x - x, o.z - z) - o.radius;
          if (d < pad && d < bestD) {
            bestD = d;
            best = o.tree;
          }
        }
      }
    }
    return best;
  };

  // --- Rocks ------------------------------------------------------------------
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockCorners = uniqueVertices(rockGeo);
  const rockSpots: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < 6; i++) {
    // A few close to the spawn so there is something to climb straight away.
    for (let tries = 0; tries < 20; tries++) {
      const a = rand() * 6.28;
      const d = range(11, 16);
      const nx = spawn.x + Math.cos(a) * d;
      const nz = spawn.z + Math.sin(a) * d;
      if (!blocked(nx, nz, 1) && !treeNear(nx, nz, 1)) {
        rockSpots.push({ x: nx, z: nz });
        break;
      }
    }
  }
  for (let tries = 0; rockSpots.length < 420 && tries < 4000; tries++) {
    const x = range(-WORLD_HALF + 6, WORLD_HALF - 6);
    const z = range(-WORLD_HALF + 6, WORLD_HALF - 6);
    if (blocked(x, z, 1) || slopeAt(x, z) > 0.8) continue;
    rockSpots.push({ x, z });
  }
  let rockCount = 0;
  for (const spot of rockSpots) {
    const s = 0.5 + rand() * rand() * 2;
    const sx = s * range(0.8, 1.3);
    const sy = s * range(0.55, 0.85);
    const sz = s * range(0.8, 1.3);
    const y = surfaceAt(spot.x, spot.z) + sy * 0.3;
    _q.setFromEuler(_e.set(range(-0.2, 0.2), rand() * 6.28, range(-0.2, 0.2)));
    _m.compose(_p.set(spot.x, y, spot.z), _q, _s.set(sx, sy, sz));
    const rockChunk = chunkAt(spot.x, spot.z);
    const rockColor = _c.setHSL(0.1, 0.05, range(0.35, 0.5));
    rockChunk.props.add(rockGeo, _m, rockColor);
    if (s > 1) rockChunk.propsLow.add(rockGeo, _m, rockColor); // only the big ones show from afar
    const hull = new Float32Array(rockCorners.length * 3);
    rockCorners.forEach((v, k) => {
      _p.copy(v).applyMatrix4(_m);
      hull[k * 3] = _p.x;
      hull[k * 3 + 1] = _p.y;
      hull[k * 3 + 2] = _p.z;
    });
    const desc = RAPIER.ColliderDesc.convexHull(hull);
    if (desc) {
      addCollider(desc, SURFACES.stone);
      addObstacle({ x: spot.x, z: spot.z, radius: Math.max(sx, sz) * 1.05 });
      rockCount++;
    }
  }

  // --- Fallen logs ------------------------------------------------------------
  const logGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  let logCount = 0;
  for (let tries = 0; logCount < 90 && tries < 3000; tries++) {
    const x = range(-WORLD_HALF + 8, WORLD_HALF - 8);
    const z = range(-WORLD_HALF + 8, WORLD_HALF - 8);
    if (blocked(x, z, 2) || slopeAt(x, z) > 0.18 || treeNear(x, z, 3.2)) continue;
    const len = range(2.5, 5.5);
    const r = range(0.22, 0.4);
    const yaw = rand() * 6.28;
    // The cylinder's axis is Y; lay it along X, then turn it.
    _q.setFromAxisAngle(UP, yaw).multiply(_qa.setFromAxisAngle(Z_AXIS, Math.PI / 2));
    const y = surfaceAt(x, z) + r * 0.7;
    _m.compose(_p.set(x, y, z), _q, _s.set(r, len, r));
    chunkAt(x, z).props.add(logGeo, _m, _c.setHSL(0.07, 0.3, range(0.17, 0.26)));
    addCollider(
      RAPIER.ColliderDesc.cylinder(len / 2, r).setTranslation(x, y, z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }),
      SURFACES.bark,
    );
    addObstacle({ x, z, radius: len / 2 + r });
    logCount++;
  }

  // --- The ruins themselves -----------------------------------------------------
  const pois: PoiInfo[] = [];
  const _yq = new THREE.Quaternion();
  plans.forEach((plan, index) => {
    const base = surfaceAt(plan.x, plan.z);
    _yq.setFromAxisAngle(UP, plan.yaw);
    const toWorld = (l: [number, number, number]) => new THREE.Vector3(...l).applyAxisAngle(UP, plan.yaw).add(new THREE.Vector3(plan.x, base, plan.z));
    for (const part of plan.ruin.parts) {
      const p = toWorld(part.pos);
      const chunk = chunkAt(p.x, p.z);
      let geometry: THREE.BufferGeometry;
      let quat: THREE.Quaternion;
      let scale: THREE.Vector3;
      if (part.shape === 'log') {
        geometry = logGeo;
        quat = _yq.clone().multiply(axisQuaternion(part.axis));
        scale = new THREE.Vector3(part.radius, part.length, part.radius);
      } else if (part.shape === 'box') {
        geometry = boxGeo;
        quat = _yq.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP, part.yaw));
        scale = new THREE.Vector3(...part.size);
      } else {
        geometry = rockGeo;
        quat = _yq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.euler)));
        scale = new THREE.Vector3(...part.scale);
      }
      _m.compose(p, quat, scale);
      chunk.props.add(geometry, _m, _c.set(part.color));
      chunk.propsLow.add(geometry, _m, _c.set(part.color));

      const rotation = { x: quat.x, y: quat.y, z: quat.z, w: quat.w };
      if (part.shape === 'log') {
        addCollider(RAPIER.ColliderDesc.cylinder(part.length / 2, part.radius).setTranslation(p.x, p.y, p.z).setRotation(rotation), part.surface === 'bark' ? SURFACES.bark : SURFACES.wood);
      } else if (part.shape === 'box') {
        if (part.collide) addCollider(RAPIER.ColliderDesc.cuboid(part.size[0] / 2, part.size[1] / 2, part.size[2] / 2).setTranslation(p.x, p.y, p.z).setRotation(rotation), SURFACES.wood);
      } else {
        const hull = new Float32Array(rockCorners.length * 3);
        rockCorners.forEach((v, k) => {
          _p.copy(v).applyMatrix4(_m);
          hull[k * 3] = _p.x;
          hull[k * 3 + 1] = _p.y;
          hull[k * 3 + 2] = _p.z;
        });
        const desc = RAPIER.ColliderDesc.convexHull(hull);
        if (desc) addCollider(desc, SURFACES.stone);
      }
    }
    pois.push({
      id: `poi-${index}`,
      type: plan.ruin.type,
      label: plan.ruin.label,
      x: plan.x,
      z: plan.z,
      yaw: plan.yaw,
      baseY: base,
      footprint: plan.ruin.footprint,
      loot: plan.ruin.loot.map((l) => {
        const w = toWorld(l.pos);
        return { kind: l.kind, x: w.x, y: w.y, z: w.z };
      }),
    });
  });

  // --- Grass tufts (visual only) ----------------------------------------------
  const tuftGeo = new THREE.ConeGeometry(0.05, 0.4, 3, 1, true).translate(0, 0.2, 0);
  for (const row of chunks) {
    for (const chunk of row) {
      for (let tries = 0, made = 0; made < 650 && tries < 1000; tries++) {
        const x = range(chunk.minX, chunk.maxX);
        const z = range(chunk.minZ, chunk.maxZ);
        if (!inside(x, z, 6)) continue;
        if (pads.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 0.3)) continue;
        if (slopeAt(x, z) > 0.7 || treeNear(x, z, 0.1)) continue;
        const s = range(0.6, 1.5);
        _q.setFromEuler(_e.set(range(-0.2, 0.2), rand() * 6.28, range(-0.2, 0.2)));
        _m.compose(_p.set(x, surfaceAt(x, z) - 0.02, z), _q, _s.set(s, s * range(0.8, 1.4), s));
        chunk.tufts.add(tuftGeo, _m, _c.setHSL(0.25 + range(-0.04, 0.04), 0.5, range(0.3, 0.45)));
        made++;
      }
    }
  }

  // --- One mesh per chunk for everything baked ---------------------------------
  const propsMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const tuftMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  for (const row of chunks) {
    for (const chunk of row) {
      if (!chunk.props.isEmpty) {
        chunk.propsMesh = new THREE.Mesh(chunk.props.build(), propsMaterial);
        chunk.propsMesh.frustumCulled = false;
        scene.add(chunk.propsMesh);
      }
      if (!chunk.propsLow.isEmpty) {
        chunk.propsLowMesh = new THREE.Mesh(chunk.propsLow.build(), propsMaterial);
        chunk.propsLowMesh.frustumCulled = false;
        chunk.propsLowMesh.visible = false;
        scene.add(chunk.propsLowMesh);
      }
      if (!chunk.tufts.isEmpty) {
        chunk.tuftsMesh = new THREE.Mesh(chunk.tufts.build(), tuftMaterial);
        chunk.tuftsMesh.frustumCulled = false;
        scene.add(chunk.tuftsMesh);
      }
    }
  }

  // --- Edge of the world: invisible walls behind the hills ----------------------
  const wall = WORLD_HALF + 0.5;
  for (const [x, z, hx, hz] of [
    [0, wall, WORLD_HALF + 1, 0.5],
    [0, -wall, WORLD_HALF + 1, 0.5],
    [wall, 0, 0.5, WORLD_HALF + 1],
    [-wall, 0, 0.5, WORLD_HALF + 1],
  ]) {
    addCollider(RAPIER.ColliderDesc.cuboid(hx, 60, hz).setTranslation(x, 0, z), SURFACES.stone);
  }

  let viewRadius = options.viewRadius ?? VIEW_RADIUS;
  let grassOn = options.grass ?? true;
  const update = (viewer: THREE.Vector3): void => {
    for (const row of chunks) {
      for (const c of row) {
        const dx = Math.max(c.minX - viewer.x, 0, viewer.x - c.maxX);
        const dz = Math.max(c.minZ - viewer.z, 0, viewer.z - c.maxZ);
        const d = Math.hypot(dx, dz);
        const shown = d < viewRadius;
        const detailed = d < DETAIL_RADIUS;
        c.terrain.high.visible = detailed;
        c.terrain.low.visible = shown && !detailed;
        if (c.propsMesh) c.propsMesh.visible = detailed;
        if (c.propsLowMesh) c.propsLowMesh.visible = shown && !detailed;
        if (c.tuftsMesh) c.tuftsMesh.visible = grassOn && d < GRASS_RADIUS;
      }
    }
  };
  update(new THREE.Vector3(spawn.x, 0, spawn.z));

  return {
    seed,
    pois,
    heightAt,
    surfaceAt,
    slopeAt,
    isBlocked: (x, z, pad = 0, ignoreSpawn = false) => blocked(x, z, pad, ignoreSpawn) || treeNear(x, z, pad),
    nearestTree,
    spawn: new THREE.Vector3(spawn.x, surfaceAt(spawn.x, spawn.z), spawn.z),
    trees,
    ropes,
    water: pads.map((p) => ({ x: p.x, z: p.z, r: p.r, ice: p.surface === SURFACES.ice })),
    update,
    setViewRadius: (metres) => void (viewRadius = metres),
    setGrass: (on) => void (grassOn = on),
    stats: { trees: trees.length, branches, rocks: rockCount, logs: logCount, ponds, puddles, colliders },
  };
}

/** The distinct corner points of a (non-indexed) polyhedron geometry. */
function uniqueVertices(geometry: THREE.BufferGeometry): THREE.Vector3[] {
  const pos = geometry.getAttribute('position');
  const seen = new Map<string, THREE.Vector3>();
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    seen.set(`${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`, v);
  }
  return [...seen.values()];
}
