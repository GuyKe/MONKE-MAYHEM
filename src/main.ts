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
import { Fire } from './world/fire';
import { TreeRopes } from './world/ropes';
import { Crafting } from './player/crafting';
import { Animals } from './world/animals';
import { FrictionFire } from './world/friction';
import { Sticks } from './world/sticks';
import type { DesktopEmulator } from './debug/desktop';
import { DAY_SECONDS, FOG_SCALE, Settings, TREE_SPACING_M, VIEW_DISTANCE_M } from './settings';
import { Menu } from './ui/menu';
import { Hand } from './player/hands';

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const settings = new Settings();

  // The main menu comes first: it shows while the forest is built, and again whenever you leave VR.
  // Hooks that need things created later are filled in below.
  const actions = { play: () => {}, resetArms: () => {}, resetBook: () => {} };
  const menu = new Menu(settings, {
    onPlay: () => actions.play(),
    onNewWorld: () => {
      const url = new URL(location.href);
      url.searchParams.delete('seed'); // a new random forest
      location.href = url.toString();
    },
    onResetArms: () => actions.resetArms(),
    onResetBook: () => actions.resetBook(),
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
  const seed = params.has('seed') ? Number(params.get('seed')) || 1 : Math.floor(Math.random() * 0x7fffffff);
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
    worldStats = `seed ${seed}: ${s.trees} trees, ${forest.ropes.length} ropes, ${s.ponds} ponds`;
  }
  world.step(); // populate the broad phase so queries see the static scenery

  // Wildlife: rabbits, deer and birds (forest only).
  const animals = forestRef
    ? new Animals(scene, {
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

  // The field journal on your hip: stash sticks in it, craft from it, unlock recipes as you go.
  const journal = new Journal(params.has('resetbook'));
  const fire = new Fire(scene, sticks, world, forestRef ? forestRef.surfaceAt : () => 0);
  const book = new Book(scene, camera, journal, sticks, {
    makePiece: (kind, position, quaternion) => void sticks.craft(kind, position, quaternion),
    buildCampfire: (x, z) => void fire.addCampfire(x, z),
  });
  // Rub two sticks together to make fire; over a pile of sticks it becomes a campfire.
  const friction = new FrictionFire(scene, sticks, fire, forestRef ? forestRef.surfaceAt : () => 0, {
    onMessage: (text) => book.say(text),
    pulse: (side, strength, ms) => hands[side].pulse(strength, ms),
  });
  // Ropes hanging in trees: grab one and pull down to tear it free.
  const treeRopes = forestRef ? new TreeRopes(scene, forestRef.ropes) : null;
  const grab = new Grab(sticks, hands, {
    stash: (stick, handPos) => book.acceptStash(stick, handPos),
    onFarThrow: () => void journal.notify('throw'),
    ropes: treeRopes ?? undefined,
    onRopePulled: () => book.say('Rope! Keep it: wind it round an axe head, or use it to tie things.'),
  });

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
      say: (text) => book.say(text),
      burst: (at, count) => friction.burst(at, count),
      pulse: (side, strength, ms) => hands[side].pulse(strength, ms),
    },
  );
  const handViews: [HandView, HandView] = hands.all.map((hand) => ({
    tracked: false,
    pos: new THREE.Vector3(),
    squeezed: false,
    holding: false,
    pulse: (strength: number, ms: number) => hand.pulse(strength, ms),
  })) as [HandView, HandView];
  const locomotion = new Locomotion(world, rig);
  const armSpan = new ArmSpan();
  let calibrationTick = 0;
  locomotion.respawn(spawn);

  const vrButton = VRButton.createButton(renderer);
  if (emulator) vrButton.textContent = 'ENTER VR (DESKTOP EMULATOR)';
  document.body.appendChild(vrButton);

  // Menu wiring: Play starts the VR session; leaving VR brings the menu back so you can resume.
  Hand.hapticScale = settings.data.haptics;
  if (!skipMenu) document.body.classList.add('has-menu'); // the menu's Play button replaces the VR button
  actions.play = () => vrButton.click();
  actions.resetArms = () => armSpan.reset();
  actions.resetBook = () => journal.reset();
  renderer.xr.addEventListener('sessionstart', () => menu.hide());
  renderer.xr.addEventListener('sessionend', () => {
    menu.setResuming(true);
    menu.show();
  });
  menu.setLoading(null);
  if (!emulator && !navigator.xr) menu.setPlayMessage('This browser has no WebXR. Open the game in your headset browser.');

  // Settings that take effect straight away.
  const hudEl = document.getElementById('hud')!;
  const applySetting = () => {
    Hand.hapticScale = settings.data.haptics;
    forestRef?.setViewRadius(VIEW_DISTANCE_M[settings.data.viewDistance]);
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
  const handLocals: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  const clock = new THREE.Clock();
  let fpsFrames = 0;
  let fpsTime = 0;
  let fps = 0;

  renderer.setAnimationLoop((_time, frame?: XRFrame) => {
    const frameDt = clock.getDelta(); // real frame time, for the fps counter
    let dt = frameDt;
    if (emulator) {
      dt = Math.min(dt, 1 / 30); // keep emulator and simulation in step on slow machines
      emulator.update(dt);
    }

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

      locomotion.update(dt, headLocal, [leftPos, rightPos]);

      hands.all.forEach((hand, i) => {
        const contact = locomotion.hands[i];
        hand.updateVisual(contact.position, contact.rawPosition, contact.touching);
        if (contact.justTouched) hand.pulse(0.3, 25);
      });

      grab.update(dt, locomotion.hands);
      crafting.update(dt);

      hands.all.forEach((hand, i) => {
        const view = handViews[i];
        view.tracked = hand.tracked;
        view.pos.copy(locomotion.hands[i].position);
        view.squeezed = hand.squeezed;
        view.holding = grab.held(i as 0 | 1) !== null;
      });
      book.update(dt, { head: locomotion.headWorld(_viewer), hands: handViews, phase: atmosphere?.phase ?? null });

      if (rig.position.y < LOCOMOTION.killY) locomotion.respawn(spawn);
    }

    // The world around the player: which chunks are drawn, and the time of day.
    const viewer = locomotion.headWorld(_viewer);
    forestRef?.update(viewer);
    atmosphere?.update(dt, viewer);
    animals?.update(dt, viewer, atmosphere?.night ?? 0);
    treeRopes?.update(dt);
    fire.update(dt, viewer, atmosphere?.night ?? 0);
    friction.update(dt);

    // Step physics by the real frame time so sticks fall at the right speed whatever
    // the refresh rate, in steps of at most 1/60 s so slow frames don't make the
    // contacts mushy.
    const physicsDt = Math.min(Math.max(dt, 1 / 144), 1 / 20);
    const substeps = Math.ceil(physicsDt / (1 / 60) - 1e-6);
    world.timestep = physicsDt / substeps;
    for (let i = 0; i < substeps; i++) world.step();
    sticks.sync();

    fpsFrames++;
    fpsTime += frameDt;
    if (fpsTime >= 0.5) {
      fps = Math.round(fpsFrames / fpsTime);
      fpsFrames = 0;
      fpsTime = 0;
    }
    hud.textContent = hudText(renderer, locomotion, armSpan, grab, journal, friction.heat, crafting, fps, emulator !== null, worldStats, atmosphere);

    renderer.render(scene, camera);
  });

  // Handy for debugging from the console and for automated tests.
  Object.assign(window, { __monke: { locomotion, hands, world, rig, emulator, armSpan, renderer, scene, spawn, forest: forestRef, sticks, grab, RAPIER, atmosphere, journal, book, fire, friction, animals, treeRopes, crafting } });
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
