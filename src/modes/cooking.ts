import * as THREE from 'three';
import { bakeGroup } from '../mode/bake';
import { bakeGorilla } from '../mode/bake';
import { buildGorilla, sign, chefHat } from '../mode/figures';
import { createRuntime } from '../mode/runtime';
import { Grabbables, makeItem, type Item } from '../mode/props';
import { addLobbyButton, Fade, finishMode } from '../mode/shell';
import { blender, chainsaw, oven, stove, hsl } from '../mode/things';
import { WorldButton } from '../ui/panel';
import { GORILLAS } from '../hub/statues';

const PALETTES = [GORILLAS.orange, GORILLAS.blue, GORILLAS.pink, GORILLAS.green, GORILLAS.grey, GORILLAS.jungle];
const PERSON_SCALE = 1.35;
const CENTROID = new THREE.Vector3(0, 0.6, -0.02);

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** A person, or a part of one: the whole gorilla's shape with some of it clipped away by planes. */
interface Piece {
  root: THREE.Group;
  mesh: THREE.Mesh;
  back: THREE.Mesh;
  geo: THREE.BufferGeometry;
  local: THREE.Plane[];
  world: THREE.Plane[];
  item: Item;
  radius: number;
  cooldown: number;
  kind: 'person' | 'piece';
  seat: number;
  /** Seconds on a stove, and a flag once it is done. */
  cook: number;
  state: 'free' | 'blend' | 'oven';
  timer: number;
  base: THREE.Vector3;
  phase: number;
  mat: THREE.MeshLambertMaterial;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/**
 * COOKING SHOW! You are the chainsaw monster. The audience sits in the stands. Reach in with your left hand (grip) and grab
 * someone, then cut them with the saw in your right hand (trigger). The way you swing it decides how they are cut. Blend them,
 * cook them on the stove, bake them in the oven. There is a lot of blood.
 */
export async function runCooking(): Promise<void> {
  const rt = await createRuntime({ background: 0x0a0608, fog: new THREE.Fog(0x0a0608, 25, 70), spawn: new THREE.Vector3(0, 0, 7), killY: -20 });
  const { scene, renderer } = rt;
  renderer.localClippingEnabled = true;
  scene.add(new THREE.AmbientLight(0x6a5a60, 1.5));
  const key = new THREE.SpotLight(0xffe8c0, 700, 60, 0.9, 0.5, 1.4);
  key.position.set(0, 14, 10);
  key.target.position.set(0, 0, -4);
  const side = new THREE.SpotLight(0xff6a4a, 400, 50, 0.8, 0.5, 1.4);
  side.position.set(-14, 10, -2);
  side.target.position.set(0, 1, -8);
  scene.add(key, key.target, side, side.target);

  // --- The studio -------------------------------------------------------------------------------------
  const floor = new THREE.Mesh(new THREE.BoxGeometry(70, 0.5, 60), new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.5 }));
  floor.position.set(0, -0.25, -8);
  scene.add(floor);
  rt.solidBox(0, -0.25, -8, 35, 0.25, 30);
  const curtain = new THREE.Mesh(new THREE.BoxGeometry(70, 16, 0.5), new THREE.MeshLambertMaterial({ color: 0x6a0f14 }));
  curtain.position.set(0, 8, -26);
  scene.add(curtain);
  rt.solidBox(0, 8, -26, 35, 8, 0.25);
  for (const sx of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 16, 60), new THREE.MeshLambertMaterial({ color: 0x4a0c10 }));
    wall.position.set(sx * 30, 8, -8);
    scene.add(wall);
    rt.solidBox(sx * 30, 8, -8, 0.25, 8, 30);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(70, 16, 0.5), new THREE.MeshLambertMaterial({ color: 0x4a0c10 }));
  back.position.set(0, 8, 22);
  scene.add(back);
  rt.solidBox(0, 8, 22, 35, 8, 0.25);
  const title = sign('COOKING SHOW!', '#ffb030', 16);
  title.position.set(0, 12, -25.5);
  scene.add(title);
  const hint = sign('RIGHT TRIGGER: chainsaw   LEFT GRIP: grab', '#e0e0e0', 14);
  hint.position.set(0, 7, 21.6);
  hint.rotation.y = Math.PI;
  scene.add(hint);
  // Bleachers.
  const stepMat = new THREE.MeshLambertMaterial({ color: 0x3a3a46 });
  const seats: Array<{ pos: THREE.Vector3; taken: boolean }> = [];
  const ROWS = 4;
  for (let r = 0; r < ROWS; r++) {
    const z = -9 - r * 3.2;
    const h = 0.6 + r * 0.6;
    const step = new THREE.Mesh(new THREE.BoxGeometry(30, h, 3.2), stepMat);
    step.position.set(0, h / 2, z);
    scene.add(step);
    rt.solidBox(0, h / 2, z, 15, h / 2, 1.6);
    for (let i = 0; i < 7; i++) seats.push({ pos: new THREE.Vector3(-12 + i * 4 + (r % 2) * 2 - 1, h, z), taken: false });
  }

  // --- Kitchen: a blender, a stove and an oven -----------------------------------------------------------------------
  const counterMat = new THREE.MeshLambertMaterial({ color: 0xb8b8bc });
  const counter = new THREE.Mesh(new THREE.BoxGeometry(3, 1.1, 2), counterMat);
  counter.position.set(-7, 0.55, -3);
  scene.add(counter);
  rt.solidBox(-7, 0.55, -3, 1.5, 0.55, 1);
  const blend = blender();
  blend.scale.setScalar(1.7);
  blend.position.set(-7, 1.1, -3);
  scene.add(blend);
  const stoveObj = stove();
  stoveObj.scale.setScalar(1.9);
  stoveObj.position.set(0, 0, -3);
  stoveObj.rotation.y = Math.PI;
  scene.add(stoveObj);
  rt.solidBox(0, 0.9, -3, 0.95, 0.9, 0.67);
  const flames: THREE.Mesh[] = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0.8, fog: false });
  for (const [x, z] of [[-0.5, -0.3], [0.5, -0.3], [-0.5, 0.33], [0.5, 0.33]]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 8), flameMat);
    f.position.set(x * 1.9, 1.95, -3 + z * 1.9);
    scene.add(f);
    flames.push(f);
  }
  const fire = new THREE.PointLight(0xff6a20, 60, 14, 1.8);
  fire.position.set(0, 2.6, -3);
  scene.add(fire);
  const ovenObj = oven();
  ovenObj.scale.setScalar(1.8);
  ovenObj.position.set(7, 0, -3);
  ovenObj.rotation.y = Math.PI;
  scene.add(ovenObj);
  rt.solidBox(7, 1.6, -3, 1, 1.6, 0.8);
  const ovenGlow = new THREE.PointLight(0xff5a10, 0, 12, 1.8);
  ovenGlow.position.set(7, 1.6, -1.8);
  scene.add(ovenGlow);
  const smokeMat = new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.5, depthWrite: false });

  // --- Studio dressing: lights, cameras, a fridge, and two giant monsters flanking the stage -----------------------
  const onAir = sign('ON AIR', '#ff3030', 6);
  onAir.position.set(0, 9, -25.4);
  scene.add(onAir);
  const truss = new THREE.Mesh(new THREE.BoxGeometry(46, 0.4, 0.4), new THREE.MeshLambertMaterial({ color: 0x2a2a30 }));
  truss.position.set(0, 14, 2);
  scene.add(truss);
  const lamps: THREE.Mesh[] = [];
  for (let i = 0; i < 9; i++) {
    const col = hsl(i / 9, 0.9, 0.6);
    const lamp = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.2, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, fog: false }));
    lamp.position.set(-20 + i * 5, 13.2, 2);
    lamp.rotation.x = Math.PI;
    scene.add(lamp);
    lamps.push(lamp);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 1.6, 12, 10, 1, true).translate(0, -6, 0), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    beam.position.copy(lamp.position);
    scene.add(beam);
  }
  for (const sx of [-1, 1]) {
    const cam = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 1.4), new THREE.MeshLambertMaterial({ color: 0x24242a }));
    body.position.y = 1.9;
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.7, 12).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x111116 }));
    lens.position.set(0, 1.9, -1.0);
    const rec = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    rec.position.set(0.3, 2.35, -0.4);
    cam.add(body, lens, rec);
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.9, 5), new THREE.MeshLambertMaterial({ color: 0x555560 }));
      const a = (i / 3) * Math.PI * 2;
      leg.position.set(Math.cos(a) * 0.5, 0.95, Math.sin(a) * 0.5);
      leg.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
      cam.add(leg);
    }
    cam.position.set(sx * 11, 0, 11);
    cam.rotation.y = sx * -0.5;
    scene.add(cam);
  }
  box1(scene, 2.2, 3.6, 1.6, 0xcfd2d6, -14, 1.8, -3);
  box1(scene, 2.0, 0.12, 0.05, 0x888890, -14, 3.2, -2.18);
  for (const sx of [-1, 1]) {
    const m = bakeGorilla(buildGorilla('monster', GORILLAS.monster));
    m.group.scale.setScalar(5.2);
    m.group.position.set(sx * 21, 0, -3);
    m.group.rotation.y = -sx * Math.PI * 0.5 + sx * 0.3;
    m.arms[0].rotation.x = 2.2;
    m.arms[1].rotation.x = 2.2;
    const saw = chainsaw();
    saw.group.scale.setScalar(2.4);
    saw.group.position.set(0, 4.6, -1.8);
    saw.group.rotation.set(-1.3, 0, 0);
    saw.blood = 1;
    m.group.add(saw.group);
    scene.add(m.group);
    rt.updaters.push((dt) => {
      saw.update(dt, true);
      m.group.rotation.z = Math.sin(performance.now() / 700 + sx) * 0.02;
    });
  }
  rt.updaters.push(() => lamps.forEach((l, i) => ((l.material as THREE.MeshBasicMaterial).color.setHSL(((performance.now() / 4000) + i / 9) % 1, 0.9, 0.6))));

  // Where things can rest.
  const grabbables = new Grabbables(rt);
  grabbables.allowed = [true, false];
  grabbables.floorAt = (x, z) => {
    if (Math.abs(x + 7) < 1.5 && Math.abs(z + 3) < 1) return 1.1;
    if (Math.abs(x) < 0.95 && Math.abs(z + 3) < 0.67) return 1.85;
    for (let r = 0; r < ROWS; r++) if (Math.abs(x) < 15 && Math.abs(z - (-9 - r * 3.2)) < 1.6) return 0.6 + r * 0.6;
    return 0;
  };

  // --- Blood -----------------------------------------------------------------------------------------------------------
  const MAX_DROPS = 900;
  const dropPos = new Float32Array(MAX_DROPS * 3);
  const dropVel = new Float32Array(MAX_DROPS * 3);
  const dropLife = new Float32Array(MAX_DROPS);
  for (let i = 0; i < MAX_DROPS; i++) dropPos[i * 3 + 1] = -100;
  const dropGeo = new THREE.BufferGeometry();
  dropGeo.setAttribute('position', new THREE.BufferAttribute(dropPos, 3));
  const drops = new THREE.Points(dropGeo, new THREE.PointsMaterial({ color: 0xa00c10, size: 0.09, sizeAttenuation: true }));
  drops.frustumCulled = false;
  scene.add(drops);
  let dropCursor = 0;
  const decals = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x6e0808 }), 400);
  decals.frustumCulled = false;
  decals.count = 0;
  scene.add(decals);
  let decalCursor = 0;
  const decal = (x: number, y: number, z: number, r: number): void => {
    const i = decalCursor++ % 400;
    decals.setMatrixAt(i, _m.compose(_a.set(x, y + 0.008 + (i % 7) * 0.0006, z), _q.identity(), _s.set(r, 1, r)));
    decals.count = Math.min(400, decals.count + 1);
    decals.instanceMatrix.needsUpdate = true;
  };
  const splash = (at: THREE.Vector3, n: number, power: number, dir?: THREE.Vector3): void => {
    for (let k = 0; k < n; k++) {
      const i = dropCursor++ % MAX_DROPS;
      dropPos[i * 3] = at.x + (Math.random() - 0.5) * 0.2;
      dropPos[i * 3 + 1] = at.y + (Math.random() - 0.5) * 0.2;
      dropPos[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.2;
      dropVel[i * 3] = (Math.random() - 0.5) * power + (dir ? dir.x * power * 0.5 : 0);
      dropVel[i * 3 + 1] = Math.random() * power * 0.9 + 0.5;
      dropVel[i * 3 + 2] = (Math.random() - 0.5) * power + (dir ? dir.z * power * 0.5 : 0);
      dropLife[i] = 1.5 + Math.random();
    }
    dropGeo.getAttribute('position').needsUpdate = true;
  };
  for (let i = 0; i < 25; i++) decal(rnd(-8, 8), 0, rnd(-4, 9), rnd(0.2, 0.8));

  // Gore: chunks that fly, bleeding stumps, and blood on the lens.
  interface Gib {
    m: THREE.Mesh;
    vel: THREE.Vector3;
    spin: THREE.Vector3;
    life: number;
    landed: boolean;
  }
  const gibMats = [0x8a0c10, 0xb01418, 0xd04050, 0xe8a0a8, 0xece0d0, 0x5a0808].map((c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
  const gibGeos = [new THREE.BoxGeometry(1, 1, 1), new THREE.IcosahedronGeometry(0.7, 0), new THREE.CylinderGeometry(0.3, 0.3, 1.6, 6)];
  const gibs: Gib[] = [];
  for (let i = 0; i < 160; i++) {
    const m = new THREE.Mesh(gibGeos[i % 3], gibMats[i % gibMats.length]);
    m.visible = false;
    scene.add(m);
    gibs.push({ m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, landed: false });
  }
  let gibCursor = 0;
  const spawnGibs = (at: THREE.Vector3, n: number, power: number): void => {
    for (let k = 0; k < n; k++) {
      const g = gibs[gibCursor++ % gibs.length];
      g.m.visible = true;
      g.m.position.copy(at);
      g.m.scale.setScalar(rnd(0.04, 0.14));
      g.m.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6));
      g.vel.set(rnd(-1, 1) * power, rnd(0.4, 1.4) * power, rnd(-1, 1) * power);
      g.spin.set(rnd(-12, 12), rnd(-12, 12), rnd(-12, 12));
      g.life = 14;
      g.landed = false;
    }
  };
  const bleeders: Array<{ piece: Piece; t: number }> = [];
  const lens = new Fade(rt, 0x7a0408);

  // --- People and pieces ---------------------------------------------------------------------------------------------------
  const personGeos = PALETTES.map((p) => {
    const g = buildGorilla('scared', p);
    g.arms[0].rotation.x = 0.4;
    g.arms[1].rotation.x = 0.4;
    if (Math.random() < 0.5) g.head.add(chefHat());
    return bakeGroup(g.group).geometry;
  });
  const pieces: Piece[] = [];
  const score = { cuts: 0, blended: 0, cooked: 0, baked: 0 };
  const scoreboard = new WorldButton(scene, 'Cuts 0 · Blended 0 · Cooked 0 · Baked 0', 5.4, 0.5, '#3a1a1a');
  scoreboard.enabled = false;
  rt.panels.add(scoreboard);
  scoreboard.mesh.position.set(0, 3.6, -6);
  const refreshScore = (): void => scoreboard.setLabel(`Cuts ${score.cuts} · Blended ${score.blended} · Cooked ${score.cooked} · Baked ${score.baked}`);
  addLobbyButton(rt, new THREE.Vector3(3, 1.4, 3));

  const makePiece = (geo: THREE.BufferGeometry, local: THREE.Plane[], at: THREE.Vector3, quat: THREE.Quaternion, kind: 'person' | 'piece', centroid: THREE.Vector3, radius: number, seat = -1): Piece => {
    const root = new THREE.Group();
    root.position.copy(at);
    root.quaternion.copy(quat);
    root.scale.setScalar(PERSON_SCALE);
    const world = local.map(() => new THREE.Plane());
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, clippingPlanes: world });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(centroid).negate();
    const backMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x8a0c10, side: THREE.BackSide, clippingPlanes: world }));
    backMesh.position.copy(mesh.position);
    root.add(mesh, backMesh);
    scene.add(root);
    const item = makeItem(root, radius, { gravity: seat >= 0 ? 0 : 9.8, rest: radius * 0.6, bounce: 0.25 });
    const piece: Piece = {
      root, mesh, back: backMesh, geo, local, world, item, radius, cooldown: 0.6, kind, seat, cook: 0, state: 'free', timer: 0, base: at.clone(), phase: Math.random() * 6, mat,
    };
    item.data.piece = piece;
    item.onGrab = (it) => {
      const p = it.data.piece as Piece;
      if (p.seat >= 0) {
        seats[p.seat].taken = false;
        p.seat = -1;
        it.gravity = 9.8;
        rt.audio.play('hurt', p.root.position, 0.8);
      }
    };
    grabbables.add(item);
    pieces.push(piece);
    return piece;
  };

  const person = (seatIndex: number): void => {
    const seat = seats[seatIndex];
    seat.taken = true;
    const at = seat.pos.clone().add(new THREE.Vector3(0, CENTROID.y * PERSON_SCALE, 0));
    _q.setFromEuler(new THREE.Euler(0, rnd(-0.2, 0.2), 0));
    const geo = personGeos[Math.floor(Math.random() * personGeos.length)];
    const p = makePiece(geo, [], at, _q.clone(), 'person', CENTROID, 0.7 * PERSON_SCALE, seatIndex);
    p.root.scale.setScalar(0.01);
    p.timer = -1; // growing in
  };
  const seatPeople = (): void => {
    const free = seats.map((s, i) => (s.taken ? -1 : i)).filter((i) => i >= 0);
    for (const i of free) if (Math.random() < 0.9) person(i);
  };
  seatPeople();

  const dispose = (p: Piece): void => {
    scene.remove(p.root);
    p.mat.dispose();
    (p.back.material as THREE.Material).dispose();
    grabbables.remove(p.item);
    const k = pieces.indexOf(p);
    if (k >= 0) pieces.splice(k, 1);
    if (p.seat >= 0) seats[p.seat].taken = false;
  };

  /** What is left of the shape after the planes: its middle and how far it reaches (in the shape's own units), or null if it is gone. */
  const measure = (geo: THREE.BufferGeometry, planes: THREE.Plane[]): { centroid: THREE.Vector3; reach: number; count: number } | null => {
    const pos = geo.getAttribute('position');
    const sum = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < pos.count; i += 2) {
      _a.fromBufferAttribute(pos, i);
      if (planes.every((pl) => pl.distanceToPoint(_a) >= 0)) {
        sum.add(_a);
        n++;
      }
    }
    if (n < 14) return null;
    const centroid = sum.divideScalar(n);
    let reach = 0;
    for (let i = 0; i < pos.count; i += 2) {
      _a.fromBufferAttribute(pos, i);
      if (planes.every((pl) => pl.distanceToPoint(_a) >= 0)) reach = Math.max(reach, _a.distanceTo(centroid));
    }
    return { centroid, reach, count: n };
  };

  const slice = (p: Piece, point: THREE.Vector3, normal: THREE.Vector3, hand: 0 | 1 | -1): void => {
    p.mesh.updateWorldMatrix(true, false);
    _m.copy(p.mesh.matrixWorld).invert();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point).applyMatrix4(_m);
    const planesA = [...p.local, plane];
    const planesB = [...p.local, plane.clone().negate()];
    const a = measure(p.geo, planesA);
    const b = measure(p.geo, planesB);
    if (!a && !b) return;
    const baseVel = p.item.vel.clone();
    const quat = p.root.quaternion.clone();
    const heldBy = p.item.held;
    const origin = p.root.position.clone();
    const made: Piece[] = [];
    const sides: Array<[typeof a, THREE.Plane[], number]> = [[a, planesA, 1], [b, planesB, -1]];
    for (const [m, planes, sign] of sides) {
      if (!m) continue;
      const world = p.mesh.localToWorld(m.centroid.clone());
      const piece = makePiece(p.geo, planes, world, quat, 'piece', m.centroid, Math.max(0.12, m.reach * PERSON_SCALE * 0.8));
      piece.item.gravity = 9.8;
      piece.item.vel.copy(baseVel).addScaledVector(normal, sign * rnd(1.2, 3)).add(_a.set(0, rnd(1, 3), 0));
      piece.item.spin.set(rnd(-4, 4), rnd(-4, 4), rnd(-4, 4));
      piece.cooldown = 0.55;
      piece.cook = p.cook;
      piece.mat.color.copy(p.mat.color);
      made.push(piece);
    }
    dispose(p);
    if (heldBy !== -1 && made.length) {
      const big = made.reduce((x, y) => (x.radius > y.radius ? x : y));
      grabbables.take(big.item, heldBy);
    }
    while (pieces.length > 70) {
      const old = pieces.find((x) => x.item.held === -1 && x.kind === 'piece' && x.seat < 0 && !made.includes(x));
      if (!old) break;
      dispose(old);
    }
    splash(point, 150, 6.5, normal);
    spawnGibs(point, 22, 4.2);
    for (const m of made) bleeders.push({ piece: m, t: rnd(1.5, 3.2) });
    if (point.distanceTo(rt.head) < 4) lens.level = Math.min(0.7, lens.level + 0.45);
    for (let w = 0; w < 4; w++) decal(point.x + rnd(-1.4, 1.4), grabbables.floorAt(point.x, point.z), point.z + rnd(-1.4, 1.4), rnd(0.2, 0.9));
    decal(point.x, grabbables.floorAt(point.x, point.z), point.z, rnd(0.3, 0.7));
    rt.audio.play('splat', point, 1);
    rt.audio.play('hurt', origin, 0.9);
    score.cuts++;
    rt.award(3, 'slice');
    refreshScore();
    if (hand !== -1) rt.hands.all[hand].pulse(1, 120);
    for (const q of pieces) if (q.kind === 'person' && Math.random() < 0.25) rt.audio.play('hurt', q.root.position, 0.4);
  };

  // --- The chainsaw ---------------------------------------------------------------------------------------------------------
  const saw = chainsaw();
  const controller = rt.controllerFor(1);
  controller.add(saw.group);
  saw.group.rotation.x = 0.1;
  const tipPrev = new THREE.Vector3();
  const tipNow = new THREE.Vector3();
  const basePt = new THREE.Vector3();
  let havePrev = false;
  let sawSound = 0;
  let revving = false;

  const nearestOnSegment = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3): number => {
    _n.subVectors(b, a);
    const t = Math.max(0, Math.min(1, _b.subVectors(p, a).dot(_n) / _n.lengthSq()));
    out.copy(a).addScaledVector(_n, t);
    return out.distanceTo(p);
  };

  let time = 0;
  let refill = 6;
  const smoke: Array<{ m: THREE.Mesh; life: number }> = [];
  const puff = (at: THREE.Vector3): void => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), smokeMat);
    m.position.copy(at);
    scene.add(m);
    smoke.push({ m, life: 1.2 });
  };
  const contact = new THREE.Vector3();
  rt.onFrame = (dt) => {
    time += dt;
    grabbables.update(dt);
    // The saw.
    const trigger = rt.hands.all[1].tracked && rt.hands.all[1].triggered;
    revving = trigger;
    saw.blood = Math.max(0, saw.blood - dt * 0.02);
    saw.update(dt, revving);
    controller.updateWorldMatrix(true, true);
    saw.group.updateWorldMatrix(true, false);
    tipNow.copy(saw.tip);
    saw.group.localToWorld(tipNow);
    basePt.copy(saw.base);
    saw.group.localToWorld(basePt);
    const speed = havePrev ? tipNow.distanceTo(tipPrev) / Math.max(dt, 1e-3) : 0;
    if (revving) {
      sawSound -= dt;
      if (sawSound <= 0) {
        sawSound = 0.28;
        rt.audio.play('saw', basePt, 0.8);
        rt.hands.all[1].pulse(0.35, 70);
      }
    } else sawSound = 0;
    if (revving && havePrev) {
      for (const p of pieces.slice()) {
        p.cooldown -= dt;
        if (p.cooldown > 0 || !pieces.includes(p)) continue;
        const d = nearestOnSegment(p.root.position, basePt, tipNow, contact);
        if (d > p.radius * 0.9 + 0.05) continue;
        // The cut lies along the blade and the direction of the swing.
        _n.subVectors(tipNow, basePt).normalize();
        if (speed > 1.1) {
          _a.subVectors(tipNow, tipPrev).normalize();
          _b.crossVectors(_n, _a);
        } else _b.crossVectors(_n, _a.set(0, 1, 0));
        if (_b.lengthSq() < 0.05) _b.set(1, 0, 0);
        _b.normalize();
        // Keep the cut near the middle of the piece so the halves are worth having.
        const off = _a.copy(contact).sub(p.root.position);
        const along = off.dot(_b);
        const maxOff = p.radius * 0.6;
        if (Math.abs(along) > maxOff) contact.addScaledVector(_b, -(along - Math.sign(along) * maxOff));
        slice(p, contact.clone(), _b.clone(), 1);
        saw.blood = Math.min(1, saw.blood + 0.25);
      }
    }
    tipPrev.copy(tipNow);
    havePrev = true;

    for (const p of pieces.slice()) {
      // Clipping planes follow the piece.
      p.mesh.updateWorldMatrix(true, false);
      p.local.forEach((pl, i) => p.world[i].copy(pl).applyMatrix4(p.mesh.matrixWorld));
      // Newcomers grow in.
      if (p.timer === -1) {
        const s = Math.min(PERSON_SCALE, p.root.scale.x + dt * 2.2);
        p.root.scale.setScalar(s);
        if (s >= PERSON_SCALE) p.timer = 0;
      }
      // Cheering in the stands, all eyes on you.
      if (p.seat >= 0 && p.item.held === -1) {
        const want = Math.atan2(-(rt.head.x - p.root.position.x), -(rt.head.z - p.root.position.z));
        let dd = want - p.root.rotation.y;
        dd -= Math.round(dd / (Math.PI * 2)) * Math.PI * 2;
        p.root.rotation.y += dd * Math.min(1, dt * 4);
        p.root.position.y = p.base.y + Math.abs(Math.sin(time * 5 + p.phase)) * 0.12;
        p.root.rotation.z = Math.sin(time * 4 + p.phase) * 0.06;
      }
      if (p.state === 'free' && p.item.held === -1 && p.seat < 0) {
        const pos = p.root.position;
        // The blender.
        if (Math.hypot(pos.x + 7, pos.z + 3) < 1.0 && pos.y < 3.3 && pos.y > 1.2) {
          p.state = 'blend';
          p.timer = 1.6;
          rt.audio.play('whirr', pos, 1);
        }
        // The stove.
        else if (Math.hypot(pos.x, pos.z + 3) < 0.95 && pos.y > 1.8 && pos.y < 3.4 && p.item.vel.lengthSq() < 4) {
          p.cook += dt;
          p.mat.color.setRGB(Math.max(0.2, 1 - p.cook * 0.2), Math.max(0.15, 1 - p.cook * 0.28), Math.max(0.1, 1 - p.cook * 0.35));
          if (Math.random() < dt * 6) {
            puff(_a.set(pos.x + rnd(-0.3, 0.3), pos.y + 0.3, pos.z + rnd(-0.3, 0.3)));
            rt.audio.play('sizzle', pos, 0.5);
          }
          if (p.cook > 4 && p.item.data.cooked !== true) {
            p.item.data.cooked = true;
            score.cooked++;
            rt.award(20, 'cooked');
            refreshScore();
            rt.audio.play('chime');
          }
        }
        // The oven: put it in front of the door.
        else if (Math.abs(pos.x - 7) < 1.4 && pos.z > -2.4 && pos.z < -0.6 && pos.y > 0.4 && pos.y < 3.2) {
          p.state = 'oven';
          p.timer = 4.5;
          p.root.visible = false;
          p.item.canGrab = false;
          p.item.vel.set(0, 0, 0);
          p.item.gravity = 0;
          rt.audio.play('thud', pos, 1);
        }
      } else if (p.state === 'blend') {
        p.timer -= dt;
        p.root.scale.multiplyScalar(1 - dt * 0.9);
        p.root.rotation.y += dt * 25;
        p.root.position.x += (-7 - p.root.position.x) * dt * 6;
        p.root.position.z += (-3 - p.root.position.z) * dt * 6;
        splash(_a.set(-7, 2.0, -3), 4, 2.2);
        if (Math.random() < dt * 8) rt.audio.play('whirr', _a, 0.6);
        if (p.timer <= 0) {
          score.blended++;
          rt.award(15, 'blended');
          refreshScore();
          dispose(p);
          decal(-7, 1.1, -3, 0.4);
          rt.audio.play('squelch', undefined, 1);
        }
      } else if (p.state === 'oven') {
        p.timer -= dt;
        ovenGlow.intensity = 90;
        if (p.timer <= 0) {
          p.state = 'free';
          p.root.visible = true;
          p.item.canGrab = true;
          p.item.gravity = 9.8;
          p.root.position.set(7, 1.2, -1.4);
          p.item.vel.set(rnd(-1, 1), 3, 2.5);
          p.mat.color.setRGB(0.25, 0.15, 0.1);
          p.cook = 5;
          score.baked++;
          rt.award(20, 'baked');
          refreshScore();
          rt.audio.play('pop', p.root.position, 1);
          for (let i = 0; i < 6; i++) puff(_a.set(7 + rnd(-0.5, 0.5), 1.4 + rnd(0, 0.6), -1.5));
        }
      }
    }
    if (!pieces.some((p) => p.state === 'oven')) ovenGlow.intensity = Math.max(0, ovenGlow.intensity - dt * 120);

    // Gore: bleeding stumps, flying chunks, blood on the lens.
    for (let i = bleeders.length - 1; i >= 0; i--) {
      const b = bleeders[i];
      b.t -= dt;
      if (b.t <= 0 || !pieces.includes(b.piece)) {
        bleeders.splice(i, 1);
        continue;
      }
      splash(b.piece.root.position, 2, 2.2);
      if (Math.random() < dt * 2) rt.audio.play('splat', b.piece.root.position, 0.4);
    }
    for (const g of gibs) {
      if (!g.m.visible) continue;
      g.life -= dt;
      if (g.life <= 0) {
        g.m.visible = false;
        continue;
      }
      if (g.landed) continue;
      g.vel.y -= 9.8 * dt;
      g.m.position.addScaledVector(g.vel, dt);
      g.m.rotation.x += g.spin.x * dt;
      g.m.rotation.y += g.spin.y * dt;
      const fl = grabbables.floorAt(g.m.position.x, g.m.position.z);
      if (g.m.position.y < fl + 0.03) {
        g.m.position.y = fl + 0.03;
        g.landed = true;
        decal(g.m.position.x, fl, g.m.position.z, rnd(0.1, 0.3));
        if (Math.random() < 0.25) rt.audio.play('splat', g.m.position, 0.3);
      }
    }
    lens.update(dt);
    // Blood falling.
    for (let i = 0; i < MAX_DROPS; i++) {
      if (dropLife[i] <= 0) continue;
      dropLife[i] -= dt;
      dropVel[i * 3 + 1] -= 9.8 * dt;
      dropPos[i * 3] += dropVel[i * 3] * dt;
      dropPos[i * 3 + 1] += dropVel[i * 3 + 1] * dt;
      dropPos[i * 3 + 2] += dropVel[i * 3 + 2] * dt;
      const floorY = grabbables.floorAt(dropPos[i * 3], dropPos[i * 3 + 2]);
      if (dropPos[i * 3 + 1] < floorY + 0.02) {
        if (Math.random() < 0.22) decal(dropPos[i * 3], floorY, dropPos[i * 3 + 2], rnd(0.05, 0.26));
        dropLife[i] = 0;
        dropPos[i * 3 + 1] = -100;
      }
    }
    dropGeo.getAttribute('position').needsUpdate = true;
    for (let i = smoke.length - 1; i >= 0; i--) {
      const s = smoke[i];
      s.life -= dt;
      s.m.position.y += dt * 1.2;
      s.m.scale.multiplyScalar(1 + dt * 1.5);
      if (s.life <= 0) {
        scene.remove(s.m);
        smoke.splice(i, 1);
      }
    }
    // Fire.
    flames.forEach((f, i) => {
      f.scale.set(1 + Math.sin(time * 14 + i) * 0.25, 1 + Math.sin(time * 19 + i * 2) * 0.4, 1);
    });
    fire.intensity = 60 * (0.7 + 0.3 * Math.sin(time * 13) * Math.sin(time * 5));
    // The audience is replaced when it thins out. Now and then it claps.
    refill -= dt;
    if (refill <= 0) {
      refill = 4;
      const free = seats.map((s, i) => (s.taken ? -1 : i)).filter((i) => i >= 0);
      if (free.length) person(free[Math.floor(Math.random() * free.length)]);
    }
    if (Math.random() < dt * 1.2) rt.audio.play('scrape', _a.set(rnd(-10, 10), 3, -14), 0.7);
  };

  finishMode(rt, 'COOKING SHOW! · right trigger: chainsaw · left grip: grab (E / X / Q on desktop). L = lobby', '#ffa040', { grabbables, pieces, slice, saw, score: () => score, seats });
}

function box1(scene: THREE.Scene, w: number, h: number, d: number, color: number, x: number, y: number, z: number): void {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  scene.add(m);
}
