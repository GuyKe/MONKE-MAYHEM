import * as THREE from 'three';
import type { Engine } from './engine';
import { box, cyl, mat, part } from './shapes';
import { slab, surface } from './textures';
import { WorldButton } from '../ui/panel';
import type { RAPIER } from '../physics';

export const DOOR_W = 3.0;
export const DOOR_H = 3.6;
const THICK = 0.5;

export type DoorState = 'idle' | 'opening' | 'closing' | 'manual';

/**
 * A heavy blast door that rises into the wall. It can be opened, closed or jammed from its panel, or lifted by hand on its handle,
 * and it comes down hard: anything under a closing door is crushed. Monsters open doors that are not jammed, and batter jammed ones.
 */
export class Door {
  readonly group = new THREE.Group();
  /** 0 shut, 1 open. */
  pos = 0;
  state: DoorState = 'idle';
  target: 0 | 1 | null = null;
  jam: 'none' | 'open' | 'closed' = 'none';
  jamHealth = 0;
  /** The lockdown (or the exit relays) has taken over the controls. */
  auto = false;
  locked = false;
  /** The speed it is moving, per second (+ up). */
  speed = 0;
  private fall = 0;
  private readonly panel: THREE.Mesh;
  private readonly lamp: THREE.Mesh;
  private collider: RAPIER.Collider;
  private lastCollider = -1;
  private readonly buttons: { open: WorldButton; close: WorldButton; jam: WorldButton };
  private readonly handle: THREE.Mesh;
  /** The handle in the world. */
  readonly handlePos = new THREE.Vector3();
  private readonly leverWorld = new THREE.Vector3();
  private motorTimer = 0;
  private lastState: DoorState = 'idle';
  /** A warning (lamp, beeps, sparks) comes before a door shuts. */
  private warnTimer = 0;
  private warned = false;
  private beepTimer = 0;
  private readonly sparks: THREE.Points;
  private readonly sparkData = new Float32Array(16 * 3);
  private readonly sparkVel = new Float32Array(16 * 3);
  private readonly sparkLife = new Float32Array(16);
  private readonly lever: THREE.Group;
  private readonly leverHandle: THREE.Mesh;
  private leverGrab = -1;
  private leverStart = 0;
  private leverUsed = false;
  private leverAngle = 0;
  private manualHand: 0 | 1 | -1 = -1;
  private manualOffset = 0;
  onSlam: ((door: Door, speed: number) => void) | null = null;

  constructor(
    private readonly e: Engine,
    readonly id: number,
    readonly name: string,
    /** The middle of the doorway at the floor. */
    readonly center: THREE.Vector3,
    /** The way the door faces (the side the controls are on): +1 or -1 along `across`. */
    readonly facing: 1 | -1,
    /** 'x': the wall runs along x and the door faces ±z; 'z': the wall runs along z and the door faces ±x. */
    readonly wall: 'x' | 'z',
  ) {
    const w = wall === 'z';
    this.panel = slab('door', w ? THICK : DOOR_W, DOOR_H, w ? DOOR_W : THICK);
    this.panel.castShadow = false;
    this.group.add(this.panel);
    // Hazard stripes on the lower edge, a number, and a lamp.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(w ? THICK + 0.04 : DOOR_W, 0.4, w ? DOOR_W : THICK + 0.04), surface('hazard', DOOR_W, 0.5));
    stripe.position.y = -DOOR_H / 2 + 0.2;
    this.panel.add(stripe);
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3030, fog: false }));
    this.lamp.position.set(w ? facing * (THICK / 2 + 0.05) : 0, DOOR_H / 2 - 0.3, w ? 0 : facing * (THICK / 2 + 0.05));
    this.panel.add(this.lamp);
    const label = document.createElement('canvas');
    label.width = 256;
    label.height = 128;
    const lc = label.getContext('2d')!;
    lc.fillStyle = '#16181c';
    lc.fillRect(0, 0, 256, 128);
    lc.fillStyle = '#e8e8e8';
    lc.font = 'bold 54px system-ui';
    lc.textAlign = 'center';
    lc.textBaseline = 'middle';
    lc.fillText(name, 128, 66);
    const lt = new THREE.CanvasTexture(label);
    lt.colorSpace = THREE.SRGBColorSpace;
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), new THREE.MeshBasicMaterial({ map: lt }));
    tag.position.set(w ? facing * (THICK / 2 + 0.03) : 0, 0.5, w ? 0 : facing * (THICK / 2 + 0.03));
    tag.rotation.y = w ? (facing > 0 ? Math.PI / 2 : -Math.PI / 2) : facing > 0 ? 0 : Math.PI;
    this.panel.add(tag);
    // The handle: a bar low on the door you can lift by hand.
    this.handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.2, 8), mat(0xe0b020, 0, 0.3, 0.8));
    this.handle.rotation.x = w ? Math.PI / 2 : 0;
    this.handle.rotation.z = w ? 0 : Math.PI / 2;
    this.handle.position.set(w ? facing * (THICK / 2 + 0.1) : 0, -DOOR_H / 2 + 1.0, w ? 0 : facing * (THICK / 2 + 0.1));
    this.panel.add(this.handle);
    this.group.position.copy(center);
    this.group.position.y += DOOR_H / 2;
    e.scene.add(this.group);
    this.collider = e.solid(center.x, center.y + DOOR_H / 2, center.z, w ? THICK / 2 : DOOR_W / 2, DOOR_H / 2, w ? DOOR_W / 2 : THICK / 2);

    // The control panel, beside the door on the side it faces.
    const side = new THREE.Vector3(w ? facing * (THICK / 2 + 0.25) : DOOR_W / 2 + 0.7, 1.3, w ? DOOR_W / 2 + 0.7 : facing * (THICK / 2 + 0.25));
    const cp = new THREE.Group();
    cp.position.copy(center).add(side);
    cp.rotation.y = w ? (facing > 0 ? Math.PI / 2 : -Math.PI / 2) : facing > 0 ? 0 : Math.PI;
    part(cp, box, 0x22262c, [0, 0, -0.04], [0.62, 0.62, 0.08], [0, 0, 0], 0, 0.4, 0.6);
    e.scene.add(cp);
    const mk = (label: string, color: string, y: number, fn: () => void): WorldButton => {
      const b = e.panels.add(new WorldButton(e.scene, label, 0.5, 0.15, color, fn));
      b.mesh.position.set(0, y, 0.02);
      cp.add(b.mesh);
      // WorldButton adds itself to the scene: move it onto the panel.
      return b;
    };
    this.buttons = {
      open: mk('OPEN', '#2d7a3a', 0.2, () => this.command('open')),
      close: mk('CLOSE', '#9a2a22', 0.0, () => this.command('close')),
      jam: mk('JAM', '#9a7a14', -0.2, () => this.command('jam')),
    };
    // A lever switch beside the buttons: grab it and pull it down to run the door.
    this.lever = new THREE.Group();
    this.lever.position.set(0.47, 0.12, 0.03);
    part(cp, box, 0x14161a, [0.47, 0.0, 0.0], [0.16, 0.34, 0.04]);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 8), mat(0xc0c0c8, 0, 0.3, 0.8));
    arm.position.y = 0.15;
    this.leverHandle = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), mat(0xd02820));
    this.leverHandle.position.y = 0.32;
    this.lever.add(arm, this.leverHandle);
    cp.add(this.lever);
    // Sparks for when it comes down.
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkData, 3));
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffb040, size: 0.07, sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.sparks.frustumCulled = false;
    this.sparks.visible = false;
    this.sparks.userData.dynamic = true;
    e.scene.add(this.sparks);
    this.refresh();
  }

  /** Where the panel's lower edge is, in the world. */
  get bottom(): number {
    return this.center.y + this.pos * DOOR_H;
  }

  /** Hide the control buttons when nobody is near (they cost a draw call each). */
  setPanelVisible(on: boolean): void {
    this.buttons.open.mesh.visible = this.buttons.close.mesh.visible = this.buttons.jam.mesh.visible = on;
  }

  /** A player pressed a control. */
  command(what: 'open' | 'close' | 'jam'): void {
    if (this.auto || this.locked) {
      this.e.audio.play('deny', this.center, 0.8);
      return;
    }
    if (what === 'jam') {
      if (this.jam === 'none') {
        this.jam = this.pos > 0.5 ? 'open' : 'closed';
        this.jamHealth = 6;
        this.target = null;
        this.state = 'idle';
        this.e.audio.play('doorLock', this.center, 1);
      } else {
        this.jam = 'none';
        this.e.audio.play('doorLock', this.center, 1);
      }
    } else if (this.jam === 'none') {
      this.target = what === 'open' ? 1 : 0;
    } else this.e.audio.play('deny', this.center, 0.8);
    this.refresh();
  }

  /** A monster or the lockdown moves the door. */
  drive(target: 0 | 1): void {
    if (this.jam !== 'none' || this.manualHand !== -1) return;
    this.target = target;
  }

  /** A monster hits a jammed door. Returns true when it gives way. */
  batter(): boolean {
    if (this.jam === 'none') return false;
    this.jamHealth -= 1;
    this.e.audio.play('doorBang', this.center, 1);
    this.e.buzz('both', Math.max(0, 0.7 - this.e.head.distanceTo(this.center) / 20), 120);
    if (this.jamHealth <= 0) {
      this.jam = 'none';
      this.target = 1;
      this.e.audio.play('doorCrush', this.center, 0.8);
      this.refresh();
      return true;
    }
    return false;
  }

  /** The panel's lamp and buttons say what the door will do. */
  refresh(): void {
    const c = this.jam !== 'none' ? 0xffb020 : this.locked ? 0x5050ff : this.auto ? 0xff2020 : this.pos > 0.95 ? 0x30ff60 : this.pos < 0.05 ? 0xff3030 : 0xffa030;
    (this.lamp.material as THREE.MeshBasicMaterial).color.setHex(c);
    this.buttons.jam.setLabel(this.jam === 'none' ? 'JAM' : 'UNJAM');
    this.buttons.open.enabled = this.buttons.close.enabled = this.jam === 'none' && !this.auto && !this.locked;
    this.buttons.jam.enabled = !this.auto && !this.locked;
  }

  /** Per frame. `hands` are the world positions of the player's hands and whether each is squeezing. */
  update(dt: number, hands: Array<{ pos: THREE.Vector3; squeezed: boolean }>): void {
    const prev = this.pos;
    const bottomY = this.center.y;
    // The handle only matters when you are close.
    const nearby = this.e.head.distanceToSquared(this.center) < 64;
    if (nearby) {
      this.panel.updateWorldMatrix(true, false);
      this.handle.getWorldPosition(this.handlePos);
    }
    // Lifted by hand?
    if (nearby && this.jam === 'none' && !this.locked && !this.auto) {
      if (this.manualHand === -1) {
        for (let i = 0; i < hands.length; i++) {
          if (hands[i].squeezed && hands[i].pos.distanceTo(this.handlePos) < 0.45) {
            this.manualHand = i as 0 | 1;
            this.manualOffset = this.pos * DOOR_H - hands[i].pos.y;
            this.state = 'manual';
            this.target = null;
            this.fall = 0;
            break;
          }
        }
      } else {
        const h = hands[this.manualHand];
        if (!h || !h.squeezed) {
          this.manualHand = -1;
          this.state = 'idle';
          this.fall = 0;
        } else {
          this.pos = Math.max(0, Math.min(1, (h.pos.y + this.manualOffset) / DOOR_H));
          this.speed = (this.pos - prev) / Math.max(dt, 1e-3);
        }
      }
    } else if (this.manualHand !== -1) {
      this.manualHand = -1;
      this.state = 'idle';
    }
    if (this.target !== 0) this.warned = false;
    if (this.manualHand === -1 && this.target === 0 && this.jam === 'none' && !this.warned && this.pos > 0.05 && this.state !== 'closing') {
      this.warned = true;
      this.warnTimer = 0.9;
    }
    if (this.warnTimer > 0) {
      // The lamp flashes and it beeps before it comes down.
      this.warnTimer -= dt;
      this.beepTimer -= dt;
      if (this.beepTimer <= 0) {
        this.beepTimer = 0.22;
        this.e.audio.play('blip', this.center, 0.9);
      }
      (this.lamp.material as THREE.MeshBasicMaterial).color.setHex(Math.floor(this.warnTimer * 8) % 2 ? 0xff9020 : 0x301000);
      this.speed = 0;
    } else if (this.manualHand === -1) {
      if (this.target !== null && this.jam === 'none') {
        const dir = this.target === 1 ? 1 : -1;
        const rate = dir > 0 ? 1 / 2.4 : 1 / 0.9;
        this.pos = Math.max(0, Math.min(1, this.pos + dir * rate * dt));
        this.state = dir > 0 ? 'opening' : 'closing';
        this.speed = dir * rate;
        if ((dir > 0 && this.pos >= 1) || (dir < 0 && this.pos <= 0)) {
          this.target = null;
          this.state = 'idle';
        }
      } else if (this.pos > 0.02 && this.pos < 0.97 && this.jam === 'none' && this.state === 'idle') {
        // Let go half way and it drops under its own weight.
        this.fall = Math.min(8, this.fall + 12 * dt);
        this.pos = Math.max(0, this.pos - (this.fall / DOOR_H) * dt);
        this.state = 'closing';
        this.speed = -this.fall / DOOR_H;
        this.target = 0;
      } else if (this.state !== 'idle' && this.target === null) {
        this.state = 'idle';
        this.speed = 0;
      }
    }
    // Sounds and the slam.
    const moving = Math.abs(this.pos - prev) > 1e-4;
    this.motorTimer -= dt;
    if (moving && this.motorTimer <= 0 && this.manualHand === -1) {
      this.motorTimer = 0.9;
      this.e.audio.play('doorMotor', this.center, 0.9);
    }
    if (prev > 0 && this.pos <= 0 && this.speed < -0.2) {
      this.e.audio.play('doorSlam', this.center, 1);
      this.e.buzz('both', Math.max(0, 0.9 - this.e.head.distanceTo(this.center) / 25), 160);
      this.onSlam?.(this, -this.speed * DOOR_H);
      this.speed = 0;
    }
    if (this.state === 'idle' && !moving) this.speed = 0;
    // Sparks fly off the bottom edge as it comes down.
    const closing = this.state === 'closing' && this.speed < -0.1 && this.pos > 0.02;
    this.sparks.visible = closing;
    if (closing) {
      const along = this.wall === 'z';
      for (let i = 0; i < 16; i++) {
        if (this.sparkLife[i] <= 0) {
          this.sparkLife[i] = 0.2 + Math.random() * 0.3;
          const off = (Math.random() - 0.5) * DOOR_W;
          this.sparkData[i * 3] = this.center.x + (along ? 0 : off);
          this.sparkData[i * 3 + 1] = this.bottom + 0.05;
          this.sparkData[i * 3 + 2] = this.center.z + (along ? off : 0);
          this.sparkVel[i * 3] = (Math.random() - 0.5) * 2;
          this.sparkVel[i * 3 + 1] = Math.random() * 2;
          this.sparkVel[i * 3 + 2] = (Math.random() - 0.5) * 2;
        }
        this.sparkLife[i] -= dt;
        this.sparkVel[i * 3 + 1] -= 9 * dt;
        this.sparkData[i * 3] += this.sparkVel[i * 3] * dt;
        this.sparkData[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
        this.sparkData[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      }
      (this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    // The lever: pull it down.
    if (nearby && !this.auto && !this.locked) {
      this.leverHandle.getWorldPosition(this.leverWorld);
      let held = -1;
      for (let i = 0; i < hands.length; i++) if (hands[i].squeezed && hands[i].pos.distanceTo(this.leverWorld) < 0.28) held = i;
      if (held !== -1 && this.leverGrab === -1) {
        this.leverGrab = held;
        this.leverStart = hands[held].pos.y;
        this.leverUsed = false;
      } else if (held === -1) {
        this.leverGrab = -1;
      } else if (!this.leverUsed) {
        const pulled = this.leverStart - hands[held].pos.y;
        this.leverAngle = Math.max(0, Math.min(1.1, pulled * 3));
        if (pulled > 0.25) {
          this.leverUsed = true;
          this.e.audio.play('click', this.center, 1);
          this.e.buzz(held as 0 | 1, 0.6, 80);
          this.command(this.pos > 0.5 ? 'close' : 'open');
        }
      }
    }
    if (this.leverGrab === -1) this.leverAngle = Math.max(0, this.leverAngle - dt * 2.5);
    this.lever.rotation.x = -this.leverAngle;
    // The panel and its collider follow.
    this.panel.position.y = this.pos * DOOR_H;
    if (Math.abs(this.pos - this.lastCollider) > 0.004) {
      this.lastCollider = this.pos;
      this.collider.setTranslation({ x: this.center.x, y: bottomY + DOOR_H / 2 + this.pos * DOOR_H + (this.pos > 0.97 ? 20 : 0), z: this.center.z });
    }
    if (Math.abs(this.pos - prev) > 0.001 || this.state !== this.lastState) this.refresh();
    this.lastState = this.state;
  }

  /** Is this point (a player or monster) in the doorway? */
  inDoorway(p: THREE.Vector3, radius: number): boolean {
    const along = this.wall === 'z' ? p.z - this.center.z : p.x - this.center.x;
    const across = this.wall === 'z' ? p.x - this.center.x : p.z - this.center.z;
    return Math.abs(along) < DOOR_W / 2 + radius && Math.abs(across) < THICK / 2 + radius;
  }

  /** Is the door coming down on someone with their feet at `feetY` and their head at `headY`? */
  crushes(p: THREE.Vector3, feetY: number, headY: number, radius = 0.25): boolean {
    if (this.speed >= -0.05 && this.state !== 'closing') return false;
    if (!this.inDoorway(p, radius)) return false;
    const bottom = this.bottom;
    return bottom < headY + 0.15 && bottom + 0.6 > feetY;
  }

  /** Is the doorway open enough to walk through? */
  get passable(): boolean {
    return this.pos > 0.7;
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
    this.refresh();
  }

  /** A stray reference so the helper geometry stays shared. */
  static readonly _geo = { cyl };
}
