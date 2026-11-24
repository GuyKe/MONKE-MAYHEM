import * as THREE from 'three';
import { LOCOMOTION } from '../config';
import { algoPicture } from '../hub/statues';
import { sign } from '../mode/figures';
import { goToMode } from '../mode/nav';
import { addGun, Grabbables, makeItem, raySphere, Tracers, type Item } from '../mode/props';
import { createRuntime } from '../mode/runtime';
import { addLobbyButton, Fade, finishMode, say } from '../mode/shell';
import { earth, rocket } from '../mode/things';
import { WorldButton } from '../ui/panel';

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

interface Enemy {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  phase: number;
  alive: boolean;
  respawn: number;
  pop: number;
  speed: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const ROCKET = new THREE.Vector3(0, 0, -150);

/**
 * O ALGO: you are on the moon, the picture is coming for you, and the only way home is a rocket that is missing three parts.
 * Find the parts (look for the glowing columns), carry them back, and launch. Guns lie about: shoot the picture. It will come back.
 */
export async function runAlgo(): Promise<void> {
  (LOCOMOTION as { gravity: number }).gravity = 3.2; // the moon
  const spawn = new THREE.Vector3(0, 0, 0);
  const rt = await createRuntime({ background: 0x000004, fog: new THREE.Fog(0x050508, 120, 380), spawn, killY: -40 });
  const { scene } = rt;
  scene.add(new THREE.AmbientLight(0x4a4e60, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 3.2);
  sun.position.set(80, 120, 60);
  scene.add(sun);

  // --- The moon ----------------------------------------------------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#8e8e92';
  c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    c.fillStyle = Math.random() < 0.5 ? 'rgba(60,60,66,0.25)' : 'rgba(200,200,205,0.2)';
    c.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  for (let i = 0; i < 7; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 8 + Math.random() * 26;
    c.strokeStyle = 'rgba(40,40,46,0.55)';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = 'rgba(70,70,76,0.35)';
    c.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 60);
  tex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex }));
  scene.add(ground);
  rt.solidBox(0, -0.5, 0, 700, 0.5, 700);
  // Stars, and home.
  const stars = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i++) {
    const a = Math.random() * Math.PI * 2;
    const e = Math.acos(1 - Math.random() * 0.98);
    stars[i * 3] = Math.sin(e) * Math.cos(a) * 480;
    stars[i * 3 + 1] = Math.cos(e) * 480;
    stars[i * 3 + 2] = Math.sin(e) * Math.sin(a) * 480;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3));
  const starPoints = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false, fog: false }));
  scene.add(starPoints);
  const home = earth(70);
  home.position.set(-220, 210, -340);
  scene.add(home);
  // Boulders.
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x77777c, flatShading: true });
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = rnd(10, 260);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (Math.hypot(x - ROCKET.x, z - ROCKET.z) < 20) continue;
    const r = rnd(0.8, 5);
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), rockMat);
    m.scale.set(r, r * rnd(0.5, 0.9), r * rnd(0.8, 1.2));
    m.position.set(x, r * 0.3, z);
    m.rotation.y = rnd(0, 6);
    scene.add(m);
    if (r > 2) rt.solidBox(x, r * 0.35, z, r * 0.6, r * 0.35, r * 0.6);
  }
  // A flag where you landed, and your tracks.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
  pole.position.set(2, 1.5, 3);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshBasicMaterial({ color: 0xd02030, side: THREE.DoubleSide }));
  flag.position.set(2.75, 2.5, 3);
  scene.add(pole, flag);

  // --- The rocket and its missing parts ------------------------------------------------------------------------
  const ship = rocket();
  ship.position.copy(ROCKET);
  scene.add(ship);
  rt.solidBox(ROCKET.x, 4, ROCKET.z, 1.5, 4, 1.5);
  const beaconMat = (color: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const shipBeacon = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 120, 8, 1, true).translate(0, 60, 0), beaconMat(0x60a0ff));
  shipBeacon.position.copy(ROCKET);
  scene.add(shipBeacon);

  const grabbables = new Grabbables(rt);
  const tracers = new Tracers(scene);
  const moonG = 2.6;
  type PartKind = 'fuel' | 'engine' | 'chip';
  const parts: Array<{ kind: PartKind; item: Item; placed: boolean; beacon: THREE.Mesh }> = [];
  const partGroup = (kind: PartKind): THREE.Group => {
    const g = new THREE.Group();
    const lam = (color: number, emissive = 0): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color, flatShading: true, emissive });
    if (kind === 'fuel') {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 14), lam(0xc02828)));
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.12, 14), lam(0xf0d030));
      band.position.y = 0.1;
      g.add(band);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 8), lam(0x303030));
      cap.position.y = 0.4;
      g.add(cap);
    } else if (kind === 'engine') {
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.42, 0.55, 12, 1, true), lam(0x6a6a72));
      bell.material.side = THREE.DoubleSide;
      g.add(bell);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.25, 10), lam(0x3a3a40));
      top.position.y = 0.35;
      g.add(top);
    } else {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.4), lam(0x103a18, 0x30ff60)));
      for (let i = 0; i < 4; i++) {
        const chip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.07), lam(0x202020, 0x20a040));
        chip.position.set(-0.08 + (i % 2) * 0.16, 0.05, -0.1 + Math.floor(i / 2) * 0.2);
        g.add(chip);
      }
    }
    return g;
  };
  const colors: Record<PartKind, number> = { fuel: 0xff5040, engine: 0xc0c0ff, chip: 0x40ff70 };
  (['fuel', 'engine', 'chip'] as PartKind[]).forEach((kind, i) => {
    const a = (i / 3) * Math.PI * 2 + rnd(-0.4, 0.4) + 0.6;
    const d = rnd(45, 100);
    const pos = new THREE.Vector3(Math.cos(a) * d, 0.3, Math.sin(a) * d * 0.9 - 40);
    const obj = partGroup(kind);
    obj.position.copy(pos);
    obj.scale.setScalar(1.2);
    scene.add(obj);
    const item = makeItem(obj, 0.4, { gravity: moonG, rest: 0.3, bounce: 0.2 });
    grabbables.add(item);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 90, 8, 1, true).translate(0, 45, 0), beaconMat(colors[kind]));
    beacon.position.copy(pos);
    beacon.position.y = 0;
    scene.add(beacon);
    parts.push({ kind, item, placed: false, beacon });
  });
  // Where the parts go on the ship.
  const slot: Record<PartKind, THREE.Vector3> = {
    fuel: new THREE.Vector3(ROCKET.x + 2.1, 1.6, ROCKET.z + 0.6),
    engine: new THREE.Vector3(ROCKET.x, 0.6, ROCKET.z),
    chip: new THREE.Vector3(ROCKET.x, 3.0, ROCKET.z - 1.55),
  };
  let installed = 0;

  // Guns for killing the picture.
  let kills = 0;
  const enemies: Enemy[] = [];
  const hitEnemy = (origin: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 | null => {
    let best: Enemy | null = null;
    let bestT = 150;
    for (const e of enemies) {
      if (!e.alive) continue;
      const t = raySphere(origin, dir, _a.set(e.x, 1.6, e.z), 1.5);
      if (t !== null && t < bestT) {
        bestT = t;
        best = e;
      }
    }
    if (!best) return null;
    best.alive = false;
    best.pop = 0.5;
    best.respawn = rnd(7, 10);
    kills++;
    rt.audio.play('pop', _a.set(best.x, 1.6, best.z), 1);
    return origin.clone().addScaledVector(dir, bestT);
  };
  for (let i = 0; i < 7; i++) {
    const a = rnd(0, Math.PI * 2);
    const d = rnd(4, i < 3 ? 12 : 60);
    const item = addGun(rt, grabbables, tracers, new THREE.Vector3(Math.cos(a) * d, 0.2, Math.sin(a) * d), hitEnemy, 0x44484f);
    item.gravity = moonG;
  }

  // --- The picture -----------------------------------------------------------------------------------------------
  const pic = algoPicture();
  const makeEnemy = (): Enemy => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: pic, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    mesh.scale.set(3.2, 3.2, 1);
    scene.add(mesh);
    const e: Enemy = { mesh, x: 0, z: 0, phase: Math.random() * 6, alive: true, respawn: 0, pop: 0, speed: rnd(3.6, 4.6) };
    place(e);
    enemies.push(e);
    return e;
  };
  const place = (e: Enemy): void => {
    const a = Math.random() * Math.PI * 2;
    const d = rnd(40, 75);
    e.x = rt.head.x + Math.cos(a) * d;
    e.z = rt.head.z + Math.sin(a) * d;
    e.alive = true;
    e.mesh.visible = true;
  };
  for (let i = 0; i < 7; i++) makeEnemy();

  const fade = new Fade(rt, 0x000000);
  let deaths = 0;
  let respawning = 0;
  let grace = 5;
  let phase: 'play' | 'countdown' | 'flying' | 'home' = 'play';
  let phaseTime = 0;
  let aspectSet = false;
  const wrist = new WorldButton(scene, 'Parts 0/3', 0.32, 0.07, '#2a2a3a');
  wrist.enabled = false;
  rt.panels.add(wrist);
  addLobbyButton(rt, new THREE.Vector3(-2.5, 1.4, -3));
  const launch = rt.panels.add(new WorldButton(scene, 'LAUNCH', 3, 0.9, '#2d6a3a', () => {
    if (phase !== 'play' || installed < 3) return;
    if (Math.hypot(rt.head.x - ROCKET.x, rt.head.z - ROCKET.z) > 12) return;
    phase = 'countdown';
    phaseTime = 0;
  }));
  launch.mesh.position.set(ROCKET.x - 3, 1.4, ROCKET.z + 4.5);
  launch.enabled = false;
  launch.draw();
  const homeButton = rt.panels.add(new WorldButton(scene, 'WELCOME HOME! BACK TO LOBBY', 4, 0.8, '#2d6a3a', () => goToMode('hub')));
  homeButton.mesh.visible = false;
  const homeSign = sign('YOU MADE IT HOME', '#80ff90', 8);
  homeSign.visible = false;
  scene.add(homeSign);
  const tip = sign('FIND 3 ROCKET PARTS · follow the glowing columns', '#e0e0f0', 9);
  tip.position.set(0, 5, -8);
  scene.add(tip);

  const install = (kind: PartKind): void => {
    const p = parts.find((x) => x.kind === kind)!;
    p.placed = true;
    p.item.canGrab = false;
    p.item.gravity = 0;
    p.item.vel.set(0, 0, 0);
    p.item.obj.position.copy(slot[kind]);
    p.item.obj.rotation.set(0, 0, 0);
    p.item.obj.scale.setScalar(kind === 'chip' ? 1.5 : 2);
    scene.remove(p.beacon);
    installed++;
    rt.audio.play('unlock');
    rt.hands.all.forEach((h) => h.pulse(0.8, 150));
    if (installed === 3) {
      launch.enabled = true;
      launch.draw();
      shipBeacon.material = beaconMat(0x60ff80);
    }
  };

  let time = 0;
  let voice = 5;
  rt.onFrame = (dt) => {
    time += dt;
    grabbables.update(dt);
    tracers.update(dt);
    starPoints.position.set(rt.head.x, 0, rt.head.z);
    home.rotation.y += dt * 0.02;
    flag.rotation.y = Math.sin(time * 0.7) * 0.15;
    parts.forEach((p) => {
      (p.beacon.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.15 * Math.sin(time * 3 + p.item.obj.id);
      if (!p.placed && p.item.held === -1 && Math.hypot(p.item.obj.position.x - ROCKET.x, p.item.obj.position.z - ROCKET.z) < 5.5 && phase === 'play') install(p.kind);
    });
    // The picture's aspect, once it has loaded.
    if (!aspectSet && pic.image && (pic.image as HTMLImageElement).width) {
      const img = pic.image as HTMLImageElement;
      const ratio = img.width / img.height;
      enemies.forEach((e) => e.mesh.scale.set(3.4 * ratio, 3.4, 1));
      aspectSet = true;
    }

    const px = rt.head.x;
    const pz = rt.head.z;
    if (phase === 'play' || phase === 'countdown') {
      if (respawning > 0) {
        respawning -= dt;
        if (respawning <= 0.4 && fade.target === 1) {
          rt.respawn();
          enemies.forEach((e) => place(e));
          grace = 4;
          fade.target = 0;
        }
      } else grace -= dt;
      let nearest = Infinity;
      for (const e of enemies) {
        if (!e.alive) {
          if (e.pop > 0) {
            e.pop -= dt;
            e.mesh.scale.multiplyScalar(1 + dt * 3);
            (e.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, e.pop * 2);
            if (e.pop <= 0) {
              e.mesh.visible = false;
              e.mesh.scale.multiplyScalar(0);
            }
          } else {
            e.respawn -= dt;
            if (e.respawn <= 0) {
              place(e);
              const img = pic.image as HTMLImageElement | undefined;
              const ratio = img && img.width ? img.width / img.height : 1;
              e.mesh.scale.set(3.4 * ratio, 3.4, 1);
              (e.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
            }
          }
          continue;
        }
        const dx = px - e.x;
        const dz = pz - e.z;
        const d = Math.hypot(dx, dz);
        nearest = Math.min(nearest, d);
        const sp = grace > 0 || respawning > 0 ? 0 : e.speed;
        if (d > 0.01) {
          e.x += (dx / d) * sp * dt;
          e.z += (dz / d) * sp * dt;
        }
        e.phase += dt * 3.2;
        // Hopping, in low gravity.
        e.mesh.position.set(e.x, 1.7 + Math.abs(Math.sin(e.phase)) * 1.6, e.z);
        e.mesh.rotation.set(0, Math.atan2(dx, dz), Math.sin(e.phase * 0.5) * 0.12);
        if (respawning <= 0 && d < 1.5 && Math.abs(rt.head.y - 1.7) < 3) {
          deaths++;
          respawning = 1.4;
          fade.target = 1;
          rt.audio.play('sting');
          rt.hands.all.forEach((h) => h.pulse(1, 250));
        }
      }
      voice -= dt;
      if (voice <= 0 && nearest < 40) {
        voice = rnd(5, 9);
        say('oh algo', 0.2, 0.7);
      }
      wrist.mesh.position.copy(rt.locomotion.hands[0].position).add(_b.set(0, 0.12, 0));
      wrist.mesh.lookAt(rt.head);
      wrist.setLabel(installed < 3 ? `Parts ${installed}/3 · kills ${kills}` : 'Ship ready! Launch it');
    }
    // The launch.
    if (phase === 'countdown') {
      phaseTime += dt;
      launch.setLabel(`${Math.max(0, 3 - Math.floor(phaseTime))}`);
      ship.position.x = ROCKET.x + (Math.random() - 0.5) * 0.05 * phaseTime;
      if (phaseTime > 3) {
        phase = 'flying';
        phaseTime = 0;
        rt.audio.play('whirr');
        rt.audio.play('growl');
      }
    } else if (phase === 'flying') {
      phaseTime += dt;
      const dy = 4 * phaseTime * dt * 6;
      ship.position.y += dy;
      shipBeacon.visible = false;
      parts.forEach((p) => p.item.obj.position.y += dy);
      // Anyone standing near rides along.
      if (Math.hypot(px - ROCKET.x, pz - ROCKET.z) < 12) rt.locomotion.carry(_b.set(0, dy, 0));
      if (phaseTime > 2 && Math.random() < dt * 8) rt.audio.play('whirr', undefined, 0.5);
      fade.target = phaseTime > 6 ? 1 : 0;
      if (phaseTime > 8) {
        phase = 'home';
        phaseTime = 0;
        rt.respawn();
        enemies.forEach((e) => (e.mesh.visible = false));
        ship.position.y = -50;
        homeButton.mesh.visible = true;
        homeSign.visible = true;
        fade.target = 0;
        (scene.background as THREE.Color).set(0x6ac0ff);
        (scene.fog as THREE.Fog).color.set(0x6ac0ff);
        tex.repeat.set(30, 30);
        ground.material = new THREE.MeshLambertMaterial({ color: 0x4aa84a });
        scene.add(new THREE.HemisphereLight(0xffffff, 0x60a060, 2.0));
        starPoints.visible = false;
        home.visible = false;
        rt.audio.play('unlock');
      }
    }
    if (phase === 'home') {
      homeButton.mesh.position.set(rt.head.x, 1.2, rt.head.z - 3);
      homeSign.position.set(rt.head.x, 4, rt.head.z - 6);
    }
    fade.update(dt);
  };

  finishMode(rt, 'O ALGO · find 3 rocket parts, get home. Grab (grip), shoot (trigger). L = lobby', '#c0c0f0', { enemies, parts, grabbables, install, state: () => ({ installed, kills, deaths, phase }), launch });
}
