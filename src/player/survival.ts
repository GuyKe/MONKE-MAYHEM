import * as THREE from 'three';
import type { Building } from '../world/building';
import { FOOD_VALUE, type FoodState, type Side, type Stick, type Sticks } from '../world/sticks';
import type { Grab } from './grab';
import type { Hands } from './hands';
import type { Locomotion } from './locomotion';
import type { Vitals, VitalsView } from './vitals';

export const MEAT_COLOR: Record<FoodState, THREE.Color> = {
  raw: new THREE.Color().setHSL(0.0, 0.55, 0.45),
  roast: new THREE.Color().setHSL(0.07, 0.55, 0.26),
  rotten: new THREE.Color().setHSL(0.22, 0.4, 0.3),
};

export interface SurvivalHooks {
  say(text: string): void;
  pulse(side: Side, strength: number, ms: number): void;
  /** Seconds in a game day. */
  cycleSeconds(): number;
  surfaceAt(x: number, z: number): number;
}

/** A leech is gone after this long if you leave it (seconds). */
const LEECH_LIFE = 50;
/** How often (seconds) a swimmer may pick one up, and the chance each time. */
const LEECH_EVERY = 3.5;
const LEECH_CHANCE = 0.4;
const MOUTH_REACH = 0.2;
/** A shelter has to be rested in this long (seconds). */
const REST_TIME = 3;
const REST_RADIUS = 2.1;

const _mouth = new THREE.Vector3();
const _fwd = new THREE.Vector3();
interface Leech {
  side: 0 | 1;
  life: number;
  mesh: THREE.Mesh;
  phase: number;
}

/**
 * Staying alive: the game clock, food and eating, meat that roasts in the sun and then rots, leeches, poison,
 * dying, and the shelter you wake up in.
 */
export class Survival {
  /** Game time in days (a day is one trip of the sun). */
  days = 0;
  /** Where you wake up after dying; null is the start of the forest. */
  respawnAt: { x: number; z: number; label: string } | null = null;
  readonly leeches: Leech[] = [];
  private wet = 0;
  private told = { leech: false, roast: false, rotten: false };
  private dying = 0;
  private rest = 0;
  private agingTimer = 0;
  private readonly leechGeo = new THREE.CapsuleGeometry(0.012, 0.045, 3, 6);
  private readonly leechMat = new THREE.MeshLambertMaterial({ color: 0x4a1410, flatShading: true });
  private readonly root = new THREE.Group();

  constructor(
    scene: THREE.Scene,
    private readonly sticks: Sticks,
    private readonly grab: Grab,
    private readonly hands: Hands,
    private readonly locomotion: Locomotion,
    private readonly vitals: Vitals,
    private readonly view: VitalsView,
    private readonly building: Building,
    private readonly spawn: THREE.Vector3,
    private readonly hooks: SurvivalHooks,
  ) {
    scene.add(this.root);
    vitals.onDeath = () => this.die();
    vitals.onHurt = () => hands.all.forEach((h) => h.pulse(0.8, 120));
  }

  /** Meat dropped by something that died. */
  dropMeat(at: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      const piece = this.sticks.craft('meat', at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.1 * i, (Math.random() - 0.5) * 0.3)), new THREE.Quaternion(), { age: 0, state: 'raw', color: MEAT_COLOR.raw });
      piece?.body.setLinvel({ x: (Math.random() - 0.5) * 2, y: 1.5, z: (Math.random() - 0.5) * 2 }, true);
    }
  }

  /** Called every frame. `head` is the head in the world and `headQuat` where it faces. */
  update(dt: number, head: THREE.Vector3, headQuat: THREE.Quaternion): void {
    this.days += dt / Math.max(1, this.hooks.cycleSeconds());
    this.vitals.update(dt);
    this.ageFood(dt, head);
    this.eat(head, headQuat);
    this.updateLeeches(dt);
    this.restInShelter(dt, head);
    if (this.dying > 0) {
      this.dying -= dt;
      if (this.dying <= 0) this.wake();
    }
  }

  // --- Food ----------------------------------------------------------------------------

  private ageFood(dt: number, head: THREE.Vector3): void {
    this.agingTimer += dt;
    if (this.agingTimer < 0.5) return;
    const step = this.agingTimer;
    this.agingTimer = 0;
    const cycle = Math.max(1, this.hooks.cycleSeconds());
    const racks = this.building.completed('rack');
    for (const stick of this.sticks.list) {
      if (stick.kind !== 'meat' || stick.hidden) continue;
      const nearRack = racks.some((r) => Math.hypot(r.x - stick.pos.x, r.z - stick.pos.z) < 2.4);
      stick.age += (step / cycle) * (nearRack ? 2 : 1);
      const state: FoodState = stick.age >= 2 ? 'rotten' : stick.age >= 1 ? 'roast' : 'raw';
      if (state !== stick.state) {
        stick.state = state;
        stick.baseColor.copy(MEAT_COLOR[state]);
        if (stick.pos.distanceTo(head) < 12) {
          if (state === 'roast' && !this.told.roast) {
            this.told.roast = true;
            this.hooks.say('Meat left out in the sun has roasted. It smells good.');
          } else if (state === 'rotten' && !this.told.rotten) {
            this.told.rotten = true;
            this.hooks.say('Meat left too long goes rotten. Do not eat it.');
          }
        }
      }
    }
  }

  private eat(head: THREE.Vector3, headQuat: THREE.Quaternion): void {
    _fwd.set(0, 0, -1).applyQuaternion(headQuat);
    _mouth.copy(head).addScaledVector(_fwd, 0.1);
    _mouth.y -= 0.09;
    for (const side of [0, 1] as const) {
      const held = this.grab.held(side);
      if (!held || (held.kind !== 'fruit' && held.kind !== 'meat')) continue;
      if (held.pos.distanceTo(_mouth) > MOUTH_REACH) continue;
      this.consume(held, side === 0 ? 'left' : 'right');
    }
  }

  private consume(food: Stick, side: Side): void {
    this.sticks.stash(food);
    this.hooks.pulse(side, 0.6, 120);
    if (food.kind === 'fruit') {
      this.vitals.heal(FOOD_VALUE.fruit);
      this.vitals.poison = Math.max(0, this.vitals.poison - 8);
      this.hooks.say('Sweet and juicy.');
      return;
    }
    const value = FOOD_VALUE.meat[food.state];
    if (food.state === 'rotten') {
      this.vitals.poisonFor(25);
      this.hooks.say('Rotten! You feel sick.');
    } else {
      this.vitals.heal(value);
      this.hooks.say(food.state === 'roast' ? 'Roasted meat. That hits the spot.' : 'Raw meat. It fills a little, but roasted would be better.');
    }
  }

  // --- Leeches -----------------------------------------------------------------------

  private updateLeeches(dt: number): void {
    const loco = this.locomotion;
    // Wading or swimming for a while picks them up.
    if (loco.inWater && this.vitals.alive) {
      this.wet += dt;
      if (this.wet >= LEECH_EVERY) {
        this.wet = 0;
        if (this.vitals.leeches < 5 && Math.random() < LEECH_CHANCE) this.attach();
      }
    } else {
      this.wet = Math.max(0, this.wet - dt);
    }
    // Pulling one off: a free hand closes on the hand it is stuck to.
    for (let i = this.leeches.length - 1; i >= 0; i--) {
      const l = this.leeches[i];
      l.life -= dt;
      const stuck = loco.hands[l.side].position;
      const other = (1 - l.side) as 0 | 1;
      const free = this.hands.all[other].squeezed && !this.grab.held(other);
      if (free && loco.hands[other].position.distanceTo(stuck) < 0.16) {
        this.pluck(i, other === 0 ? 'left' : 'right');
        continue;
      }
      if (l.life <= 0 || !this.vitals.alive) this.removeLeech(i);
      else {
        l.mesh.position.copy(stuck);
        l.mesh.position.y += 0.045;
        l.mesh.rotation.set(0.4, l.phase, Math.sin(performance.now() * 0.01 + l.phase) * 0.5);
      }
    }
    this.vitals.leeches = this.leeches.length;
  }

  private attach(): void {
    const side = (Math.random() < 0.5 ? 0 : 1) as 0 | 1;
    const mesh = new THREE.Mesh(this.leechGeo, this.leechMat);
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.leeches.push({ side, life: LEECH_LIFE, mesh, phase: Math.random() * 6 });
    this.hands.all[side].pulse(0.5, 100);
    if (!this.told.leech) {
      this.told.leech = true;
      this.hooks.say('A leech! Close your other hand on it to pull it off.');
    } else {
      this.hooks.say('Another leech!');
    }
  }

  private pluck(index: number, by: Side): void {
    this.removeLeech(index);
    this.hooks.pulse(by, 0.7, 90);
    this.hooks.say('Got it off.');
  }

  private removeLeech(index: number): void {
    const [l] = this.leeches.splice(index, 1);
    this.root.remove(l.mesh);
  }

  /** Adds leeches to a hand (for tests). */
  forceLeech(): void {
    this.attach();
  }

  // --- Death and shelters --------------------------------------------------------------

  private die(): void {
    this.dying = 2.4;
    this.view.fadeTarget = 1;
    this.hooks.say('You died.');
    this.hands.all.forEach((h) => h.pulse(1, 400));
  }

  private wake(): void {
    const at = this.respawnAt ?? { x: this.spawn.x, z: this.spawn.z, label: 'the start' };
    this.locomotion.respawn({ x: at.x, y: this.hooks.surfaceAt(at.x, at.z), z: at.z });
    for (let i = this.leeches.length - 1; i >= 0; i--) this.removeLeech(i);
    this.vitals.revive();
    this.view.fadeTarget = 0;
    this.hooks.say(this.respawnAt ? `You wake in ${at.label}.` : 'You wake at the start of the forest.');
  }

  private restInShelter(dt: number, head: THREE.Vector3): void {
    if (!this.vitals.alive) return;
    let near: { id: string; x: number; z: number } | null = null;
    for (const s of this.building.completed('shelter')) {
      if (Math.hypot(s.x - head.x, s.z - head.z) < REST_RADIUS && head.y - this.hooks.surfaceAt(s.x, s.z) < 1.8) near = s;
    }
    if (!near) {
      this.rest = 0;
      return;
    }
    if (this.respawnAt && Math.hypot(this.respawnAt.x - near.x, this.respawnAt.z - near.z) < 0.5) return;
    this.rest += dt;
    if (this.rest >= REST_TIME) {
      this.rest = 0;
      this.setRespawn(near.x, near.z, near.id);
    }
  }

  /** Makes a shelter the place you wake after dying. */
  setRespawn(x: number, z: number, id: string): void {
    const label = id === 'hut' ? 'your stick hut' : id === 'bed' ? 'your sleeping platform' : 'your lean-to';
    this.respawnAt = { x, z, label };
    this.hooks.say(`This is home now. If you die, you will wake in ${label}.`);
    this.hands.all.forEach((h) => h.pulse(0.6, 150));
  }
}
