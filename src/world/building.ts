import * as THREE from 'three';
import type { BlueprintView } from '../player/bookFaces';
import type { Grab } from '../player/grab';
import type { Hands } from '../player/hands';
import { TieGesture } from '../player/tie';
import { RAPIER, STRUCTURE_GROUPS } from '../physics';
import { BLUEPRINTS, blueprint, type Blueprint, type Slot } from './blueprints';
import { SURFACES, setSurface } from './materials';
import type { Side, Stick, Sticks } from './sticks';

export interface BuildingHooks {
  say(text: string): void;
  pulse(side: Side, strength: number, ms: number): void;
}

export interface BuildingWorld {
  surfaceAt(x: number, z: number): number;
  isBlocked(x: number, z: number, pad?: number, ignoreSpawn?: boolean): boolean;
}

/** What the building system asks of the player's movement. */
export interface BuildingPlayer {
  /** Let the hands pass through built structures (while tying a joint). */
  handsIgnoreStructures: boolean;
}

export interface BuildingFrame {
  /** Head position in the world. */
  head: THREE.Vector3;
  /** Where each hand is in the world. */
  hands: [THREE.Vector3, THREE.Vector3];
  /** The way you are facing, flat on the ground. */
  forward: THREE.Vector3;
}

interface SlotState {
  slot: Slot;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  axis: THREE.Vector3;
  filled: boolean;
  ghost: THREE.Mesh;
  tie: TieGesture | null;
}

interface Site {
  bp: Blueprint;
  pos: THREE.Vector3;
  yaw: number;
  slots: SlotState[];
  group: THREE.Group;
  complete: boolean;
}

interface Placing {
  bp: Blueprint;
  group: THREE.Group;
  pos: THREE.Vector3;
  /** Turned by the thumbstick, on top of facing you. */
  turn: number;
  valid: boolean;
  aimed: boolean;
}

/** A piece let go this close to a slot's centre (metres) fits it. */
const FIT_DISTANCE = 0.3;
/** ...and must lie within this angle of the slot's direction. */
const FIT_ANGLE = (36 * Math.PI) / 180;
/** A hand this near a joint can tie it. */
const TIE_REACH = 0.38;
const STORAGE = 'monke.plans';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

const WOOD_COLOR = { log: 0x5b3d26, pole: 0x9a7448, stick: 0x7a5a38 } as const;

/**
 * Building structures from a plan.
 *
 * Choose a plan in the book and a hologram of the finished structure appears. Hold a trigger and point to move it,
 * push a thumbstick to turn it, and let go of the trigger to put it down. Each part you can add next glows. Bring
 * the right piece (a log, a pole, a stick) lying the right way, and let go of it close to its glow: it snaps in and
 * becomes solid. Joints are tied with rope: hold a rope at the joint, hold the trigger and circle it.
 * Finishing a structure may unlock another plan.
 */
export class Building {
  /** Bumped whenever anything the book shows about building changes. */
  version = 0;
  readonly unlocked = new Set<string>();
  readonly built: Record<string, number> = {};

  private site: Site | null = null;
  private placing: Placing | null = null;
  private readonly sites: Site[] = [];
  private time = 0;
  private readonly prism = new THREE.CylinderGeometry(0.8, 1, 1, 6);
  private readonly ring = new THREE.TorusGeometry(0.1, 0.03, 5, 12).rotateX(Math.PI / 2);
  private readonly ghostNext = new THREE.MeshBasicMaterial({ color: 0x66d0ff, transparent: true, opacity: 0.5, depthWrite: false });
  private readonly ghostMatch = new THREE.MeshBasicMaterial({ color: 0x70ff90, transparent: true, opacity: 0.65, depthWrite: false });
  private readonly ghostWait = new THREE.MeshBasicMaterial({ color: 0x66d0ff, transparent: true, opacity: 0.12, depthWrite: false });
  private readonly ghostBad = new THREE.MeshBasicMaterial({ color: 0xff6a5a, transparent: true, opacity: 0.4, depthWrite: false });
  private readonly ghostPlace = new THREE.MeshBasicMaterial({ color: 0x66d0ff, transparent: true, opacity: 0.4, depthWrite: false });
  private lastTriggered = [false, false];
  private lastHead = new THREE.Vector3();
  private lastForward = new THREE.Vector3(0, 0, -1);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: RAPIER.World,
    private readonly sticks: Sticks,
    private readonly terrain: BuildingWorld,
    private readonly hands: Hands,
    private readonly grab: Grab,
    private readonly hooks: BuildingHooks,
    private readonly player?: BuildingPlayer,
  ) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) ?? '{}') as { unlocked?: string[]; built?: Record<string, number> };
      for (const id of saved.unlocked ?? []) if (BLUEPRINTS.some((b) => b.id === id)) this.unlocked.add(id);
      Object.assign(this.built, saved.built ?? {});
    } catch {
      /* storage can be unavailable */
    }
    for (const bp of BLUEPRINTS) if (bp.unlockedBy === null) this.unlocked.add(bp.id);
  }

  // --- What the book shows ------------------------------------------------------------

  view(): BlueprintView {
    const active = this.site && !this.site.complete ? this.site : null;
    const placing = this.placing;
    return {
      list: BLUEPRINTS.map((bp) => ({
        id: bp.id,
        name: this.unlocked.has(bp.id) ? bp.name : '???',
        blurb: this.unlocked.has(bp.id) ? bp.blurb : `Locked: ${bp.hint}`,
        needs: this.unlocked.has(bp.id) ? `Needs ${bp.needs}` : '',
        locked: !this.unlocked.has(bp.id),
      })),
      active:
        active || placing
          ? {
              id: (active?.bp ?? placing!.bp).id,
              name: (active?.bp ?? placing!.bp).name,
              placed: !!active,
              steps: (active?.bp ?? placing!.bp).steps.map((text, i) => {
                const slots = (active?.bp ?? placing!.bp).slots.filter((s) => s.step === i);
                const done = active ? active.slots.filter((s) => s.slot.step === i && s.filled).length : 0;
                return { text: `${text} (${done}/${slots.length})`, done: !!active && done === slots.length };
              }),
            }
          : null,
    };
  }

  /** Choose a plan: its hologram appears for you to place. */
  select(id: string): void {
    const bp = blueprint(id);
    if (!this.unlocked.has(id)) {
      this.hooks.say(`Locked: ${bp.hint}`);
      return;
    }
    this.cancel(false);
    const group = this.ghostGroup(bp, this.ghostPlace);
    this.scene.add(group);
    this.placing = { bp, group, pos: new THREE.Vector3(), turn: 0, valid: false, aimed: false };
    this.placeAhead();
    this.hooks.say('Hold a trigger and point to move it. Thumbstick turns it. Let go to put it down.');
    this.version++;
  }

  /** Give up the current plan: the hologram goes. Parts already built stay where they are. */
  cancel(say = true): void {
    if (this.placing) {
      this.scene.remove(this.placing.group);
      this.placing = null;
    }
    if (this.site && !this.site.complete) {
      for (const s of this.site.slots) if (!s.filled) this.site.group.remove(s.ghost);
      this.sites.push(this.site);
      this.site = null;
      if (say) this.hooks.say('You give up on the plan. What you built stays.');
    }
    this.version++;
  }

  /** Puts a plan down at (x, z) without aiming (for tests and the emulator). */
  placeAt(id: string, x: number, z: number, yaw: number): boolean {
    const bp = blueprint(id);
    if (!this.unlocked.has(id)) return false;
    this.cancel(false);
    this.createSite(bp, new THREE.Vector3(x, this.terrain.surfaceAt(x, z), z), yaw);
    return true;
  }

  /** Where the active site is, or null. */
  get activeSite(): { id: string; pos: THREE.Vector3; yaw: number; slots: Array<{ id: string; pos: THREE.Vector3; axis: THREE.Vector3; filled: boolean; kind: string }> } | null {
    const s = this.site;
    if (!s) return null;
    return { id: s.bp.id, pos: s.pos, yaw: s.yaw, slots: s.slots.map((st) => ({ id: st.slot.id, pos: st.pos, axis: st.axis, filled: st.filled, kind: st.slot.kind })) };
  }

  /**
   * A held piece was let go. If it lies close to a part that can go in next, and the right way round, it is built
   * into the structure (and this returns true: the piece is used up).
   */
  accept(stick: Stick): boolean {
    const site = this.site;
    if (!site) return false;
    let best: SlotState | null = null;
    let bestScore = Infinity;
    for (const s of site.slots) {
      if (s.filled || s.slot.kind === 'tie' || s.slot.kind !== stick.kind || !this.available(s)) continue;
      if (stick.length < 0.6 * s.slot.length) continue;
      const d = stick.pos.distanceTo(s.pos);
      if (d > FIT_DISTANCE) continue;
      _v.set(0, 1, 0).applyQuaternion(stick.quat);
      if (Math.acos(Math.min(1, Math.abs(_v.dot(s.axis)))) > FIT_ANGLE) continue;
      if (d < bestScore) {
        bestScore = d;
        best = s;
      }
    }
    if (!best) return false;
    this.fill(site, best);
    const side = stick.heldBy;
    this.sticks.stash(stick);
    if (side) this.hooks.pulse(side, 0.9, 90);
    return true;
  }

  // --- Each frame -------------------------------------------------------------------------

  update(dt: number, frame: BuildingFrame): void {
    this.time += dt;
    this.lastHead.copy(frame.head);
    this.lastForward.copy(frame.forward);
    if (this.placing) this.updatePlacing(dt, frame);
    if (this.site && !this.site.complete) {
      this.updateGhosts();
      this.updateTies(dt, frame);
    } else if (this.player) {
      this.player.handsIgnoreStructures = false;
    }
    this.lastTriggered = [this.hands.left.triggered, this.hands.right.triggered];

    // The ghosts breathe, so they are easy to spot.
    const pulse = 0.5 + 0.15 * Math.sin(this.time * 4);
    this.ghostNext.opacity = pulse;
    this.ghostMatch.opacity = 0.55 + 0.2 * Math.sin(this.time * 7);
  }

  // --- Placing ----------------------------------------------------------------------------

  private placeAhead(): void {
    const p = this.placing!;
    // About three metres in front of you, the way you are facing.
    p.pos.x = this.lastHead.x + this.lastForward.x * 3;
    p.pos.z = this.lastHead.z + this.lastForward.z * 3;
    p.pos.y = this.terrain.surfaceAt(p.pos.x, p.pos.z);
    this.refreshPlacing(0);
  }

  private updatePlacing(dt: number, frame: BuildingFrame): void {
    const p = this.placing!;
    // The thumbsticks turn it.
    const stick = Math.abs(this.hands.right.stickX) > Math.abs(this.hands.left.stickX) ? this.hands.right.stickX : this.hands.left.stickX;
    if (Math.abs(stick) > 0.2) p.turn += stick * 1.8 * dt;

    // A hand with the trigger held aims: from your head, through the hand, down to the ground.
    const aimHand: 0 | 1 | null = this.hands.right.triggered ? 1 : this.hands.left.triggered ? 0 : null;
    if (aimHand !== null) {
      const hit = this.aim(frame.head, frame.hands[aimHand]);
      if (hit) {
        p.pos.copy(hit);
        p.aimed = true;
      }
    }
    this.refreshPlacing(dt);

    // Let go of the trigger to put it down.
    const released = (this.lastTriggered[0] && !this.hands.left.triggered) || (this.lastTriggered[1] && !this.hands.right.triggered);
    if (released && p.aimed) {
      if (p.valid) {
        const yaw = this.placingYaw();
        const bp = p.bp;
        this.scene.remove(p.group);
        this.placing = null;
        this.createSite(bp, p.pos.clone(), yaw);
      } else {
        this.hooks.say("It won't go there: the ground is too steep, or something is in the way.");
        p.aimed = false;
      }
    }
  }

  /** The point on the ground that the line from `head` through `hand` hits, or null. */
  private aim(head: THREE.Vector3, hand: THREE.Vector3): THREE.Vector3 | null {
    const dir = _w.subVectors(hand, head);
    if (dir.lengthSq() < 1e-4) return null;
    dir.normalize();
    let prev = 0;
    for (let t = 0.3; t < 16; t += 0.25) {
      const x = head.x + dir.x * t;
      const y = head.y + dir.y * t;
      const z = head.z + dir.z * t;
      if (y <= this.terrain.surfaceAt(x, z)) {
        // Narrow it down between the last two steps.
        let lo = prev;
        let hi = t;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          if (head.y + dir.y * mid <= this.terrain.surfaceAt(head.x + dir.x * mid, head.z + dir.z * mid)) hi = mid;
          else lo = mid;
        }
        const hx = head.x + dir.x * hi;
        const hz = head.z + dir.z * hi;
        return new THREE.Vector3(hx, this.terrain.surfaceAt(hx, hz), hz);
      }
      prev = t;
    }
    return null;
  }

  /** The turn of the plan: its open side faces you, plus whatever you have turned it. */
  private placingYaw(): number {
    const p = this.placing!;
    return Math.atan2(this.lastHead.x - p.pos.x, this.lastHead.z - p.pos.z) + p.turn;
  }

  private refreshPlacing(_dt: number): void {
    const p = this.placing!;
    p.pos.y = this.terrain.surfaceAt(p.pos.x, p.pos.z);
    p.group.position.copy(p.pos);
    p.group.rotation.y = this.placingYaw();
    // Level enough, and clear of trees and water?
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 7; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = i === 0 ? 0 : p.bp.footprint * 0.8;
      const h = this.terrain.surfaceAt(p.pos.x + Math.cos(a) * r, p.pos.z + Math.sin(a) * r);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    p.valid = hi - lo < 0.4 && !this.terrain.isBlocked(p.pos.x, p.pos.z, p.bp.footprint * 0.6, true);
    const material = p.valid ? this.ghostPlace : this.ghostBad;
    p.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = material;
    });
  }

  private createSite(bp: Blueprint, pos: THREE.Vector3, yaw: number): void {
    const group = new THREE.Group();
    group.position.copy(pos);
    this.scene.add(group);
    const slots: SlotState[] = bp.slots.map((slot) => {
      const local = new THREE.Vector3(...slot.pos).applyAxisAngle(UP, yaw).add(pos);
      const axis = new THREE.Vector3(...slot.axis).applyAxisAngle(UP, yaw).normalize();
      const ghost = this.slotMesh(slot, this.ghostWait);
      // The ghost lives in the group, so it is placed in the structure's own space.
      ghost.position.set(...slot.pos);
      ghost.quaternion.setFromUnitVectors(UP, new THREE.Vector3(...slot.axis).normalize());
      group.add(ghost);
      return { slot, pos: local, quat: new THREE.Quaternion().setFromUnitVectors(UP, axis), axis, filled: false, ghost, tie: slot.kind === 'tie' ? new TieGesture(1.5, 0.02, 0.26, 0.22) : null };
    });
    group.rotation.y = yaw;
    this.site = { bp, pos, yaw, slots, group, complete: false };
    this.hooks.say(`${bp.name} placed. Gather what it needs. Glowing parts go next.`);
    this.version++;
  }

  // --- Building ----------------------------------------------------------------------------

  private available(s: SlotState): boolean {
    const site = this.site!;
    return s.slot.requires.every((id) => site.slots.find((o) => o.slot.id === id)?.filled);
  }

  /** Parts that can go in right now glow; and glow green when you are holding the right piece near them. */
  private updateGhosts(): void {
    const site = this.site!;
    const held = [this.grab.held(0), this.grab.held(1)];
    for (const s of site.slots) {
      if (s.filled) continue;
      const avail = this.available(s);
      let match = false;
      if (avail && s.slot.kind !== 'tie') {
        match = held.some((h) => h && h.kind === s.slot.kind && h.length >= 0.6 * s.slot.length && h.pos.distanceTo(s.pos) < 0.7);
      } else if (avail) {
        match = held.some((h) => h && h.kind === 'rope' && h.pos.distanceTo(s.pos) < 0.6);
      }
      s.ghost.material = !avail ? this.ghostWait : match ? this.ghostMatch : this.ghostNext;
      s.ghost.visible = true;
    }
  }

  private updateTies(dt: number, frame: BuildingFrame): void {
    const site = this.site!;
    let tyingNow = false;
    const working = new Set<SlotState>();
    for (let i = 0; i < 2; i++) {
      const hand = i === 0 ? this.hands.left : this.hands.right;
      const coil = this.grab.held(i as 0 | 1);
      let tying: SlotState | null = null;
      if (coil && coil.kind === 'rope') {
        let best = TIE_REACH;
        for (const s of site.slots) {
          if (s.filled || s.slot.kind !== 'tie' || !this.available(s)) continue;
          const d = frame.hands[i].distanceTo(s.pos);
          if (d < best) {
            best = d;
            tying = s;
          }
        }
      }
      if (!tying || !tying.tie || !coil) continue;
      working.add(tying);
      // A hand holding rope at a joint has to be able to reach into the wood it will wind round, or it
      // would shove you away while you line it up.
      tyingNow = true;
      const added = tying.tie.update(dt, tying.pos, tying.axis, frame.hands[i], hand.triggered);
      // The ghost ring swells as the rope goes round.
      tying.ghost.scale.setScalar(1 + 0.5 * tying.tie.progress);
      if (added > 0) this.hooks.pulse(i === 0 ? 'left' : 'right', 0.15 + 0.5 * tying.tie.progress, 40);
      if (tying.tie.progress >= 1) {
        this.fill(site, tying);
        this.sticks.stash(coil);
        this.hooks.pulse(i === 0 ? 'left' : 'right', 1, 150);
      }
    }
    // Any joint that no hand is working on starts again (once, after both hands have been considered).
    for (const s of site.slots) {
      if (s.tie && !s.filled && !working.has(s)) {
        s.tie.reset();
        s.ghost.scale.setScalar(1);
      }
    }
    if (this.player) this.player.handsIgnoreStructures = tyingNow;
  }

  /** Builds the real part into the structure, and sees whether it is finished. */
  private fill(site: Site, s: SlotState): void {
    s.filled = true;
    site.group.remove(s.ghost);
    const solid = this.slotMesh(s.slot, new THREE.MeshLambertMaterial({ color: s.slot.kind === 'tie' ? 0xc9ac6e : WOOD_COLOR[s.slot.kind], flatShading: true }));
    solid.position.set(...s.slot.pos);
    solid.quaternion.setFromUnitVectors(UP, new THREE.Vector3(...s.slot.axis).normalize());
    site.group.add(solid);

    if (s.slot.kind !== 'tie') {
      // Solid: it can be leant on, climbed and stood on.
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(s.slot.length / 2, s.slot.radius)
          .setTranslation(s.pos.x, s.pos.y, s.pos.z)
          .setRotation({ x: s.quat.x, y: s.quat.y, z: s.quat.z, w: s.quat.w })
          .setCollisionGroups(STRUCTURE_GROUPS)
          .setFriction(0.9),
      );
      setSurface(collider, s.slot.kind === 'log' ? SURFACES.bark : SURFACES.wood);
    }
    this.version++;

    if (site.slots.every((o) => o.filled)) this.finish(site);
    else {
      const step = site.bp.steps[s.slot.step];
      const stepDone = site.slots.filter((o) => o.slot.step === s.slot.step).every((o) => o.filled);
      if (stepDone && step) this.hooks.say(`Done: ${step.split('.')[0]}.`);
    }
  }

  private finish(site: Site): void {
    site.complete = true;
    this.sites.push(site);
    this.site = null;
    this.built[site.bp.id] = (this.built[site.bp.id] ?? 0) + 1;
    const unlocked: string[] = [];
    for (const bp of BLUEPRINTS) {
      if (bp.unlockedBy === site.bp.id && !this.unlocked.has(bp.id)) {
        this.unlocked.add(bp.id);
        unlocked.push(bp.name);
      }
    }
    try {
      localStorage.setItem(STORAGE, JSON.stringify({ unlocked: [...this.unlocked], built: this.built }));
    } catch {
      /* ignore */
    }
    this.hooks.say(unlocked.length ? `${site.bp.name} finished! New plan: ${unlocked.join(', ')}.` : `${site.bp.name} finished!`);
    this.hooks.pulse('left', 1, 250);
    this.hooks.pulse('right', 1, 250);
    this.version++;
  }

  // --- Looks ---------------------------------------------------------------------------------

  private slotMesh(slot: Slot, material: THREE.Material): THREE.Mesh {
    if (slot.kind === 'tie') {
      const mesh = new THREE.Mesh(this.ring, material);
      mesh.scale.setScalar(slot.radius < 0.05 ? 1.1 : 1);
      return mesh;
    }
    const mesh = new THREE.Mesh(this.prism, material);
    mesh.scale.set(slot.radius, slot.length, slot.radius);
    return mesh;
  }

  /** A see-through copy of every part, to show where things will go. */
  private ghostGroup(bp: Blueprint, material: THREE.Material): THREE.Group {
    const group = new THREE.Group();
    for (const slot of bp.slots) {
      const mesh = this.slotMesh(slot, material);
      mesh.position.set(...slot.pos);
      mesh.quaternion.setFromUnitVectors(UP, new THREE.Vector3(...slot.axis).normalize());
      group.add(mesh);
    }
    return group;
  }
}
