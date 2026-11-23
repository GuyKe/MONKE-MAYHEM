import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SPAWN } from '../config';
import { RAPIER, WORLD_GROUPS } from '../physics';
import { SURFACES, setSurface, type SurfaceMaterial } from './materials';
import { Noise2D, mulberry32, smoothstep } from './noise';
import { WORLD_HALF, createTerrain } from './terrain';

export interface Forest {
  heightAt(x: number, z: number): number;
  /** Sky dome. Parent it to the player rig so it always surrounds the player. */
  sky: THREE.Object3D;
  /** Where the player starts, standing on the ground. */
  spawn: THREE.Vector3;
  /** Every tree trunk: ground position, height and radius. */
  trees: ReadonlyArray<{ x: number; z: number; height: number; radius: number }>;
  stats: { trees: number; branches: number; rocks: number; logs: number; colliders: number };
}

const HORIZON = 0xcfe3d8;
const FOG_DENSITY = 0.017;

/** A circle trees, rocks and grass keep out of. */
interface Keepout {
  x: number;
  z: number;
  r: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Builds the forest: terrain, trees, rocks, logs, grass, an ice pond and mud
 * puddles, with sky and fog. Everything repeating is instanced, so the whole
 * forest is about ten draw calls. The same seed always gives the same forest.
 */
export function buildForest(scene: THREE.Scene, world: RAPIER.World, seed = 1337): Forest {
  const noise = new Noise2D(seed);
  const rand = mulberry32(seed + 1);
  const range = (a: number, b: number) => a + rand() * (b - a);
  const terrain = createTerrain(noise);
  const keepouts: Keepout[] = [{ x: SPAWN.x, z: SPAWN.z, r: 9 }];
  let colliders = 0;

  const addCollider = (desc: RAPIER.ColliderDesc, surface: SurfaceMaterial): void => {
    setSurface(world.createCollider(desc.setCollisionGroups(WORLD_GROUPS).setFriction(0.9)), surface);
    colliders++;
  };

  // --- Slippery spots ---------------------------------------------------------
  // Flat discs lying on flat ground: a frozen pond and mud puddles. Two small
  // ones sit by the spawn so the slip is easy to try straight away.
  const pads: Array<{ x: number; z: number; r: number; surface: SurfaceMaterial; level: number }> = [];
  const addPad = (x: number, z: number, r: number, surface: SurfaceMaterial, inner = r + 0.8, outer = r + 3) => {
    const spot = terrain.addFlatSpot({ x, z, inner, outer });
    pads.push({ x, z, r, surface, level: spot.level });
    keepouts.push({ x, z, r: outer });
  };
  addPad(-27, -23, 5.5, SURFACES.ice, 7, 13); // frozen pond
  addPad(-5.5, 9, 2.3, SURFACES.ice, 3.2, 4.5); // frozen puddle by the spawn
  addPad(5.5, 9.5, 2.2, SURFACES.mud, 3, 4.5); // mud by the spawn
  for (let tries = 0, made = 0; made < 7 && tries < 200; tries++) {
    const a = rand() * Math.PI * 2;
    const d = range(16, 48);
    const x = SPAWN.x + Math.cos(a) * d;
    const z = SPAWN.z + Math.sin(a) * d;
    if (Math.abs(x) > WORLD_HALF - 24 || Math.abs(z) > WORLD_HALF - 24) continue;
    if (terrain.slopeAt(x, z) > 0.25) continue;
    if (keepouts.some((k) => Math.hypot(x - k.x, z - k.z) < k.r + 6)) continue;
    addPad(x, z, range(1.4, 2.4), SURFACES.mud, 3, 4.5);
    made++;
  }

  terrain.build(scene, world);
  const heightAt = terrain.heightAt;

  for (const pad of pads) {
    const h = 0.03;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(pad.r, pad.r, h, 32),
      pad.surface === SURFACES.ice
        ? new THREE.MeshPhongMaterial({ color: pad.surface.color, specular: 0xffffff, shininess: 90 })
        : new THREE.MeshLambertMaterial({ color: pad.surface.color }),
    );
    mesh.position.set(pad.x, pad.level + h / 2, pad.z);
    scene.add(mesh);
    addCollider(RAPIER.ColliderDesc.cylinder(h / 2, pad.r).setTranslation(pad.x, pad.level + h / 2, pad.z), pad.surface);
  }

  const blocked = (x: number, z: number, pad = 0): boolean =>
    keepouts.some((k) => Math.hypot(x - k.x, z - k.z) < k.r + pad);

  // --- Trees ------------------------------------------------------------------
  interface Tree {
    x: number;
    z: number;
    y: number;
    height: number;
    radius: number;
    pine: boolean;
    width: number;
  }
  const trees: Tree[] = [];
  const SPACING = 5.5;
  for (let gx = -WORLD_HALF + 2; gx < WORLD_HALF - 1; gx += SPACING) {
    for (let gz = -WORLD_HALF + 2; gz < WORLD_HALF - 1; gz += SPACING) {
      const x = gx + range(-2, 2);
      const z = gz + range(-2, 2);
      if (Math.abs(x) > WORLD_HALF - 3 || Math.abs(z) > WORLD_HALF - 3) continue;
      if (blocked(x, z, 1.2) || terrain.slopeAt(x, z) > 0.6) continue;
      const density = 0.5 + 0.5 * noise.fbm(x * 0.03 + 5, z * 0.03 - 9, 2);
      const edge = Math.max(Math.abs(x), Math.abs(z));
      const chance = edge > WORLD_HALF - 22 ? 0.95 : 0.3 + 0.6 * density;
      if (rand() > chance) continue;
      const pine = rand() < 0.6;
      const height = pine ? range(8, 14) : range(6, 10);
      trees.push({
        x,
        z,
        y: heightAt(x, z) - 0.35,
        height,
        radius: 0.2 + (height - 6) * 0.022 + range(0, 0.06),
        pine,
        width: range(0.85, 1.25),
      });
    }
  }

  const trunkGeo = new THREE.CylinderGeometry(0.72, 1, 1, 6).translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ flatShading: true }), trees.length);

  const pineGeo = mergeGeometries([
    new THREE.ConeGeometry(0.2, 0.45, 6).translate(0, 0.4, 0),
    new THREE.ConeGeometry(0.16, 0.4, 6).translate(0, 0.62, 0),
    new THREE.ConeGeometry(0.11, 0.35, 6).translate(0, 0.82, 0),
  ])!;
  const leafGeo = new THREE.IcosahedronGeometry(1, 1);
  const pines = trees.filter((t) => t.pine);
  const broads = trees.filter((t) => !t.pine);
  const pineMesh = new THREE.InstancedMesh(pineGeo, new THREE.MeshLambertMaterial({ flatShading: true }), pines.length);
  const leafMesh = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ flatShading: true }), broads.length);

  trees.forEach((t, i) => {
    _m.compose(_p.set(t.x, t.y, t.z), _q.setFromAxisAngle(UP, rand() * 6.28), _s.set(t.radius, t.height + 0.35, t.radius));
    trunks.setMatrixAt(i, _m);
    trunks.setColorAt(i, _c.setHSL(0.07 + range(-0.01, 0.015), 0.35, range(0.2, 0.3)));
    addCollider(
      RAPIER.ColliderDesc.cylinder((t.height + 0.35) / 2, t.radius * 0.86).setTranslation(t.x, t.y + (t.height + 0.35) / 2, t.z),
      SURFACES.bark,
    );
  });
  pines.forEach((t, i) => {
    const w = t.height * t.width;
    _m.compose(_p.set(t.x, t.y + 0.35, t.z), _q.setFromAxisAngle(UP, rand() * 6.28), _s.set(w, t.height, w));
    pineMesh.setMatrixAt(i, _m);
    pineMesh.setColorAt(i, _c.setHSL(0.36 + range(-0.02, 0.02), 0.45, range(0.16, 0.25)));
  });
  broads.forEach((t, i) => {
    const w = t.height * 0.27 * t.width;
    _m.compose(
      _p.set(t.x, t.y + 0.35 + t.height * 0.78, t.z),
      _q.setFromAxisAngle(UP, rand() * 6.28),
      _s.set(w, w * 0.8, w),
    );
    leafMesh.setMatrixAt(i, _m);
    leafMesh.setColorAt(i, _c.setHSL(0.27 + range(-0.03, 0.03), 0.5, range(0.26, 0.36)));
  });

  // Low branches to grab and climb on.
  const branchData: Array<{ pos: THREE.Vector3; quat: THREE.Quaternion; len: number }> = [];
  for (const t of trees) {
    if (rand() > 0.6) continue;
    const count = 1 + Math.floor(rand() * 2);
    for (let b = 0; b < count; b++) {
      const angle = rand() * Math.PI * 2;
      const len = range(0.9, 1.6);
      const yawQ = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(Math.cos(angle), Math.sin(angle)));
      const tilt = new THREE.Quaternion().setFromAxisAngle(X_AXIS, -range(0.1, 0.35)); // outer end rises
      const reach = t.radius * 0.5 + len / 2;
      branchData.push({
        pos: new THREE.Vector3(
          t.x + Math.cos(angle) * reach,
          t.y + 0.35 + range(0.9, 2.4),
          t.z + Math.sin(angle) * reach,
        ),
        quat: yawQ.multiply(tilt),
        len,
      });
    }
  }
  const branches = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: SURFACES.wood.color, flatShading: true }),
    branchData.length,
  );
  branchData.forEach((b, i) => {
    _m.compose(b.pos, b.quat, _s.set(0.11, 0.11, b.len));
    branches.setMatrixAt(i, _m);
    addCollider(
      RAPIER.ColliderDesc.cuboid(0.07, 0.07, b.len / 2)
        .setTranslation(b.pos.x, b.pos.y, b.pos.z)
        .setRotation({ x: b.quat.x, y: b.quat.y, z: b.quat.z, w: b.quat.w }),
      SURFACES.wood,
    );
  });

  // --- Rocks ------------------------------------------------------------------
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockCorners = uniqueVertices(rockGeo);
  const rockSpots: Array<{ x: number; z: number }> = [];
  for (let tries = 0; rockSpots.length < 70 && tries < 1500; tries++) {
    const x = range(-WORLD_HALF + 4, WORLD_HALF - 4);
    const z = range(-WORLD_HALF + 4, WORLD_HALF - 4);
    const nearSpawn = rockSpots.length < 5;
    if (nearSpawn) {
      const a = rand() * 6.28;
      const d = range(11, 15);
      const nx = SPAWN.x + Math.cos(a) * d;
      const nz = SPAWN.z + Math.sin(a) * d;
      if (!blocked(nx, nz, 1)) rockSpots.push({ x: nx, z: nz });
      continue;
    }
    if (blocked(x, z, 1) || terrain.slopeAt(x, z) > 0.8) continue;
    rockSpots.push({ x, z });
  }
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ flatShading: true }), rockSpots.length);
  let rockCount = 0;
  rockSpots.forEach((spot, i) => {
    const s = 0.5 + rand() * rand() * 2;
    const sx = s * range(0.8, 1.3);
    const sy = s * range(0.55, 0.85);
    const sz = s * range(0.8, 1.3);
    const y = heightAt(spot.x, spot.z) + sy * 0.3;
    _q.setFromEuler(new THREE.Euler(range(-0.2, 0.2), rand() * 6.28, range(-0.2, 0.2)));
    _m.compose(_p.set(spot.x, y, spot.z), _q, _s.set(sx, sy, sz));
    rocks.setMatrixAt(i, _m);
    rocks.setColorAt(i, _c.setHSL(0.1, 0.05, range(0.35, 0.5)));
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
      rockCount++;
    }
  });

  // --- Fallen logs ------------------------------------------------------------
  const logSpots: Array<{ x: number; z: number; len: number; r: number; yaw: number }> = [];
  for (let tries = 0; logSpots.length < 16 && tries < 600; tries++) {
    const x = range(-WORLD_HALF + 8, WORLD_HALF - 8);
    const z = range(-WORLD_HALF + 8, WORLD_HALF - 8);
    if (blocked(x, z, 2) || terrain.slopeAt(x, z) > 0.18) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.2)) continue;
    logSpots.push({ x, z, len: range(2.5, 5.5), r: range(0.22, 0.4), yaw: rand() * 6.28 });
  }
  const logGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const logs = new THREE.InstancedMesh(logGeo, new THREE.MeshLambertMaterial({ flatShading: true }), logSpots.length);
  logSpots.forEach((l, i) => {
    // The cylinder's axis is Y; lay it along X, then turn it.
    _q.setFromAxisAngle(UP, l.yaw).multiply(_qa.setFromAxisAngle(Z_AXIS, Math.PI / 2));
    const y = heightAt(l.x, l.z) + l.r * 0.7;
    _m.compose(_p.set(l.x, y, l.z), _q, _s.set(l.r, l.len, l.r));
    logs.setMatrixAt(i, _m);
    logs.setColorAt(i, _c.setHSL(0.07, 0.3, range(0.17, 0.26)));
    addCollider(
      RAPIER.ColliderDesc.cylinder(l.len / 2, l.r)
        .setTranslation(l.x, y, l.z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }),
      SURFACES.bark,
    );
  });

  // --- Grass tufts (visual only) ----------------------------------------------
  const tuftGeo = new THREE.ConeGeometry(0.05, 0.4, 3, 1, true).translate(0, 0.2, 0);
  const TUFTS = 5000;
  const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), TUFTS);
  let tuftCount = 0;
  for (let tries = 0; tuftCount < TUFTS && tries < TUFTS * 3; tries++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * 55;
    const x = SPAWN.x + Math.cos(a) * d;
    const z = SPAWN.z + Math.sin(a) * d;
    if (Math.abs(x) > WORLD_HALF - 6 || Math.abs(z) > WORLD_HALF - 6) continue;
    if (pads.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 0.3)) continue;
    if (terrain.slopeAt(x, z) > 0.7 || trees.some((t) => Math.hypot(t.x - x, t.z - z) < t.radius + 0.1)) continue;
    const s = range(0.6, 1.5);
    _q.setFromEuler(new THREE.Euler(range(-0.2, 0.2), rand() * 6.28, range(-0.2, 0.2)));
    _m.compose(_p.set(x, heightAt(x, z) - 0.02, z), _q, _s.set(s, s * range(0.8, 1.4), s));
    tufts.setMatrixAt(tuftCount, _m);
    tufts.setColorAt(tuftCount, _c.setHSL(0.25 + range(-0.04, 0.04), 0.5, range(0.3, 0.45)));
    tuftCount++;
  }
  tufts.count = tuftCount;

  for (const mesh of [trunks, pineMesh, leafMesh, branches, rocks, logs, tufts]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false; // instances are spread over the whole map
    scene.add(mesh);
  }

  // --- Edge of the world: invisible walls behind the hills ----------------------
  const wall = WORLD_HALF + 0.5;
  for (const [x, z, hx, hz] of [
    [0, wall, WORLD_HALF + 1, 0.5],
    [0, -wall, WORLD_HALF + 1, 0.5],
    [wall, 0, 0.5, WORLD_HALF + 1],
    [-wall, 0, 0.5, WORLD_HALF + 1],
  ]) {
    addCollider(RAPIER.ColliderDesc.cuboid(hx, 40, hz).setTranslation(x, 0, z), SURFACES.stone);
  }

  // --- Sky, fog, light --------------------------------------------------------
  scene.background = new THREE.Color(HORIZON);
  scene.fog = new THREE.FogExp2(HORIZON, FOG_DENSITY);
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x4a5a32, 1.5));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(30, 50, 20);
  scene.add(sun);

  return {
    heightAt,
    sky: createSky(),
    spawn: new THREE.Vector3(SPAWN.x, heightAt(SPAWN.x, SPAWN.z), SPAWN.z),
    trees,
    stats: { trees: trees.length, branches: branchData.length, rocks: rockCount, logs: logSpots.length, colliders },
  };
}

/** A gradient dome: pale at the horizon, blue overhead. */
function createSky(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(150, 24, 14);
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const horizon = new THREE.Color(HORIZON);
  const mid = new THREE.Color(0x9cc7e0);
  const zenith = new THREE.Color(0x5b9bd0);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = Math.max(0, pos.getY(i) / 150);
    c.copy(horizon).lerp(mid, smoothstep(0, 0.35, h)).lerp(zenith, smoothstep(0.35, 1, h));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
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
