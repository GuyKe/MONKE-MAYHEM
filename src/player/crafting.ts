import * as THREE from 'three';
import type { FellInfo, Tree } from '../world/forest';
import { type Side, type Stick, type Sticks } from '../world/sticks';
import type { Grab } from './grab';
import type { Hands } from './hands';
import { TieGesture } from './tie';

export interface CraftingHooks {
  /** Something to tell the player (shown above the book). */
  say(text: string): void;
  /** A puff of sparks or chips at a point. */
  burst(at: THREE.Vector3, count: number): void;
  pulse(side: Side, strength: number, ms: number): void;
  /** Tells the journal something happened. */
  notify?(event: 'axe' | 'log' | 'axe2'): void;
  /** A tree came down and landed. */
  onFelled?(tree: Tree): void;
}

export interface CraftingWorld {
  /** The tree whose trunk is within `pad` of (x, z). */
  nearestTree(x: number, z: number, pad: number): Tree | null;
  surfaceAt(x: number, z: number): number;
  /** Chops a tree down: it falls away from (fromX, fromZ), and `done` is called when it lands. */
  fellTree?(tree: Tree, fromX: number, fromZ: number, done: (landed: FellInfo) => void): boolean;
}

/** How many good smashes of a stone against the outline turn a stick into an axe. */
export const SMASHES_FOR_AXE = 3;
/** How fast (m/s) the stone and stick must come together for a smash to count. */
const SMASH_SPEED = 1.6;
/** Surface-to-surface distance (metres) at which they count as touching. */
const SMASH_GAP = 0.04;
/** Hits on a trunk before each log comes loose, for a stone axe and a lashed one. */
const HITS_PER_LOG = { axe: 3, axe2: 2 };
/** A tree gives this many logs before it is spent. */
const LOGS_PER_TREE = 4;
/** Head speed (m/s) a chop needs. */
const CHOP_SPEED = 3.2;
/** A swing counts for this long (seconds) after the head moved fast: the blow itself stops it dead. */
const SWING_MEMORY = 0.15;
/** Blows to bring a tree down: more for a thicker trunk, fewer with a lashed axe. */
const hitsToFell = (tree: Tree, axe: Stick): number => Math.ceil(tree.radius * 12 * (axe.kind === 'axe2' ? 0.65 : 1));

interface SwingSample {
  speed: number;
  dir: THREE.Vector3;
  age: number;
}

const _a = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _n = new THREE.Vector3();
const _hp = new THREE.Vector3();
const _hq = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Making and using tools.
 *
 *  - **Stone axe:** hold a stone in one hand and a stick in the other, hold both triggers, and smash them together
 *    five times. The stone is bound to the stick and you hold an axe.
 *  - **Chopping:** swing an axe hard into a tree trunk. Logs come loose, but each swing wears the axe, and it breaks.
 *  - **Lashed axe:** hold an axe and a rope, hold both triggers, and wind the rope round the axe head with your hand.
 *    The reinforced axe lasts much longer and chops faster.
 */
export class Crafting {
  /** Smashes so far towards an axe. */
  smashes = 0;
  /** Progress winding rope on an axe, 0 to 1. */
  lashing = 0;

  private smashCooldown = 0;
  private sinceSmash = 0;
  private guideCooldown = 0;
  private readonly chopCooldown = new Map<Stick, number>();
  private readonly swings = new Map<Stick, SwingSample[]>();
  private readonly treeHits = new Map<Tree, { hits: number; logs: number }>();
  private readonly tie = new TieGesture(1.5, 0.025, 0.24, 0.16);
  private lashBuzz = 0;
  private told = { lashing: false, worn: new Set<Stick>() };
  /** The outline of a stone that appears on the tip of a stick you hold a trigger on. */
  private readonly ghost: THREE.Mesh | null;
  private ghostTime = 0;
  /** Trees that are coming down (so they are not chopped twice). */
  private readonly falling = new Set<Tree>();

  constructor(
    private readonly sticks: Sticks,
    private readonly grab: Grab,
    private readonly hands: Hands,
    private readonly world: CraftingWorld,
    private readonly hooks: CraftingHooks,
    scene?: THREE.Scene,
  ) {
    if (scene) {
      this.ghost = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1, 0),
        new THREE.MeshBasicMaterial({ color: 0x66d0ff, wireframe: true, transparent: true, opacity: 0.9, depthTest: false }),
      );
      this.ghost.scale.set(0.075, 0.06, 0.04);
      this.ghost.renderOrder = 5;
      this.ghost.visible = false;
      scene.add(this.ghost);
    } else {
      this.ghost = null;
    }
  }

  /** Where the stone outline is right now, or null if it is not showing (for tests). */
  get outlineAt(): THREE.Vector3 | null {
    return this.ghost && this.ghost.visible ? this.ghost.position : null;
  }

  update(dt: number): void {
    this.smashCooldown = Math.max(0, this.smashCooldown - dt);
    this.guideCooldown = Math.max(0, this.guideCooldown - dt);
    for (const [stick, t] of this.chopCooldown) this.chopCooldown.set(stick, Math.max(0, t - dt));

    this.knap(dt);
    this.lash(dt);
    for (const side of [0, 1] as const) {
      const held = this.grab.held(side);
      if (held && (held.kind === 'axe' || held.kind === 'axe2')) this.chop(held, side, dt);
    }
  }

  // --- Stone axe ----------------------------------------------------------------

  private knap(dt: number): void {
    const held = [this.grab.held(0), this.grab.held(1)] as const;
    const stoneHand = held[0]?.kind === 'stone' ? 0 : held[1]?.kind === 'stone' ? 1 : -1;
    const stickHand = held[0]?.kind === 'stick' ? 0 : held[1]?.kind === 'stick' ? 1 : -1;
    if (this.ghost) this.ghost.visible = false;
    if (stickHand < 0) {
      this.sinceSmash += dt;
      if (this.sinceSmash > 6) this.smashes = 0; // wandered off; start again
      return;
    }
    const stick = held[stickHand as 0 | 1]!;
    const trigger = (stickHand === 0 ? this.hands.left : this.hands.right).triggered;

    if (!trigger) {
      if (stoneHand >= 0 && this.guideCooldown === 0 && this.smashes === 0) {
        this.guideCooldown = 25;
        this.hooks.say('Hold the trigger on the hand with the stick: an outline of a stone appears. Smash a stone into it.');
      }
      return;
    }

    // The outline of a stone, on the tip of the stick.
    this.sticks.headPosition(stick, _hp);
    this.ghostTime += dt;
    const stone = stoneHand >= 0 && stoneHand !== stickHand ? held[stoneHand as 0 | 1]! : null;
    const near = stone ? stone.pos.distanceTo(_hp) < 0.3 : false;
    if (this.ghost) {
      this.ghost.visible = true;
      this.ghost.position.copy(_hp);
      this.ghost.quaternion.copy(stick.quat);
      this.ghost.scale.set(0.075, 0.06, 0.04).multiplyScalar(1.15 + 0.12 * Math.sin(this.ghostTime * 6));
      (this.ghost.material as THREE.MeshBasicMaterial).color.set(near ? 0x70ff90 : 0x66d0ff);
    }
    if (!stone) return;
    this.sinceSmash += dt;
    if (this.sinceSmash > 6) this.smashes = 0;
    if (this.smashCooldown > 0) return;

    // Is the stone at the outline, and coming at it fast?
    const gap = stone.pos.distanceTo(_hp) - stone.radius - 0.04;
    if (gap > SMASH_GAP) return;
    _n.subVectors(_hp, stone.pos).normalize(); // from the stone to the outline
    this.grab.velocity(stickHand as 0 | 1, _v);
    this.grab.velocity(stoneHand as 0 | 1, _w);
    const closing = _w.sub(_v).dot(_n);
    if (closing < SMASH_SPEED) return;

    this.smashCooldown = 0.3;
    this.sinceSmash = 0;
    this.smashes++;
    this.hooks.burst(_hp, 6);
    this.hooks.pulse('left', 0.9, 70);
    this.hooks.pulse('right', 0.9, 70);

    if (this.smashes < SMASHES_FOR_AXE) {
      this.hooks.say(`Smash! ${this.smashes} of ${SMASHES_FOR_AXE}.`);
      return;
    }

    // Done: the stone is bound to the stick. It stays in the hand that held the stick.
    this.smashes = 0;
    if (this.ghost) this.ghost.visible = false;
    const length = THREE.MathUtils.clamp(stick.length, 0.6, 0.9);
    const axe = this.sticks.craft('axe', stick.pos.clone(), stick.quat.clone(), { length });
    this.sticks.stash(stone);
    this.sticks.stash(stick);
    if (axe) this.grab.give(stickHand as 0 | 1, axe);
    this.hooks.burst(_hp, 14);
    this.hooks.say('You made a stone axe! Swing it into a tree. It will wear out.');
    this.hooks.notify?.('axe');
    this.hooks.pulse('left', 1, 160);
    this.hooks.pulse('right', 1, 160);
  }

  // --- Chopping -----------------------------------------------------------------

  private chop(axe: Stick, side: 0 | 1, dt: number): void {
    const head = this.sticks.headPosition(axe, _hp);

    // How fast the head is going: the body's speed plus how fast it is swinging round the hand. The blow
    // itself stops it dead, so remember the fastest it went in the last moment.
    const lv = axe.body.linvel();
    const av = axe.body.angvel();
    _v.set(lv.x, lv.y, lv.z);
    _w.subVectors(head, axe.pos);
    _v.add(_axis.set(av.y * _w.z - av.z * _w.y, av.z * _w.x - av.x * _w.z, av.x * _w.y - av.y * _w.x));
    const recent = this.swings.get(axe) ?? [];
    this.swings.set(axe, recent);
    for (const s of recent) s.age += dt;
    while (recent.length && recent[0].age > SWING_MEMORY) recent.shift();
    const speed = _v.length();
    if (speed > 0.5) recent.push({ speed, dir: _v.clone().normalize(), age: 0 });
    let swing: SwingSample | null = null;
    for (const s of recent) if (!swing || s.speed > swing.speed) swing = s;

    if ((this.chopCooldown.get(axe) ?? 0) > 0) return;
    const tree = this.world.nearestTree(head.x, head.z, 0.12);
    if (!tree || !swing) return;
    const ground = this.world.surfaceAt(tree.x, tree.z);
    if (head.y < ground || head.y > ground + tree.height) return;
    if (swing.speed < CHOP_SPEED) return;
    // Heading into the trunk, not just scraping along it.
    _n.set(tree.x - head.x, 0, tree.z - head.z).normalize();
    if (swing.dir.dot(_n) < 0.4) return;
    recent.length = 0; // that swing has landed

    this.chopCooldown.set(axe, 0.45);
    const sideName: Side = side === 0 ? 'left' : 'right';
    this.hooks.pulse(sideName, 1, 80);
    this.hooks.burst(head, 5);

    const record = this.treeHits.get(tree) ?? { hits: 0, logs: 0 };
    this.treeHits.set(tree, record);
    record.hits++;
    axe.durability -= 1;

    // Enough blows and the tree comes down.
    if (this.world.fellTree && !this.falling.has(tree) && record.hits >= hitsToFell(tree, axe)) {
      this.falling.add(tree);
      this.hooks.pulse(sideName, 1, 250);
      if (this.world.fellTree(tree, head.x, head.z, (info) => this.landed(tree, info))) {
        this.hooks.say('Timber! Stand clear.');
      } else {
        this.falling.delete(tree);
      }
    }

    const needed = axe.kind === 'axe2' ? HITS_PER_LOG.axe2 : HITS_PER_LOG.axe;
    if (record.hits % needed === 0) {
      if (record.logs >= LOGS_PER_TREE) {
        this.hooks.say('This tree is spent. Try another.');
      } else {
        record.logs++;
        // A log drops from the cut, on the side you are standing.
        const out = _n.clone().multiplyScalar(-0.35);
        const at = new THREE.Vector3(head.x + out.x, head.y, head.z + out.z);
        this.sticks.craft('log', at, new THREE.Quaternion().setFromAxisAngle(_up, Math.random() * 6.28).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)));
        this.hooks.notify?.('log');
        this.hooks.say(`A log comes loose. (${record.logs} of ${LOGS_PER_TREE} from this tree.)`);
      }
    }

    if (axe.durability <= 0) this.breakAxe(axe, sideName);
    else if (axe.durability === 3 && !this.told.worn.has(axe)) {
      this.told.worn.add(axe);
      this.hooks.say('The axe is wearing out.');
    }
  }

  /** A felled tree has hit the ground: logs along the trunk, sticks where the crown lies. */
  private landed(tree: Tree, info: FellInfo): void {
    this.falling.delete(tree);
    this.treeHits.delete(tree);
    const dir = new THREE.Vector3(info.dirX, 0, info.dirZ);
    const along = new THREE.Quaternion().setFromUnitVectors(_up, dir);
    const logs = Math.max(2, Math.min(5, Math.floor(info.height / 4.5)));
    for (let i = 0; i < logs; i++) {
      const d = 1.3 + i * 1.5;
      const x = info.x + dir.x * d;
      const z = info.z + dir.z * d;
      this.sticks.craft('log', new THREE.Vector3(x, this.world.surfaceAt(x, z) + 0.5 + i * 0.05, z), along.clone());
    }
    for (let i = 0; i < 7; i++) {
      const d = info.height * (0.55 + Math.random() * 0.4);
      const x = info.x + dir.x * d + (Math.random() - 0.5) * 2.5;
      const z = info.z + dir.z * d + (Math.random() - 0.5) * 2.5;
      this.sticks.craft('stick', new THREE.Vector3(x, this.world.surfaceAt(x, z) + 0.6 + Math.random() * 0.4, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)));
    }
    this.hooks.burst(new THREE.Vector3(info.x + dir.x * info.height * 0.7, this.world.surfaceAt(info.x, info.z) + 0.3, info.z + dir.z * info.height * 0.7), 24);
    this.hooks.notify?.('log');
    this.hooks.onFelled?.(tree);
    this.hooks.say('The tree is down. Logs and sticks lie along it.');
  }

  /** The axe falls apart into what it was made of (and a lashed one gives back its rope). */
  private breakAxe(axe: Stick, side: Side): void {
    const at = axe.pos.clone();
    const quat = axe.quat.clone();
    const lashed = axe.kind === 'axe2';
    this.sticks.stash(axe);
    const q = new THREE.Quaternion();
    const spawn = (kind: 'stick' | 'stone' | 'rope', dx: number, dz: number) => {
      const piece = this.sticks.craft(kind, at.clone().add(new THREE.Vector3(dx, 0.05, dz)), kind === 'stick' ? quat : q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)));
      piece?.body.setLinvel({ x: dx * 4, y: 1.5, z: dz * 4 }, true);
    };
    spawn('stone', 0.1, 0);
    spawn('stick', -0.1, 0.05);
    if (lashed) spawn('rope', 0, -0.12);
    this.hooks.burst(at, 12);
    this.hooks.pulse(side, 1, 200);
    this.hooks.say(lashed ? 'The axe broke! The rope, stone and stick are still good.' : 'The axe broke! The stone and stick are still good.');
  }

  // --- Lashing rope round an axe head ---------------------------------------------

  private lash(dt: number): void {
    const held = [this.grab.held(0), this.grab.held(1)] as const;
    const axeHand = held[0]?.kind === 'axe' ? 0 : held[1]?.kind === 'axe' ? 1 : -1;
    const ropeHand = held[0]?.kind === 'rope' ? 0 : held[1]?.kind === 'rope' ? 1 : -1;
    if (axeHand < 0 || ropeHand < 0 || axeHand === ropeHand) {
      this.tie.reset();
      this.lashing = 0;
      return;
    }
    const axe = held[axeHand as 0 | 1]!;
    const coil = held[ropeHand as 0 | 1]!;
    if (!this.told.lashing) {
      this.told.lashing = true;
      this.hooks.say('Hold both triggers and wind the rope round the axe head.');
    }

    this.sticks.headPosition(axe, _hp);
    _axis.set(0, 1, 0).applyQuaternion(axe.quat);
    this.grab.handPose(ropeHand as 0 | 1, _a, _hq);
    const active = this.hands.left.triggered && this.hands.right.triggered;
    const added = this.tie.update(dt, _hp, _axis, _a, active);
    this.lashing = this.tie.progress;
    axe.wrap = Math.max(axe.wrap, this.lashing); // the winding shows on the axe as you go

    this.lashBuzz -= dt;
    if (added > 0 && this.lashBuzz <= 0) {
      this.lashBuzz = 0.07;
      this.hooks.pulse(ropeHand === 0 ? 'left' : 'right', 0.15 + 0.5 * this.lashing, 40);
    }
    if (this.lashing < 1) return;

    // Tied. The lashed axe replaces the plain one in the same hand, and the rope is used up.
    this.tie.reset();
    this.lashing = 0;
    const lashed = this.sticks.craft('axe2', axe.pos.clone(), axe.quat.clone(), { length: axe.length, wrap: 1 });
    this.sticks.stash(axe);
    this.sticks.stash(coil);
    if (lashed) this.grab.give(axeHand as 0 | 1, lashed);
    this.hooks.burst(_hp, 8);
    this.hooks.pulse('left', 1, 160);
    this.hooks.pulse('right', 1, 160);
    this.hooks.say('Lashed tight! A stronger axe: it lasts longer and chops faster.');
    this.hooks.notify?.('axe2');
  }
}
