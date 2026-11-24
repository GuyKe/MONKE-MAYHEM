import * as THREE from 'three';
import type { Fire } from './fire';
import type { Building } from './building';
import type { Stick, Sticks, FoodState } from './sticks';
import type { Grab } from '../player/grab';
import type { Hands } from '../player/hands';
import type { Locomotion } from '../player/locomotion';
import { MEAT_COLOR } from '../player/survival';

export interface SpitHooks {
  say(text: string): void;
  pulse(side: 'left' | 'right', strength: number, ms: number): void;
  sound?(name: 'scrape' | 'click' | 'thud', at: THREE.Vector3): void;
}

interface Skewer {
  state: FoodState;
  age: number;
  /** Where along the rod (metres from the middle). */
  along: number;
  phase: number;
  mesh: THREE.Mesh;
}

interface SpitState {
  key: string;
  base: THREE.Vector3;
  rod: THREE.Vector3;
  axis: THREE.Vector3;
  side: THREE.Vector3;
  group: THREE.Group;
  lever: THREE.Mesh;
  weight: THREE.Mesh;
  skewers: Skewer[];
  /** How far round the crank is (radians). */
  angle: number;
  /** Cooking done, 0 to 1 and a bit. */
  progress: number;
  hasWeight: boolean;
  /** Which hand turns the crank, and where its angle started. */
  hand: 0 | 1 | null;
  lastHandAngle: number;
  turns: number;
  toldFire: boolean;
}

/** The crank arm's length, and how far the grip reaches. */
const CRANK = 0.32;
const GRIP = 0.2;
/** One full turn cooks this much (a dozen turns roast the meat). */
const PER_TURN = 0.085;
/** A stone on the lever turns it this fast (radians per second). */
const WEIGHT_SPEED = 0.75;
/** Each time the weighted lever comes round, the stone may slip off. */
const SLIP_CHANCE = 0.3;
const MAX_MEAT = 2;
/** A fire must be this close to cook. */
const FIRE_REACH = 1.4;
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Roasting spits: once built, a crank sticks out of the end of the rod. Put meat on the rod (let go of it there), light a
 * fire under it and turn the crank with your hand: a dozen turns and the meat is roasted. Rest a stone on the lever and it
 * keeps turning by itself, until the stone slips off. Take the meat off with your grip.
 */
export class Spits {
  readonly list: SpitState[] = [];
  private readonly meatGeo = new THREE.IcosahedronGeometry(1, 1);
  private readonly leverMat = new THREE.MeshLambertMaterial({ color: 0x8a6a40, flatShading: true });
  private readonly stoneMat = new THREE.MeshLambertMaterial({ color: 0x8b8f86, flatShading: true });

  constructor(
    private readonly scene: THREE.Scene,
    private readonly building: Building,
    private readonly sticks: Sticks,
    private readonly fire: Fire,
    private readonly grab: Grab,
    private readonly hands: Hands,
    private readonly locomotion: Locomotion,
    private readonly hooks: SpitHooks,
  ) {}

  /** Makes a spit for every finished one that has none. */
  private sync(): void {
    for (const s of this.building.completed('spit')) {
      const key = `${s.x.toFixed(2)},${s.z.toFixed(2)}`;
      if (this.list.some((o) => o.key === key)) continue;
      const axis = new THREE.Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
      const side = new THREE.Vector3().crossVectors(axis, UP).normalize();
      const rod = new THREE.Vector3(s.x, s.y + 0.92, s.z);
      const group = new THREE.Group();
      const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 6), this.leverMat);
      const weight = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07, 0), this.stoneMat);
      weight.visible = false;
      const handle = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), this.leverMat);
      lever.add(handle);
      handle.position.y = 0.5;
      group.add(lever, weight);
      this.scene.add(group);
      this.list.push({
        key,
        base: rod.clone().addScaledVector(axis, 0.98),
        rod,
        axis,
        side,
        group,
        lever,
        weight,
        skewers: [],
        angle: 0,
        progress: 0,
        hasWeight: false,
        hand: null,
        lastHandAngle: 0,
        turns: 0,
        toldFire: false,
      });
      this.hooks.say('The spit is ready. Put meat on the rod, light a fire under it, and turn the crank.');
    }
  }

  private tip(s: SpitState, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(s.base).addScaledVector(UP, Math.cos(s.angle) * CRANK).addScaledVector(s.side, Math.sin(s.angle) * CRANK);
  }

  /** A piece was let go at `at`: meat goes on the rod, a stone onto the lever. True if the spit took it. */
  accept(stick: Stick): boolean {
    for (const s of this.list) {
      if (stick.kind === 'meat' && s.skewers.length < MAX_MEAT && this.distanceToRod(s, stick.pos) < 0.32) {
        const used = s.skewers.map((k) => k.along);
        const along = [-0.4, 0.35, 0][used.length] ?? 0;
        const mesh = new THREE.Mesh(this.meatGeo, new THREE.MeshLambertMaterial({ color: MEAT_COLOR[stick.state], flatShading: true }));
        mesh.scale.set(0.2, 0.1, 0.1);
        s.group.add(mesh);
        s.skewers.push({ state: stick.state, age: stick.age, along, phase: s.skewers.length * 2.5, mesh });
        this.sticks.stash(stick);
        this.hooks.say('On the spit. Turn the crank over a fire.');
        return true;
      }
      if (stick.kind === 'stone' && !s.hasWeight && stick.pos.distanceTo(this.tip(s, _a)) < GRIP + 0.1) {
        s.hasWeight = true;
        s.weight.visible = true;
        this.sticks.stash(stick);
        this.hooks.say('The stone weighs the lever down and it turns. It may slip off.');
        return true;
      }
    }
    return false;
  }

  /** A squeezed empty hand at `p`: takes meat off a spit. */
  take(p: THREE.Vector3): Stick | null {
    for (const s of this.list) {
      for (let i = 0; i < s.skewers.length; i++) {
        const k = s.skewers[i];
        if (k.mesh.position.distanceTo(p) > 0.25) continue;
        s.skewers.splice(i, 1);
        s.group.remove(k.mesh);
        const piece = this.sticks.craft('meat', p.clone(), new THREE.Quaternion(), { state: k.state, age: k.age, color: MEAT_COLOR[k.state] });
        return piece;
      }
    }
    return null;
  }

  private distanceToRod(s: SpitState, p: THREE.Vector3): number {
    _a.subVectors(p, s.rod);
    const along = THREE.MathUtils.clamp(_a.dot(s.axis), -0.9, 0.9);
    return _b.copy(s.rod).addScaledVector(s.axis, along).distanceTo(p);
  }

  update(dt: number, time: number): void {
    this.sync();
    for (const s of this.list) {
      const before = s.angle;
      this.tip(s, _a);
      // A hand on the crank turns it.
      if (s.hand !== null) {
        const hand = this.hands.all[s.hand];
        if (!hand.squeezed || this.grab.held(s.hand)) s.hand = null;
        else {
          const h = this.locomotion.hands[s.hand].position;
          _b.subVectors(h, s.base);
          const phi = Math.atan2(_b.dot(s.side), _b.dot(UP));
          let d = phi - s.lastHandAngle;
          d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
          s.angle += d;
          s.lastHandAngle = phi;
        }
      } else if (s.hasWeight) {
        s.angle += WEIGHT_SPEED * dt;
      }
      if (s.hand === null) {
        for (const i of [0, 1] as const) {
          if (this.hands.all[i].squeezed && !this.grab.held(i) && this.locomotion.hands[i].position.distanceTo(_a) < GRIP) {
            s.hand = i;
            _b.subVectors(this.locomotion.hands[i].position, s.base);
            s.lastHandAngle = Math.atan2(_b.dot(s.side), _b.dot(UP));
            this.hooks.pulse(i === 0 ? 'left' : 'right', 0.4, 50);
            break;
          }
        }
      }

      // Turning cooks what is on the rod, if there is a fire under it.
      const turned = Math.abs(s.angle - before);
      if (turned > 0 && s.skewers.length) {
        if (this.fire.nearestCampfire(s.rod) < FIRE_REACH) {
          s.progress += (turned / (Math.PI * 2)) * PER_TURN;
          if (s.hand !== null && Math.random() < 0.15) this.hooks.pulse(s.hand === 0 ? 'left' : 'right', 0.15, 30);
          for (const k of s.skewers) {
            k.age = Math.max(k.age, Math.min(1, s.progress));
            const state: FoodState = k.age >= 2 ? 'rotten' : k.age >= 1 ? 'roast' : 'raw';
            if (state !== k.state) {
              k.state = state;
              (k.mesh.material as THREE.MeshLambertMaterial).color.copy(MEAT_COLOR[state]);
              this.hooks.say('The meat is roasted. Take it off the spit.');
            } else if (state === 'raw') {
              // It browns as it cooks.
              (k.mesh.material as THREE.MeshLambertMaterial).color.copy(MEAT_COLOR.raw).lerp(MEAT_COLOR.roast, Math.min(1, s.progress));
            }
          }
        } else if (!s.toldFire && s.hand !== null) {
          s.toldFire = true;
          this.hooks.say('It needs a fire under it.');
        }
      }
      if (!s.skewers.length) s.progress = 0;

      // A stone on the lever can slip off as it comes round.
      if (s.hasWeight && s.hand === null && Math.floor(s.angle / (Math.PI * 2)) !== Math.floor(before / (Math.PI * 2))) {
        s.turns++;
        if (Math.random() < SLIP_CHANCE) {
          s.hasWeight = false;
          s.weight.visible = false;
          const stone = this.sticks.craft('stone', this.tip(s, _a).clone(), new THREE.Quaternion());
          stone?.body.setLinvel({ x: s.side.x * 0.8, y: 0.5, z: s.side.z * 0.8 }, true);
          this.hooks.say('The stone slipped off the lever!');
          this.hooks.sound?.('thud', s.base);
        }
      }

      // Draw: the lever, the stone, and the meat going round on the rod.
      this.tip(s, _a);
      s.lever.position.copy(s.base).lerp(_a, 0.5);
      _b.subVectors(_a, s.base);
      s.lever.scale.set(1, _b.length(), 1);
      s.lever.quaternion.setFromUnitVectors(UP, _b.normalize());
      s.weight.position.copy(_a);
      for (const k of s.skewers) {
        const a = s.angle + k.phase;
        k.mesh.position.copy(s.rod).addScaledVector(s.axis, k.along).addScaledVector(UP, Math.cos(a) * 0.045).addScaledVector(s.side, Math.sin(a) * 0.045);
        _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), s.axis);
        k.mesh.quaternion.copy(_q);
      }
      void time;
    }
  }

  /** Meat on spits as saved pieces (so putting the game away does not lose it). */
  contents(): Array<{ at: THREE.Vector3; state: FoodState; age: number }> {
    return this.list.flatMap((s) => s.skewers.map((k) => ({ at: s.rod.clone().addScaledVector(UP, 0.1), state: k.state, age: k.age })));
  }
}
