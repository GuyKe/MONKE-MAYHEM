import * as THREE from 'three';
import type { Settings } from '../settings';
import type { MapMarker, MapView } from '../world/mapview';
import type { PieceKind, Stick, Sticks } from '../world/sticks';
import { FACE, FACE_COUNT, FACE_H, FACE_W, drawFace, parseSettingValue, type BlueprintView, type FaceContext, type Hit } from './bookFaces';
import { RECIPES, type Journal, type Recipe } from './journal';

/** What the book needs to know about a hand each frame. */
export interface HandView {
  tracked: boolean;
  /** Where the hand is in the world. */
  pos: THREE.Vector3;
  squeezed: boolean;
  /** Holding a piece right now. */
  holding: boolean;
  /** The thumbstick, left (-1) to right (1). */
  stickX: number;
  pulse(strength: number, ms: number): void;
}

export interface BookContext {
  /** Head position in the world. */
  head: THREE.Vector3;
  hands: [HandView, HandView];
  phase: 'night' | 'dawn' | 'day' | 'dusk' | null;
}

export interface BookActions {
  /** Puts a crafted piece into the world. */
  makePiece(kind: PieceKind, position: THREE.Vector3, quaternion: THREE.Quaternion): void;
  /** Builds a campfire on the ground at (x, z). */
  buildCampfire(x: number, z: number): void;
}

/** What the pages need from the rest of the game. */
export interface BookServices {
  settings: Settings;
  craft(): { smashes: number; lashing: number; sharpening: number; smashesNeeded: number };
  world(): { seed: number; clock: string; phase: string; day: number };
  map: MapView | null;
  markers(): MapMarker[];
  player(): { x: number; z: number; heading: number };
  blueprints: { view(): BlueprintView; version(): number; select(id: string): void; cancel(): void } | null;
  resetArms(): void;
}

/** Size of one page in metres. Big enough to read at arm's length in a headset. */
const PAGE_W = 0.2;
const PAGE_H = 0.27;
const LEAVES = (FACE_COUNT - 2) / 2;
const SPREADS = LEAVES + 1;

/** Where the closed book hangs, in the player's body frame (x right, y up, -z forward). */
const HIP = new THREE.Vector3(0.3, -0.3, -0.04);
/** The book shrinks to this size at the hip, like a pouch. */
const HIP_SCALE = 0.45;
/** A hand this close to the hip book (squeezing) takes it out. */
const TAKE_RADIUS = 0.18;
/** A stick released this close to the book is put in it. */
const STASH_RADIUS = 0.3;
/** A hand this far (centre, metres) in front of a page has pressed it: its surface is touching. */
const PRESS_DEPTH = 0.075;
/** Extra reach around each button, in page pixels (about 8 mm). */
const HIT_PADDING = 22;
/** Swiping along the page faster than this (m/s) turns it. */
const SWIPE_SPEED = 0.8;

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/**
 * The field journal: a real book you carry on your hip.
 *
 *  - Squeeze a grip at your hip to take it out. It flies to your hand and opens, facing you. Let go to put it away.
 *  - Poke the buttons with your free hand. Turn pages by swiping across a page, pushing a thumbstick sideways,
 *    or poking the arrows.
 *  - Hold a stick to the book and let go to put it in.
 */
export class Book {
  /** Where the book is right now (world). */
  readonly bookPos = new THREE.Vector3();
  /** Which hand has it out, or null when it is on your hip. */
  holder: 0 | 1 | null = null;
  /** The spread showing, 0 to 6. */
  page = 0;

  private readonly root = new THREE.Group();
  private readonly closed = new THREE.Group();
  private readonly open = new THREE.Group();
  private readonly cover: THREE.MeshLambertMaterial;
  private readonly leaves: Array<{ group: THREE.Group; angle: number }> = [];
  private readonly canvases: HTMLCanvasElement[] = [];
  private readonly textures: THREE.CanvasTexture[] = [];
  private readonly keys: string[] = new Array(FACE_COUNT).fill('');
  private readonly hits: Hit[][] = Array.from({ length: FACE_COUNT }, () => []);
  private readonly leftStack: THREE.Mesh;
  private readonly rightStack: THREE.Mesh;
  private readonly toast: THREE.Sprite;
  private readonly toastCanvas = document.createElement('canvas');
  private readonly toastTexture: THREE.CanvasTexture;

  private yaw = 0;
  private yawReady = false;
  private blend = 0;
  private glow = 0;
  private toastTime = 0;
  private time = 0;
  private forced = false;
  private hover: { face: number; id: string } | null = null;
  private settingsVersion = 0;
  private lastHands: [HandView, HandView] | null = null;
  private readonly head = new THREE.Vector3();
  private readonly wasSqueezed: [boolean, boolean] = [false, false];
  private readonly lastDepth: [number, number] = [1, 1];
  private readonly lastLocalX: [number | null, number | null] = [null, null];
  private readonly cooldown: [number, number] = [0, 0];
  private flipCooldown = 0;
  private lastHolder: 0 | 1 = 0;
  private readonly lastStick: [number, number] = [0, 0];

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly journal: Journal,
    private readonly sticks: Sticks,
    private readonly actions: BookActions,
    private readonly services: BookServices,
  ) {
    // --- The closed book on the hip ---
    this.cover = new THREE.MeshLambertMaterial({ color: 0x6a3e22, emissive: 0x000000 });
    const coverBox = new THREE.Mesh(new THREE.BoxGeometry(PAGE_W + 0.012, PAGE_H + 0.012, 0.05), this.cover);
    const pagesBox = new THREE.Mesh(new THREE.BoxGeometry(PAGE_W, PAGE_H, 0.044), new THREE.MeshLambertMaterial({ color: 0xe8dcc0 }));
    pagesBox.position.x = 0.008;
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.02, PAGE_H + 0.016, 0.054), new THREE.MeshLambertMaterial({ color: 0x3b2314 }));
    strap.position.x = 0.07;
    this.closed.add(coverBox, pagesBox, strap);

    // --- The open book ---
    const leather = new THREE.MeshLambertMaterial({ color: 0x6a3e22 });
    const board = new THREE.BoxGeometry(PAGE_W * 2 + 0.03, PAGE_H + 0.014, 0.007);
    const back = new THREE.Mesh(board, leather);
    back.position.z = -0.03;
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.014, PAGE_H + 0.014, 0.034), leather);
    spine.position.z = -0.014;
    const cream = new THREE.MeshLambertMaterial({ color: 0xe3d6b6 });
    this.leftStack = new THREE.Mesh(new THREE.BoxGeometry(PAGE_W - 0.002, PAGE_H - 0.004, 1), cream);
    this.rightStack = new THREE.Mesh(new THREE.BoxGeometry(PAGE_W - 0.002, PAGE_H - 0.004, 1), cream);
    this.open.add(back, spine, this.leftStack, this.rightStack);

    for (let f = 0; f < FACE_COUNT; f++) {
      const canvas = document.createElement('canvas');
      canvas.width = FACE_W;
      canvas.height = FACE_H;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      this.canvases.push(canvas);
      this.textures.push(texture);
    }
    const faceMaterial = (f: number) => new THREE.MeshBasicMaterial({ map: this.textures[f], toneMapped: false, fog: false });
    const plane = new THREE.PlaneGeometry(PAGE_W, PAGE_H);
    // The inside covers: faces 0 (left) and 13 (right).
    const inLeft = new THREE.Mesh(plane, faceMaterial(0));
    inLeft.position.set(-PAGE_W / 2, 0, -0.0005);
    const inRight = new THREE.Mesh(plane, faceMaterial(FACE_COUNT - 1));
    inRight.position.set(PAGE_W / 2, 0, -0.0005);
    this.open.add(inLeft, inRight);
    // Each leaf turns about the spine. Its front is a right-hand page; its back is the left-hand page after it turns.
    for (let k = 0; k < LEAVES; k++) {
      const group = new THREE.Group();
      const front = new THREE.Mesh(plane, faceMaterial(2 * k + 1));
      front.position.set(PAGE_W / 2, 0, 0.0002);
      const rear = new THREE.Mesh(plane, faceMaterial(2 * k + 2));
      rear.rotation.y = Math.PI;
      rear.position.set(PAGE_W / 2, 0, -0.0002);
      group.add(front, rear);
      this.open.add(group);
      this.leaves.push({ group, angle: 0 });
    }
    this.open.visible = false;
    this.root.add(this.closed, this.open);
    this.root.visible = false;
    scene.add(this.root);

    this.toastCanvas.width = 512;
    this.toastCanvas.height = 80;
    this.toastTexture = new THREE.CanvasTexture(this.toastCanvas);
    this.toastTexture.colorSpace = THREE.SRGBColorSpace;
    this.toast = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.toastTexture, fog: false, depthTest: false, transparent: true }));
    this.toast.scale.set(0.5, 0.078, 1);
    this.toast.renderOrder = 30;
    this.toast.visible = false;
    scene.add(this.toast);

    journal.onUnlock = (recipe) => {
      this.say(`New recipe: ${recipe.name}`);
      this.glow = 10;
      this.lastHands?.[this.holder === 0 ? 1 : 0].pulse(0.9, 120);
    };
    services.settings.onChange(() => this.settingsVersion++);
  }

  /** True while the book is out of the pouch and showing its pages. */
  get isOpen(): boolean {
    return this.blend > 0.5;
  }

  /** Advance the book one frame. */
  update(dt: number, ctx: BookContext): void {
    this.time += dt;
    this.lastHands = ctx.hands;
    this.root.visible = true;
    this.head.copy(ctx.head);
    this.flipCooldown = Math.max(0, this.flipCooldown - dt);
    for (let i = 0; i < 2; i++) this.cooldown[i] = Math.max(0, this.cooldown[i] - dt);

    if (ctx.phase === 'dusk' || ctx.phase === 'night') this.journal.notify('dusk');

    // The way the body faces, smoothed, so the pouch doesn't swing with every glance.
    _v.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const target = Math.atan2(-_v.x, -_v.z);
    if (!this.yawReady) {
      this.yaw = target;
      this.yawReady = true;
    }
    let diff = target - this.yaw;
    diff -= Math.round(diff / (Math.PI * 2)) * Math.PI * 2;
    this.yaw += diff * (1 - Math.exp(-3 * dt));

    const side = this.services.settings.data.bookSide === 'left' ? -1 : 1;
    const hip = _w.set(HIP.x * side, HIP.y, HIP.z).applyAxisAngle(UP, this.yaw).add(ctx.head).clone();

    // Taking it out and putting it away.
    if (this.forced) this.holder = 0;
    for (let i = 0; i < 2; i++) {
      const hand = ctx.hands[i];
      const squeezeStart = hand.tracked && hand.squeezed && !this.wasSqueezed[i];
      this.wasSqueezed[i] = hand.tracked && hand.squeezed;
      if (this.holder === null && squeezeStart && !hand.holding && hand.pos.distanceTo(hip) < TAKE_RADIUS && !this.sticks.nearest(hand.pos, 0.13)) {
        this.holder = i as 0 | 1;
        this.lastHolder = this.holder;
        hand.pulse(0.5, 50);
      }
    }
    if (this.holder !== null && !this.forced) {
      const hand = ctx.hands[this.holder];
      if (!hand.tracked || !hand.squeezed) {
        this.holder = null;
        ctx.hands[0].pulse(0.2, 25);
      }
    }
    this.blend = THREE.MathUtils.clamp(this.blend + (this.holder !== null ? dt / 0.25 : -dt / 0.22), 0, 1);

    // Where it is: between the hip and the hand, facing the player once out.
    const ease = this.blend * this.blend * (3 - 2 * this.blend);
    const hipQuat = _q.setFromAxisAngle(UP, this.yaw - (side * Math.PI) / 2).clone();
    if (this.holder !== null || this.blend > 0) {
      const hand = ctx.hands[this.holder ?? this.lastHolder];
      const handPos = _v.copy(hand.pos);
      const heldPos = handPos.clone().add(new THREE.Vector3(0, 0.13, 0));
      _m.lookAt(ctx.head, heldPos, UP); // this way round, the book's front (+z) points at the player
      const heldQuat = new THREE.Quaternion().setFromRotationMatrix(_m);
      this.root.position.copy(hip).lerp(heldPos, ease);
      this.root.quaternion.copy(hipQuat).slerp(heldQuat, ease);
      this.root.scale.setScalar(HIP_SCALE + (1 - HIP_SCALE) * ease);
    } else {
      this.root.position.copy(hip);
      this.root.quaternion.copy(hipQuat);
      this.root.scale.setScalar(HIP_SCALE);
    }
    this.bookPos.copy(this.root.position);
    this.closed.visible = this.blend < 0.5;
    this.open.visible = this.blend >= 0.5;
    this.root.updateMatrixWorld(true);

    // Page turning, and what is drawn on the pages.
    this.animateLeaves(dt);
    if (this.open.visible) {
      this.interact(dt, ctx);
      this.drawVisibleFaces();
    }

    // The cover glows when something new unlocked or a stick is held up to the book.
    this.glow = Math.max(0, this.glow - dt);
    const holdingNear = ctx.hands.some((h) => h.tracked && h.holding && h.pos.distanceTo(this.bookPos) < STASH_RADIUS + 0.1);
    const pulse = this.glow > 0 ? 0.35 + 0.25 * Math.sin(this.time * 6) : 0;
    const e = pulse + (holdingNear ? 0.25 : 0);
    this.cover.emissive.setRGB(e, e * 0.7, 0);

    if (this.toastTime > 0) {
      this.toastTime -= dt;
      this.toast.visible = this.toastTime > 0;
      (this.toast.material as THREE.SpriteMaterial).opacity = Math.min(1, this.toastTime);
      this.toast.position.copy(this.bookPos).add(_v.set(0, 0.3, 0));
    }
  }

  /** Takes the book out (held by the left hand) or puts it away, without squeezing. For the emulator and tests. */
  toggle(): void {
    this.forced = !this.forced;
    if (!this.forced) this.holder = null;
  }

  /** Crafts recipe number `index` as if its button had been poked (for the emulator's number keys). */
  pressRow(index: number): void {
    const recipe = RECIPES[index];
    if (recipe) this.perform(`craft:${recipe.id}`, null);
  }

  /** Shows a short message above the book. */
  say(text: string): void {
    const c = this.toastCanvas.getContext('2d')!;
    c.clearRect(0, 0, 512, 80);
    c.fillStyle = 'rgba(30,20,10,0.88)';
    c.beginPath();
    c.roundRect(4, 4, 504, 72, 18);
    c.fill();
    c.strokeStyle = '#e8c26a';
    c.lineWidth = 3;
    c.stroke();
    c.fillStyle = '#f6e7b8';
    c.font = 'bold 28px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    let line = text;
    while (c.measureText(line).width > 480 && line.length > 4) line = line.slice(0, -2);
    c.fillText(line === text ? text : `${line}…`, 256, 42);
    this.toastTexture.needsUpdate = true;
    this.toastTime = 6;
    this.toast.visible = true;
  }

  /**
   * Called when a held piece is released at `handPos`. If it is a stick held up to the book, the book takes it
   * (and returns true); otherwise the piece is dropped or thrown as usual.
   */
  acceptStash(stick: Stick, handPos: THREE.Vector3): boolean {
    if (stick.kind !== 'stick') return false;
    if (handPos.distanceTo(this.bookPos) >= STASH_RADIUS * (this.isOpen ? 1.1 : 1)) return false;
    this.journal.addStick();
    this.lastHands?.forEach((h) => h.holding && h.pulse(0.5, 40));
    return true;
  }

  /** Where the hit region `id` on face `face` is in the world, `depth` metres in front of the page (for tests). */
  hitCenterWorld(face: number, id: string, depth = 0): THREE.Vector3 | null {
    const hit = this.hits[face].find((h) => h.id === id);
    if (!hit) return null;
    const right = face % 2 === 1;
    const x = ((hit.x + hit.w / 2) / FACE_W) * PAGE_W + (right ? 0 : -PAGE_W);
    const y = (0.5 - (hit.y + hit.h / 2) / FACE_H) * PAGE_H;
    this.root.updateMatrixWorld(true);
    return this.root.localToWorld(new THREE.Vector3(x, y, depth));
  }

  /** Turns to the next (1) or previous (-1) spread. */
  flip(direction: 1 | -1): void {
    const next = THREE.MathUtils.clamp(this.page + direction, 0, SPREADS - 1);
    if (next === this.page) return;
    this.page = next;
    this.flipCooldown = 0.35;
    this.lastHands?.forEach((h) => h.tracked && h.pulse(0.15, 20));
    // Make sure the pages it is turning to are drawn before they show.
    this.drawFace(2 * this.page, true);
    this.drawFace(2 * this.page + 1, true);
  }

  // --- Interaction ------------------------------------------------------------------

  private interact(dt: number, ctx: BookContext): void {
    this.hover = null;
    const free = this.holder === 0 ? 1 : 0;
    const hand = ctx.hands[free];
    // Thumbsticks turn pages too.
    for (let i = 0; i < 2; i++) {
      const x = ctx.hands[i].stickX;
      if (Math.abs(x) > 0.7 && Math.abs(this.lastStick[i]) < 0.3 && this.flipCooldown === 0) this.flip(x > 0 ? 1 : -1);
      this.lastStick[i] = x;
    }
    if (!hand.tracked || this.blend < 0.9) {
      this.lastDepth[free] = 1;
      this.lastLocalX[free] = null;
      return;
    }

    const local = this.root.worldToLocal(_w.copy(hand.pos));
    const onRight = local.x >= 0;
    const face = onRight ? 2 * this.page + 1 : 2 * this.page;
    const px = (onRight ? local.x / PAGE_W : (local.x + PAGE_W) / PAGE_W) * FACE_W;
    const py = ((PAGE_H / 2 - local.y) / PAGE_H) * FACE_H;
    const depth = local.z; // distance in front of the pages, toward the player
    const near = depth > -0.06 && depth < 0.16 && Math.abs(local.x) < PAGE_W && px >= 0 && px <= FACE_W && py >= 0 && py <= FACE_H;

    // Swiping across the page turns it.
    const lastX = this.lastLocalX[free];
    this.lastLocalX[free] = near ? local.x : null;
    if (near && lastX !== null && this.flipCooldown === 0 && depth < 0.13) {
      const vx = (local.x - lastX) / Math.max(dt, 1 / 144);
      if (onRight && local.x > 0.02 && vx < -SWIPE_SPEED) this.flip(1);
      else if (!onRight && local.x < -0.02 && vx > SWIPE_SPEED) this.flip(-1);
    }

    // Poking a button.
    // The pokeable area is a little bigger than the button drawn: fingertips are not that precise.
    const pad = HIT_PADDING;
    const hit = near ? this.hits[face].find((h) => px >= h.x - pad && px <= h.x + h.w + pad && py >= h.y - pad && py <= h.y + h.h + pad) : undefined;
    if (hit) this.hover = { face, id: hit.id };
    const pressed = !!hit && this.lastDepth[free] > PRESS_DEPTH && depth <= PRESS_DEPTH && this.cooldown[free] === 0 && this.flipCooldown === 0;
    this.lastDepth[free] = near ? depth : 1;
    if (pressed && hit) {
      this.cooldown[free] = 0.4;
      this.perform(hit.id, hand);
    }
  }

  private perform(id: string, hand: HandView | null): void {
    const [kind, a, b] = id.split(':');
    switch (kind) {
      case 'page':
        this.flip(a === 'next' ? 1 : -1);
        hand?.pulse(0.3, 25);
        break;
      case 'craft': {
        const recipe = RECIPES.find((r) => r.id === a);
        const crafted = recipe ? this.journal.craft(recipe.id) : null;
        if (!crafted) {
          hand?.pulse(0.15, 60); // can't make that yet
          break;
        }
        this.spawn(crafted, hand);
        hand?.pulse(0.9, 90);
        break;
      }
      case 'bp':
        if (a === 'select' && b) this.services.blueprints?.select(b);
        else if (a === 'cancel') this.services.blueprints?.cancel();
        hand?.pulse(0.5, 50);
        break;
      case 'set': {
        const key = a as keyof Settings['data'];
        this.services.settings.set(key, parseSettingValue(key, b) as never);
        hand?.pulse(0.3, 30);
        break;
      }
      case 'reset':
        if (a === 'arms') this.services.resetArms();
        else if (a === 'book') this.journal.reset();
        hand?.pulse(0.6, 70);
        break;
    }
  }

  /** Puts what was crafted into the world: just above your free hand, or a campfire on the ground ahead. */
  private spawn(recipe: Recipe, hand: HandView | null): void {
    if (recipe.makes === 'campfire') {
      this.actions.buildCampfire(this.head.x - Math.sin(this.yaw) * 1.6, this.head.z - Math.cos(this.yaw) * 1.6);
      return;
    }
    const position = (hand ? hand.pos.clone() : this.bookPos.clone().add(new THREE.Vector3(0, -0.1, 0))).add(new THREE.Vector3(0, 0.14, 0));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.actions.makePiece(recipe.makes, position, new THREE.Quaternion().setFromUnitVectors(UP, right));
  }

  // --- Looks ------------------------------------------------------------------------

  private animateLeaves(dt: number): void {
    for (let k = 0; k < LEAVES; k++) {
      const leaf = this.leaves[k];
      const target = k < this.page ? Math.PI : 0;
      const diff = target - leaf.angle;
      // Ease toward the target; the leaf nearest the spine of the pile turns first.
      leaf.angle += Math.sign(diff) * Math.min(Math.abs(diff), dt * (6 + Math.abs(diff) * 3));
      leaf.group.rotation.y = -leaf.angle;
      leaf.group.position.z = Math.sin(leaf.angle) * 0.02 + (leaf.angle < Math.PI / 2 ? (LEAVES - k) * 0.0007 : (k + 1) * 0.0007);
    }
    // The page edges thicken on whichever side has more pages.
    const left = 0.004 + this.page * 0.003;
    const right = 0.004 + (LEAVES - this.page) * 0.003;
    this.leftStack.scale.z = left;
    this.leftStack.position.set(-PAGE_W / 2, 0, -left / 2 - 0.001);
    this.rightStack.scale.z = right;
    this.rightStack.position.set(PAGE_W / 2, 0, -right / 2 - 0.001);
  }

  private drawVisibleFaces(): void {
    this.drawFace(2 * this.page);
    this.drawFace(2 * this.page + 1);
  }

  private faceContext(): FaceContext {
    const world = this.services.world();
    return {
      journal: this.journal,
      settings: this.services.settings,
      craft: this.services.craft(),
      seed: world.seed,
      clock: world.clock,
      phase: world.phase,
      day: world.day,
      map: this.services.map,
      markers: this.services.markers(),
      player: this.services.player(),
      blueprints: this.services.blueprints ? this.services.blueprints.view() : null,
    };
  }

  /** A cheap summary of what a face shows, so it is redrawn only when that changes. */
  private key(face: number): string {
    const hover = this.hover && this.hover.face === face ? this.hover.id : '';
    const j = this.journal.version;
    switch (face) {
      case 0:
        return String(j);
      case FACE.recipesA:
      case FACE.recipesB:
        return `${j}|${hover}`;
      case FACE.tools: {
        const c = this.services.craft();
        return `${c.smashes}|${Math.round(c.lashing * 25)}|${Math.round(c.sharpening * 25)}`;
      }
      case FACE.plansA:
      case FACE.plansB:
      case FACE.plan:
        return `${this.services.blueprints?.version() ?? 0}|${hover}`;
      case FACE.map:
      case FACE.places: {
        const p = this.services.player();
        return `${this.services.map?.version ?? 0}|${Math.round(p.x / 3)}|${Math.round(p.z / 3)}|${Math.round(p.heading * 12)}|${this.services.markers().filter((m) => m.discovered).length}`;
      }
      case FACE.settingsA:
      case FACE.settingsB:
        return `${this.settingsVersion}|${hover}`;
      case FACE.notes:
        return `${j}|${this.services.world().clock}`;
      default:
        return '1';
    }
  }

  private drawFace(face: number, force = false): void {
    const key = this.key(face);
    if (!force && key === this.keys[face]) return;
    this.keys[face] = key;
    const c = this.canvases[face].getContext('2d')!;
    this.hits[face] = drawFace(face, c, this.faceContext(), this.hover && this.hover.face === face ? this.hover.id : null);
    this.textures[face].needsUpdate = true;
  }
}
