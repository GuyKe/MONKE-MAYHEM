import * as THREE from 'three';
import type { PieceKind, Stick, Sticks } from '../world/sticks';
import { RECIPES, type Journal, type Recipe } from './journal';

/** What the book needs to know about a hand each frame. */
export interface HandView {
  tracked: boolean;
  /** Where the hand is in the world. */
  pos: THREE.Vector3;
  squeezed: boolean;
  /** Holding a piece right now. */
  holding: boolean;
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

/** Where the closed book hangs, in the player's body frame (x right, y up, -z forward). */
const BOOK_LOCAL = new THREE.Vector3(-0.3, -0.3, -0.04);
/** Where the open pages float. */
const PANEL_LOCAL = new THREE.Vector3(-0.08, -0.1, -0.46);
const PANEL_W = 0.5;
const PANEL_H = 0.4375;
const PX = 512;
const PY = 448;

/** A hand this close to the closed book (squeezing) opens it. */
const OPEN_RADIUS = 0.15;
/** A held stick released this close to the book is stashed. */
const STASH_RADIUS = 0.26;
const STASH_RADIUS_OPEN = 0.34;

/** A hand this far (centre, metres) in front of the pages has pressed them: its surface is touching. */
const PRESS_DEPTH = 0.075;

/** Layout of the pages, in canvas pixels. */
const ROW_TOP = [118, 190, 262, 334];
const ROW_H = 66;
const CLOSE = { x: 442, y: 10, w: 60, h: 44 };

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/**
 * The field journal: a leather book on your left hip.
 *
 * - Squeeze a grip with an empty hand near the book to open it, and again to close it.
 * - Hold a stick to the book and let go to put it in the book.
 * - With the pages open, poke a recipe with a hand to craft it. Recipes are locked until you
 *   have done what they need; the pages say what that is.
 *
 * It follows the direction your body faces, not your head, so you can look at it without it
 * swinging about.
 */
export class Book {
  open = false;

  private readonly root = new THREE.Group();
  private readonly cover: THREE.MeshLambertMaterial;
  private readonly panel: THREE.Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly texture: THREE.CanvasTexture;
  private readonly toast: THREE.Sprite;
  private readonly toastCanvas = document.createElement('canvas');
  private readonly toastTexture: THREE.CanvasTexture;

  private yaw = 0;
  private yawReady = false;
  private glow = 0;
  private toastTime = 0;
  private hover = -1;
  private drawnVersion = -1;
  private drawnHover = -2;
  private drawnOpen = false;
  private time = 0;
  private lastHands: [HandView, HandView] | null = null;
  private readonly head = new THREE.Vector3();

  private readonly wasSqueezed: [boolean, boolean] = [false, false];
  private readonly lastDepth: [number, number] = [1, 1];
  private readonly cooldown: [number, number] = [0, 0];

  /** Where the book and the pages are this frame (world space), for other systems. */
  readonly bookPos = new THREE.Vector3();
  readonly panelPos = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly journal: Journal,
    private readonly sticks: Sticks,
    private readonly actions: BookActions,
  ) {
    this.cover = new THREE.MeshLambertMaterial({ color: 0x6a3e22, emissive: 0x000000 });
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.052), this.cover);
    const pages = new THREE.Mesh(new THREE.BoxGeometry(0.168, 0.228, 0.04), new THREE.MeshLambertMaterial({ color: 0xe8dcc0 }));
    pages.position.x = 0.008;
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.246, 0.056), new THREE.MeshLambertMaterial({ color: 0x3b2314 }));
    strap.position.x = 0.04;
    this.root.add(cover, pages, strap);
    this.root.visible = false; // until the first update puts it on the player's hip
    scene.add(this.root);

    this.canvas.width = PX;
    this.canvas.height = PY;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_W, PANEL_H),
      new THREE.MeshBasicMaterial({ map: this.texture, side: THREE.DoubleSide, fog: false }),
    );
    this.panel.renderOrder = 20;
    this.panel.visible = false;
    scene.add(this.panel);

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
      this.showToast(`New recipe: ${recipe.name}`);
      this.glow = 10;
      this.lastHands?.[0].pulse(0.9, 120); // the book is on the left hip
    };
  }

  /** Advance the book one frame. */
  update(dt: number, ctx: BookContext): void {
    this.time += dt;
    this.root.visible = true;
    this.lastHands = ctx.hands;
    this.updatePose(dt, ctx.head);

    if (ctx.phase === 'dusk' || ctx.phase === 'night') this.journal.notify('dusk');

    // Hands: open or close by squeezing near the book, and poke the pages.
    this.hover = -1;
    for (let i = 0; i < 2; i++) {
      const hand = ctx.hands[i];
      this.cooldown[i] = Math.max(0, this.cooldown[i] - dt);
      if (!hand.tracked) {
        this.wasSqueezed[i] = false;
        this.lastDepth[i] = 1;
        continue;
      }
      const squeezeStart = hand.squeezed && !this.wasSqueezed[i];
      this.wasSqueezed[i] = hand.squeezed;
      if (squeezeStart && !hand.holding && hand.pos.distanceTo(this.bookPos) < OPEN_RADIUS && !this.sticks.nearest(hand.pos, 0.13)) {
        this.setOpen(!this.open);
        hand.pulse(0.4, 30);
      }
      if (this.open) this.poke(i, hand);
    }

    // Look: the cover glows when something new has unlocked or a stick is held up to it.
    this.glow = Math.max(0, this.glow - dt);
    const holdingNear = ctx.hands.some((h) => h.tracked && h.holding && h.pos.distanceTo(this.bookPos) < STASH_RADIUS + 0.1);
    const pulse = this.glow > 0 ? 0.35 + 0.25 * Math.sin(this.time * 6) : 0;
    this.cover.emissive.setRGB(pulse + (holdingNear ? 0.25 : 0), (pulse + (holdingNear ? 0.25 : 0)) * 0.7, 0);

    if (this.toastTime > 0) {
      this.toastTime -= dt;
      this.toast.visible = this.toastTime > 0;
      (this.toast.material as THREE.SpriteMaterial).opacity = Math.min(1, this.toastTime);
      this.toast.position.copy(this.bookPos).add(_v.set(0, 0.28, 0));
    }

    if (this.open !== this.drawnOpen || this.journal.version !== this.drawnVersion || this.hover !== this.drawnHover) this.draw();
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  /** Where recipe row `index` is in the world, `depth` metres in front of the pages (for tests). The pages must be open. */
  rowCenterWorld(index: number, depth = 0): THREE.Vector3 {
    const py = index === 100 ? CLOSE.y + CLOSE.h / 2 : ROW_TOP[index] + ROW_H / 2;
    const px = index === 100 ? CLOSE.x + CLOSE.w / 2 : 430;
    return this.panel.localToWorld(new THREE.Vector3((px / PX - 0.5) * PANEL_W, (0.5 - py / PY) * PANEL_H, depth));
  }

  /** Shows a short message above the book (the same place new recipes are announced). */
  say(text: string): void {
    this.showToast(text);
  }

  /** Pokes recipe row `index` as if with a hand (for the desktop emulator and tests). */
  pressRow(index: number): void {
    if (!this.open) this.setOpen(true);
    this.pressButton(index, null);
  }

  /**
   * Called when a held piece is released at `handPos`. If it is a stick held up to the book, the book
   * takes it (and returns true); otherwise the piece is dropped or thrown as usual.
   */
  acceptStash(stick: Stick, handPos: THREE.Vector3): boolean {
    if (stick.kind !== 'stick') return false;
    const near = handPos.distanceTo(this.bookPos) < STASH_RADIUS || (this.open && handPos.distanceTo(this.panelPos) < STASH_RADIUS_OPEN);
    if (!near) return false;
    this.journal.addStick();
    this.lastHands?.forEach((h) => h.holding && h.pulse(0.5, 40));
    return true;
  }

  private setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.panel.visible = open;
    if (!open) this.journal.markSeen();
  }

  private updatePose(dt: number, head: THREE.Vector3): void {
    // The way the body faces: the head's heading, smoothed so the book doesn't swing with every glance.
    _v.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const target = Math.atan2(-_v.x, -_v.z);
    if (!this.yawReady) {
      this.yaw = target;
      this.yawReady = true;
    }
    let diff = target - this.yaw;
    diff -= Math.round(diff / (Math.PI * 2)) * Math.PI * 2;
    this.yaw += diff * (1 - Math.exp(-3 * dt));

    this.head.copy(head);
    this.bookPos.copy(BOOK_LOCAL).applyAxisAngle(UP, this.yaw).add(head);
    this.root.position.copy(this.bookPos);
    this.root.rotation.set(0, this.yaw - Math.PI / 2, 0.15); // the cover faces out to the left

    this.panelPos.copy(PANEL_LOCAL).applyAxisAngle(UP, this.yaw).add(head);
    if (this.open) {
      this.panel.position.copy(this.panelPos);
      this.panel.lookAt(head); // faces the player
      this.panel.updateMatrixWorld();
    }
  }

  /** Is `hand` touching the pages? Hover the row under it, and press when it pushes in. */
  private poke(i: number, hand: HandView): void {
    const local = this.panel.worldToLocal(_w.copy(hand.pos));
    const px = ((local.x + PANEL_W / 2) / PANEL_W) * PX;
    const py = ((PANEL_H / 2 - local.y) / PANEL_H) * PY;
    const depth = local.z; // distance in front of the pages, toward the player
    const near = depth > -0.04 && depth < 0.2 && px >= 0 && px <= PX && py >= 0 && py <= PY;

    let row = -1;
    if (near) {
      if (px >= CLOSE.x && px <= CLOSE.x + CLOSE.w && py >= CLOSE.y && py <= CLOSE.y + CLOSE.h) row = 100;
      else if (px >= 12 && px <= PX - 12) row = ROW_TOP.findIndex((top) => py >= top && py <= top + ROW_H);
    }
    if (row !== -1) this.hover = row;

    // A press is the hand's surface crossing the front of the pages, however slowly.
    const pressed = row !== -1 && this.lastDepth[i] > PRESS_DEPTH && depth <= PRESS_DEPTH && this.cooldown[i] === 0;
    this.lastDepth[i] = near ? depth : 1;
    if (pressed) {
      this.cooldown[i] = 0.4;
      this.pressButton(row, hand);
    }
  }

  private pressButton(row: number, hand: HandView | null): void {
    if (row === 100) {
      this.setOpen(false);
      hand?.pulse(0.3, 25);
      return;
    }
    const recipe = RECIPES[row];
    if (!recipe) return;
    const crafted = this.journal.craft(recipe.id);
    if (!crafted) {
      hand?.pulse(0.15, 60); // can't make that yet
      return;
    }
    this.spawn(crafted);
    hand?.pulse(0.9, 90);
  }

  /** Puts what was crafted into the world: in front of the pages, or a campfire on the ground ahead. */
  private spawn(recipe: Recipe): void {
    if (recipe.makes === 'campfire') {
      this.actions.buildCampfire(this.head.x - Math.sin(this.yaw) * 1.6, this.head.z - Math.cos(this.yaw) * 1.6);
      return;
    }
    // Just in front of the pages, lying across the way you face.
    const towardPlayer = _v.copy(this.bookPos).sub(this.panelPos).setY(0).normalize();
    const position = this.panelPos.clone().addScaledVector(towardPlayer, 0.22);
    position.y += 0.12;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, right);
    this.actions.makePiece(recipe.makes, position, quaternion);
  }

  private showToast(text: string): void {
    const c = this.toastCanvas.getContext('2d')!;
    c.clearRect(0, 0, 512, 80);
    c.fillStyle = 'rgba(30,20,10,0.88)';
    roundRect(c, 4, 4, 504, 72, 18);
    c.fill();
    c.strokeStyle = '#e8c26a';
    c.lineWidth = 3;
    c.stroke();
    c.fillStyle = '#f6e7b8';
    c.font = 'bold 34px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, 256, 42);
    this.toastTexture.needsUpdate = true;
    this.toastTime = 6;
    this.toast.visible = true;
  }

  private draw(): void {
    this.drawnVersion = this.journal.version;
    this.drawnHover = this.hover;
    this.drawnOpen = this.open;
    const c = this.ctx;

    // Parchment.
    c.fillStyle = '#e9dcbd';
    c.fillRect(0, 0, PX, PY);
    c.strokeStyle = '#6a3e22';
    c.lineWidth = 8;
    c.strokeRect(4, 4, PX - 8, PY - 8);

    c.fillStyle = '#3b2a1a';
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    c.font = 'bold 34px Georgia, serif';
    c.fillText('Field Journal', 24, 50);
    c.font = '22px Georgia, serif';
    c.fillStyle = '#5a4128';
    c.fillText(`Sticks in the book: ${this.journal.stash}`, 24, 88);

    // Close button.
    c.fillStyle = this.hover === 100 ? '#b5502f' : '#8a3a22';
    roundRect(c, CLOSE.x, CLOSE.y, CLOSE.w, CLOSE.h, 10);
    c.fill();
    c.fillStyle = '#f6e7b8';
    c.font = 'bold 30px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('✕', CLOSE.x + CLOSE.w / 2, CLOSE.y + 33);

    RECIPES.forEach((recipe, i) => this.drawRow(c, recipe, ROW_TOP[i], this.hover === i));

    c.fillStyle = '#6b5236';
    c.font = 'italic 17px Georgia, serif';
    c.textAlign = 'left';
    c.fillText('Hold a stick to the book and let go to put it in.', 24, 418);
    c.fillText('Rub two sticks together over a pile of 5 to light a fire.', 24, 438);
    this.texture.needsUpdate = true;
  }

  private drawRow(c: CanvasRenderingContext2D, recipe: Recipe, top: number, hover: boolean): void {
    const status = this.journal.status(recipe);
    const locked = status === 'locked';
    c.fillStyle = locked ? '#cdbf9f' : hover ? '#f6ecd0' : '#f1e6c8';
    roundRect(c, 12, top, PX - 24, ROW_H, 12);
    c.fill();
    c.strokeStyle = hover && !locked ? '#b5502f' : '#a99468';
    c.lineWidth = hover ? 4 : 2;
    c.stroke();

    c.textAlign = 'left';
    c.fillStyle = locked ? '#8a7a5c' : '#3b2a1a';
    c.font = 'bold 26px Georgia, serif';
    c.fillText(locked ? '???' : recipe.name, 28, top + 30);
    c.font = '17px Georgia, serif';
    c.fillStyle = locked ? '#7f6f52' : '#5a4128';
    const sub = locked ? `Locked: ${recipe.hint}` : `${recipe.cost} sticks. ${recipe.blurb}`;
    c.fillText(fit(c, sub, 330), 28, top + 54);

    if (this.journal.fresh.has(recipe.id)) {
      c.fillStyle = '#d9a21b';
      roundRect(c, 215, top + 8, 54, 24, 8);
      c.fill();
      c.fillStyle = '#3b2a1a';
      c.font = 'bold 15px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText('NEW', 242, top + 25);
    }

    // Right side: the button.
    if (locked) return;
    const ready = status === 'ready';
    c.fillStyle = ready ? (hover ? '#3f9a45' : '#2f7d36') : '#9a7b3a';
    roundRect(c, 372, top + 10, 124, ROW_H - 20, 12);
    c.fill();
    c.fillStyle = '#f6f0d8';
    c.textAlign = 'center';
    c.font = 'bold 22px system-ui, sans-serif';
    c.fillText(ready ? 'CRAFT' : `NEED ${recipe.cost - this.journal.stash}`, 434, top + 41);
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** Shortens `text` with an ellipsis until it fits `width` pixels. */
function fit(c: CanvasRenderingContext2D, text: string, width: number): string {
  if (c.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 4 && c.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return `${t}…`;
}
