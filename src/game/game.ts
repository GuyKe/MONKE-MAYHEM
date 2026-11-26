import * as THREE from 'three';
import { skinById } from './avatar';
import { FLOOR_Y } from './nav';
import { itemById } from './cosmetics';
import { Door } from './doors';
import { createEngine, type Engine } from './engine';
import { Facility, ROOM_Z } from './facility';
import { CctvMap } from './map';
import { Locker } from './lockers';
import { batchStatic } from './batch';
import { Grabbables, type Item } from './grab';
import { Fade, Toast, Wrist } from './hud';
import { makeFlashlight, makeGlowstick, makeLog, makeRadar, type ItemContext } from './items';
import { Lobby } from './lobby';
import { Monster, type MonsterKind, type Noise } from './monsters';
import { PauseMenu } from './pause';
import { Save } from './save';
import { rnd } from './shapes';
import { Voice } from './voice';

const LOGS = [
  ['LOG 1 · SERVER ROOM', 'They told us the glass was for the visitors.', 'It was never for the visitors.'],
  ['LOG 2 · COLD STORE', 'We stopped freezing them on day nine.', 'They do not like the cold. They like the quiet.'],
  ['LOG 3 · BOILER ROOM', 'The relays hold the doors. Cut the power', 'and the doors stop listening to us.'],
  ['LOG 4 · ARMORY', 'Guns do nothing. The only thing that hurt one', 'was a door. Remember that.'],
  ['LOG 5 · MORGUE', 'The mimic wears our faces. It only moves', 'when nobody is looking. Never look away.'],
  ['LOG 6 · POWER ROOM', 'If the lights die, stay still. They hear', 'a footstep from the next hall.'],
  ['LOG 7 · SPECIMEN LAB', 'Tank 4 is empty. We did not open it.', 'It opened itself.'],
  ['LOG 8 · BREAK ROOM', 'Lockers are not safe. They are only dark.', 'Hold still, hold your breath, and pray.'],
];

const LOBBY_SPAWN = new THREE.Vector3(0, 0, -3.2);
const RED = new THREE.Color(1, 0.1, 0.05);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const HALL_VIEW = new THREE.Vector3(0, -4, 26);
const _f = new THREE.Vector3();

/**
 * LOCKDOWN. You wake in a clean safe room with a window onto the facility's machine hall, far below. Break the glass, drop to the
 * catwalk, and find a way out past the things that live there: restore power at two relays, reach the exit lift, and do not get
 * caught in a door. Doors are the only weapon you have, and they cut both ways.
 */
export async function runGame(): Promise<void> {
  const save = new Save();
  const e = await createEngine({ background: 0x04060a, spawn: LOBBY_SPAWN, killY: -40 });
  const { scene } = e;
  scene.fog = new THREE.Fog(0x04060a, 12, 95);
  const hemi = new THREE.HemisphereLight(0x8aa0c0, 0x202428, 0.7);
  const ambient = new THREE.AmbientLight(0x303848, 0.5);
  scene.add(hemi, ambient);

  // One flashlight beam for the whole game: it goes to whichever flashlight is held and on.
  const torchSpot = new THREE.SpotLight(0xfff2d8, 0, 34, 0.5, 0.55, 1.2);
  scene.add(torchSpot, torchSpot.target);
  const toast = new Toast(e.camera);
  const fade = new Fade(e.camera, 0x000000);
  const wrist = new Wrist(e);
  const voice = new Voice(e.audio);

  // --- Sound the monsters can hear -----------------------------------------------------------------------------
  const noises: Noise[] = [];
  let noiseId = 0;
  const noise = (pos: THREE.Vector3, radius: number, kind: string): void => {
    noises.push({ id: ++noiseId, pos: pos.clone(), radius, kind, age: 0 });
  };

  const grab = new Grabbables(e);
  const monsters: Monster[] = [];
  const ctx: ItemContext = {
    e,
    grab,
    noise,
    monsters: () => monsters.map((m) => ({ pos: m.pos, kind: m.kind })),
    floorAt: (x, y, z) => facility.floorAt(x, y, z),
    readLog: (id) => readLog(id),
  };
  const facility = new Facility(e);
  grab.floorAt = (x, y, z) => facility.floorAt(x, y, z);
  const lobby = new Lobby(e, save, ctx);

  // A security monitor on the lobby wall.
  const cctv = new CctvMap();
  cctv.mesh.position.set(-7.25, 2.3, 6.55);
  cctv.mesh.rotation.y = Math.PI;
  scene.add(cctv.mesh);

  // Lockers along the hall walls: hide in one and keep still.
  const lockers: Locker[] = [];
  for (const z of [26, 38, 50, 62]) {
    lockers.push(new Locker(e, -19.3, z, 1), new Locker(e, 19.3, z, -1));
    for (const x of [-19.4, 19.4]) {
      facility.nav.setBlock(0, x - 0.7, x + 0.7, z - 0.6, z + 0.6, false);
      facility.blockers.push({ x0: x - 0.6, x1: x + 0.6, z0: z - 0.6, z1: z + 0.6 });
    }
  }

  const lockerRoot = new THREE.Group();
  scene.add(lockerRoot);
  for (const l of lockers) lockerRoot.add(l.group);
  batchStatic(lockerRoot);

  // Data logs on stands in every room.
  const readLog = (id: number): void => {
    const first = !save.data.logs.includes(id);
    for (const [i, line] of LOGS[id].entries()) toast.show(line, i === 0 ? '#9ad8ff' : '#e8e8e8', 6);
    if (first) {
      save.data.logs.push(id);
      save.addCredits(25);
      toast.show(`+25 credits · ${save.data.logs.length}/8 logs`, '#e8d060', 4);
      e.audio.play('chime');
      lobby.refreshWardrobe();
    }
  };
  ROOM_Z.forEach((zc, i) => {
    for (const side of [1, -1]) {
      const id = (side > 0 ? 0 : 4) + i;
      const x = side * 21.3;
      const z = zc + 4.5;
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 1.0, 10), new THREE.MeshStandardMaterial({ color: 0x30363e, roughness: 0.5, metalness: 0.5 }));
      stand.position.set(x, FLOOR_Y + 0.5, z);
      scene.add(stand);
      if (!save.data.logs.includes(id)) makeLog(ctx, new THREE.Vector3(x, FLOOR_Y + 1.08, z), id);
    }
  });

  // Gear lying about the facility (fresh each run).
  const worldGear: Item[] = [];
  const spawnGear = (): void => {
    for (const it of worldGear.splice(0)) {
      if (it.held !== -1) continue;
      grab.remove(it);
      it.obj.parent?.remove(it.obj);
    }
    const spots = facility.gearSpots.slice().sort(() => Math.random() - 0.5).slice(0, 10);
    spots.forEach((p, i) => {
      const at = p.clone();
      at.y += 0.15;
      worldGear.push(i < 5 ? makeGlowstick(ctx, at, i) : i < 8 ? makeFlashlight(ctx, at) : makeRadar(ctx, at));
    });
  };
  spawnGear();

  // --- Looks -----------------------------------------------------------------------------------------------------
  const worn: THREE.Object3D[] = [];
  const applyLook = (): void => {
    for (const o of worn.splice(0)) o.parent?.remove(o);
    const d = save.data;
    const skin = skinById(d.equipped.skin);
    e.body.setSkin(skin);
    e.hands.left.setGlove(skin.glove);
    e.hands.right.setGlove(skin.glove);
    for (const id of [d.equipped.hat, d.equipped.acc]) {
      const item = itemById(id);
      if (!item?.build) continue;
      if (item.on === 'head') {
        const o = item.build();
        e.body.wearOnHead(o);
        worn.push(o);
      } else if (item.on === 'torso') {
        const o = item.build();
        e.body.torso.add(o);
        worn.push(o);
      } else if (item.on === 'hands') {
        for (const hand of [e.hands.left, e.hands.right]) {
          const o = item.build();
          hand.mesh.add(o);
          worn.push(o);
        }
      }
    }
  };
  lobby.onLook = applyLook;
  lobby.onTip = (text) => {
    toast.show('BOT-9', '#9ad8ff', 5);
    toast.show(text.length > 52 ? text.slice(0, text.lastIndexOf(' ', 52)) : text, '#e8f0f4', 5);
    if (text.length > 52) toast.show(text.slice(text.lastIndexOf(' ', 52) + 1), '#e8f0f4', 5);
  };
  lobby.onCourse = (seconds, best) => {
    toast.show(`COURSE: ${seconds.toFixed(1)}s`, '#60ff90', 4);
    if (best) toast.show('NEW BEST!', '#ffd060', 4);
    save.addCredits(5);
  };
  lobby.onVend = (item) => {
    const price = item === 'energy' ? 20 : 5;
    if (save.data.credits < price) {
      e.audio.play('deny');
      toast.show('NOT ENOUGH CREDITS', '#ff6060', 2);
      return;
    }
    save.addCredits(-price);
    lobby.refreshWardrobe();
    if (item === 'energy') {
      boost = true;
      e.audio.play('buy');
      toast.show('ENERGY CELL: faster for your next run', '#80ff90', 4);
    } else {
      e.audio.play('splat', e.head, 0.4);
      toast.show(['It tastes like regret.', 'Best before: never.', 'Is that meat?', 'Crunchy. Too crunchy.'][Math.floor(Math.random() * 4)], '#e8d8a0', 3);
    }
  };
  applyLook();
  e.updaters.push((dt) => {
    for (const o of worn) {
      o.traverse((c) => {
        if (c.userData.spin) c.rotation.y += dt * 20;
        if (c.userData.wing) c.rotation.z += Math.sin(e.time * 4) * 0.004 * c.userData.wing;
        if (c.userData.pulse) c.scale.setScalar(1 + 0.25 * Math.sin(e.time * 6));
        if (c.userData.ring) c.rotation.z += dt * c.userData.ring;
        if (c.userData.swim) c.position.x = Math.sin(e.time * 1.4) * 0.12;
      });
    }
  });

  // --- Voice -------------------------------------------------------------------------------------------------------
  lobby.onMic = (on) => {
    if (on && !voice.enabled) void voice.enable().then((ok) => (ok ? voice.setMonitor(true) : toast.show('MICROPHONE BLOCKED', '#ff6060')));
    else voice.setMonitor(on);
  };

  // --- The things in the dark ------------------------------------------------------------------------------------------
  const kinds: MonsterKind[] = ['stalker', 'skitter', 'warden', 'mimic'];
  kinds.forEach((k, i) => monsters.push(new Monster(e, k, facility.spawns[i])));
  const resetMonsters = (): void => monsters.forEach((m, i) => m.place(facility.spawns[i % facility.spawns.length]));

  // --- Lights ----------------------------------------------------------------------------------------------------------
  const allFixtures = [...lobby.fixtures, ...facility.fixtures];
  const pool = [0, 1, 2].map(() => {
    const l = new THREE.PointLight(0xcfe4ff, 12, 22, 1.5);
    scene.add(l);
    return l;
  });
  let lightTimer = 0;
  let lockdownRed = 0;

  // --- State ---------------------------------------------------------------------------------------------------------------
  let dead = false;
  let deadTimer = 0;
  let escaped = false;
  let lockdown = 0;
  let nextLockdown = rnd(70, 120);
  let runTime = 0;
  let runCredits = 0;
  let heartbeat = 0;
  let faced = false;
  let wasGrounded = true;
  let airVy = 0;
  let stepNoise = 0;
  let voiceNoise = 0;
  let relays = 0;
  const doorTimers = new Map<Door, number>();

  let brokenFor = 0;
  let boost = false;
  let lastLobby = true;
  let panelTimer = 0;
  let blackout = 0;
  let nextBlackout = rnd(90, 150);
  let nextScare = rnd(10, 20);
  let hideTimer = 0;
  let hidden = false;
  let findTimer = 0;
  let hideLocker: Locker | null = null;
  const fear = new Fade(e.camera, 0x500000);
  const inLobby = (): boolean => e.head.z < 7.3 && e.head.y > -1.5;

  const faceWindow = (): void => {
    _f.set(0, 0, -1).applyQuaternion(e.headQuat);
    const cur = Math.atan2(-_f.x, -_f.z);
    let d = Math.PI - cur;
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
    e.locomotion.turn(d);
  };

  const pause = new PauseMenu(e, {
    toLobby: () => returnToLobby('You went back to the lobby.'),
    toggleMic: () => {
      if (voice.enabled) voice.disable();
      else void voice.enable().then((ok) => !ok && toast.show('MICROPHONE BLOCKED', '#ff6060'));
    },
    micOn: () => voice.enabled,
  });
  e.onPause = () => pause.toggle();

  const resetRun = (): void => {
    runTime = 0;
    runCredits = 0;
    relays = 0;
    lockdown = 0;
    lockdownRed = 0;
    nextLockdown = rnd(70, 120);
    e.audio.setAlarm(false);
    for (const d of facility.doors) {
      d.auto = false;
      d.jam = 'none';
      d.target = d === facility.exitDoor ? null : 0;
      d.setLocked(d === facility.exitDoor);
    }
    for (const r of facility.relays) {
      r.active = false;
      r.button.enabled = true;
      r.button.setLabel('RESTORE POWER');
      (r.lamp.material as THREE.MeshStandardMaterial).emissive.setHex(0xff2020);
      (r.lamp.material as THREE.MeshStandardMaterial).color.setHex(0xff3030);
    }
    facility.evacuate.enabled = false;
    resetMonsters();
    noises.length = 0;
    blackout = 0;
    nextBlackout = rnd(90, 150);
    spawnGear();
  };

  const returnToLobby = (message: string): void => {
    e.respawn(LOBBY_SPAWN);
    faceWindow();
    boost = false;
    resetRun();
    lobby.glass.reset();
    dead = false;
    escaped = false;
    fade.setColor(0x000000);
    fade.target = 0;
    toast.show(message, '#cfe8ff', 3.5);
    e.audio.play('chime');
  };

  const die = (cause: 'caught' | 'crushed'): void => {
    if (dead || escaped) return;
    dead = true;
    deadTimer = 3.2;
    const s = save.data.stats;
    s.deaths++;
    if (cause === 'crushed') s.crushed++;
    s.seconds += runTime;
    const bank = Math.round(runCredits * 0.4);
    save.addCredits(bank);
    save.save();
    fade.setColor(cause === 'crushed' ? 0x400000 : 0x000000);
    fade.target = 1;
    e.audio.play(cause === 'crushed' ? 'doorCrush' : 'die');
    if (cause === 'crushed') e.audio.play('splat', e.head, 1);
    e.buzz('both', 1, 600);
    toast.show(cause === 'crushed' ? 'CRUSHED BY A DOOR' : 'CAUGHT', '#ff4040', 3);
    if (bank) toast.show(`+${bank} credits kept`, '#e8d060', 3);
    lobby.refreshWardrobe();
  };

  const escape = (): void => {
    if (dead || escaped) return;
    escaped = true;
    deadTimer = 3.4;
    const s = save.data.stats;
    s.escapes++;
    s.seconds += runTime;
    const bank = runCredits + 100;
    save.addCredits(bank);
    save.save();
    fade.setColor(0xffffff);
    fade.target = 1;
    e.audio.play('unlock');
    e.buzz('both', 0.6, 300);
    toast.show('ESCAPED!', '#60ff90', 3.5);
    toast.show(`+${bank} credits`, '#e8d060', 3.5);
    lobby.refreshWardrobe();
  };

  facility.onEvacuate = escape;
  facility.onRelay = (r) => {
    relays++;
    runCredits += 30;
    toast.show(`${r.name}: POWER RESTORED (${relays}/2)`, '#60ff90', 3);
    if (relays >= 2) {
      facility.exitDoor.setLocked(false);
      facility.exitDoor.target = 1;
      facility.evacuate.enabled = true;
      toast.show('EXIT GATE UNLOCKED', '#60ff90', 4);
      e.audio.play('unlock');
    }
    // The relay hums: monsters come to look.
    noise(r.pos, 30, 'relay');
  };
  facility.onDoorSlam = (d) => noise(d.center, 22, 'door slam');
  lobby.glass.onCrack = (n, at) => noise(at, 10 + n * 6, 'glass');
  lobby.glass.onShatter = (at) => {
    noise(at, 55, 'glass shatter');
    toast.show('THE GLASS IS GONE', '#ffcf40', 3);
    toast.show('Drop to the catwalk. Find the relays.', '#e8e8e8', 4);
  };

  // --- Per frame ---------------------------------------------------------------------------------------------------------------
  const lastItemPos = new Map<object, THREE.Vector3>();
  const handInfo = [
    { pos: e.locomotion.hands[0].position, squeezed: false },
    { pos: e.locomotion.hands[1].position, squeezed: false },
  ];
  const handPos: THREE.Vector3[] = [handInfo[0].pos, handInfo[1].pos];
  const itemPos: THREE.Vector3[] = [];
  const itemSpeed: number[] = [];
  e.onFrame = (dt) => {
    const t = e.time;
    if (e.presenting && !faced) {
      faced = true;
      faceWindow();
      toast.show('FACILITY 9 · SUBJECT REGISTRY', '#9ad8ff', 4);
      toast.show('Name yourself. Get dressed. Then break the glass.', '#e8e8e8', 5);
    }
    toast.update(dt);
    fade.update(dt, dead || escaped ? 2.5 : 4);
    wrist.update();
    pause.refresh();
    grab.update(dt);

    const lobbyNow = inLobby();
    e.locomotion.speedScale = 1.35 * (boost && !lobbyNow ? 1.25 : 1);
    if (lobbyNow !== lastLobby) {
      lastLobby = lobbyNow;
      lobby.setPanelsVisible(lobbyNow);
    }
    panelTimer -= dt;
    if (panelTimer <= 0) {
      panelTimer = 0.5;
      for (const d of facility.doors) d.setPanelVisible(!lobbyNow && d.center.distanceToSquared(e.head) < 26 * 26);
    }
    // Left alone, the broken window reseals itself after a while (the facility mends it).
    if (lobby.glass.broken) {
      brokenFor += dt;
      const nearGlass = e.head.z > 5.4 && e.head.z < 8.4 && Math.abs(e.head.x) < 6.6 && e.head.y > -1;
      if (brokenFor > 150 && !nearGlass) {
        brokenFor = 0;
        lobby.glass.reset(true);
        toast.show('BLAST GLASS RESEALED', '#9ad8ff', 3);
      }
    } else brokenFor = 0;
    e.audio.setZone(facility.zoneAt(e.head));
    facility.update(dt, t);

    // The hands, for doors and the window.
    for (let i = 0; i < 2; i++) {
      handInfo[i].pos = e.locomotion.hands[i].position;
      handInfo[i].squeezed = e.hands.all[i].tracked && e.hands.all[i].squeezed;
    }
    handPos[0] = handInfo[0].pos;
    handPos[1] = handInfo[1].pos;
    for (const d of facility.doors) d.update(dt, handInfo);

    // Things thrown at the glass.
    itemPos.length = 0;
    itemSpeed.length = 0;
    for (const it of grab.items) {
      const p = it.obj.position;
      let last = lastItemPos.get(it);
      if (!last) {
        last = p.clone();
        lastItemPos.set(it, last);
      }
      itemPos.push(p);
      itemSpeed.push(last.distanceTo(p) / Math.max(dt, 1e-3));
      last.copy(p);
    }
    lobby.update(dt, t, handPos, itemPos, itemSpeed);
    if (lobbyNow) cctv.update(dt, t, facility, monsters, null);

    // The game proper: only while alive, and out of the lobby.
    const huntable = !lobbyNow && !dead && !escaped;
    if (!dead && !escaped) {
      if (!lobbyNow) {
        runTime += dt;
        runCredits += dt / 6;
      }
      // Crushed by a door?
      if (!lobbyNow) for (const d of facility.doors) if (d.crushes(e.feet, e.feet.y, e.head.y + 0.1)) die('crushed');
      // Noise you make.
      stepNoise -= dt;
      const speed = e.locomotion.velocity.length();
      for (let i = 0; i < 2; i++) {
        const c = e.locomotion.hands[i];
        if (c.justTouched && stepNoise <= 0 && !lobbyNow) {
          stepNoise = 0.2;
          const v = Math.max(speed, e.locomotion.hands[i].position.distanceTo(c.rawPosition) * 10);
          noise(c.position, v > 1.2 ? 3.5 + Math.min(11, v * 1.5) : 2.2, 'hands');
        }
      }
      // Landing from a height.
      if (!e.locomotion.grounded) airVy = Math.min(airVy, e.locomotion.velocity.y);
      if (e.locomotion.grounded && !wasGrounded) {
        if (airVy < -4.5) {
          const h = Math.min(1, -airVy / 12);
          e.audio.play('thud', e.feet, h);
          e.buzz('both', 0.3 + 0.6 * h, 150 + 200 * h);
          if (!lobbyNow) noise(e.feet, 6 + -airVy * 2.2, 'landing');
        }
        airVy = 0;
      }
      wasGrounded = e.locomotion.grounded;
      // Speaking.
      voiceNoise -= dt;
      if (voice.enabled && voiceNoise <= 0) {
        const l = voice.level();
        voiceNoise = 0.7;
        if (l > 0.3 && !lobbyNow) noise(e.head, 7 + l * 20, 'voice');
      }
    }

    // Hiding in a locker: step in, keep still, and the door swings shut.
    const still = e.locomotion.velocity.length() < 0.6;
    let inLocker: Locker | null = null;
    if (huntable) for (const l of lockers) if (l.contains(e.head)) inLocker = l;
    if (inLocker && still) hideTimer += dt;
    else hideTimer = 0;
    const wasHidden = hidden;
    hidden = !!inLocker && hideTimer > 0.7;
    hideLocker = hidden ? inLocker : null;
    if (hidden && !wasHidden) {
      e.audio.play('doorLock', inLocker!.center, 0.8);
      toast.show('HIDDEN', '#9ad8ff', 1.5);
    }
    for (const l of lockers) l.set(l.closed + ((l === hideLocker ? 1 : 0) - l.closed) * Math.min(1, dt * 6));
    if (hideLocker) {
      // Something hunting that comes right up to the locker may check it.
      let close = false;
      for (const m of monsters) if (m.state !== 'patrol' && m.state !== 'stunned' && Math.hypot(m.pos.x - hideLocker.center.x, m.pos.z - hideLocker.center.z) < 2.4) close = true;
      if (close) {
        findTimer += dt;
        if (Math.floor(findTimer * 1.2) !== Math.floor((findTimer - dt) * 1.2)) {
          e.audio.play('doorBang', hideLocker.center, 1);
          e.buzz('both', 0.6, 110);
        }
        if (findTimer > 3.4) {
          toast.show('FOUND', '#ff4040', 2);
          die('caught');
        }
      } else findTimer = Math.max(0, findTimer - dt);
    } else findTimer = 0;

    // The monsters.
    const torch = grab.items.find((it) => it.kind === 'torch' && it.data.on === true && it.held !== -1) ?? grab.items.find((it) => it.kind === 'torch' && it.data.on === true && it.obj.position.distanceToSquared(e.head) < 900);
    const torchOn = !!torch && torch.held !== -1;
    if (torch) {
      torch.obj.updateWorldMatrix(true, false);
      torchSpot.position.copy(_v.set(0, 0, -0.17).applyMatrix4(torch.obj.matrixWorld));
      torchSpot.target.position.copy(_v2.set(0, 0, -3).applyMatrix4(torch.obj.matrixWorld));
      torchSpot.intensity = 160;
    } else torchSpot.intensity = 0;
    const layer: 0 | 1 = e.feet.y > -9 ? 1 : 0;
    for (const n of noises) n.age += dt;
    for (let i = noises.length - 1; i >= 0; i--) if (noises[i].age > 0.6) noises.splice(i, 1);
    for (const m of monsters) {
      m.update(dt, {
        e,
        facility,
        feet: e.feet,
        head: e.head,
        huntable,
        hidden,
        layer,
        lit: torchOn,
        noises,
        caught: () => die('caught'),
      });
    }

    // The edges of your sight go red when something is on you.
    let chaser = Infinity;
    for (const m of monsters) if (m.state === 'hunt') chaser = Math.min(chaser, m.pos.distanceTo(e.head));
    fear.target = huntable && chaser < 14 ? 0.5 * (1 - chaser / 14) : 0;
    fear.update(dt, 3);

    // Heartbeat: it quickens when something hunting is near.
    let nearest = Infinity;
    for (const m of monsters) if (m.alert > 0.3 || m.state === 'hunt') nearest = Math.min(nearest, m.pos.distanceTo(e.head));
    if (huntable) e.audio.setTension(nearest < 30 ? 1 - nearest / 30 : 0);
    else e.audio.setTension(0);
    heartbeat -= dt;
    if (huntable && nearest < 24 && heartbeat <= 0) {
      const closeness = 1 - nearest / 24;
      heartbeat = 1.05 - 0.6 * closeness;
      e.audio.play('thump', undefined, 0.5 + 0.5 * closeness);
      e.buzz('both', 0.15 + 0.7 * closeness, 80);
      setTimeout(() => {
        e.audio.play('thump', undefined, 0.35 + 0.4 * closeness);
        e.buzz('both', 0.1 + 0.5 * closeness, 60);
      }, 170);
    }

    // The lockdown: alarms, red light, and every door gone mad.
    if (!dead && !escaped) {
      if (lockdown > 0) {
        lockdown -= dt;
        lockdownRed = Math.min(1, lockdownRed + dt * 2);
        for (const d of facility.doors) {
          if (d === facility.exitDoor && d.locked) continue;
          const left = (doorTimers.get(d) ?? rnd(0.2, 2)) - dt;
          if (left <= 0) {
            d.drive(d.pos > 0.5 ? 0 : 1);
            doorTimers.set(d, rnd(1.2, 3.8));
          } else doorTimers.set(d, left);
        }
        if (lockdown <= 0) {
          e.audio.setAlarm(false);
          for (const d of facility.doors) {
            d.auto = false;
            d.refresh();
          }
          toast.show('LOCKDOWN ENDED', '#60ff90', 3);
        }
      } else {
        lockdownRed = Math.max(0, lockdownRed - dt);
        if (!lobbyNow) nextLockdown -= dt;
        if (nextLockdown <= 0 && !lobbyNow) {
          nextLockdown = rnd(80, 140);
          lockdown = 26;
          e.audio.setAlarm(true);
          e.audio.play('lockdown');
          toast.show('EMERGENCY LOCKDOWN', '#ff4040', 5);
          toast.show('All doors are out of your control.', '#e8e8e8', 5);
          e.buzz('both', 1, 500);
          for (const d of facility.doors) {
            d.auto = true;
            d.refresh();
            doorTimers.set(d, rnd(0.2, 2));
          }
          // The alarm brings them.
          noise(e.head, 60, 'alarm');
        }
      }
    }

    // The power fails now and then (stay still and use your own light), and things happen in the dark.
    if (!dead && !escaped && !lobbyNow) {
      nextBlackout -= dt;
      if (nextBlackout <= 0 && lockdown <= 0 && blackout <= 0) {
        nextBlackout = rnd(100, 170);
        blackout = rnd(6, 9);
        toast.show('POWER FAILURE', '#ff9a40', 4);
        e.audio.play('static');
        e.audio.play('thud', e.head, 1);
        e.buzz('both', 0.5, 200);
      }
      nextScare -= dt;
      if (nextScare <= 0) {
        nextScare = rnd(12, 24);
        const a = Math.random() * Math.PI * 2;
        const far = _v.set(e.head.x + Math.cos(a) * rnd(10, 30), e.head.y, e.head.z + Math.sin(a) * rnd(10, 30)).clone();
        const pick = Math.floor(Math.random() * 4);
        if (pick === 0) e.audio.play('growl', far, 0.7);
        else if (pick === 1) e.audio.play('doorBang', facility.doors[Math.floor(Math.random() * facility.doors.length)].center, 0.9);
        else if (pick === 2) e.audio.play('static', far, 0.8);
        else e.audio.play('skitter', far, 0.9);
      }
    }
    if (blackout > 0) blackout -= dt;
    hemi.intensity = blackout > 0 ? 0.08 : 0.7;
    ambient.intensity = blackout > 0 ? 0.05 : 0.5;

    // Lights: the nearest fixtures really light, all of them flicker.
    for (const f of allFixtures) {
      const flick = Math.sin(t * 37 + f.phase) * Math.sin(t * 5.3 + f.phase * 2);
      let k = flick > 0.93 && f.pos.y < 3 ? 0.12 : 1;
      if (blackout > 0) k = 0;
      if (lockdownRed > 0) k *= 0.45 + 0.55 * Math.abs(Math.sin(t * 5 + f.phase * 0.1));
      const col = (f.mesh.material as THREE.MeshBasicMaterial).color;
      if (lockdownRed > 0) col.copy(f.base).lerp(RED, lockdownRed * 0.8).multiplyScalar(k);
      else col.copy(f.base).multiplyScalar(k);
      (f as unknown as { k: number }).k = k;
    }
    lightTimer -= dt;
    if (lightTimer <= 0) {
      lightTimer = 0.2;
      const byDistance = (list: typeof allFixtures, p: THREE.Vector3, n: number): typeof allFixtures => list.slice().sort((a, b) => a.pos.distanceToSquared(p) - b.pos.distanceToSquared(p)).slice(0, n);
      // In the lobby, some of the light goes on the hall seen through the window.
      const near = lobbyNow ? [...byDistance(lobby.fixtures, e.head, 2), ...byDistance(facility.fixtures, HALL_VIEW, 1)] : byDistance(allFixtures, e.head, pool.length);
      pool.forEach((l, i) => {
        const f = near[i];
        l.visible = true;
        l.position.copy(f.pos).y -= 0.4;
        l.color.copy(f.base).lerp(RED, lockdownRed * 0.85);
        l.intensity = (f.pos.y > 3.5 && f.pos.z < 7 ? 14 : 34) * ((f as unknown as { k?: number }).k ?? 1);
        l.distance = f.pos.z < 7 ? 14 : lobbyNow ? 46 : 30;
        if (lobbyNow && f.pos.z >= 7) l.intensity *= 3;
      });
    }

    // Wrist readout.
    wrist.set(lobbyNow ? `SAFE · $${save.data.credits}` : lockdown > 0 ? `LOCKDOWN ${Math.ceil(lockdown)}s` : `RELAYS ${relays}/2 · $${Math.floor(runCredits)}`);

    // After dying or escaping: back to the lobby.
    if ((dead || escaped) && (deadTimer -= dt) <= 0) returnToLobby(escaped ? 'Back in the safe zone.' : 'You wake in the safe zone.');
  };

  // The state, for tests and the debug view.
  Object.assign(window, {
    __monke: { THREE, renderer: e.renderer, scene: e.scene, camera: e.camera, locomotion: e.locomotion, rig: e.rig, emulator: e.emulator, panels: e.panels },
    __game: {
      e, save, lobby, facility, monsters, grab, voice, noise, die, escape, pause,
      state: () => ({ dead, escaped, lockdown, relays, runTime, runCredits, inLobby: inLobby(), hidden, blackout, logs: save.data.logs.length, gear: worldGear.length }),
      readLog, lockers, startBlackout: () => (nextBlackout = 0.01),
      startLockdown: () => (nextLockdown = 0.01),
      faceWindow,
    },
  });
}

export type { Engine };
