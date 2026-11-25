import * as THREE from 'three';
import { sign } from '../mode/figures';
import { goToMode } from '../mode/nav';
import { createRuntime } from '../mode/runtime';
import { addLobbyButton, Fade, finishMode } from '../mode/shell';
import { Screen, vacuum } from '../mode/things';
import { WorldButton } from '../ui/panel';

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

const HX = 70; // half the room
const HZ = 55;
const WALL = 70;

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * VACUUM: you are tiny, in a house made for giants. A vacuum cleaner patrols the living room, and when it sees you it comes. Stay
 * out of its mouth. The couch is too low for it to reach under. Find the mouse hole in the far wall and get out.
 */
export async function runVacuum(): Promise<void> {
  const spawn = new THREE.Vector3(HX - 12, 0, HZ - 12);
  const rt = await createRuntime({ background: 0x1c1410, fog: new THREE.Fog(0x1c1410, 60, 190), spawn, killY: -20 });
  const { scene } = rt;
  scene.add(new THREE.HemisphereLight(0xffe8c8, 0x6a4a30, 1.7));
  const sun = new THREE.DirectionalLight(0xfff0c0, 2.2);
  sun.position.set(-30, 80, -20);
  scene.add(sun);

  // --- The house ---------------------------------------------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d')!;
  for (let i = 0; i < 4; i++) {
    c.fillStyle = ['#8a5a30', '#7c4e28', '#946238', '#85542c'][i];
    c.fillRect(i * 64, 0, 62, 256);
    c.fillStyle = 'rgba(40,20,0,0.25)';
    for (let k = 0; k < 14; k++) c.fillRect(i * 64 + Math.random() * 60, Math.random() * 256, 1, 18 + Math.random() * 30);
  }
  const floorTex = new THREE.CanvasTexture(canvas);
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set((HX * 2) / 24, (HZ * 2) / 24);
  floorTex.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(HX * 2, 1, HZ * 2), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.position.y = -0.5;
  scene.add(floor);
  rt.solidBox(0, -0.5, 0, HX, 0.5, HZ);
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xd8c8a0 });
  const trimMat = new THREE.MeshLambertMaterial({ color: 0x5a3a20 });
  const wall = (x: number, z: number, w: number, d: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL, d), wallMat);
    m.position.set(x, WALL / 2, z);
    scene.add(m);
    rt.solidBox(x, WALL / 2, z, w / 2, WALL / 2, d / 2);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 3, d + 0.1), trimMat);
    trim.position.set(x, 1.5, z);
    scene.add(trim);
  };
  wall(0, -HZ - 1, HX * 2 + 4, 2);
  wall(0, HZ + 1, HX * 2 + 4, 2);
  wall(-HX - 1, 0, 2, HZ * 2);
  wall(HX + 1, 0, 2, HZ * 2);
  // A window with a bar of light.
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(24, 34), new THREE.MeshBasicMaterial({ color: 0xfff6d0, fog: false }));
  glass.position.set(-10, 40, -HZ + 0.05);
  scene.add(glass);
  for (const [w, h, x, y] of [[24, 1, 0, 0], [1, 34, 0, 0]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.4), trimMat);
    bar.position.set(-10 + x, 40 + y, -HZ + 0.2);
    scene.add(bar);
  }
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(64, 44).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x7a2a3a }));
  rug.position.set(6, 0.03, 2);
  scene.add(rug);

  // Furniture. `blocks` are what the vacuum cannot go through.
  const blocks: Rect[] = [];
  const box = (w: number, h: number, d: number, color: number, x: number, y0: number, z: number, block = false, collide = true): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y0 + h / 2, z);
    scene.add(m);
    if (collide) rt.solidBox(x, y0 + h / 2, z, w / 2, h / 2, d / 2);
    if (block) blocks.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
    return m;
  };
  // The couch, with a gap too low for the vacuum underneath.
  const couch = { x: -34, z: -30, w: 46, d: 20, gap: 5 };
  box(couch.w, 6, couch.d, 0x3a5a8a, couch.x, couch.gap, couch.z);
  box(couch.w, 14, 5, 0x34527e, couch.x, couch.gap + 6, couch.z - couch.d / 2 + 2.5);
  for (const sx of [-1, 1]) box(5, 10, couch.d, 0x2f4a74, couch.x + sx * (couch.w / 2 - 2.5), couch.gap + 6, couch.z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(2, couch.gap, 2, 0x2a1a10, couch.x + sx * (couch.w / 2 - 1.5), 0, couch.z + sz * (couch.d / 2 - 1.5));
  blocks.push({ x0: couch.x - couch.w / 2, x1: couch.x + couch.w / 2, z0: couch.z - couch.d / 2, z1: couch.z + couch.d / 2 });
  // Coffee table: the vacuum fits underneath, between the legs.
  const table = { x: 8, z: 0 };
  box(38, 1.6, 22, 0x6a4020, table.x, 10, table.z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(2.4, 10, 2.4, 0x4a2a14, table.x + sx * 16, 0, table.z + sz * 9, true);
  // Toy blocks that make stairs.
  box(7, 4, 7, 0xd83030, 26, 0, 14, true);
  box(7, 8, 7, 0x3060d8, 30, 0, 21, true);
  box(7, 12, 7, 0xe0c030, 24, 0, 28, true);
  // A pair of shoes, a bookshelf, a plant.
  box(18, 8, 7, 0x3a2a24, -10, 0, 38, true);
  box(18, 8, 7, 0x3a2a24, -4, 0, 46, true);
  box(40, 62, 9, 0x6a4a2a, 30, 0, -HZ + 5, true);
  for (let i = 0; i < 6; i++) box(38, 1, 8.5, 0x4a3018, 30, 8 + i * 9.5, -HZ + 5, false, false);
  for (let i = 0; i < 34; i++) {
    const h = rnd(5, 8);
    box(rnd(1, 2.2), h, 6, [0xc03030, 0x3070c0, 0x30a050, 0xe0b030, 0x8030a0][i % 5], 12 + (i % 17) * 2.1, 9 + Math.floor(i / 17) * 19, -HZ + 5, false, false);
  }
  box(8, 9, 8, 0x9a4a2a, 52, 0, -34, true);
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(9, 1), new THREE.MeshLambertMaterial({ color: 0x2f8a3a, flatShading: true }));
  leaves.position.set(52, 17, -34);
  scene.add(leaves);

  // More of the house: a television, a lamp, pictures, pillows, a pencil, dust bunnies and cereal to collect.
  const tv = new Screen(30, 17, 2);
  tv.group.position.set(-12, 18, HZ - 2.6);
  tv.group.rotation.y = Math.PI;
  scene.add(tv.group);
  box(40, 8, 9, 0x4a2c18, -12, 0, HZ - 6, true);
  const tvLight = new THREE.PointLight(0x80a0ff, 120, 60, 1.6);
  tvLight.position.set(-12, 14, HZ - 12);
  scene.add(tvLight);
  const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 36, 8), new THREE.MeshLambertMaterial({ color: 0x2a2a2e }));
  lampPole.position.set(-HX + 6, 18, 36);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(5, 8, 8, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe0a0, side: THREE.DoubleSide, fog: false }));
  shade.position.set(-HX + 6, 38, 36);
  scene.add(lampPole, shade);
  rt.solidBox(-HX + 6, 18, 36, 0.8, 18, 0.8);
  const lampLight = new THREE.PointLight(0xffd890, 220, 80, 1.5);
  lampLight.position.set(-HX + 6, 36, 36);
  scene.add(lampLight);
  const frameColors = [0xc03030, 0x3070c0, 0x30a050, 0xe0b030];
  for (let i = 0; i < 4; i++) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(12, 9, 0.6), trimMat);
    frame.position.set(HX - 0.4, 30 + (i % 2) * 6, -30 + i * 18);
    frame.rotation.y = -Math.PI / 2;
    const art = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 7.4), new THREE.MeshLambertMaterial({ color: frameColors[i] }));
    art.position.copy(frame.position).add(new THREE.Vector3(-0.35, 0, 0));
    art.rotation.y = -Math.PI / 2;
    scene.add(frame, art);
  }
  for (let i = 0; i < 4; i++) {
    const pil = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: [0xe0b030, 0xc03030, 0x30a0a0, 0xe0e0d0][i], flatShading: true }));
    pil.scale.set(5, 2.4, 4);
    pil.position.set(couch.x - 15 + i * 9, couch.gap + 7.4, couch.z + 2);
    pil.rotation.y = rnd(-0.5, 0.5);
    scene.add(pil);
  }
  const pencil = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 44, 6), new THREE.MeshLambertMaterial({ color: 0xe0b020 }));
  pencil.rotation.z = Math.PI / 2;
  pencil.position.set(42, 1.1, 30);
  pencil.rotation.y = 0.4;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4, 6), new THREE.MeshLambertMaterial({ color: 0x303030 }));
  tip.rotation.z = Math.PI / 2;
  tip.position.set(42 - 24, 1.1, 30 + 24 * Math.sin(0.4) * 0.4);
  scene.add(pencil);
  void tip;
  const bunnies: Array<{ m: THREE.Mesh; x: number; z: number; a: number }> = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 1), new THREE.MeshLambertMaterial({ color: 0x8a8a8e, flatShading: true }));
    const b = { m, x: rnd(-HX + 8, HX - 8), z: rnd(-HZ + 8, HZ - 8), a: rnd(0, 6) };
    m.position.set(b.x, 1.4, b.z);
    scene.add(m);
    bunnies.push(b);
  }
  const crumbs: Array<{ m: THREE.Mesh; x: number; z: number; alive: boolean }> = [];
  for (let i = 0; i < 28; i++) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.5, 6, 12), new THREE.MeshLambertMaterial({ color: [0xe0b050, 0xd08030, 0xc0a060][i % 3], flatShading: true }));
    m.rotation.x = Math.PI / 2;
    const c = { m, x: rnd(-HX + 6, HX - 6), z: rnd(-HZ + 6, HZ - 6), alive: true };
    m.position.set(c.x, 0.6, c.z);
    scene.add(m);
    crumbs.push(c);
  }
  let crumbCount = 0;

  // The way out: a hole in the baseboard.
  const hole = { x: -HX + 0.5, z: -HZ + 14 };
  const arch = new THREE.Mesh(new THREE.CircleGeometry(5, 20, 0, Math.PI).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff0b0, fog: false, side: THREE.DoubleSide }));
  arch.position.set(-HX + 0.1, 0.01, hole.z);
  scene.add(arch);
  const archGlow = new THREE.PointLight(0xfff0b0, 160, 50, 1.6);
  archGlow.position.set(hole.x + 5, 4, hole.z);
  scene.add(archGlow);
  const exitSign = sign('EXIT', '#fff0a0', 9);
  exitSign.position.set(hole.x + 0.5, 14, hole.z);
  exitSign.rotation.y = Math.PI / 2;
  scene.add(exitSign);

  // --- The vacuum -----------------------------------------------------------------------------------------------
  const S = 9;
  const v = vacuum(0xd23a2a);
  v.group.scale.setScalar(S);
  scene.add(v.group);
  const rumble = new THREE.PointLight(0x30c0ff, 40, 30, 1.6);
  v.group.add(rumble);
  rumble.position.set(0, 0.8, -0.2);
  const vac = { x: -HX + 24, z: HZ - 24, heading: 0, speed: 0, target: new THREE.Vector3(), retarget: 0, state: 'patrol' as 'patrol' | 'chase' | 'search' };
  const R = 5.2; // its body
  const mouth = new THREE.Vector3();
  const mouthLocal = v.mouth.clone().multiplyScalar(S);

  // Its cord, plugged into the wall.
  const socket = new THREE.Vector3(HX - 1, 8, 10);
  const cordPts = Array.from({ length: 24 }, () => new THREE.Vector3());
  const cordGeo = new THREE.BufferGeometry().setFromPoints(cordPts);
  const cord = new THREE.Line(cordGeo, new THREE.LineBasicMaterial({ color: 0x101010 }));
  cord.frustumCulled = false;
  scene.add(cord);
  const plug = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 2), new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
  plug.position.copy(socket);
  scene.add(plug);

  const fade = new Fade(rt, 0x000000);
  let deaths = 0;
  let won = false;
  let respawning = 0;
  const status = new WorldButton(scene, 'Find the mouse hole', 0.3, 0.07, '#3a2a1a');
  status.enabled = false;
  rt.panels.add(status);
  addLobbyButton(rt, new THREE.Vector3(spawn.x - 3, 1.4, spawn.z - 3));
  const escaped = rt.panels.add(new WorldButton(scene, 'YOU ESCAPED! BACK TO LOBBY', 6, 1.2, '#2d6a3a', () => goToMode('hub')));
  escaped.mesh.position.set(hole.x + 12, 4, hole.z);
  escaped.mesh.visible = false;
  escaped.mesh.rotation.y = Math.PI / 2;

  const inRect = (x: number, z: number, r: Rect, pad = 0): boolean => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
  /** True if a block (other than the couch, index 0) stands between two points. */
  const blockedLine = (x0: number, z0: number, x1: number, z1: number): boolean => {
    for (let i = 1; i < 10; i++) {
      const t = i / 10;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      for (const r of blocks) if (r !== blocks[0] && inRect(x, z, r, -0.2)) return true;
    }
    return false;
  };
  const pickTarget = (): void => {
    for (let i = 0; i < 20; i++) {
      const x = rnd(-HX + 12, HX - 12);
      const z = rnd(-HZ + 12, HZ - 12);
      if (!blocks.some((r) => inRect(x, z, r, R + 2))) {
        vac.target.set(x, 0, z);
        return;
      }
    }
  };
  pickTarget();
  const couchRect = blocks.find((r) => r.x0 === couch.x - couch.w / 2)!;

  let time = 0;
  let suck = 0;
  rt.onFrame = (dt) => {
    time += dt;
    const px = rt.head.x;
    const pz = rt.head.z;
    const feet = rt.head.y - 0.6;
    const hidden = inRect(px, pz, couchRect, -1) && feet < couch.gap - 0.5;
    const distToVac = Math.hypot(px - vac.x, pz - vac.z);

    if (!won && respawning <= 0) {
      // What it wants.
      if (!hidden && distToVac < 60 && !blockedLine(vac.x, vac.z, px, pz)) {
        if (vac.state !== 'chase') rt.audio.play('growl', _a.set(vac.x, 3, vac.z), 0.6);
        vac.state = 'chase';
        vac.target.set(px, 0, pz);
      } else if (vac.state === 'chase') {
        vac.state = hidden ? 'search' : 'patrol';
        vac.retarget = 4;
      }
      vac.retarget -= dt;
      if (vac.state !== 'chase' && (vac.retarget <= 0 || Math.hypot(vac.target.x - vac.x, vac.target.z - vac.z) < 4)) {
        vac.retarget = rnd(5, 9);
        if (vac.state === 'search') vac.state = 'patrol';
        pickTarget();
      }
    }
    // Drive.
    const want = Math.atan2(-(vac.target.x - vac.x), -(vac.target.z - vac.z));
    let diff = want - vac.heading;
    diff -= Math.round(diff / (Math.PI * 2)) * Math.PI * 2;
    vac.heading += Math.max(-1.6 * dt, Math.min(1.6 * dt, diff));
    const goal = won || respawning > 0 ? 0 : vac.state === 'chase' ? 7.2 : 4.2;
    vac.speed += (goal * (Math.abs(diff) > 1.2 ? 0.3 : 1) - vac.speed) * Math.min(1, dt * 2);
    vac.x += -Math.sin(vac.heading) * vac.speed * dt;
    vac.z += -Math.cos(vac.heading) * vac.speed * dt;
    vac.x = Math.max(-HX + R, Math.min(HX - R, vac.x));
    vac.z = Math.max(-HZ + R, Math.min(HZ - R, vac.z));
    for (const r of blocks) {
      // Push the round body out of the rectangle.
      const cx = Math.max(r.x0, Math.min(r.x1, vac.x));
      const cz = Math.max(r.z0, Math.min(r.z1, vac.z));
      const dx = vac.x - cx;
      const dz = vac.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < R) {
        if (d > 1e-4) {
          vac.x = cx + (dx / d) * R;
          vac.z = cz + (dz / d) * R;
        } else vac.x += R;
        vac.speed *= 0.7;
        if (vac.state !== 'chase') pickTarget();
      }
    }
    v.group.position.set(vac.x, 0, vac.z);
    v.group.rotation.y = vac.heading;
    v.group.updateMatrixWorld(true);
    mouth.copy(mouthLocal);
    v.group.localToWorld(mouth);
    // The house is alive: the television flickers, dust bunnies roll, cereal waits to be eaten.
    tv.tick(time);
    tvLight.intensity = 90 + Math.sin(time * 17) * 30 * Math.sin(time * 3);
    for (const b of bunnies) {
      b.a += (Math.random() - 0.5) * dt * 3;
      b.x = Math.max(-HX + 4, Math.min(HX - 4, b.x + Math.cos(b.a) * dt * 2));
      b.z = Math.max(-HZ + 4, Math.min(HZ - 4, b.z + Math.sin(b.a) * dt * 2));
      b.m.position.set(b.x, 1.4, b.z);
      b.m.rotation.x += dt * 2;
      b.m.rotation.z += dt;
    }
    for (const cr of crumbs) {
      if (!cr.alive) continue;
      cr.m.rotation.z += dt;
      if (Math.hypot(px - cr.x, pz - cr.z) < 2.2 && feet < 3) {
        cr.alive = false;
        cr.m.visible = false;
        crumbCount++;
        rt.award(2, 'cereal');
        rt.audio.play('eat');
      }
    }
    // Its breath.
    if (!won) {
      const toX = mouth.x - px;
      const toZ = mouth.z - pz;
      const d = Math.hypot(toX, toZ);
      const fwdX = -Math.sin(vac.heading);
      const fwdZ = -Math.cos(vac.heading);
      const infront = (-toX * fwdX + -toZ * fwdZ) / Math.max(d, 0.01); // is the player in front of the mouth
      const low = feet < 9;
      if (respawning <= 0 && ((d < 30 && low && infront > 0.15 && !blockedLine(mouth.x, mouth.z, px, pz) && !hidden) || (distToVac < 3.2 && feet < 6))) {
        const strength = 26 * Math.pow(1 - d / 30, 1.4) + (d < 10 ? 10 : 0);
        rt.locomotion.carry(_b.set((toX / d) * strength * dt, 0, (toZ / d) * strength * dt));
        rt.hands.all.forEach((h) => h.pulse(0.1 + 0.5 * (1 - d / 30), 40));
        if (d < 3.4 || (distToVac < 3.2 && feet < 6)) {
          deaths++;
          respawning = 1.4;
          fade.target = 1;
          rt.audio.play('suck', undefined, 1);
          rt.audio.play('sting');
        }
      }
      suck -= dt;
      if (suck <= 0) {
        suck = 0.4;
        rt.audio.play('suck', _a.set(vac.x, 3, vac.z), Math.max(0.12, 1 - distToVac / 90));
      }
    }
    if (respawning > 0) {
      respawning -= dt;
      if (respawning <= 0.5 && fade.target === 1) {
        rt.respawn();
        vac.x = -HX + 24;
        vac.z = HZ - 24;
        vac.state = 'patrol';
        vac.speed = 0;
        fade.target = 0;
      }
    }
    fade.update(dt);
    // The cord sags between the wall and the vacuum.
    const end = _a.set(vac.x + Math.sin(vac.heading) * 8, 3, vac.z + Math.cos(vac.heading) * 8);
    cordPts.forEach((p, i) => {
      const t = i / (cordPts.length - 1);
      p.lerpVectors(socket, end, t);
      p.y += -Math.sin(t * Math.PI) * 6 + 0.3;
    });
    cordGeo.setFromPoints(cordPts);
    rumble.intensity = 40 * (0.8 + 0.2 * Math.sin(time * 30));
    // Out through the hole?
    if (!won && Math.hypot(px - hole.x, pz - hole.z) < 5) {
      won = true;
      rt.award(250, 'ESCAPED!');
      escaped.mesh.visible = true;
      rt.audio.play('unlock');
    }
    status.mesh.position.set(rt.locomotion.hands[0].position.x, rt.locomotion.hands[0].position.y + 0.1, rt.locomotion.hands[0].position.z);
    status.mesh.lookAt(rt.head);
    status.setLabel(won ? 'Free!' : hidden ? 'Hidden under the couch' : vac.state === 'chase' ? 'IT SEES YOU' : `Find the hole · sucked ${deaths}x`);
  };

  finishMode(rt, 'VACUUM · you are tiny. Avoid its mouth, hide under the couch, reach the mouse hole. L = lobby', '#ffb090', { vac, blocks, state: () => ({ won, deaths, crumbs: crumbCount }), hole, couch });
}
