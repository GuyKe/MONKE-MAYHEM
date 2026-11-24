import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { LOCOMOTION, SPAWN } from './config';
import { RAPIER, createPhysicsWorld } from './physics';
import { buildTestArena } from './world/testArena';
import { buildForest } from './world/forest';
import { Atmosphere } from './world/atmosphere';
import { WORLD_HALF } from './world/terrain';
import { mulberry32 } from './world/noise';
import { Hands } from './player/hands';
import { Locomotion } from './player/locomotion';
import { ArmSpan } from './player/armSpan';
import { Grab } from './player/grab';
import { Journal, RECIPES } from './player/journal';
import { Book, type HandView } from './player/book';
import { MapView } from './world/mapview';
import { Pois } from './world/pois';
import { Fire } from './world/fire';
import { Building } from './world/building';
import { TreeRopes } from './world/ropes';
import { Crafting, SMASHES_FOR_AXE } from './player/crafting';
import { Animals } from './world/animals';
import { FrictionFire } from './world/friction';
import { Sticks, STICK_TYPES, stickType } from './world/sticks';
import { Body } from './player/body';
import { GameAudio } from './audio';
import { Vitals, VitalsView } from './player/vitals';
import { Survival } from './player/survival';
import { Combat } from './player/combat';
import { MirrorView } from './player/mirror';
import { Crocs } from './world/crocs';
import { Fruits } from './world/fruit';
import { FallingLeaves } from './world/leaves';
import { Logger } from './world/logger';
import { Spits } from './world/spit';
import { Perf } from './perf';
import { Comfort } from './comfort';
import { Quality } from './quality';
import { Net, type Msg } from './net/net';
import { RemotePlayers, type PoseMsg } from './net/avatars';
import { Voice } from './net/voice';
import { Sync } from './net/sync';
import { MEAT_COLOR } from './player/survival';
import { SaveStore, type SaveData } from './save';
import type { DesktopEmulator } from './debug/desktop';
import { DAY_SECONDS, FOG_SCALE, SHARPNESS, Settings, TREE_SPACING_M, TURN_SPEED_DEG, VIEW_DISTANCE_M } from './settings';
import { Menu } from './ui/menu';
import { Hand } from './player/hands';

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const settings = new Settings();

  // The main menu comes first: it shows while the forest is built, and again whenever you leave VR.
  // Hooks that need things created later are filled in below.
  const actions = {
    play: () => {},
    resetArms: () => {},
    resetBook: () => {},
    save: () => false as boolean,
    host: async (): Promise<string> => '',
    leave: () => {},
    mic: async (): Promise<void> => {},
  };
  // Multiplayer: a joiner connects first (it needs the host's seed to build the same forest).
  const net = new Net();
  const syncRef: { current: Sync | null } = { current: null };
  // A saved game is carried on whenever the page is opened without asking for a particular forest.
  const saved = SaveStore.load();
  const menu = new Menu(settings, {
    onPlay: () => actions.play(),
    onNewWorld: () => {
      const url = new URL(location.href);
      url.searchParams.delete('seed'); // a new random forest
      location.href = url.toString();
    },
    onResetArms: () => actions.resetArms(),
    onResetBook: () => actions.resetBook(),
    onSave: () => actions.save(),
    onDeleteSave: () => SaveStore.clear(),
    onHost: () => actions.host(),
    onJoin: (code) => {
      const url = new URL(location.href);
      url.searchParams.set('join', code);
      url.searchParams.delete('seed');
      location.href = url.toString();
    },
    onLeaveGame: () => actions.leave(),
    onMic: () => actions.mic(),
  });
  const skipMenu = params.has('play') || params.has('arena');
  if (skipMenu) menu.hide();
  await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 30))); // let it paint before the heavy work

  // Use the desktop emulator when asked to (?emulate) or when there's no real VR.
  const forceEmulator = params.has('emulate');
  const hasRealVR = !forceEmulator && (await navigator.xr?.isSessionSupported('immersive-vr').catch(() => false));
  const emulator: DesktopEmulator | null = hasRealVR
    ? null
    : new (await import('./debug/desktop')).DesktopEmulator(); // loaded only when needed

  // Joining: connect to the host and wait for its world.
  let welcome: Msg | null = null;
  let joinError = '';
  const joinCode = params.get('join');
  if (joinCode) {
    menu.setLoading(`Joining ${joinCode.toUpperCase()}…`);
    try {
      const wanted = net.waitFor('welcome');
      await net.join(joinCode);
      welcome = await wanted;
    } catch (e) {
      joinError = `Could not join ${joinCode.toUpperCase()}: ${e instanceof Error ? e.message : String(e)}`;
      net.leave();
    }
  }

  const world = await createPhysicsWorld();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.xr.setFoveation(1);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 250);
  camera.position.set(0, 1.6, 0);

  // The rig is the tracking-space origin; the head and controllers move inside it.
  const rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);

  // The forest is the game: a new random one every visit (`?seed=123` repeats one).
  // `?arena` loads the small flat movement test course instead.
  const seed = welcome ? (welcome.seed as number) : params.has('seed') ? Number(params.get('seed')) || 1 : saved ? saved.seed : Math.floor(Math.random() * 0x7fffffff);
  // Pick up the saved game if this is its forest, unless a particular forest was asked for without `continue`.
  const useSave = !welcome && !!saved && saved.seed === seed && !params.has('arena') && !params.has('fresh') && (params.has('continue') || !params.has('seed'));
  if (useSave) menu.setSaveInfo(SaveStore.describe(saved!));
  const spawn = new THREE.Vector3(SPAWN.x, SPAWN.y, SPAWN.z);
  let worldStats = 'test arena';
  let forestRef: ReturnType<typeof buildForest> | null = null;
  let atmosphere: Atmosphere | null = null;
  if (params.has('arena')) {
    buildTestArena(scene, world);
  } else {
    // Where you start, and what time of day, are random too (but follow the seed).
    const roll = mulberry32(seed ^ 0x5bd1e995);
    const spawnXZ = { x: (roll() * 2 - 1) * WORLD_HALF * 0.55, z: (roll() * 2 - 1) * WORLD_HALF * 0.55 };
    const forest = buildForest(scene, world, {
      seed,
      forceLogger: params.has('logger'),
      spawn: spawnXZ,
      treeSpacing: TREE_SPACING_M[settings.data.treeDensity],
      viewRadius: VIEW_DISTANCE_M[settings.data.viewDistance],
      grass: settings.data.grass,
    });
    forestRef = forest;
    spawn.copy(forest.spawn);
    atmosphere = new Atmosphere(scene, {
      startTime: params.has('time') ? Number(params.get('time')) : 0.27 + roll() * 0.15,
      cycleSeconds: params.has('cycle') ? Number(params.get('cycle')) || 600 : DAY_SECONDS[settings.data.dayLength] || 600,
    });
    atmosphere.fogScale = FOG_SCALE[settings.data.atmosphere];
    if (!params.has('cycle') && settings.data.dayLength === 'always-day') atmosphere.frozenAt = 0.42;
    rig.add(atmosphere.sky);
    const s = forest.stats;
    worldStats = `seed ${seed}: ${s.trees} trees, ${forest.ropes.length} ropes, ${forest.lakes.length} lakes, ${forest.bushes.length} bushes`;
  }
  world.step(); // populate the broad phase so queries see the static scenery

  // Things that need the survival system, which is built once the player exists.
  const refs: { survival: Survival | null } = { survival: null };
  // Wildlife: rabbits, deer and birds (forest only).
  const animals = forestRef
    ? new Animals(scene, {
        onKill: (species, at) => refs.survival?.dropMeat(at, species === 'deer' ? 3 : 1),
        onDied: (id) => syncRef.current?.animalDied(id),
        onRemoteHit: (id, amount) => syncRef.current?.hitAnimal(id, amount),
        seed,
        surfaceAt: forestRef.surfaceAt,
        isBlocked: forestRef.isBlocked,
        worldHalf: WORLD_HALF,
        trees: forestRef.trees,
        enabled: settings.data.animals,
      })
    : null;

  const sticks = new Sticks(scene, world, {
    surfaceAt: forestRef ? forestRef.surfaceAt : () => 0,
    isBlocked: forestRef ? forestRef.isBlocked : () => false,
    spawn,
    worldHalf: forestRef ? WORLD_HALF : 25,
    count: forestRef ? 280 : 40,
    stones: forestRef ? 120 : 14,
    seed,
  });

  const hands = new Hands(renderer, rig, scene);
  const body = new Body(scene);
  const audio = new GameAudio();
  const mirror = new MirrorView(scene, body);
  const comfort = new Comfort(camera);

  // The field journal on your hip: stash sticks in it, craft from it, unlock recipes as you go.
  const journal = new Journal(params.has('resetbook'));
  const fire = new Fire(scene, sticks, world, forestRef ? forestRef.surfaceAt : () => 0);
  // The map fills in as you explore. (Stage 6 adds places to find.)
  const mapView = forestRef ? new MapView(WORLD_HALF, forestRef.surfaceAt, forestRef.water) : null;
  const camForward = new THREE.Vector3();
  // The book shows the building plans, and the building system needs the grab code, which needs the book to
  // stash sticks: so the building system is filled in once it exists.
  const buildingRef: { current: Building | null } = { current: null };
  const poisRef: { current: Pois | null } = { current: null };
  const loggerRef: { current: Logger | null } = { current: null };
  const spitsRef: { current: Spits | null } = { current: null };
  const book = new Book(
    scene,
    camera,
    journal,
    sticks,
    {
      makePiece: (kind, position, quaternion) => void sticks.craft(kind, position, quaternion),
      buildCampfire: (x, z) => void fire.addCampfire(x, z),
    },
    {
      settings,
      craft: () => ({ smashes: crafting.smashes, lashing: crafting.lashing, sharpening: crafting.sharpening, smashesNeeded: SMASHES_FOR_AXE }),
      world: () => ({
        seed,
        clock: atmosphere?.clock ?? '--:--',
        phase: atmosphere?.phase ?? 'day',
        day: atmosphere?.day ?? 1,
      }),
      map: mapView,
      markers: () => poisRef.current?.markers ?? [],
      player: () => {
        const head = locomotion.headWorld(_viewer);
        camForward.set(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(_wq));
        return { x: head.x, z: head.z, heading: Math.atan2(camForward.x, -camForward.z) };
      },
      blueprints: {
        view: () => buildingRef.current?.view() ?? { list: [], active: null },
        version: () => buildingRef.current?.version ?? 0,
        select: (id) => buildingRef.current?.select(id),
        cancel: () => buildingRef.current?.cancel(),
      },
      resetArms: () => armSpan.reset(),
    },
  );
  const say = (text: string): void => {
    book.say(text);
    audio.messageSound(text);
  };
  // Rub two sticks together to make fire; over a pile of sticks it becomes a campfire.
  const friction = new FrictionFire(scene, sticks, fire, forestRef ? forestRef.surfaceAt : () => 0, {
    onMessage: say,
    pulse: (side, strength, ms) => hands[side].pulse(strength, ms),
  });
  // The old places to find, with things lying about inside them.
  if (forestRef) {
    poisRef.current = new Pois(forestRef.pois, sticks, {
      onVehicle: (x, _y, z, yaw) => {
        loggerRef.current = new Logger(scene, x, z, yaw, {
          say: (text) => say(text),
          pulse: (side, strength, ms) => hands[side].pulse(strength, ms),
          fell: (tree, fx, fz) => crafting.fell(tree, fx, fz),
          surfaceAt: forestRef!.surfaceAt,
          nearestTree: forestRef!.nearestTree,
          waterLevelAt: forestRef!.waterLevelAt,
          sound: (name, at) => audio.play(name, at),
        });
      },
      say: say,
      pulse: (strength, ms) => hands.all.forEach((h) => h.pulse(strength, ms)),
    });
  }

  // Ropes hanging in trees: grab one and pull down to tear it free.
  const seenSticks = new Set<string>();
  const treeRopes = forestRef ? new TreeRopes(scene, forestRef.ropes) : null;
  const fruits = forestRef ? new Fruits(scene, forestRef.bushes) : null;
  const leaves = forestRef ? new FallingLeaves(scene, seed, forestRef.surfaceAt) : null;
  const grab = new Grab(sticks, hands, {
    pick: (handPos) => {
      const meat = spitsRef.current?.take(handPos);
      if (meat) return meat;
      const f = fruits?.nearest(handPos, 0.2);
      if (f && fruits) {
        fruits.take(f, refs.survival?.days ?? 0);
        return sticks.craft('fruit', handPos.clone(), new THREE.Quaternion(), { color: fruits.colour(f, new THREE.Color()) });
      }
      if (!forestRef) return null;
      // Leaves: a handful torn off a bush.
      for (const b of forestRef.bushes) {
        if (Math.abs(b.x - handPos.x) > b.r + 0.3 || Math.abs(b.z - handPos.z) > b.r + 0.3) continue;
        if (Math.hypot(b.x - handPos.x, b.y + b.r * 0.5 - handPos.y, b.z - handPos.z) < b.r + 0.15) {
          say('A handful of leaves. Lay them on a roof.');
          return sticks.craft('leaf', handPos.clone(), new THREE.Quaternion(), { color: new THREE.Color().setHSL(0.28 + Math.random() * 0.06, 0.55, 0.26 + Math.random() * 0.08) });
        }
      }
      // Mud: scooped from the ground along a lake's banks.
      const ground = forestRef.surfaceAt(handPos.x, handPos.z);
      if (handPos.y - ground < 0.3) {
        for (const l of forestRef.lakes) {
          const d = Math.hypot(handPos.x - l.x, handPos.z - l.z);
          if (d < l.r + 7 && ground < l.level + 1.2) {
            say('A lump of mud from the lake shore.');
            return sticks.craft('mud', handPos.clone(), new THREE.Quaternion(), { color: new THREE.Color().setHSL(0.07, 0.35, 0.16 + Math.random() * 0.05) });
          }
        }
      }
      return null;
    },
    stash: (stick, handPos) => book.acceptStash(stick, handPos) || (buildingRef.current?.accept(stick) ?? false) || (spitsRef.current?.accept(stick) ?? false),
    onFarThrow: () => void journal.notify('throw'),
    ropes: treeRopes ?? undefined,
    onRopePulled: () => {
      say('Rope! Keep it: wind it round an axe head, or use it to tie things.');
      audio.play('rope');
    },
    onGrab: (stick) => {
      audio.play('click');
      syncRef.current?.claim(stick);
      if (stick.kind === 'stick') {
        const type = stickType(stick.length);
        if (!seenSticks.has(type)) {
          seenSticks.add(type);
          say(STICK_TYPES[type].label + '.');
        }
      }
    },
    onThrow: (speed, at) => audio.play('whoosh', at, speed / 8),
  });

  // Structures: pick a plan in the book, place it, then bring the parts and tie them together.
  const building = new Building(
    scene,
    world,
    sticks,
    forestRef ?? { surfaceAt: () => 0, isBlocked: () => false },
    hands,
    grab,
    {
      say,
      pulse: (side, strength, ms) => {
        hands[side].pulse(strength, ms);
        // The pulses a part fitting in, a joint tied and a structure finished give.
        if (ms === 90 || ms === 150 || ms === 250) audio.play('build');
      },
    },
    {
      // (The player is created below; these are only used once the game is running.)
      get handsIgnoreStructures() {
        return locomotion.handsIgnoreStructures;
      },
      set handsIgnoreStructures(on: boolean) {
        locomotion.handsIgnoreStructures = on;
      },
    },
  );
  buildingRef.current = building;

  // Tools: smash a stone on a stick for an axe, chop with it, lash rope round it for a better one.
  // The arena has a few trunks to chop; the forest has thousands.
  const arenaTrees = [[4, -3, 0.3], [6.5, -6, 0.45], [3, -9, 0.3], [8, -1.5, 0.45]].map(([x, z, radius]) => ({ x, z, radius, height: 7 }));
  const crafting = new Crafting(
    sticks,
    grab,
    hands,
    forestRef ?? {
      surfaceAt: () => 0,
      nearestTree: (x, z, pad) => arenaTrees.find((t) => Math.hypot(t.x - x, t.z - z) - t.radius < pad) ?? null,
    },
    {
      say: say,
      burst: (at, count) => {
        friction.burst(at, count);
        // Chips, smashes and falling trees all throw sparks; how many says which it was.
        const sound = count === 3 ? 'scrape' : count === 5 ? 'chop' : count === 6 ? 'smash' : count === 12 ? 'break' : count === 24 ? 'crash' : count === 14 || count === 8 ? 'build' : null;
        if (sound) audio.play(sound, at);
      },
      pulse: (side, strength, ms) => hands[side].pulse(strength, ms),
      notify: (event) => void journal.notify(event),
      onFelled: (tree) => {
        // Ropes hanging on it come down too.
        for (const r of treeRopes?.ropes ?? []) {
          if (r.taken || Math.hypot(r.spot.x - tree.x, r.spot.z - tree.z) > tree.radius + 0.5) continue;
          treeRopes!.take(r);
          sticks.craft('rope', new THREE.Vector3(r.spot.x, (forestRef?.surfaceAt(r.spot.x, r.spot.z) ?? 0) + 0.3, r.spot.z), new THREE.Quaternion());
        }
      },
    },
    scene,
  );
  const handViews: [HandView, HandView] = hands.all.map((hand) => ({
    tracked: false,
    pos: new THREE.Vector3(),
    squeezed: false,
    holding: false,
    stickX: 0,
    pulse: (strength: number, ms: number) => hand.pulse(strength, ms),
  })) as [HandView, HandView];
  const locomotion = new Locomotion(world, rig);
  locomotion.waterAt = forestRef ? forestRef.waterLevelAt : null;
  const vitals = new Vitals();
  const vitalsView = new VitalsView(scene, camera, vitals);
  const crocs = forestRef
    ? new Crocs(scene, forestRef.lakes, {
        surfaceAt: forestRef.surfaceAt,
        waterLevelAt: forestRef.waterLevelAt,
        onBite: (damage, at, target) => {
          audio.play('snap', at);
          if (target !== 'me') {
            net.bite(target, damage);
            return;
          }
          vitals.hurt(damage, 'crocodile');
          book.say('The crocodile bit you!');
        },
        onKill: (at) => refs.survival?.dropMeat(at, 4),
        onDied: (lake) => syncRef.current?.crocDied(lake),
        onRemoteHit: (lake, amount) => syncRef.current?.hitCroc(lake, amount),
      })
    : null;
  const survival = new Survival(scene, sticks, grab, hands, locomotion, vitals, vitalsView, building, spawn, {
    say: say,
    pulse: (side, strength, ms) => hands[side].pulse(strength, ms),
    cycleSeconds: () => (atmosphere && !atmosphere.frozenAt ? atmosphere.cycleSeconds : 600),
    surfaceAt: forestRef ? forestRef.surfaceAt : () => 0,
  });
  refs.survival = survival;
  const combat = new Combat(sticks, grab, animals, crocs, {
    onHit: () => audio.play('thud'),
    pulse: (side, strength, ms) => hands[side].pulse(strength, ms),
    burst: (at, count) => friction.burst(at, count),
    say: say,
  });
  spitsRef.current = new Spits(scene, building, sticks, fire, grab, hands, locomotion, {
    say,
    pulse: (side, strength, ms) => hands[side].pulse(strength, ms),
    sound: (name, at) => audio.play(name, at),
  });
  let swimTime = 0;
  let lastPage = 0;
  let lastOpen = false;
  const hurtBefore = vitals.onHurt;
  vitals.onHurt = (amount, cause) => {
    hurtBefore?.(amount, cause);
    audio.play(cause === 'crocodile' ? 'thud' : 'hurt');
  };
  const deathBefore = vitals.onDeath;
  vitals.onDeath = () => {
    deathBefore?.();
    audio.play('die');
  };
  const armSpan = new ArmSpan();
  let calibrationTick = 0;
  locomotion.respawn(spawn);

  // --- Saving: the forest comes back from its seed, and this puts back what changed in it ---------------
  const V3 = THREE.Vector3;
  const MEAT_HEX = { raw: MEAT_COLOR.raw.getHex(), roast: MEAT_COLOR.roast.getHex(), rotten: MEAT_COLOR.rotten.getHex() };
  const collect = (): SaveData => {
    const head = locomotion.headWorld(new V3());
    const ground = forestRef ? forestRef.surfaceAt(head.x, head.z) : 0;
    return {
      v: 1,
      seed,
      at: Date.now(),
      player: [Math.round(head.x * 100) / 100, Math.round(ground * 100) / 100, Math.round(head.z * 100) / 100],
      health: vitals.health,
      poison: vitals.poison,
      days: survival.days,
      time: atmosphere?.time ?? 0.3,
      day: atmosphere?.day ?? 1,
      respawn: survival.respawnAt,
      stash: journal.stash,
      pieces: [...sticks.list
        .filter((s) => !s.hidden)
        .map((s) => ({
          n: s.nid,
          k: s.kind,
          p: [Math.round(s.pos.x * 1000) / 1000, Math.round(s.pos.y * 1000) / 1000, Math.round(s.pos.z * 1000) / 1000] as [number, number, number],
          q: [Math.round(s.quat.x * 1000) / 1000, Math.round(s.quat.y * 1000) / 1000, Math.round(s.quat.z * 1000) / 1000, Math.round(s.quat.w * 1000) / 1000] as [number, number, number, number],
          l: Math.round(s.length * 1000) / 1000,
          r: Math.round(s.radius * 10000) / 10000,
          d: s.durability,
          w: Math.round(s.wrap * 100) / 100,
          s: s.state,
          a: Math.round(s.age * 1000) / 1000,
          c: s.baseColor.getHex(),
        })),
        // Meat on a spit goes back on the ground by it.
        ...(spitsRef.current?.contents() ?? []).map((m) => ({ k: 'meat' as const, p: [m.at.x, m.at.y, m.at.z] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], l: 0.15, r: 0.085, d: 0, w: 0, s: m.state, a: m.age, c: MEAT_HEX[m.state] })),
      ],
      sites: building.export(),
      ropes: treeRopes ? treeRopes.ropes.flatMap((r, i) => (r.taken ? [i] : [])) : [],
      fruits: fruits ? fruits.export() : [],
      felled: forestRef ? forestRef.felledIndices() : [],
      fires: fire.exportCampfires(),
      explored: mapView ? mapView.exportExplored() : '',
      logger: loggerRef.current ? [loggerRef.current.x, loggerRef.current.z, loggerRef.current.heading] : undefined,
      found: poisRef.current ? poisRef.current.export() : [],
      crocsDead: crocs ? crocs.killed : [],
      animalsDead: animals ? [...animals.deadIds] : [],
    };
  };
  const applySave = (data: SaveData, joining = false): void => {
    // Everything lying about is replaced by what was lying about when you saved.
    for (const s of sticks.list) if (!s.hidden) sticks.stash(s);
    for (const p of data.pieces) {
      const piece = sticks.craft(p.k, new V3(...p.p), new THREE.Quaternion(...p.q), { length: p.l, radius: p.r, wrap: p.w, state: p.s, age: p.a, color: p.c, nid: p.n });
      if (piece) piece.durability = p.d;
    }
    building.restore(data.sites);
    for (const i of data.ropes) if (treeRopes?.ropes[i]) treeRopes.ropes[i].taken = true;
    fruits?.restore(data.fruits);
    forestRef?.restoreFelled(data.felled);
    fire.restoreCampfires(data.fires);
    if (data.explored) mapView?.restoreExplored(data.explored);
    if (data.logger && loggerRef.current) {
      loggerRef.current.x = data.logger[0];
      loggerRef.current.z = data.logger[1];
      loggerRef.current.heading = data.logger[2];
    }
    poisRef.current?.restore(data.found);
    crocs?.restore(data.crocsDead);
    for (const id of data.animalsDead ?? []) animals?.killRemote(id);
    survival.days = data.days;
    if (!joining) {
      journal.stash = data.stash;
      journal.version++;
      survival.respawnAt = data.respawn;
    }
    if (atmosphere) {
      atmosphere.time = data.time;
      atmosphere.day = data.day;
    }
    locomotion.respawn({ x: data.player[0], y: data.player[1], z: data.player[2] });
    if (!joining) {
      vitals.health = Math.max(5, data.health);
      vitals.poison = data.poison;
    }
  };
  if (useSave) applySave(saved!);
  // Asking for another forest by seed does not quietly overwrite your saved game; only Save Game does.
  const autosaveOn = !welcome && (!saved || useSave);
  const saveNow = (): boolean => {
    if (!vitals.alive || params.has('arena')) return false;
    const data = collect();
    const ok = SaveStore.write(data);
    if (ok) {
      menu.setSaveInfo(SaveStore.describe(data));
      if (net.role === 'host') net.broadcast({ t: 'saved' });
    }
    return ok;
  };
  actions.save = saveNow;
  /** The game saves by itself this often (seconds of play), as well as when you leave VR or close the tab. */
  const AUTOSAVE_SECONDS = 300;
  let autosave = 0;
  window.addEventListener('pagehide', () => {
    if (renderer.xr.isPresenting && autosaveOn) saveNow();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && renderer.xr.isPresenting && autosaveOn) saveNow();
  });

  // With a headset the quality follows the frame rate; the desktop emulator is too slow to judge by (unless asked: ?autoquality).
  const quality = new Quality(forestRef, sticks, animals, leaves);
  quality.fixed = !!emulator && !params.has('autoquality');
  // --- Multiplayer: the other players, voices, and keeping everyone's world the same ---------------------
  const avatars = new RemotePlayers(scene);
  const voice = new Voice(net, audio, (id, level) => avatars.talk(id, level));
  const _pq = new THREE.Quaternion();
  const poseNow = (): PoseMsg => {
    const h = locomotion.headWorld(new V3());
    camera.getWorldQuaternion(_pq);
    const r = (n: number) => Math.round(n * 1000) / 1000;
    const hand = (i: 0 | 1): { p: [number, number, number] | null; q: [number, number, number, number] } => {
      const q = hands.all[i].tracked ? hands.all[i].worldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
      const p = locomotion.hands[i].position;
      return { p: hands.all[i].tracked ? [r(p.x), r(p.y), r(p.z)] : null, q: [r(q.x), r(q.y), r(q.z), r(q.w)] };
    };
    const l = hand(0);
    const rt = hand(1);
    return { h: [r(h.x), r(h.y), r(h.z)], q: [r(_pq.x), r(_pq.y), r(_pq.z), r(_pq.w)], l: l.p, r: rt.p, lq: l.q, rq: rt.q };
  };
  let netMessage = joinError;
  const netStatus = (): void =>
    menu.setNet({
      role: net.role,
      code: net.code,
      players: [...(syncRef.current?.roster.values() ?? [])].sort((a, b) => a.index - b.index).map((p) => p.name + (p.index === (syncRef.current?.index ?? -1) ? ' (you)' : '')),
      mic: voice.mic,
      muted: voice.muted,
      message: netMessage,
    });
  const sync = new Sync({
    net, sticks, animals, crocs, forest: forestRef, ropes: treeRopes, fruits, fire, building, atmosphere, survival, logger: loggerRef, avatars, voice, vitals, seed,
    say, collect, pose: poseNow, onRoster: () => netStatus(),
  });
  syncRef.current = sync;
  actions.host = async (): Promise<string> => {
    const code = await net.host();
    sync.start(0);
    netMessage = '';
    netStatus();
    void voice.startMic().then(netStatus);
    say(`Hosting. Your code is ${code}.`);
    return code;
  };
  actions.leave = () => {
    if (net.role === 'client') {
      const url = new URL(location.href);
      url.searchParams.delete('join');
      location.href = url.toString();
      return;
    }
    if (net.role === 'host' && autosaveOn) saveNow(); // what everyone did is kept
    sync.stop();
    netMessage = '';
    netStatus();
  };
  actions.mic = async (): Promise<void> => {
    if (voice.mic !== 'on') await voice.startMic();
    else voice.setMuted(!voice.muted);
    netStatus();
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && net.connected && voice.mic === 'on') {
      voice.setMuted(!voice.muted);
      say(voice.muted ? 'Microphone muted.' : 'Microphone on.');
      netStatus();
    }
  });
  window.addEventListener('pagehide', () => net.leave());
  if (welcome) {
    applySave(welcome.snapshot as unknown as SaveData, true);
    sync.start(welcome.index as number);
    sync.adoptRoster(welcome.roster as Array<{ id: string; index: number }>);
    say(`Joined ${net.code}. Press Play to enter.`);
  }
  netStatus();
  if (params.has('host')) void actions.host();

  const vrButton = VRButton.createButton(renderer);
  if (emulator) vrButton.textContent = 'ENTER VR (DESKTOP EMULATOR)';
  document.body.appendChild(vrButton);

  // Menu wiring: Play starts the VR session; leaving VR brings the menu back so you can resume.
  Hand.hapticScale = settings.data.haptics;
  audio.setVolume(settings.data.volume);
  if (!skipMenu) document.body.classList.add('has-menu'); // the menu's Play button replaces the VR button
  actions.play = () => vrButton.click();
  actions.resetArms = () => armSpan.reset();
  actions.resetBook = () => journal.reset();
  renderer.xr.addEventListener('sessionstart', () => {
    menu.hide();
    if (net.connected) void voice.startMic().then(netStatus); // pressing Play is the click that lets the browser ask for the microphone
    const rate = (renderer.xr.getSession() as unknown as { frameRate?: number } | null)?.frameRate;
    if (rate && rate > 30) quality.targetMs = 1000 / rate;
    audio.start(); // sound may only begin after a click, and pressing Play is one
  });
  renderer.xr.addEventListener('sessionend', () => {
    if (autosaveOn) saveNow();
    menu.setResuming(true);
    menu.show();
  });
  menu.setLoading(null);
  if (!emulator && !navigator.xr) menu.setPlayMessage('This browser has no WebXR. Open the game in your headset browser.');

  // Settings that take effect straight away.
  const hudEl = document.getElementById('hud')!;
  const applySetting = () => {
    Hand.hapticScale = settings.data.haptics;
    audio.setVolume(settings.data.volume);
    quality?.configure(settings.data.quality, settings.data.viewDistance);
    comfort.setLevel(settings.data.vignette);
    renderer.xr.setFramebufferScaleFactor(SHARPNESS[settings.data.sharpness]);
    if (atmosphere) atmosphere.motes = !settings.data.reduceMotion;
    if (leaves) leaves.enabled = !settings.data.reduceMotion;
    forestRef?.setGrass(settings.data.grass);
    if (atmosphere) {
      atmosphere.fogScale = FOG_SCALE[settings.data.atmosphere];
      const seconds = DAY_SECONDS[settings.data.dayLength];
      if (seconds === 0) atmosphere.frozenAt = 0.42;
      else {
        atmosphere.frozenAt = null;
        atmosphere.cycleSeconds = seconds;
      }
    }
    hudEl.style.visibility = settings.data.showDebug ? 'visible' : 'hidden';
  };
  settings.onChange(applySetting);
  applySetting();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') locomotion.respawn(spawn);
    // Desktop emulator: it can't poke the pages, so the keys do it.
    if (emulator && e.code === 'KeyB') book.toggle();
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (emulator && digit && Number(digit[1]) <= RECIPES.length) book.pressRow(Number(digit[1]) - 1);
  });

  const hud = document.getElementById('hud')!;
  const _viewer = new THREE.Vector3();
  const headLocal = new THREE.Vector3(0, 1.6, 0);
  const _hq = new THREE.Quaternion();
  const _wq = new THREE.Quaternion();
  let lastTurnStick = 0;
  const handLocals: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  const clock = new THREE.Clock();
  const perf = new Perf(params.has('perf'));
  let fpsFrames = 0;
  let fpsTime = 0;
  let fps = 0;

  renderer.setAnimationLoop((_time, frame?: XRFrame) => {
    perf.begin();
    const frameDt = clock.getDelta(); // real frame time, for the fps counter
    let dt = frameDt;
    if (emulator) {
      dt = Math.min(dt, 1 / 30); // keep emulator and simulation in step on slow machines
      emulator.update(dt);
    }
    perf.lap('emulator');

    if (frame && renderer.xr.isPresenting) {
      const refSpace = renderer.xr.getReferenceSpace();
      const pose = refSpace ? frame.getViewerPose(refSpace) : undefined;
      if (pose) {
        const p = pose.transform.position;
        headLocal.set(p.x, p.y, p.z);
      }
      const [left, right] = hands.all;
      const leftPos = left.localPosition(handLocals[0]);
      const rightPos = right.localPosition(handLocals[1]);

      // Arm span: estimate from height at the start, refine with the T-pose gesture.
      armSpan.estimateFromHeight(headLocal.y);
      const cal = armSpan.update(dt, headLocal, leftPos, rightPos, left.squeezed, right.squeezed);
      if (cal.finished) {
        hands.all.forEach((h) => h.pulse(1, 250));
        calibrationTick = 0;
      } else if (cal.progress > 0) {
        const tick = Math.floor(cal.progress * 10);
        if (tick !== calibrationTick) {
          calibrationTick = tick;
          hands.all.forEach((h) => h.pulse(0.1 + 0.4 * cal.progress, 40));
        }
      } else {
        calibrationTick = 0;
      }
      locomotion.reachScale = armSpan.scale;

      // Turning with the right thumbstick (when it is not busy turning pages or a hologram).
      const stickX = right.stickX;
      if (settings.data.turning !== 'off' && !book.isOpen && !building.isPlacing) {
        if (settings.data.turning === 'snap') {
          if (Math.abs(stickX) > 0.7 && Math.abs(lastTurnStick) < 0.3) locomotion.turn((-Math.sign(stickX) * Number(settings.data.snapAngle) * Math.PI) / 180);
        } else if (Math.abs(stickX) > 0.2) {
          const rate = ((TURN_SPEED_DEG[settings.data.turnSpeed] * Math.PI) / 180) * Math.sign(stickX) * ((Math.abs(stickX) - 0.2) / 0.8);
          locomotion.turn(-rate * dt);
        }
      }
      lastTurnStick = stickX;
      // The sky stays put in the world however you turn.
      if (atmosphere) atmosphere.sky.quaternion.copy(rig.quaternion).invert();
      perf.lap('arm span');
      locomotion.update(dt, headLocal, [leftPos, rightPos]);
      perf.lap('locomotion');

      hands.all.forEach((hand, i) => {
        const contact = locomotion.hands[i];
        hand.updateVisual(contact.position, contact.rawPosition, contact.touching);
        if (contact.justTouched) {
          hand.pulse(0.3, 25);
          if (!locomotion.handsIgnoreStructures) audio.slap(contact.surface.name, locomotion.velocity.length() / 5 + 0.25, contact.position);
        }
      });

      grab.update(dt, locomotion.hands);
      crafting.update(dt);
      combat.update(dt);
      perf.lap('grab+craft');
      camForward.set(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(_wq));
      camForward.y = 0;
      building.update(dt, {
        head: locomotion.headWorld(_viewer),
        hands: [locomotion.hands[0].position, locomotion.hands[1].position],
        forward: camForward.lengthSq() > 1e-6 ? camForward.normalize() : camForward.set(0, 0, -1),
      });

      hands.all.forEach((hand, i) => {
        const view = handViews[i];
        view.tracked = hand.tracked;
        view.pos.copy(locomotion.hands[i].position);
        view.squeezed = hand.squeezed;
        view.holding = grab.held(i as 0 | 1) !== null;
        view.stickX = hand.stickX;
      });
      perf.lap('building');
      book.update(dt, { head: locomotion.headWorld(_viewer), hands: handViews, phase: atmosphere?.phase ?? null });
      perf.lap('book');
      if (book.page !== lastPage || book.isOpen !== lastOpen) {
        audio.play(book.isOpen !== lastOpen ? 'click' : 'page');
        lastPage = book.page;
        lastOpen = book.isOpen;
      }

      camera.getWorldQuaternion(_hq);
      const headNow = locomotion.headWorld(_viewer);
      body.update(dt, headNow, _hq, [
        hands.left.tracked ? locomotion.hands[0].position : null,
        hands.right.tracked ? locomotion.hands[1].position : null,
      ]);
      survival.update(dt, headNow, _hq);
      loggerRef.current?.update(dt, headNow, _hq, hands, locomotion);
      spitsRef.current?.update(dt, 0);
      mirror.update(sticks, headNow);
      autosave += dt;
      if (autosave > AUTOSAVE_SECONDS && autosaveOn && (net.role !== 'host' || settings.data.hostAutosave)) {
        autosave = 0;
        saveNow();
      }
      perf.lap('body+survival');
      if (net.connected) sync.update(dt);
      crocs?.update(
        dt,
        headNow,
        locomotion.inWater,
        avatars.heads().map((h) => ({ pos: h.pos, inWater: (forestRef?.waterLevelAt(h.pos.x, h.pos.z) ?? -Infinity) > h.pos.y - 0.9, id: h.id })),
      );
      vitalsView.update(dt, hands.left.tracked ? body.forearm[0] : null, headNow, locomotion.headUnderwater);
      audio.listen(headNow, _hq);
      comfort.update(dt, Math.max(locomotion.velocity.length(), Math.abs(loggerRef.current?.rider !== null ? (loggerRef.current?.speed ?? 0) : 0)), _hq);
      quality.update(frameDt);
      let lakeEdge = Infinity;
      if (forestRef) for (const l of forestRef.lakes) lakeEdge = Math.min(lakeEdge, Math.hypot(l.x - headNow.x, l.z - headNow.z) - l.r);
      audio.update(dt, {
        night: atmosphere?.night ?? 0,
        lakeDistance: lakeEdge,
        fireDistance: fire.nearestCampfire(headNow),
        rub: friction.heat,
        inWater: locomotion.inWater,
        underwater: locomotion.headUnderwater,
        swimSpeed: locomotion.swimming ? Math.hypot(locomotion.velocity.x, locomotion.velocity.z) : 0,
        airSpeed: !locomotion.grounded && !locomotion.anyTouching ? locomotion.velocity.length() : 0,
        crocDistance: Infinity,
      });
      perf.lap('audio+ui');
      swimTime = locomotion.swimming ? swimTime + dt : 0;
      if (swimTime > 4) {
        swimTime = 0;
        void journal.notify('swim');
      }

      if (rig.position.y < LOCOMOTION.killY) locomotion.respawn(spawn);
    }

    // The world around the player: which chunks are drawn, and the time of day.
    const viewer = locomotion.headWorld(_viewer);
    forestRef?.update(viewer, dt);
    perf.lap('forest');
    atmosphere?.update(dt, viewer);
    perf.lap('atmosphere');
    animals?.update(dt, viewer, atmosphere?.night ?? 0, avatars.heads().map((h) => h.pos));
    perf.lap('animals');
    mapView?.explore(viewer.x, viewer.z);
    poisRef.current?.update(viewer);
    perf.lap('map+pois');
    treeRopes?.update(dt, viewer);
    fruits?.update(dt, viewer, survival.days);
    perf.lap('ropes+fruit');
    leaves?.update(dt, viewer, atmosphere?.night ?? 0);
    perf.lap('leaves');
    fire.update(dt, viewer, atmosphere?.night ?? 0);
    friction.update(dt);
    perf.lap('fire');

    // Step physics by the real frame time so sticks fall at the right speed whatever
    // the refresh rate, in steps of at most 1/60 s so slow frames don't make the
    // contacts mushy.
    const physicsDt = Math.min(Math.max(dt, 1 / 144), 1 / 20);
    const substeps = Math.ceil(physicsDt / (1 / 60) - 1e-6);
    world.timestep = physicsDt / substeps;
    for (let i = 0; i < substeps; i++) world.step();
    perf.lap('physics');
    sticks.sync(viewer, dt);
    perf.lap('sticks.sync');

    fpsFrames++;
    fpsTime += frameDt;
    if (fpsTime >= 0.5) {
      fps = Math.round(fpsFrames / fpsTime);
      fpsFrames = 0;
      fpsTime = 0;
    }
    hud.textContent = hudText(renderer, locomotion, armSpan, grab, journal, friction.heat, crafting, fps, emulator !== null, worldStats, atmosphere);

    if (perf.enabled) hud.textContent += `\n\nquality ${quality.level}${quality.auto ? ' (auto)' : ''}, ${quality.changes} changes\n${perf.report()}`;
    renderer.render(scene, camera);
    perf.lap('render');
  });

  // Handy for debugging from the console and for automated tests.
  Object.assign(window, { __monke: { net, sync, voice, avatars, settings, quality, comfort, perf, spits: spitsRef, logger: loggerRef, audio, mirror, saveNow, collect, applySave, THREE, vitals, survival, combat, crocs, fruits, body, camera, locomotion, hands, world, rig, emulator, armSpan, renderer, scene, spawn, forest: forestRef, sticks, grab, RAPIER, atmosphere, journal, book, fire, friction, animals, treeRopes, crafting, building, pois: poisRef, mapView } });
}

function hudText(
  renderer: THREE.WebGLRenderer,
  loco: Locomotion,
  arms: ArmSpan,
  grab: Grab,
  journal: Journal,
  heat: number,
  crafting: Crafting,
  fps: number,
  emulated: boolean,
  worldStats: string,
  atmosphere: Atmosphere | null,
): string {
  if (!renderer.xr.isPresenting) {
    return emulated
      ? 'No VR headset found: using the desktop emulator.\nPress ENTER VR below to start.'
      : '';
  }
  const v = loco.velocity;
  const lines = [
    `fps      ${fps}  (${worldStats})`,
    atmosphere ? `time     ${atmosphere.clock}  ${atmosphere.phase}  day ${atmosphere.day}` : 'time     -',
    `speed    ${Math.hypot(v.x, v.z).toFixed(2)} m/s  (vy ${v.y.toFixed(2)})`,
    `hands    L ${loco.hands[0].touching ? '●' : '○'}  R ${loco.hands[1].touching ? '●' : '○'}`,
    `grounded ${loco.grounded ? 'yes' : 'no'}`,
    `surface  L ${surfaceLabel(loco, 0)}  R ${surfaceLabel(loco, 1)}`,
    `holding  L ${grab.held(0)?.kind ?? '-'}  R ${grab.held(1)?.kind ?? '-'}`,
    `book     ${journal.stash} sticks, ${journal.unlocked.size}/${RECIPES.length} recipes`,
    crafting.smashes > 0 || crafting.lashing > 0 ? `tools    smashes ${crafting.smashes}/5  lashing ${Math.round(crafting.lashing * 100)}%` : 'tools    -',
    heat > 0.02 ? `heat     ${'#'.repeat(Math.round(heat * 10)).padEnd(10, '.')} rub sticks together` : 'heat     -',
    `reach    x${arms.scale.toFixed(2)}  (arm span ${arms.span.toFixed(2)} m, ${arms.calibrated ? 'calibrated' : 'estimated'})`,
  ];
  if (emulated) {
    lines.push(
      '',
      'click   look with the mouse',
      'W A S D knuckle-walk',
      'shift   faster strokes',
      'space   jump',
      'Q / E   squeeze left / right grip (grab and throw)',
      'B       open / close the book',
      '1-4     craft (book open)',
      'T       T-pose arm calibration',
      '[ ]     shorter / longer emulated arms',
      'R       respawn',
    );
  }
  return lines.join('\n');
}

function surfaceLabel(loco: Locomotion, i: 0 | 1): string {
  const hand = loco.hands[i];
  return hand.touching ? `${hand.surface.name} ${Math.round(hand.surface.slip * 100)}%` : '-';
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#900;padding:16px">${String(err)}</pre>`);
});
