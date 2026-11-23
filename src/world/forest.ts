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
  /** Chopped down: only a stump is left. */
  felled?: boolean;
}

interface TreeData extends Tree {
  y: number;
  pine: boolean;
  width: number;
  jungle: boolean;
  spin: number;
  spin2: number;
  bark: THREE.Color;
  foliage: THREE.Color;
  branches: Array<{ pos: THREE.Vector3; quat: THREE.Quaternion; len: number; collider: RAPIER.Collider }>;
  collider: RAPIER.Collider;
  felled: boolean;
}

/** A lake: where it is, how big, how high the water stands and whether something lives in it. */
/** A bush with berries on it. */
export interface Bush {
  x: number;
  y: number;
  z: number;
  r: number;
  hue: number;
  /** Where the berries sit. */
  fruit: Array<{ x: number; y: number; z: number }>;
}

export interface ForestLake {
  x: number;
  z: number;
  r: number;
  level: number;
  bed: number;
  croc: boolean;
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

/** Where a felled tree landed. */
export interface FellInfo {
  x: number;
  y: number;
  z: number;
  /** The way it fell (flat, unit). */
  dirX: number;
  dirZ: number;
  height: number;
  radius: number;
  pine: boolean;
}

export interface Forest {
  /** Lakes: deep water, with the odd crocodile. */
  lakes: ReadonlyArray<ForestLake>;
  /** The height of the water at (x, z) if it is under a lake, else null. */
  waterLevelAt(x: number, z: number): number | null;
  /** Fruit bushes. */
  bushes: ReadonlyArray<Bush>;
  /** Chops a tree down (it falls away from `fromX, fromZ`); `done` is called once it has landed. */
  fellTree(tree: Tree, fromX: number, fromZ: number, done: (landed: FellInfo) => void): boolean;
  /** Indices (into `trees`) of the felled trees, for the save. */
  felledIndices(): number[];
  restoreFelled(list: number[]): void;
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
  water: ReadonlyArray<{ x: number; z: number; r: number; ice: boolean; lake?: boolean }>;
  /** Shows the chunks near `viewer` and hides the rest. Call every frame (it is cheap). */
  update(viewer: THREE.Vector3, dt?: number): void;
  /** Changes how far chunks are drawn. */
  setViewRadius(metres: number): void;
  setGrass(on: boolean): void;
  stats: { trees: number; branches: number; rocks: number; logs: number; ponds: number; puddles: number; colliders: number };
}

/** Chunks nearer than this (metres, to their nearest edge) are drawn. Fog hides the cut-off. */
export const VIEW_RADIUS = 78;
/** Chunks nearer than this get full detail; farther ones get a cheaper version. */
const DETAIL_RADIUS = 30;
/** Grass tufts are only drawn this close. */
const GRASS_RADIUS = 34;

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
  /** The trees (apart from other props, so a felled one can be taken out). */
  treesMesh?: THREE.Mesh;
  treesLowMesh?: THREE.Mesh;
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

  const addCollider = (desc: RAPIER.ColliderDesc, surface: SurfaceMaterial): RAPIER.Collider => {
    const collider = world.createCollider(desc.setCollisionGroups(WORLD_GROUPS).setFriction(0.9));
    setSurface(collider, surface);
    colliders++;
    return collider;
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

  // --- Lakes ---------------------------------------------------------------------
  // Deep bowls with flat water. The first is a walk from the start; about one in ten has a crocodile.
  const lakes: ForestLake[] = [];
  const addLake = (near: boolean): void => {
    for (let tries = 0; tries < 400; tries++) {
      const r = range(13, 26);
      let x: number;
      let z: number;
      if (near) {
        const a = rand() * Math.PI * 2;
        const d = range(70, 115);
        x = spawn.x + Math.cos(a) * d;
        z = spawn.z + Math.sin(a) * d;
      } else {
        x = range(-WORLD_HALF + r + 45, WORLD_HALF - r - 45);
        z = range(-WORLD_HALF + r + 45, WORLD_HALF - r - 45);
      }
      if (!inside(x, z, r + 40) || Math.hypot(x - spawn.x, z - spawn.z) < r + 50) continue;
      if (terrain.slopeAt(x, z) > 0.2) continue;
      if (lakes.some((l) => Math.hypot(l.x - x, l.z - z) < l.r + r + 40)) continue;
      if (!farFromOthers(x, z, r + 12)) continue;
      const lake = terrain.addLake(x, z, r);
      keepouts.push({ x, z, r: r + 9 });
      lakes.push({ ...lake, croc: rand() < 0.1 });
      return;
    }
  };
  addLake(true);
  for (let i = 0; i < 8; i++) addLake(false);
  const inLake = (x: number, z: number, margin = 0) => lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + 8 + margin);

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
      if (!inside(x, z, 45) || terrain.slopeAt(x, z) > 0.22) continue;
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
      const pine = rand() < 0.55;
      // Tall and thick, with the odd giant.
      const giant = rand() < 0.07;
      const height = (pine ? range(16, 28) : range(11, 19)) * (giant ? 1.3 : 1);
      const jungle = !pine && rand() < 0.5; // broadleaf trees: half are lush, with vines and dense crowns
      trees.push({
        x,
        z,
        y: surfaceAt(x, z) - 0.35,
        height,
        radius: (0.34 + height * 0.024 + range(0, 0.2)) * (giant ? 1.5 : 1),
        pine,
        width: range(0.85, 1.25),
        jungle,
        spin: rand() * 6.28,
        spin2: rand() * 6.28,
        bark: new THREE.Color().setHSL(0.07 + range(-0.01, 0.015), 0.35, range(0.2, 0.3)),
        foliage: pine
          ? new THREE.Color().setHSL(0.36 + range(-0.02, 0.02), 0.45, range(0.16, 0.25))
          : new THREE.Color().setHSL(jungle ? 0.31 + range(-0.04, 0.03) : 0.27 + range(-0.03, 0.03), jungle ? 0.62 : 0.5, range(0.24, 0.36)),
        branches: [],
        collider: null as unknown as RAPIER.Collider,
        felled: false,
      });
    }
  }
  const chunkTrees = new Map<Chunk, TreeData[]>();
  const propsMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  const trunkGeo = new THREE.CylinderGeometry(0.72, 1, 1, 6, 1, true).translate(0, 0.5, 0); // open ended: both ends are hidden
  const stumpGeo = new THREE.CylinderGeometry(0.72, 1, 1, 6).translate(0, 0.5, 0);
  const pineGeo = mergeGeometries([
    new THREE.ConeGeometry(0.2, 0.45, 6).translate(0, 0.4, 0),
    new THREE.ConeGeometry(0.16, 0.4, 6).translate(0, 0.62, 0),
    new THREE.ConeGeometry(0.11, 0.35, 6).translate(0, 0.82, 0),
  ])!;
  const leafGeo = new THREE.SphereGeometry(1, 6, 4);
  const vineGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 1, true).translate(0, -0.5, 0);
  // Far-away versions: one cone for a pine, a plain 20-sided blob for a broadleaf.
  const pineLowGeo = new THREE.ConeGeometry(0.2, 0.75, 5).translate(0, 0.55, 0);
  const leafLowGeo = new THREE.IcosahedronGeometry(1, 0);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const VINE = new THREE.Color(0x2f6f2a);
  let branches = 0;
  for (const t of trees) {
    const chunk = chunkAt(t.x, t.z);
    const list = chunkTrees.get(chunk);
    if (list) list.push(t);
    else chunkTrees.set(chunk, [t]);
    const trunkH = t.height + 0.35;
    t.collider = addCollider(RAPIER.ColliderDesc.cylinder(trunkH / 2, t.radius * 0.86).setTranslation(t.x, t.y + trunkH / 2, t.z), SURFACES.bark);

    // Low branches to grab and climb on.
    if (rand() > 0.55) continue;
    const count = 1 + Math.floor(rand() * 2);
    for (let b = 0; b < count; b++) {
      const angle = rand() * Math.PI * 2;
      const len = range(0.9, 1.6);
      const quat = new THREE.Quaternion()
        .setFromAxisAngle(UP, Math.atan2(Math.cos(angle), Math.sin(angle)))
        .multiply(_qa.setFromAxisAngle(X_AXIS, -range(0.1, 0.35))); // outer end rises
      const reach = t.radius * 0.5 + len / 2;
      const pos = new THREE.Vector3(t.x + Math.cos(angle) * reach, t.y + 0.35 + range(0.9, 5.5), t.z + Math.sin(angle) * reach); // the higher ones you climb up to
      const collider = addCollider(
        RAPIER.ColliderDesc.cuboid(0.07, 0.07, len / 2)
          .setTranslation(pos.x, pos.y, pos.z)
          .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }),
        SURFACES.wood,
      );
      t.branches.push({ pos, quat, len, collider });
      branches++;
    }
  }

  /** (Re)builds the baked trees of a chunk: trunks, crowns, branches, and stumps for felled ones. */
  const bakeTrees = (chunk: Chunk): void => {
    const high = new Baker();
    const low = new Baker();
    for (const t of chunkTrees.get(chunk) ?? []) {
      if (t.felled) {
        _m.compose(_p.set(t.x, t.y, t.z), _q.setFromAxisAngle(UP, t.spin), _s.set(t.radius, 0.45, t.radius));
        high.add(stumpGeo, _m, t.bark);
        low.add(stumpGeo, _m, t.bark);
        continue;
      }
      const trunkH = t.height + 0.35;
      _m.compose(_p.set(t.x, t.y, t.z), _q.setFromAxisAngle(UP, t.spin), _s.set(t.radius, trunkH, t.radius));
      high.add(trunkGeo, _m, t.bark);
      if (!t.pine) low.add(trunkGeo, _m, t.bark);
      if (t.pine) {
        const w = t.height * t.width * 0.75;
        _m.compose(_p.set(t.x, t.y + 0.35, t.z), _q.setFromAxisAngle(UP, t.spin2), _s.set(w, t.height, w));
        high.add(pineGeo, _m, t.foliage);
        low.add(pineLowGeo, _m, t.foliage);
      } else {
        // A crown of blobs: one big in the middle and a few around it. Lush trees have more, and hang vines.
        const w = t.height * (t.jungle ? 0.3 : 0.24) * t.width;
        const cy = t.y + 0.35 + t.height * 0.78;
        _m.compose(_p.set(t.x, cy, t.z), _q.setFromAxisAngle(UP, t.spin2), _s.set(w, w * 0.8, w));
        high.add(leafGeo, _m, t.foliage);
        low.add(leafLowGeo, _m, t.foliage);
        const extra = t.jungle ? 4 : 2;
        for (let k = 0; k < extra; k++) {
          const a = t.spin + (k / extra) * Math.PI * 2;
          const ox = Math.cos(a) * w * 0.7;
          const oz = Math.sin(a) * w * 0.7;
          const sw = w * 0.62;
          _m.compose(_p.set(t.x + ox, cy - w * 0.15 + Math.sin(a * 3) * w * 0.15, t.z + oz), _q.identity(), _s.set(sw, sw * 0.75, sw));
          high.add(leafLowGeo, _m, _c.copy(t.foliage).offsetHSL(0.01 * k, 0, 0.02 * (k % 2)));
          if (t.jungle && k < 3) {
            const vl = t.height * 0.35 + (k % 2) * 3;
            _m.compose(_p.set(t.x + ox * 1.15, cy - w * 0.3, t.z + oz * 1.15), _q.identity(), _s.set(0.04, vl, 0.04));
            high.add(vineGeo, _m, VINE);
          }
        }
      }
      for (const b of t.branches) {
        _m.compose(b.pos, b.quat, _s.set(0.11, 0.11, b.len));
        high.add(boxGeo, _m, _c.set(SURFACES.wood.color));
      }
    }
    const swap = (current: THREE.Mesh | undefined, baker: Baker, visible: boolean): THREE.Mesh | undefined => {
      if (baker.isEmpty) return current;
      if (current) {
        current.geometry.dispose();
        current.geometry = baker.build();
        return current;
      }
      const mesh = new THREE.Mesh(baker.build(), propsMaterial);
      mesh.frustumCulled = false;
      mesh.visible = visible;
      scene.add(mesh);
      return mesh;
    };
    chunk.treesMesh = swap(chunk.treesMesh, high, true);
    chunk.treesLowMesh = swap(chunk.treesLowMesh, low, false);
  };

  // Ropes hanging down some of the bigger trunks, ending within reach of the ground.
  const ropes: RopeSpot[] = [];
  const addRope = (t: TreeData) => {
    const angle = rand() * Math.PI * 2;
    const x = t.x + Math.cos(angle) * (t.radius + 0.05);
    const z = t.z + Math.sin(angle) * (t.radius + 0.05);
    const ground = surfaceAt(x, z);
    ropes.push({ x, z, top: ground + Math.min(t.height * 0.5, 9), bottom: ground + range(1.15, 1.4) });
  };
  for (const t of trees) if (t.radius > 0.5 && rand() < 0.13) addRope(t);
  // Always a few close to where you start.
  const byDistance = [...trees].sort((p, q) => Math.hypot(p.x - spawn.x, p.z - spawn.z) - Math.hypot(q.x - spawn.x, q.z - spawn.z));
  let nearRopes = ropes.filter((r) => Math.hypot(r.x - spawn.x, r.z - spawn.z) < 45).length;
  for (const t of byDistance) {
    if (nearRopes >= 9) break;
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
          if (!o.tree || o.tree.felled) continue;
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
        if (pads.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 0.3) || inLake(x, z, -4)) continue;
        if (slopeAt(x, z) > 0.7 || treeNear(x, z, 0.1)) continue;
        const s = range(0.6, 1.5);
        _q.setFromEuler(_e.set(range(-0.2, 0.2), rand() * 6.28, range(-0.2, 0.2)));
        _m.compose(_p.set(x, surfaceAt(x, z) - 0.02, z), _q, _s.set(s, s * range(0.8, 1.4), s));
        chunk.tufts.add(tuftGeo, _m, _c.setHSL(0.25 + range(-0.04, 0.04), 0.5, range(0.3, 0.45)));
        made++;
      }
    }
  }

  // --- Leaf litter, ferns, flowers and fruit bushes --------------------------------
  const leafLitterGeo = new THREE.PlaneGeometry(0.13, 0.2).rotateX(-Math.PI / 2);
  const fernGeo = mergeGeometries(
    [0, 1, 2].map((k) => {
      const g = new THREE.ConeGeometry(0.09, 0.8, 3, 1, true).scale(1, 1, 0.35).translate(0, 0.4, 0);
      g.rotateZ(0.85); // leans out
      g.rotateY((k / 3) * Math.PI * 2);
      return g;
    }),
  )!;
  const bloomGeo = new THREE.IcosahedronGeometry(0.06, 0).translate(0, 0.32, 0);
  const stemGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.32, 3).translate(0, 0.16, 0);
  const LEAF_COLORS = [0xb8761e, 0xd39a2b, 0x9c4a1c, 0x7a8a2a, 0x5f8a2c, 0xc2562a];
  const BLOOMS = [0xe0405a, 0xf0d040, 0xb060d8, 0xf08a2a, 0xffffff];
  const bushes: Bush[] = [];
  for (const row of chunks) {
    for (const chunk of row) {
      for (let tries = 0, made = 0; made < 260 && tries < 600; tries++) {
        const x = range(chunk.minX, chunk.maxX);
        const z = range(chunk.minZ, chunk.maxZ);
        if (!inside(x, z, 6) || inLake(x, z, -4) || slopeAt(x, z) > 0.6 || treeNear(x, z, 0.1)) continue;
        // Fallen leaves gather under the broadleaf trees.
        const under = !!nearestTree(x, z, 3);
        if (!under && rand() < 0.55) continue;
        _q.setFromEuler(_e.set(range(-0.15, 0.15), rand() * 6.28, range(-0.15, 0.15)));
        const sc = range(0.7, 1.5);
        _m.compose(_p.set(x, surfaceAt(x, z) + 0.015, z), _q, _s.set(sc, 1, sc));
        chunk.tufts.add(leafLitterGeo, _m, _c.set(LEAF_COLORS[Math.floor(rand() * LEAF_COLORS.length)]).offsetHSL(0, 0, range(-0.05, 0.05)));
        made++;
      }
      for (let tries = 0, made = 0; made < 60 && tries < 300; tries++) {
        const x = range(chunk.minX, chunk.maxX);
        const z = range(chunk.minZ, chunk.maxZ);
        if (!inside(x, z, 6) || inLake(x, z, -4) || slopeAt(x, z) > 0.6 || treeNear(x, z, 0.3)) continue;
        const s = range(0.7, 1.5);
        _q.setFromAxisAngle(UP, rand() * 6.28);
        _m.compose(_p.set(x, surfaceAt(x, z) - 0.02, z), _q, _s.set(s, s, s));
        chunk.tufts.add(fernGeo, _m, _c.setHSL(0.3 + range(-0.03, 0.03), 0.6, range(0.2, 0.3)));
        if (rand() < 0.2) {
          const bx = x + range(-1, 1);
          const bz = z + range(-1, 1);
          _m.compose(_p.set(bx, surfaceAt(bx, bz), bz), _q.identity(), _s.set(1, 1, 1));
          chunk.tufts.add(stemGeo, _m, _c.set(0x3f7a30));
          chunk.tufts.add(bloomGeo, _m, _c.set(BLOOMS[Math.floor(rand() * BLOOMS.length)]));
        }
        made++;
      }
      // Fruit bushes: a few green mounds with berries you can pick.
      for (let tries = 0, made = 0; made < 9 && tries < 200; tries++) {
        const x = range(chunk.minX, chunk.maxX);
        const z = range(chunk.minZ, chunk.maxZ);
        if (!inside(x, z, 8) || blocked(x, z, 1, true) || inLake(x, z, 1) || slopeAt(x, z) > 0.4 || treeNear(x, z, 1.4)) continue;
        const r = range(0.5, 0.8);
        const y = surfaceAt(x, z);
        const bush: Bush = { x, y, z, r, hue: [0.0, 0.07, 0.78, 0.14][Math.floor(rand() * 4)], fruit: [] };
        const green = _c.setHSL(0.3 + range(-0.03, 0.03), 0.55, range(0.2, 0.3));
        for (let k = 0; k < 3; k++) {
          const a = k * 2.1 + rand();
          const br = r * range(0.55, 0.8);
          _m.compose(_p.set(x + Math.cos(a) * r * 0.35, y + br * 0.6, z + Math.sin(a) * r * 0.35), _q.identity(), _s.set(br, br * 0.8, br));
          chunk.props.add(leafGeo, _m, green);
        }
        const berries = 3 + Math.floor(rand() * 3);
        for (let k = 0; k < berries; k++) {
          const a = rand() * 6.28;
          const rr = r * range(0.7, 0.95);
          bush.fruit.push({ x: x + Math.cos(a) * rr, y: y + range(0.25, r * 1.1), z: z + Math.sin(a) * rr });
        }
        bushes.push(bush);
        made++;
      }
    }
  }

  // --- Water: a flat, see-through disc over each lake ---------------------------------
  const waterMaterial = new THREE.MeshLambertMaterial({ color: 0x2c7189, transparent: true, opacity: 0.78, depthWrite: false });
  const lakeMeshes = lakes.map((lake) => {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(lake.r + 7, 40).rotateX(-Math.PI / 2), waterMaterial);
    mesh.position.set(lake.x, lake.level, lake.z);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    scene.add(mesh);
    return mesh;
  });
  const waterLevelAt = (x: number, z: number): number | null => {
    for (const l of lakes) {
      if (Math.hypot(x - l.x, z - l.z) < l.r + 7 && surfaceAt(x, z) < l.level) return l.level;
    }
    return null;
  };

  // --- One mesh per chunk for everything baked ---------------------------------
  const tuftMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  for (const row of chunks) {
    for (const chunk of row) {
      bakeTrees(chunk);
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

  // --- Felling trees -----------------------------------------------------------------
  interface Falling {
    group: THREE.Group;
    t: number;
    axis: THREE.Vector3;
    done: (landed: FellInfo) => void;
    info: FellInfo;
  }
  const falling: Falling[] = [];
  /** Takes the tree out of the world, leaving a stump. */
  const applyFelled = (t: TreeData): void => {
    t.felled = true;
    world.removeCollider(t.collider, true);
    for (const b of t.branches) world.removeCollider(b.collider, true);
    t.branches.length = 0;
    t.collider = addCollider(RAPIER.ColliderDesc.cylinder(0.225, t.radius * 0.86).setTranslation(t.x, t.y + 0.225, t.z), SURFACES.bark);
    bakeTrees(chunkAt(t.x, t.z));
  };
  const restoreFelled = (list: number[]): void => {
    const touched = new Set<Chunk>();
    for (const i of list) {
      const t = trees[i];
      if (!t || t.felled) continue;
      t.felled = true;
      world.removeCollider(t.collider, true);
      for (const b of t.branches) world.removeCollider(b.collider, true);
      t.branches.length = 0;
      t.collider = addCollider(RAPIER.ColliderDesc.cylinder(0.225, t.radius * 0.86).setTranslation(t.x, t.y + 0.225, t.z), SURFACES.bark);
      touched.add(chunkAt(t.x, t.z));
    }
    for (const c of touched) bakeTrees(c);
  };
  const fellTree = (tree: Tree, fromX: number, fromZ: number, done: (landed: FellInfo) => void): boolean => {
    const t = tree as TreeData;
    if (!trees.includes(t) || t.felled) return false;
    applyFelled(t);

    // It falls away from you.
    let dx = t.x - fromX;
    let dz = t.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const group = new THREE.Group();
    group.position.set(t.x, t.y, t.z);
    const wood = new THREE.MeshLambertMaterial({ color: t.bark, flatShading: true });
    const trunk = new THREE.Mesh(trunkGeo, wood);
    trunk.scale.set(t.radius, t.height + 0.35, t.radius);
    group.add(trunk);
    const crownMaterial = new THREE.MeshLambertMaterial({ color: t.foliage, flatShading: true });
    if (t.pine) {
      const crown = new THREE.Mesh(pineGeo, crownMaterial);
      const w = t.height * t.width * 0.75;
      crown.scale.set(w, t.height, w);
      crown.position.y = 0.35;
      group.add(crown);
    } else {
      const w = t.height * (t.jungle ? 0.3 : 0.24) * t.width;
      const crown = new THREE.Mesh(leafGeo, crownMaterial);
      crown.scale.set(w, w * 0.8, w);
      crown.position.y = 0.35 + t.height * 0.78;
      group.add(crown);
    }
    scene.add(group);
    falling.push({
      group,
      t: 0,
      axis: new THREE.Vector3(dz, 0, -dx),
      done,
      info: { x: t.x, y: t.y + 0.35, z: t.z, dirX: dx, dirZ: dz, height: t.height, radius: t.radius, pine: t.pine },
    });
    return true;
  };
  const FALL_SECONDS = 2.6;
  const stepFalling = (dt: number): void => {
    for (let i = falling.length - 1; i >= 0; i--) {
      const f = falling[i];
      f.t += dt / FALL_SECONDS;
      const k = Math.min(1, f.t);
      // Creaks over slowly, then speeds up and thumps down.
      const angle = (Math.PI / 2 - 0.04) * (k * k * k) + Math.sin(f.t * 30) * 0.01 * (1 - k);
      f.group.quaternion.setFromAxisAngle(f.axis, angle);
      if (f.t >= 1) {
        scene.remove(f.group);
        f.group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) (m.material as THREE.Material).dispose();
        });
        falling.splice(i, 1);
        f.done(f.info);
      }
    }
  };

  let viewRadius = options.viewRadius ?? VIEW_RADIUS;
  let grassOn = options.grass ?? true;
  const update = (viewer: THREE.Vector3, dt = 0): void => {
    if (dt > 0) stepFalling(dt);
    lakes.forEach((l, i) => (lakeMeshes[i].visible = Math.hypot(l.x - viewer.x, l.z - viewer.z) < viewRadius + l.r + 30));
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
        if (c.treesMesh) c.treesMesh.visible = detailed;
        if (c.treesLowMesh) c.treesLowMesh.visible = shown && !detailed;
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
    water: [
      ...pads.map((p) => ({ x: p.x, z: p.z, r: p.r, ice: p.surface === SURFACES.ice })),
      ...lakes.map((l) => ({ x: l.x, z: l.z, r: l.r + 3, ice: false, lake: true })),
    ],
    lakes,
    waterLevelAt,
    bushes,
    fellTree,
    felledIndices: () => trees.flatMap((t, i) => (t.felled ? [i] : [])),
    restoreFelled,
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
