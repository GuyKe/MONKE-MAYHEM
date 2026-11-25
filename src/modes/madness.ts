import * as THREE from 'three';
import { bakeGroup, bakedMaterial } from '../mode/bake';
import { sign } from '../mode/figures';
import { createRuntime } from '../mode/runtime';
import { addGun, Grabbables, raySphere, Tracers } from '../mode/props';
import { addLobbyButton, finishMode } from '../mode/shell';
import { beam, car, chicken, horse, hsl, kfcBucket, Screen, ufo } from '../mode/things';
import { WorldButton } from '../ui/panel';

/** One instanced thing in the field. */
interface Prop {
  mesh: THREE.InstancedMesh;
  index: number;
  pos: THREE.Vector3;
  rot: THREE.Euler;
  scale: number;
  radius: number;
  /** 'static' never moves; 'spin' turns on the spot; 'fly' has been shot into the air. */
  state: 'static' | 'spin' | 'fly';
  spin: THREE.Vector3;
  vel: THREE.Vector3;
  baseY: number;
  chicken: boolean;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _a2 = new THREE.Vector3();

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/**
 * ABSOLUTE MADNESS: a flat field full of horses that do not move, horses in cars, animals spinning for no reason, flying saucers,
 * flashing lights and screens, chickens that will not stop screaming, a giant bucket of fried chicken, and guns lying about.
 * Nothing makes sense. Shoot something and see.
 */
export async function runMadness(): Promise<void> {
  const rt = await createRuntime({ background: 0x66ccff, fog: new THREE.Fog(0xffe8a0, 40, 230), spawn: new THREE.Vector3(0, 0, 0), killY: -60 });
  const { scene } = rt;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xff88cc, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(30, 80, 20);
  scene.add(sun);

  // --- The field ------------------------------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d')!;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      c.fillStyle = (x + y) % 2 ? '#7fe05a' : '#e8f070';
      c.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  const groundTex = new THREE.CanvasTexture(canvas);
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(120, 120);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  const groundMat = new THREE.MeshLambertMaterial({ map: groundTex });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2), groundMat);
  scene.add(ground);
  rt.solidBox(0, -0.5, 0, 400, 0.5, 400);

  // --- Things -----------------------------------------------------------------------------------------
  const props: Prop[] = [];
  const horseGeo = bakeGroup(horse()).geometry;
  const chickenGeo = bakeGroup(chicken()).geometry;
  const carHorse = new THREE.Group();
  carHorse.add(car(0xffffff, true));
  const rider = horse(0xffffff);
  rider.scale.setScalar(0.5);
  rider.position.set(0, 0.7, 0.2);
  carHorse.add(rider);
  const carHorseGeo = bakeGroup(carHorse).geometry;
  const bigCarGeo = bakeGroup(car(0xffffff)).geometry;

  const makeSet = (geo: THREE.BufferGeometry, count: number, build: (i: number) => Partial<Prop> & { pos: THREE.Vector3 }): void => {
    const mesh = new THREE.InstancedMesh(geo, bakedMaterial, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    scene.add(mesh);
    for (let i = 0; i < count; i++) {
      const b = build(i);
      const p: Prop = {
        mesh, index: i, pos: b.pos, rot: b.rot ?? new THREE.Euler(0, rnd(0, 6.3), 0), scale: b.scale ?? 1, radius: b.radius ?? 1.2, state: b.state ?? 'static',
        spin: b.spin ?? new THREE.Vector3(), vel: new THREE.Vector3(), baseY: b.pos.y, chicken: b.chicken ?? false,
      };
      props.push(p);
      mesh.setColorAt(i, _c.setHSL(Math.random(), 0.4 + Math.random() * 0.6, 0.55 + Math.random() * 0.3));
      write(p);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  const write = (p: Prop): void => {
    _q.setFromEuler(p.rot);
    p.mesh.setMatrixAt(p.index, _m.compose(p.pos, _q, _s.setScalar(p.scale)));
    p.mesh.instanceMatrix.needsUpdate = true;
  };
  const around = (min: number, max: number): THREE.Vector3 => {
    const a = Math.random() * Math.PI * 2;
    const r = rnd(min, max);
    return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
  };

  // Horses, standing about, stiff as boards. Some are tipped over, a few are enormous.
  makeSet(horseGeo, 120, () => {
    const big = Math.random() < 0.06;
    const tipped = Math.random() < 0.28;
    const rot = new THREE.Euler(tipped ? rnd(0, 6.3) : 0, rnd(0, 6.3), tipped ? rnd(0, 6.3) : 0);
    const scale = big ? rnd(4, 9) : rnd(0.7, 2.2);
    const pos = around(6, 150);
    if (tipped) pos.y = 1.2 * scale;
    return { pos, rot, scale, radius: 1.3 * scale };
  });
  // Horses in cars.
  makeSet(carHorseGeo, 30, () => ({ pos: around(10, 140), scale: rnd(0.9, 2.5), radius: 2.4 }));
  makeSet(bigCarGeo, 16, () => ({ pos: around(8, 130), rot: new THREE.Euler(rnd(-0.3, 0.3), rnd(0, 6.3), Math.random() < 0.3 ? Math.PI : 0), scale: rnd(0.8, 3), radius: 2.2 }));
  // Things that spin round and round.
  makeSet(chickenGeo, 90, () => {
    const pos = around(3, 120);
    pos.y = Math.random() < 0.4 ? rnd(0, 0.5) : rnd(1, 12);
    return { pos, scale: rnd(1.5, 4), radius: 1.2, state: 'spin', spin: new THREE.Vector3(rnd(-3, 3), rnd(-8, 8), rnd(-3, 3)), chicken: true };
  });
  makeSet(horseGeo, 26, () => {
    const pos = around(8, 110);
    pos.y = rnd(1, 9);
    return { pos, scale: rnd(0.6, 1.6), radius: 1.6, state: 'spin', spin: new THREE.Vector3(rnd(-2, 2), rnd(-6, 6), rnd(-2, 2)) };
  });
  makeSet(carHorseGeo, 10, () => {
    const pos = around(12, 100);
    pos.y = rnd(2, 14);
    return { pos, scale: 1.2, radius: 2.4, state: 'spin', spin: new THREE.Vector3(rnd(-1, 1), rnd(-5, 5), rnd(-1, 1)) };
  });
  const chickens = props.filter((p) => p.chicken);
  props.forEach((p) => {
    if (p.state === 'spin' && !p.chicken) p.baseY = p.pos.y;
  });

  // The bucket: a very large one, near where you start, and some small ones that drift about.
  const bucket = kfcBucket();
  bucket.scale.setScalar(7);
  bucket.position.set(10, 0, -16);
  scene.add(bucket);
  const littleBuckets: THREE.Group[] = [];
  for (let i = 0; i < 8; i++) {
    const b = kfcBucket();
    b.scale.setScalar(rnd(1, 2.6));
    b.position.copy(around(8, 60)).setY(rnd(3, 14));
    scene.add(b);
    littleBuckets.push(b);
  }

  // Flying saucers, with beams.
  const ufoGeo = bakeGroup(ufo()).geometry;
  const saucers: Array<{ mesh: THREE.Mesh; center: THREE.Vector3; radius: number; speed: number; phase: number }> = [];
  for (let i = 0; i < 9; i++) {
    const mesh = new THREE.Mesh(ufoGeo, bakedMaterial);
    const s = rnd(2, 5);
    mesh.scale.setScalar(s);
    mesh.add(beam(2.2, 18 / s * 3, hsl(Math.random(), 1, 0.7)));
    scene.add(mesh);
    saucers.push({ mesh, center: new THREE.Vector3(rnd(-60, 60), rnd(18, 50), rnd(-90, 30)), radius: rnd(6, 30), speed: rnd(0.2, 0.7) * (Math.random() < 0.5 ? 1 : -1), phase: Math.random() * 6.3 });
  }

  // Screens: everywhere, all of them loud.
  const screens: Array<{ s: Screen; at: THREE.Vector3 }> = [];
  for (let i = 0; i < 18; i++) {
    const s = new Screen(rnd(3, 8), rnd(2, 5), i);
    const at = around(8, 90);
    at.y = rnd(2, 10);
    s.group.position.copy(at);
    s.group.rotation.set(rnd(-0.3, 0.3), rnd(0, 6.3), rnd(-0.4, 0.4));
    scene.add(s.group);
    screens.push({ s, at });
  }

  // Lights that run about, and glowing poles.
  const lights = [0, 1, 2, 3, 4].map(() => {
    const l = new THREE.PointLight(0xffffff, 400, 60, 1.6);
    scene.add(l);
    return l;
  });
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.25, 1, 6).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ fog: false }), 40);
  const poleData: Array<{ pos: THREE.Vector3; h: number }> = [];
  for (let i = 0; i < 40; i++) {
    const pos = around(6, 130);
    const h = rnd(6, 40);
    poleData.push({ pos, h });
    poles.setMatrixAt(i, _m.compose(pos, _q.identity(), _s.set(1, h, 1)));
  }
  poles.frustumCulled = false;
  scene.add(poles);

  // The sky: huge things.
  const sky = new THREE.Group();
  scene.add(sky);
  const sunFace = new THREE.Mesh(new THREE.SphereGeometry(30, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffee40, fog: false }));
  sunFace.position.set(-120, 110, -170);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(5, 10, 8), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
    eye.position.set(sx * 10, 8, 26);
    sunFace.add(eye);
  }
  const grin = new THREE.Mesh(new THREE.TorusGeometry(14, 1.8, 6, 16, Math.PI), new THREE.MeshBasicMaterial({ color: 0xc02020, fog: false }));
  grin.position.set(0, -4, 26);
  grin.rotation.z = Math.PI;
  sunFace.add(grin);
  sky.add(sunFace);
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rnd(40, 90), 4, 6, 40), new THREE.MeshBasicMaterial({ color: hsl(i / 4, 1, 0.55), fog: false }));
    ring.position.set(rnd(-150, 150), rnd(80, 140), rnd(-190, -80));
    ring.rotation.set(rnd(0, 3), rnd(0, 3), 0);
    sky.add(ring);
    rings.push(ring);
  }
  const bigBucket = kfcBucket();
  bigBucket.scale.setScalar(40);
  bigBucket.position.set(150, 60, -130);
  sky.add(bigBucket);
  const title = sign('ABSOLUTE MADNESS', '#ff30c0', 120);
  title.position.set(0, 70, -150);
  sky.add(title);
  const rainbowMoons = [0, 1, 2].map((i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(rnd(8, 18), 12, 10), new THREE.MeshBasicMaterial({ color: hsl(i / 3, 1, 0.6), fog: false }));
    m.position.set(rnd(-180, 180), rnd(60, 150), rnd(-200, 80));
    sky.add(m);
    return m;
  });

  // --- Guns, and what they do -----------------------------------------------------------------------------
  const grabbables = new Grabbables(rt);
  const tracers = new Tracers(scene);
  let yeeted = 0;
  const status = new WorldButton(scene, 'Yeeted: 0', 1.6, 0.4, '#3a3a3a');
  status.enabled = false;
  rt.panels.add(status);
  status.mesh.position.set(-1.8, 1.5, -3);
  addLobbyButton(rt, new THREE.Vector3(1.6, 1.5, -3));
  const hitProp = (origin: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 | null => {
    let best: Prop | null = null;
    let bestT = 120;
    for (const p of props) {
      const t = raySphere(origin, dir, _s.set(p.pos.x, p.pos.y + p.radius * 0.6, p.pos.z), p.radius);
      if (t !== null && t < bestT) {
        bestT = t;
        best = p;
      }
    }
    const end = origin.clone().addScaledVector(dir, bestT);
    if (!best) return null;
    best.state = 'fly';
    best.vel.set((Math.random() - 0.5) * 8, rnd(14, 26), (Math.random() - 0.5) * 8);
    best.spin.set(rnd(-9, 9), rnd(-9, 9), rnd(-9, 9));
    yeeted++;
    rt.award(2, 'yeet');
    status.setLabel(`Yeeted: ${yeeted}`);
    rt.audio.play(best.chicken ? 'squawk' : 'pop', end, 1);
    return end;
  };
  for (let i = 0; i < 14; i++) {
    const at = around(2.5, 14).setY(0.1);
    addGun(rt, grabbables, tracers, at, hitProp, hsl(i / 14, 0.7, 0.4));
  }

  const hue = new THREE.Color();
  // --- Extra madness: trampolines, speakers with a beat, lasers, confetti, fireworks ------------------------------------------
  const pads: Array<{ pos: THREE.Vector3; mesh: THREE.Mesh }> = [];
  for (let i = 0; i < 10; i++) {
    const at = around(8, 70);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.5, 20), new THREE.MeshLambertMaterial({ color: hsl(i / 10, 1, 0.55), emissive: hsl(i / 10, 1, 0.3) }));
    pad.position.set(at.x, 0.25, at.z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.25, 6, 24), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(at.x, 0.5, at.z);
    scene.add(pad, ring);
    pads.push({ pos: at, mesh: pad });
  }
  const speakers: THREE.Group[] = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.Group();
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 5, 2.4), new THREE.MeshLambertMaterial({ color: 0x18181c }));
    cab.position.y = 2.5;
    g.add(cab);
    for (const y of [1.5, 3.6]) {
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.2, 16).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x333339, emissive: 0x2a0030 }));
      cone.position.set(0, y, -1.25);
      g.add(cone);
    }
    const at = around(6, 40);
    g.position.set(at.x, 0, at.z);
    g.lookAt(0, 0, 0);
    scene.add(g);
    speakers.push(g);
  }
  const lasers: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 140, 6).translate(0, 70, 0), new THREE.MeshBasicMaterial({ color: hsl(i / 8, 1, 0.6), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const at = around(10, 80);
    l.position.set(at.x, 0, at.z);
    scene.add(l);
    lasers.push(l);
  }
  const CONF = 600;
  const confPos = new Float32Array(CONF * 3);
  const confCol = new Float32Array(CONF * 3);
  for (let i = 0; i < CONF; i++) {
    confPos.set([rnd(-25, 25), rnd(0, 18), rnd(-25, 25)], i * 3);
    hue.setHSL(Math.random(), 1, 0.6);
    confCol.set([hue.r, hue.g, hue.b], i * 3);
  }
  const confGeo = new THREE.BufferGeometry();
  confGeo.setAttribute('position', new THREE.BufferAttribute(confPos, 3));
  confGeo.setAttribute('color', new THREE.BufferAttribute(confCol, 3));
  const confetti = new THREE.Points(confGeo, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, sizeAttenuation: true }));
  confetti.frustumCulled = false;
  scene.add(confetti);
  const FW = 900;
  const fwPos = new Float32Array(FW * 3);
  const fwVel = new Float32Array(FW * 3);
  const fwCol = new Float32Array(FW * 3);
  const fwLife = new Float32Array(FW);
  for (let i = 0; i < FW; i++) fwPos[i * 3 + 1] = -500;
  const fwGeo = new THREE.BufferGeometry();
  fwGeo.setAttribute('position', new THREE.BufferAttribute(fwPos, 3));
  fwGeo.setAttribute('color', new THREE.BufferAttribute(fwCol, 3));
  const fireworks = new THREE.Points(fwGeo, new THREE.PointsMaterial({ size: 0.9, vertexColors: true, sizeAttenuation: true, fog: false, blending: THREE.AdditiveBlending, depthWrite: false }));
  fireworks.frustumCulled = false;
  scene.add(fireworks);
  let fwCursor = 0;
  const burst = (at: THREE.Vector3): void => {
    hue.setHSL(Math.random(), 1, 0.6);
    for (let k = 0; k < 90; k++) {
      const i = fwCursor++ % FW;
      const v = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(8, 22));
      fwPos.set([at.x, at.y, at.z], i * 3);
      fwVel.set([v.x, v.y, v.z], i * 3);
      fwCol.set([hue.r, hue.g, hue.b], i * 3);
      fwLife[i] = rnd(1.2, 2.4);
    }
    rt.audio.play('bang', at, 0.5);
  };
  let fireworkTimer = 1;
  let beat = 0;
  let boing = 0;

  // --- Every frame ----------------------------------------------------------------------------------------------
  let time = 0;
  let screamTimer = 0;
  let noiseTimer = 0;
  rt.onFrame = (dt) => {
    time += dt;
    grabbables.update(dt);
    tracers.update(dt);
    // The sky and the ground never settle.
    (scene.background as THREE.Color).copy(hue.setHSL((time * 0.07) % 1, 0.9, 0.62));
    (scene.fog as THREE.Fog).color.copy(hue.setHSL((time * 0.07 + 0.35) % 1, 0.8, 0.75));
    groundMat.color.setHSL((time * 0.11) % 1, 0.5, 0.78);
    sunFace.rotation.z = time * 0.3;
    sunFace.scale.setScalar(1 + Math.sin(time * 3) * 0.08);
    rings.forEach((r, i) => (r.rotation.y += dt * (0.3 + i * 0.2)));
    rainbowMoons.forEach((m, i) => m.position.add(_s.set(Math.sin(time + i) * dt * 10, Math.cos(time * 1.3 + i) * dt * 6, 0)));
    bigBucket.rotation.y = time * 0.5;
    bucket.rotation.y = time * 0.6;
    bucket.position.y = Math.abs(Math.sin(time * 1.4)) * 3;
    littleBuckets.forEach((b, i) => {
      b.rotation.set(time * (0.6 + i * 0.1), time * 1.1, 0);
      b.position.y += Math.sin(time * 2 + i) * dt * 2;
    });
    // Trampolines.
    boing -= dt;
    for (const pad of pads) {
      if (Math.hypot(rt.head.x - pad.pos.x, rt.head.z - pad.pos.z) < 3.4 && rt.head.y < 2.4 && boing <= 0) {
        boing = 0.7;
        rt.locomotion.velocity.y = 15;
        rt.locomotion.carry(_s.set(0, 0.4, 0));
        rt.locomotion.velocity.y = 15;
        rt.audio.play('whirr', pad.pos, 1);
        rt.award(1, 'BOING');
      }
      pad.mesh.scale.y = 1 + Math.max(0, boing) * 0.3;
    }
    // The beat.
    beat -= dt;
    if (beat <= 0) {
      beat = 0.5;
      rt.audio.play('thump', speakers[0].position, 1);
      speakers.forEach((sp) => sp.scale.setScalar(1.12));
    }
    speakers.forEach((sp) => sp.scale.lerp(_s.set(1, 1, 1), Math.min(1, dt * 8)));
    lasers.forEach((l, i) => {
      l.rotation.x = Math.sin(time * (0.7 + i * 0.13) + i) * 0.9;
      l.rotation.z = Math.cos(time * (0.5 + i * 0.11) + i * 2) * 0.9;
    });
    // Confetti falls around you; fireworks go off in the sky.
    for (let i = 0; i < CONF; i++) {
      confPos[i * 3 + 1] -= dt * (1.5 + (i % 5) * 0.4);
      confPos[i * 3] += Math.sin(time * 2 + i) * dt * 0.8;
      if (confPos[i * 3 + 1] < 0) {
        confPos[i * 3] = rt.head.x + rnd(-25, 25);
        confPos[i * 3 + 1] = rnd(14, 20);
        confPos[i * 3 + 2] = rt.head.z + rnd(-25, 25);
      }
    }
    confGeo.getAttribute('position').needsUpdate = true;
    fireworkTimer -= dt;
    if (fireworkTimer <= 0) {
      fireworkTimer = rnd(0.5, 1.6);
      burst(_a2.set(rt.head.x + rnd(-60, 60), rnd(35, 70), rt.head.z + rnd(-90, -20)));
    }
    for (let i = 0; i < FW; i++) {
      if (fwLife[i] <= 0) continue;
      fwLife[i] -= dt;
      fwVel[i * 3 + 1] -= 6 * dt;
      fwPos[i * 3] += fwVel[i * 3] * dt;
      fwPos[i * 3 + 1] += fwVel[i * 3 + 1] * dt;
      fwPos[i * 3 + 2] += fwVel[i * 3 + 2] * dt;
      if (fwLife[i] <= 0) fwPos[i * 3 + 1] = -500;
    }
    fwGeo.getAttribute('position').needsUpdate = true;
    // Spinning, and flying.
    for (const p of props) {
      if (p.state === 'static') continue;
      if (p.state === 'spin') {
        p.rot.x += p.spin.x * dt;
        p.rot.y += p.spin.y * dt;
        p.rot.z += p.spin.z * dt;
        p.pos.y = p.baseY + Math.sin(time * 2 + p.index) * 0.4;
      } else {
        p.vel.y -= 14 * dt;
        p.pos.addScaledVector(p.vel, dt);
        p.rot.x += p.spin.x * dt;
        p.rot.y += p.spin.y * dt;
        p.rot.z += p.spin.z * dt;
        if (p.pos.y < 0.4 && p.vel.y < 0) {
          p.pos.y = 0.4;
          p.vel.set(0, 0, 0);
          p.state = 'spin';
          p.baseY = 0.4;
          p.spin.multiplyScalar(0.3);
        }
      }
      write(p);
    }
    saucers.forEach((s) => {
      const a = time * s.speed + s.phase;
      s.mesh.position.set(s.center.x + Math.cos(a) * s.radius, s.center.y + Math.sin(time * 1.7 + s.phase) * 2, s.center.z + Math.sin(a) * s.radius);
      s.mesh.rotation.y = time * 2;
      s.mesh.rotation.z = Math.sin(time * 1.1 + s.phase) * 0.2;
    });
    for (const s of screens) if (Math.hypot(s.at.x - rt.head.x, s.at.z - rt.head.z) < 100) s.s.tick(time);
    lights.forEach((l, i) => {
      l.color.setHSL((time * 0.5 + i * 0.2) % 1, 1, 0.6);
      l.position.set(rt.head.x + Math.cos(time * (0.8 + i * 0.3) + i) * 18, 3 + Math.abs(Math.sin(time * 2 + i)) * 8, rt.head.z + Math.sin(time * (0.7 + i * 0.25) + i * 2) * 18);
    });
    poleData.forEach((_p, i) => poles.setColorAt(i, hue.setHSL((time * 0.8 + i * 0.07) % 1, 1, 0.55)));
    if (poles.instanceColor) poles.instanceColor.needsUpdate = true;
    // Chickens scream, always.
    screamTimer -= dt;
    if (screamTimer <= 0) {
      screamTimer = 0.18;
      const p = chickens[Math.floor(Math.random() * chickens.length)];
      const d = Math.hypot(p.pos.x - rt.head.x, p.pos.z - rt.head.z);
      if (d < 60) rt.audio.play('squawk', p.pos, Math.max(0.15, 1 - d / 60));
    }
    noiseTimer -= dt;
    if (noiseTimer <= 0) {
      noiseTimer = rnd(0.3, 1.1);
      const a = Math.random() * Math.PI * 2;
      rt.audio.play((['whirr', 'pop', 'bang', 'squelch', 'chime', 'crash', 'whoosh'] as const)[Math.floor(Math.random() * 7)], _s.set(rt.head.x + Math.cos(a) * 14, 2, rt.head.z + Math.sin(a) * 14), 0.6);
    }
  };

  finishMode(rt, 'ABSOLUTE MADNESS · grab a gun (grip), shoot (trigger). L = lobby', '#ff60d0', { props, grabbables, hitProp, status });
}
