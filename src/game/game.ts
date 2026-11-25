import * as THREE from 'three';
import { skinById } from './avatar';
import { itemById } from './cosmetics';
import { Door } from './doors';
import { createEngine, type Engine } from './engine';
import { Facility } from './facility';
import { Grabbables } from './grab';
import { Fade, Toast, Wrist } from './hud';
import type { ItemContext } from './items';
import { Lobby } from './lobby';
import { Monster, type MonsterKind, type Noise } from './monsters';
import { PauseMenu } from './pause';
import { Save } from './save';
import { rnd } from './shapes';
import { Voice } from './voice';

const LOBBY_SPAWN = new THREE.Vector3(0, 0, -3.2);
const RED = new THREE.Color(1, 0.1, 0.05);
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
  scene.add(new THREE.HemisphereLight(0x8aa0c0, 0x202428, 0.7));
  scene.add(new THREE.AmbientLight(0x303848, 0.5));

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
  };
  const facility = new Facility(e);
  grab.floorAt = (x, y, z) => facility.floorAt(x, y, z);
  const lobby = new Lobby(e, save, ctx);

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
  applyLook();
  e.updaters.push((dt) => {
    for (const o of worn) {
      o.traverse((c) => {
        if (c.userData.spin) c.rotation.y += dt * 20;
        if (c.userData.wing) c.rotation.z += Math.sin(e.time * 4) * 0.004 * c.userData.wing;
      });
    }
  });

  // --- Voice -------------------------------------------------------------------------------------------------------
  lobby.onMic = (on) => {
    if (on && !voice.enabled) void voice.enable().then((ok) => (ok ? voice.setMonitor(true) : toast.show('MICROPHONE BLOCKED', '#ff6060')));
    else voice.setMonitor(on);
  };

  // --- The things in the dark ------------------------------------------------------------------------------------------
  const kinds: MonsterKind[] = ['stalker', 'skitter', 'warden'];
  kinds.forEach((k, i) => monsters.push(new Monster(e, k, facility.spawns[i])));
  const resetMonsters = (): void => monsters.forEach((m, i) => m.place(facility.spawns[i % facility.spawns.length]));

  // --- Lights ----------------------------------------------------------------------------------------------------------
  const allFixtures = [...lobby.fixtures, ...facility.fixtures];
  const pool = [0, 1, 2, 3, 4].map(() => {
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
  };

  const returnToLobby = (message: string): void => {
    e.respawn(LOBBY_SPAWN);
    faceWindow();
    resetRun();
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
    e.audio.setZone(facility.zoneAt(e.head));
    facility.pulse(t);

    // The hands, for doors and the window.
    const handInfo = [0, 1].map((i) => ({ pos: e.locomotion.hands[i].position, squeezed: e.hands.all[i].tracked && e.hands.all[i].squeezed }));
    for (const d of facility.doors) d.update(dt, handInfo);

    // Things thrown at the glass.
    const itemPos: THREE.Vector3[] = [];
    const itemSpeed: number[] = [];
    for (const it of grab.items) {
      const p = it.obj.position;
      const last = lastItemPos.get(it) ?? p.clone();
      itemPos.push(p);
      itemSpeed.push(last.distanceTo(p) / Math.max(dt, 1e-3));
      lastItemPos.set(it, p.clone());
    }
    lobby.update(dt, t, handInfo.map((h) => h.pos), itemPos, itemSpeed);

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

    // The monsters.
    const torchOn = grab.items.some((it) => it.kind === 'torch' && it.held !== -1 && it.data.on === true);
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
        layer,
        lit: torchOn,
        noises,
        caught: () => die('caught'),
      });
    }

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

    // Lights: the nearest fixtures really light, all of them flicker.
    for (const f of allFixtures) {
      const flick = Math.sin(t * 37 + f.phase) * Math.sin(t * 5.3 + f.phase * 2);
      let k = flick > 0.93 && f.pos.y < 3 ? 0.12 : 1;
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
      const near = lobbyNow ? [...byDistance(lobby.fixtures, e.head, 2), ...byDistance(facility.fixtures, HALL_VIEW, 3)] : byDistance(allFixtures, e.head, pool.length);
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
      state: () => ({ dead, escaped, lockdown, relays, runTime, runCredits, inLobby: inLobby() }),
      startLockdown: () => (nextLockdown = 0.01),
      faceWindow,
    },
  });
}

export type { Engine };
