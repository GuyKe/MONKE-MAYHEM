import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { WorldButton } from '../ui/panel';
import { MIRROR_LAYER } from './avatar';
import { inSlot, type Cosmetic } from './cosmetics';
import type { Engine } from './engine';
import type { Fixture } from './facility';
import { Rack, makeFlashlight, makeGlowstick, makeRadar, type ItemContext } from './items';
import type { Save, Slot } from './save';
import { box, cyl, dyn, mat, part } from './shapes';
import { batchStatic } from './batch';
import { slab, surface } from './textures';
import { Drone, TIPS } from './drone';
import { forklift, hazardFrame, lockerBank, panelLight, picnicTable, pipe, plant, shelves, pallet } from './props';

export const WIN_X = 5.5;
export const WIN_Y0 = 0.9;
export const WIN_Y1 = 3.7;
export const WIN_Z = 6.85;

const _mf = new THREE.Vector3();
const _md = new THREE.Vector3();
const KEY_ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

function canvasTex(w: number, h: number): [HTMLCanvasElement, THREE.CanvasTexture] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return [c, t];
}

/** The reinforced window: hit it hard with a hand or something thrown, three times, and it goes. */
export class Glass {
  readonly group = new THREE.Group();
  broken = false;
  cracks = 0;
  private readonly pane: THREE.Mesh;
  private overlay!: THREE.Mesh;
  private heal = 0;
  private reform = 0;
  private readonly crackCanvas: HTMLCanvasElement;
  private readonly crackTex: THREE.CanvasTexture;
  private readonly hits: Array<{ u: number; v: number }> = [];
  private collider: ReturnType<Engine['solid']> | null;
  private readonly last = [new THREE.Vector3(), new THREE.Vector3()];
  private cooldown = 0;
  private shards: THREE.InstancedMesh | null = null;
  private shardData: Array<{ p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; rv: THREE.Vector3; s: number }> = [];
  private shardTime = 0;
  onCrack: ((level: number, at: THREE.Vector3) => void) | null = null;
  onShatter: ((at: THREE.Vector3) => void) | null = null;

  constructor(private readonly e: Engine) {
    const w = WIN_X * 2;
    const h = WIN_Y1 - WIN_Y0;
    this.pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0x9cc8e8, transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    this.pane.position.set(0, (WIN_Y0 + WIN_Y1) / 2, WIN_Z);
    this.group.add(this.pane);
    [this.crackCanvas, this.crackTex] = canvasTex(1024, 256);
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.crackTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    overlay.position.set(0, (WIN_Y0 + WIN_Y1) / 2, WIN_Z - 0.01);
    this.group.add(overlay);
    this.overlay = overlay;
    // A heavy frame, with a sign.
    const frameMat = surface('hazard', 1, 1);
    for (const [fw, fh, x, y] of [[w + 0.5, 0.25, 0, WIN_Y1 + 0.12], [w + 0.5, 0.25, 0, WIN_Y0 - 0.12], [0.25, h, -WIN_X - 0.12, (WIN_Y0 + WIN_Y1) / 2], [0.25, h, WIN_X + 0.12, (WIN_Y0 + WIN_Y1) / 2]] as Array<[number, number, number, number]>) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.3), frameMat);
      m.position.set(x, y, WIN_Z - 0.02);
      this.group.add(m);
    }
    for (let i = -2; i <= 2; i++) {
      const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.12), mat(0x30363e, 0, 0.4, 0.6));
      mullion.position.set(i * 2.2, (WIN_Y0 + WIN_Y1) / 2, WIN_Z);
      this.group.add(mullion);
    }
    this.collider = e.solid(0, (WIN_Y0 + WIN_Y1) / 2, WIN_Z, WIN_X, h / 2, 0.05);
    e.scene.add(this.group);
  }

  /** A blow at a point (world). Returns true if it counted. */
  hit(point: THREE.Vector3, power: number): boolean {
    if (this.broken || this.cooldown > 0) return false;
    this.cooldown = 0.35;
    const u = (point.x + WIN_X) / (WIN_X * 2);
    const v = (point.y - WIN_Y0) / (WIN_Y1 - WIN_Y0);
    this.hits.push({ u, v });
    this.cracks += power > 8 ? 2 : 1;
    this.drawCracks();
    this.e.audio.play('glassCrack', point, 1);
    this.e.buzz('both', 0.9, 140);
    this.onCrack?.(this.cracks, point);
    if (this.cracks >= 3) this.shatter(point);
    return true;
  }

  private drawCracks(): void {
    const c = this.crackCanvas.getContext('2d')!;
    c.clearRect(0, 0, 1024, 256);
    c.lineCap = 'round';
    this.hits.forEach((h, n) => {
      const cx = h.u * 1024;
      const cy = (1 - h.v) * 256;
      const arms = 7 + n * 3;
      for (let i = 0; i < arms; i++) {
        let a = (i / arms) * Math.PI * 2 + Math.random() * 0.4;
        let x = cx;
        let y = cy;
        const len = 60 + Math.random() * 190 + n * 40;
        c.strokeStyle = `rgba(235,248,255,${0.85 - Math.random() * 0.25})`;
        c.lineWidth = 1.5 + Math.random() * 1.5;
        c.beginPath();
        c.moveTo(x, y);
        for (let d = 0; d < len; d += 18) {
          a += (Math.random() - 0.5) * 0.7;
          x += Math.cos(a) * 18;
          y += Math.sin(a) * 18;
          c.lineTo(x, y);
          if (Math.random() < 0.12) {
            c.moveTo(x, y);
            c.lineTo(x + Math.cos(a + 1) * 30, y + Math.sin(a + 1) * 30);
            c.moveTo(x, y);
          }
        }
        c.stroke();
      }
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.beginPath();
      c.arc(cx, cy, 5, 0, Math.PI * 2);
      c.fill();
    });
    this.crackTex.needsUpdate = true;
  }

  private shatter(at: THREE.Vector3): void {
    this.broken = true;
    this.pane.visible = false;
    this.overlay.visible = false;
    if (this.collider) {
      this.e.removeSolid(this.collider);
      this.collider = null;
    }
    this.e.audio.play('glassShatter', at, 1);
    this.e.buzz('both', 1, 400);
    // Shards fly out and fall into the hall.
    const N = 180;
    const tri = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.5, -0.4, 0), new THREE.Vector3(0.5, -0.3, 0), new THREE.Vector3(0.1, 0.5, 0)]);
    tri.computeVertexNormals();
    this.shards = new THREE.InstancedMesh(tri, new THREE.MeshStandardMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.6, roughness: 0.05, metalness: 0.4, side: THREE.DoubleSide }), N);
    this.shards.frustumCulled = false;
    this.e.scene.add(this.shards);
    for (let i = 0; i < N; i++) {
      this.shardData.push({
        p: new THREE.Vector3((Math.random() - 0.5) * WIN_X * 2, WIN_Y0 + Math.random() * (WIN_Y1 - WIN_Y0), WIN_Z),
        v: new THREE.Vector3((Math.random() - 0.5) * 3 + (at.x - 0) * 0.1, Math.random() * 2, 1.5 + Math.random() * 4),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        rv: new THREE.Vector3(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5),
        s: 0.1 + Math.random() * 0.45,
      });
    }
    this.onShatter?.(at);
  }

  /** The glass grows back: whole, uncracked, with a shimmer. */
  reset(quiet = false): void {
    if (!this.broken && this.cracks === 0) return;
    this.broken = false;
    this.cracks = 0;
    this.hits.length = 0;
    this.drawCracks();
    this.pane.visible = true;
    this.overlay.visible = true;
    this.reform = 2.2;
    if (!this.collider) this.collider = this.e.solid(0, (WIN_Y0 + WIN_Y1) / 2, WIN_Z, WIN_X, (WIN_Y1 - WIN_Y0) / 2, 0.05);
    if (this.shards) {
      this.e.scene.remove(this.shards);
      this.shards = null;
      this.shardData.length = 0;
    }
    if (!quiet) this.e.audio.play('unlock', new THREE.Vector3(0, 2.3, WIN_Z), 0.8);
    this.onReset?.();
  }

  onReset: (() => void) | null = null;

  update(dt: number, hands: THREE.Vector3[], items: THREE.Vector3[], itemSpeeds: number[]): void {
    this.cooldown -= dt;
    // New glass shimmers into place; small cracks mend if left alone.
    const mat = this.pane.material as THREE.MeshStandardMaterial;
    if (this.reform > 0) {
      this.reform -= dt;
      mat.opacity = 0.16 + Math.max(0, this.reform / 2.2) * 0.5 * (0.5 + 0.5 * Math.sin(this.reform * 30));
    } else if (!this.broken) mat.opacity = 0.16;
    if (!this.broken && this.cracks > 0) {
      this.heal += dt;
      if (this.heal > 25) {
        this.heal = 0;
        this.cracks--;
        this.hits.shift();
        this.drawCracks();
      }
    } else this.heal = 0;
    if (!this.broken) {
      for (let i = 0; i < hands.length; i++) {
        const p = hands[i];
        const speed = this.last[i].distanceTo(p) / Math.max(dt, 1e-3);
        if (Math.abs(p.x) < WIN_X + 0.1 && p.y > WIN_Y0 - 0.1 && p.y < WIN_Y1 + 0.1 && Math.abs(p.z - WIN_Z) < 0.35 && speed > 3.2 && this.last[i].z < p.z + 0.2) this.hit(p, speed);
        this.last[i].copy(p);
      }
      items.forEach((p, i) => {
        if (itemSpeeds[i] > 5 && Math.abs(p.x) < WIN_X && p.y > WIN_Y0 && p.y < WIN_Y1 && Math.abs(p.z - WIN_Z) < 0.3) this.hit(p, itemSpeeds[i]);
      });
    }
    if (this.shards) {
      this.shardTime += dt;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      this.shardData.forEach((s, i) => {
        s.v.y -= 9.8 * dt;
        s.p.addScaledVector(s.v, dt);
        if (s.p.y < -4.4 && s.p.z > 7 && s.p.z < 13) {
          s.p.y = -4.4;
          s.v.set(0, 0, 0);
          s.rv.multiplyScalar(0);
        }
        s.r.x += s.rv.x * dt;
        s.r.y += s.rv.y * dt;
        s.r.z += s.rv.z * dt;
        m.compose(s.p, q.setFromEuler(s.r), new THREE.Vector3(s.s, s.s, s.s));
        this.shards!.setMatrixAt(i, m);
      });
      this.shards.instanceMatrix.needsUpdate = true;
      if (this.shardTime > 40) {
        this.e.scene.remove(this.shards);
        this.shards = null;
      }
    }
  }
}

/** The lobby: a sterile room with a registry terminal, a mirror and a wardrobe, gear on the wall, and a window onto the hazard zone. */
export class Lobby {
  readonly group = new THREE.Group();
  readonly glass: Glass;
  readonly fixtures: Fixture[] = [];
  readonly racks: Rack[] = [];
  readonly spawn = new THREE.Vector3(0, 0, -3.2);
  private name = '';
  private typing = false;
  private readonly monitor: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture };
  private readonly wardrobe: { tab: Slot; page: number; items: WorldButton[]; tabs: WorldButton[]; credits: WorldButton; page_: WorldButton };
  private readonly namePlate: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture };
  private cursor = 0;
  /** The next key replaces the saved name. */
  private fresh = true;
  private reflector: Reflector;
  /** Called when the look changes (the game applies it to the body). */
  onLook: (() => void) | null = null;
  onMic: ((on: boolean) => void) | null = null;
  micCheck = false;
  drone!: Drone;
  onTip: ((text: string) => void) | null = null;
  onCourse: ((seconds: number, best: boolean) => void) | null = null;
  onVend: ((item: 'energy' | 'snack') => void) | null = null;
  /** The training course: when a run began (seconds on the game clock), or -1. */
  private run = -1;
  private finishPlate = new THREE.Vector3(-22, 4.6, -5.5);
  private courseSign!: [HTMLCanvasElement, THREE.CanvasTexture];
  private briefing!: [HTMLCanvasElement, THREE.CanvasTexture];
  private briefTimer = 0;
  private briefIndex = 0;
  private panelsOn = true;
  private readonly lobbyButtons: WorldButton[] = [];

  constructor(
    private readonly e: Engine,
    private readonly save: Save,
    ctx: ItemContext,
  ) {
    e.scene.add(this.group);
    this.glass = new Glass(e);
    this.name = save.data.name;
    const before = e.panels.buttons.length;
    this.buildShell();
    this.monitor = this.buildTerminal();
    this.namePlate = this.buildMirror();
    this.reflector = this.group.children.find((c) => c instanceof Reflector) as Reflector;
    this.wardrobe = this.buildWardrobe();
    this.buildRacks(ctx);
    this.buildSigns();
    this.buildAnnex();
    this.buildLounge();
    this.buildVending();
    this.buildBriefing();
    this.buildPoll();
    this.drone = new Drone(e);
    this.drone.onTip = (t) => this.onTip?.(t);
    this.lobbyButtons.push(...e.panels.buttons.slice(before));
    this.refreshWardrobe();
    window.addEventListener('keydown', (ev) => this.onKey(ev));
    batchStatic(this.group);
  }

  private block(kind: 'wall' | 'floor' | 'ceiling' | 'hazard' | 'concrete' | 'grate', x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tint = 0xffffff): THREE.Mesh {
    const m = slab(kind, x1 - x0, y1 - y0, z1 - z0, tint);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.group.add(m);
    this.e.solid((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2);
    return m;
  }

  private buildShell(): void {
    this.block('floor', -9, 9, -0.4, 0, -7, 7);
    this.block('ceiling', -9, 9, 4.2, 4.6, -7, 7);
    // The west wall has a doorway into the training annex.
    this.block('wall', -9.4, -9, 0, 4.2, -7, 3.2);
    this.block('wall', -9.4, -9, 0, 4.2, 6.2, 7);
    this.block('wall', -9.4, -9, 3.1, 4.2, 3.2, 6.2);
    this.block('wall', 9, 9.4, 0, 4.2, -7, 7);
    this.block('wall', -9, 9, 0, 4.2, -7.4, -7);
    // Exposed concrete beams across the ceiling, and square panel lights in black frames between them.
    for (const x of [-7.4, -2.5, 2.5, 7.4]) this.block('wall', x - 0.3, x + 0.3, 3.8, 4.2, -7, 7);
    for (const x of [-5, 0, 5]) {
      for (const z of [-4, 1.5]) {
        const { group, panel } = panelLight(0.9);
        group.position.set(x, 4.12, z);
        this.group.add(group);
        dyn(panel);
        this.fixtures.push({ pos: new THREE.Vector3(x, 3.9, z), mesh: panel, phase: Math.random() * 10, base: new THREE.Color(0xffffff) });
      }
    }
    // Black skirting round the walls.
    for (const [x, z, w, d] of [[0, -6.97, 18, 0.06], [-8.97, -2, 0.06, 10], [8.97, 0, 0.06, 14]] as Array<[number, number, number, number]>) {
      const sk = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, d), mat(0x1a1a1e));
      sk.position.set(x, 0.08, z);
      this.group.add(sk);
    }
    // Pipes along the north wall and a red one down the corner.
    this.group.add(pipe(new THREE.Vector3(-8.9, 3.45, -6.7), new THREE.Vector3(8.9, 3.45, -6.7), 0.15, 0x8a4a2a));
    this.group.add(pipe(new THREE.Vector3(-8.9, 3.1, -6.7), new THREE.Vector3(8.9, 3.1, -6.7), 0.1, 0x2a3a8a));
    this.group.add(pipe(new THREE.Vector3(-8.7, 0, -6.6), new THREE.Vector3(-8.7, 4.2, -6.6), 0.16, 0xb02a20));
    // The doorway to the annex gets a frame of yellow and black.
    const frame = hazardFrame(3.0, 3.1);
    frame.position.set(-9.0, 0, 4.7);
    frame.rotation.y = Math.PI / 2;
    this.group.add(frame);
    for (let i = 0; i < 3; i++) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.06), surface('grate', 1, 0.5));
      vent.position.set(-6 + i * 6, 3.6, -6.95);
      this.group.add(vent);
    }
    // The sealed intake door in the back wall.
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.0, 0.12), surface('door', 2.4, 3));
    door.position.set(0, 1.5, -6.92);
    this.group.add(door);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
    lamp.position.set(0, 3.2, -6.85);
    this.group.add(lamp);
    // Cables and a floor drain, to look lived in.
    for (let i = 0; i < 3; i++) {
      const cable = new THREE.Mesh(new THREE.TorusGeometry(0.4 + i * 0.15, 0.015, 6, 24, Math.PI), mat(0x101012));
      cable.position.set(-3 + i * 3, 2.9, -6.9);
      this.group.add(cable);
    }
    const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.02, 20), surface('grate', 0.7, 0.7));
    drain.position.set(2, 0.01, 2);
    this.group.add(drain);
    // The edge of the window: a warning stripe on the floor.
    const warn = new THREE.Mesh(new THREE.PlaneGeometry(WIN_X * 2 + 1, 0.8), surface('hazard', 6, 0.8));
    warn.rotation.x = -Math.PI / 2;
    warn.position.set(0, 0.012, 6.2);
    this.group.add(warn);
  }

  // --- The terminal ----------------------------------------------------------------------------------------------------

  private buildTerminal(): { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } {
    const g = new THREE.Group();
    g.position.set(-8.55, 0, 0);
    g.rotation.y = Math.PI / 2;
    this.group.add(g);
    part(g, box, 0x2a2e36, [0, 0.45, -0.3], [2.6, 0.9, 0.9], [0, 0, 0], 0, 0.4, 0.6);
    this.e.solid(-8.3, 0.45, 0, 0.45, 0.45, 1.3);
    // The screen.
    const [canvas, tex] = canvasTex(640, 360);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    screen.position.set(0, 1.65, -0.2);
    g.add(screen);
    part(g, box, 0x14161a, [0, 1.65, -0.24], [1.75, 1.05, 0.08]);
    part(g, box, 0x2a2e36, [0, 1.12, -0.26], [0.2, 0.2, 0.1]);
    // The keys, on a tilted board.
    const kb = new THREE.Group();
    kb.position.set(0, 1.0, 0.05);
    kb.rotation.x = -0.55;
    g.add(kb);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 0.82), new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.5 }));
    plate.position.z = -0.005;
    kb.add(plate);
    const key = (ch: string, x: number, y: number, w = 0.14, fn?: () => void): void => {
      const b = this.e.panels.add(new WorldButton(this.e.scene, ch, w, 0.12, '#38404c', fn ?? (() => this.type(ch))));
      b.mesh.position.set(x, y, 0.01);
      kb.add(b.mesh);
    };
    KEY_ROWS.forEach((row, ri) => {
      const x0 = -((row.length - 1) * 0.152) / 2;
      [...row].forEach((ch, i) => key(ch, x0 + i * 0.152, 0.3 - ri * 0.14));
    });
    key('SPACE', -0.5, -0.27, 0.52, () => this.type(' '));
    key('DEL', 0.1, -0.27, 0.3, () => this.backspace());
    key('SAVE', 0.5, -0.27, 0.34, () => this.commit());
    // Voice test and mic.
    const mic = this.e.panels.add(new WorldButton(this.e.scene, 'MIC CHECK', 0.62, 0.15, '#2d4a6a', () => {
      this.micCheck = !this.micCheck;
      mic.setLabel(this.micCheck ? 'MIC: ON' : 'MIC CHECK');
      this.onMic?.(this.micCheck);
    }));
    mic.mesh.position.set(0.0, 2.35, -0.19);
    g.add(mic.mesh);
    this.drawMonitor(canvas, tex);
    return { canvas, tex };
  }

  private type(ch: string): void {
    if (this.fresh) {
      this.name = '';
      this.fresh = false;
    }
    if (this.name.length >= 12) {
      this.e.audio.play('deny', undefined, 0.5);
      return;
    }
    this.name += ch;
    this.e.audio.play('key');
    this.e.buzz('both', 0.1, 20);
    this.dirty();
  }

  private backspace(): void {
    this.fresh = false;
    this.name = this.name.slice(0, -1);
    this.e.audio.play('key');
    this.dirty();
  }

  private commit(): void {
    this.save.setName(this.name || 'SUBJECT');
    this.name = this.save.data.name;
    this.e.audio.play('chime');
    this.dirty();
  }

  private dirty(): void {
    this.drawMonitor(this.monitor.canvas, this.monitor.tex);
    this.drawNamePlate();
  }

  private onKey(ev: KeyboardEvent): void {
    // The real keyboard works too when you are at the terminal.
    if (!this.typing || ev.repeat) return;
    if (/^[a-z0-9]$/i.test(ev.key)) this.type(ev.key.toUpperCase());
    else if (ev.key === ' ') this.type(' ');
    else if (ev.key === 'Backspace') this.backspace();
    else if (ev.key === 'Enter') this.commit();
  }

  private drawMonitor(canvas: HTMLCanvasElement, tex: THREE.CanvasTexture): void {
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#04100a';
    c.fillRect(0, 0, 640, 360);
    c.strokeStyle = '#1a6a3a';
    c.lineWidth = 4;
    c.strokeRect(6, 6, 628, 348);
    c.font = 'bold 28px ui-monospace, monospace';
    c.fillStyle = '#40ff90';
    c.fillText('FACILITY 9 · SUBJECT REGISTRY', 24, 50);
    c.font = '22px ui-monospace, monospace';
    c.fillStyle = '#20b060';
    c.fillText('ENTER YOUR DESIGNATION, THEN SAVE', 24, 86);
    c.font = 'bold 56px ui-monospace, monospace';
    c.fillStyle = '#b8ffd8';
    const cursor = this.cursor % 2 === 0 ? '_' : ' ';
    c.fillText(`${this.name}${cursor}`, 24, 170);
    c.font = '22px ui-monospace, monospace';
    c.fillStyle = '#20b060';
    const s = this.save.data.stats;
    c.fillText(`CREDITS  ${this.save.data.credits}`, 24, 232);
    c.fillText(`ESCAPES  ${s.escapes}     DEATHS  ${s.deaths}`, 24, 264);
    c.fillText(`CRUSHED  ${s.crushed}     LOGS  ${this.save.data.logs.length}/8`, 24, 296);
    c.fillStyle = '#107a40';
    c.fillText(this.micCheck ? 'VOICE: LIVE (HEAR YOUR ECHO)' : 'VOICE CHAT: SPATIAL, ECHOES WITH THE ROOM', 24, 336);
    tex.needsUpdate = true;
  }

  // --- The mirror and the wardrobe ------------------------------------------------------------------------------------

  private buildMirror(): { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } {
    const g = new THREE.Group();
    g.position.set(8.9, 0, -2.5);
    g.rotation.y = -Math.PI / 2;
    this.group.add(g);
    const mirror = new Reflector(new THREE.PlaneGeometry(1.7, 2.6), { textureWidth: 320, textureHeight: 480, clipBias: 0.003, color: 0xd8e4ec });
    mirror.position.set(0, 1.5, 0);
    mirror.onBeforeRender = ((orig) => (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, geometry: THREE.BufferGeometry, material: THREE.Material, grp: THREE.Group) => {
      // Your head is hidden from your own eyes, but the mirror must see it.
      this.e.body.head.traverse((o) => o.layers.set(0));
      orig.call(mirror, renderer, scene, camera, geometry, material, grp);
      this.e.body.head.traverse((o) => o.layers.set(MIRROR_LAYER));
    })(mirror.onBeforeRender);
    dyn(mirror);
    this.group.add(mirror);
    // Move the reflector into the group's space (Reflector uses its world matrix).
    mirror.position.set(8.88, 1.5, -2.5);
    mirror.rotation.y = -Math.PI / 2;
    const frameMat = mat(0x20242a, 0, 0.3, 0.8);
    for (const [w, h, x, y] of [[1.9, 0.12, 0, 2.86], [1.9, 0.12, 0, 0.16], [0.12, 2.8, -0.9, 1.5], [0.12, 2.8, 0.9, 1.5]] as Array<[number, number, number, number]>) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), frameMat);
      m.position.set(x, y, 0.02);
      g.add(m);
    }
    // A plate showing who you are.
    const [canvas, tex] = canvasTex(512, 128);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    plate.position.set(0, 3.1, 0.03);
    g.add(plate);
    const np = { canvas, tex };
    this.namePlate_(np);
    return np;
  }

  private namePlate_(np: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }): void {
    const c = np.canvas.getContext('2d')!;
    c.fillStyle = '#10161c';
    c.fillRect(0, 0, 512, 128);
    c.strokeStyle = '#40e0ff';
    c.lineWidth = 6;
    c.strokeRect(4, 4, 504, 120);
    c.fillStyle = '#e8f6ff';
    c.font = 'bold 64px system-ui';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(this.name || 'SUBJECT', 256, 68);
    np.tex.needsUpdate = true;
  }

  private drawNamePlate(): void {
    this.namePlate_(this.namePlate);
  }

  private buildWardrobe(): Lobby['wardrobe'] {
    const g = new THREE.Group();
    g.position.set(8.7, 0, 2.2);
    g.rotation.y = -Math.PI / 2;
    this.group.add(g);
    part(g, box, 0x1c2026, [0, 1.6, -0.06], [3.0, 2.3, 0.1], [0, 0, 0], 0, 0.4, 0.5);
    const mk = (label: string, w: number, h: number, x: number, y: number, color: string, fn: () => void): WorldButton => {
      const b = this.e.panels.add(new WorldButton(this.e.scene, label, w, h, color, fn));
      b.mesh.position.set(x, y, 0.0);
      g.add(b.mesh);
      return b;
    };
    const head = mk('WARDROBE', 1.4, 0.3, 0, 2.58, '#20303c', () => {});
    head.enabled = false;
    const credits = mk('', 1.2, 0.26, 0.9, 2.58, '#4a3a10', () => {});
    credits.enabled = false;
    const tabs: WorldButton[] = (['hat', 'skin', 'acc'] as Slot[]).map((slot, i) =>
      mk(slot === 'hat' ? 'HATS' : slot === 'skin' ? 'SUITS' : 'GEAR', 0.88, 0.28, -0.95 + i * 0.95, 2.26, '#2d4a6a', () => {
        this.wardrobe.tab = slot;
        this.wardrobe.page = 0;
        this.refreshWardrobe();
      }),
    );
    const items: WorldButton[] = [];
    for (let i = 0; i < 6; i++) items.push(mk('', 1.3, 0.34, i % 2 ? 0.7 : -0.7, 1.82 - Math.floor(i / 2) * 0.42, '#2d5a3a', () => this.pick(i)));
    mk('◄', 0.5, 0.28, -0.95, 0.55, '#6a3e22', () => this.turnPage(-1));
    const page_ = mk('1/1', 0.9, 0.28, 0, 0.55, '#3a3a3a', () => {});
    page_.enabled = false;
    mk('►', 0.5, 0.28, 0.95, 0.55, '#6a3e22', () => this.turnPage(1));
    return { tab: 'hat', page: 0, items, tabs, credits, page_ };
  }

  private slotItems(): Cosmetic[] {
    return inSlot(this.wardrobe.tab);
  }

  private turnPage(d: number): void {
    const pages = Math.max(1, Math.ceil(this.slotItems().length / 6));
    this.wardrobe.page = (this.wardrobe.page + d + pages) % pages;
    this.e.audio.play('click');
    this.refreshWardrobe();
  }

  private pick(i: number): void {
    const item = this.slotItems()[this.wardrobe.page * 6 + i];
    if (!item) return;
    const d = this.save.data;
    if (!d.owned.includes(item.id)) {
      if (d.credits < item.price) {
        this.e.audio.play('deny');
        return;
      }
      this.save.addCredits(-item.price);
      d.owned.push(item.id);
      this.e.audio.play('buy');
    } else this.e.audio.play('equip');
    d.equipped[item.slot] = item.id;
    this.save.save();
    this.refreshWardrobe();
    this.onLook?.();
    this.dirty();
  }

  refreshWardrobe(): void {
    const w = this.wardrobe;
    const d = this.save.data;
    const list = this.slotItems();
    w.items.forEach((b, i) => {
      const item = list[w.page * 6 + i];
      if (!item) {
        b.setLabel('');
        b.enabled = false;
        b.mesh.visible = false;
        return;
      }
      b.mesh.visible = this.panelsOn;
      const owned = d.owned.includes(item.id);
      const on = d.equipped[item.slot] === item.id;
      b.setLabel(on ? `✓ ${item.name}` : owned ? item.name : `${item.name} $${item.price}`);
      b.enabled = true;
    });
    w.credits.setLabel(`$ ${d.credits}`);
    w.page_.setLabel(`${w.page + 1}/${Math.max(1, Math.ceil(list.length / 6))}`);
  }

  // --- Gear ---------------------------------------------------------------------------------------------------------------

  private buildRacks(ctx: ItemContext): void {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(9, 1.2, 0.12), surface('wall', 9, 1.2, 0x8a9098));
    wall.position.set(0, 1.4, -6.9);
    this.group.add(wall);
    const labels: Array<[string, number]> = [['GLOWSTICKS', -4.2], ['LIGHT', -0.3], ['RADAR', 3.4]];
    for (const [text, x] of labels) {
      const [c, t] = canvasTex(256, 64);
      const x2 = c.getContext('2d')!;
      x2.fillStyle = '#10161c';
      x2.fillRect(0, 0, 256, 64);
      x2.fillStyle = '#e8d060';
      x2.font = 'bold 36px system-ui';
      x2.textAlign = 'center';
      x2.textBaseline = 'middle';
      x2.fillText(text, 128, 34);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.32), new THREE.MeshBasicMaterial({ map: t }));
      m.position.set(x, 2.15, -6.82);
      this.group.add(m);
    }
    const at = (x: number, y = 1.4): THREE.Vector3 => new THREE.Vector3(x, y, -6.7);
    let n = 0;
    for (const x of [-5.2, -4.5, -3.8, -3.1]) this.racks.push(new Rack(ctx, at(x), () => makeGlowstick(ctx, at(x), n++)));
    this.racks.push(new Rack(ctx, at(-0.7), () => makeFlashlight(ctx, at(-0.7))));
    this.racks.push(new Rack(ctx, at(0.3), () => makeFlashlight(ctx, at(0.3))));
    this.racks.push(new Rack(ctx, at(3.4), () => makeRadar(ctx, at(3.4))));
    this.racks.push(new Rack(ctx, at(4.2), () => makeRadar(ctx, at(4.2))));
    for (let i = 0; i < 8; i++) {
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6).rotateX(Math.PI / 2), mat(0xaaaaaa, 0, 0.3, 0.8));
      hook.position.set(-5.2 + i * 1.3, 1.32, -6.74);
      this.group.add(hook);
    }
  }

  private buildSigns(): void {
    const mk = (text: string, color: string, w: number, h: number, x: number, y: number, z: number, ry: number, bg = '#10161c'): void => {
      const [c, t] = canvasTex(1024, Math.round(1024 * (h / w)));
      const x2 = c.getContext('2d')!;
      x2.fillStyle = bg;
      x2.fillRect(0, 0, c.width, c.height);
      x2.fillStyle = color;
      x2.font = `bold ${Math.round(c.height * 0.5)}px system-ui`;
      x2.textAlign = 'center';
      x2.textBaseline = 'middle';
      x2.fillText(text, c.width / 2, c.height / 2 + 6);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t }));
      m.position.set(x, y, z);
      m.rotation.y = ry;
      this.group.add(m);
    };
    mk('DO NOT BREAK GLASS', '#ffcf30', 3.6, 0.45, 0, 4.0, 6.88, Math.PI, '#3a0a0a');
    mk('SAFE ZONE', '#60ff90', 3, 0.5, 0, 3.4, -6.9, 0);
    mk('REGISTRY', '#e8e8e8', 1.4, 0.3, -8.9, 2.7, 0, Math.PI / 2, '#16202a');
    mk('WARDROBE', '#e8e8e8', 1.6, 0.3, 8.9, 3.6, 3.6, -Math.PI / 2, '#16202a');
  }

  private facingMirror(): boolean {
    const f = _mf.set(0, 0, -1).applyQuaternion(this.e.headQuat);
    const d = _md.set(8.9 - this.e.head.x, 0, -2.5 - this.e.head.z);
    const dist = d.length();
    return dist < 9 && f.dot(d.divideScalar(Math.max(dist, 0.01))) > 0.1;
  }

  // --- The training annex ------------------------------------------------------------------------------------------------

  /** A room off the lobby to learn the hands on: stepping blocks, poles, and a climbing wall to a finish plate, with a timer. */
  private buildAnnex(): void {
    const HEIGHT = 6;
    this.block('floor', -24, -9.4, -0.4, 0, -7, 7);
    this.block('ceiling', -24, -9.4, HEIGHT, HEIGHT + 0.4, -7, 7);
    this.block('wall', -24, -9.4, 0, HEIGHT, -7.4, -7);
    this.block('wall', -24.4, -24, 0, HEIGHT, -7.4, 7.4);
    this.block('wall', -24, -20, 0, HEIGHT, 6.6, 7);
    for (const x of [-14, -20]) {
      const mesh = dyn(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.7), new THREE.MeshBasicMaterial({ color: 0xf4fbff, fog: false })));
      mesh.position.set(x, HEIGHT - 0.06, 0);
      this.group.add(mesh);
      this.fixtures.push({ pos: new THREE.Vector3(x, HEIGHT - 0.4, 0), mesh, phase: Math.random() * 10, base: new THREE.Color(0xf4fbff) });
    }
    const tinted = (x: number, y: number, z: number, w: number, h: number, d: number, tint: number): void => {
      this.block('floor', x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - d / 2, z + d / 2, tint);
    };
    // Stepping blocks that climb the room.
    tinted(-12.4, 0.35, 4.2, 1.4, 0.7, 1.4, 0x3a8ae0);
    tinted(-14.6, 0.7, 1.8, 1.4, 1.4, 1.4, 0x40c0a0);
    tinted(-16.8, 1.05, -0.6, 1.4, 2.1, 1.4, 0xe0b030);
    tinted(-19.2, 0.8, 2.6, 1.6, 1.6, 1.6, 0xe06040);
    // Poles to swing round.
    for (const [x, z] of [[-13.4, -3.6], [-16.6, -5.4], [-19.4, -3.2]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, HEIGHT, 10), mat(0xd8a020));
      pole.position.set(x, HEIGHT / 2, z);
      this.group.add(pole);
      this.e.solid(x, HEIGHT / 2, z, 0.1, HEIGHT / 2, 0.1);
    }
    // The climbing wall: a slab with holds sticking out of it, to a ledge.
    this.block('wall', -24, -23.3, 0, HEIGHT, -7, 7);
    const colors = [0xff6a30, 0x30c8ff, 0xffd030, 0xff40c0, 0x60e060];
    for (let i = 0; i < 46; i++) {
      const y = 0.5 + (i / 46) * 4.4 + (Math.random() - 0.5) * 0.3;
      const z = -6.4 + ((i * 37) % 13) * 0.45 + (Math.random() - 0.5) * 0.3;
      const h = this.block('floor', -23.3, -23.0, y - 0.1, y + 0.1, z - 0.18, z + 0.18, colors[i % colors.length]);
      void h;
    }
    // The ledge at the top, and a rail so you can see it from below.
    this.block('grate', -24, -20.5, 4.4, 4.6, -7, -3.6);
    for (const x of [-20.6]) this.block('hazard', x - 0.05, x + 0.05, 4.6, 5.3, -7, -3.6, 0xffffff);
    // A forklift, shelves of crates and a pallet make the annex look like the warehouse it is.
    const fk = forklift();
    fk.position.set(-11.6, 0, -5.4);
    fk.rotation.y = 0.4;
    this.group.add(fk);
    this.e.solid(-11.6, 1.0, -5.4, 0.9, 1.0, 1.1);
    const sh = shelves(2.6, 2.8, 0.8, 3, true);
    sh.position.set(-15.4, 0, -6.55);
    this.group.add(sh);
    this.e.solid(-15.4, 1.4, -6.55, 1.3, 1.4, 0.45);
    const pl = pallet(2);
    pl.position.set(-22.4, 0, 3.8);
    this.group.add(pl);
    this.e.solid(-22.4, 0.7, 3.8, 0.6, 0.7, 0.5);
    // The finish plate.
    const plate = dyn(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.05, 20), new THREE.MeshBasicMaterial({ color: 0x40ff90 })));
    plate.position.copy(this.finishPlate).setY(4.65);
    this.group.add(plate);
    // The start post: poke it to start the clock.
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.12), mat(0x30363e));
    post.position.set(-10.4, 0.6, 5.4);
    this.group.add(post);
    const start = this.e.panels.add(new WorldButton(this.e.scene, 'START RUN', 0.7, 0.2, '#2d7a3a', () => this.startRun()));
    start.mesh.position.set(-10.1, 1.35, 5.4);
    start.mesh.rotation.y = Math.PI / 2;
    // Signs.
    const [c, t] = canvasTex(1024, 256);
    const x2 = c.getContext('2d')!;
    x2.fillStyle = '#10161c';
    x2.fillRect(0, 0, 1024, 256);
    x2.fillStyle = '#ffd860';
    x2.font = 'bold 84px system-ui';
    x2.textAlign = 'center';
    x2.fillText('TRAINING ANNEX', 512, 100);
    x2.fillStyle = '#e8e8e8';
    x2.font = '42px system-ui';
    x2.fillText('Push off floors, walls and ceilings. Climb to the green plate.', 512, 180);
    const title = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), new THREE.MeshBasicMaterial({ map: t }));
    title.position.set(-9.6, 3.3, 0);
    title.rotation.y = Math.PI / 2;
    this.group.add(title);
    this.courseSign = canvasTex(512, 256);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: this.courseSign[1] }));
    board.position.set(-24.0, 2.0, 0.5);
    board.rotation.y = Math.PI / 2;
    // The board hangs on the end wall facing the room.
    board.position.set(-23.25, 2.4, 5.6);
    this.group.add(board);
    this.drawCourse();
  }

  private startRun(): void {
    this.run = this.e.time;
    this.e.audio.play('chime');
    this.e.buzz('both', 0.3, 80);
    this.drawCourse();
  }

  private drawCourse(live = 0): void {
    const c = this.courseSign[0].getContext('2d')!;
    c.fillStyle = '#0a1a14';
    c.fillRect(0, 0, 512, 256);
    c.strokeStyle = '#30c070';
    c.lineWidth = 6;
    c.strokeRect(4, 4, 504, 248);
    c.fillStyle = '#40ff90';
    c.font = 'bold 40px ui-monospace, monospace';
    c.textAlign = 'center';
    c.fillText('CLIMB COURSE', 256, 56);
    c.font = 'bold 84px ui-monospace, monospace';
    c.fillStyle = '#b8ffd8';
    c.fillText(this.run >= 0 ? live.toFixed(1) + 's' : '--', 256, 150);
    c.font = '32px ui-monospace, monospace';
    c.fillStyle = '#20b060';
    const best = this.save.data.bestCourse;
    c.fillText(best ? `BEST ${best.toFixed(1)}s` : 'NO TIME YET', 256, 215);
    this.courseSign[1].needsUpdate = true;
  }

  // --- The lounge, the vending machine, the briefing board ---------------------------------------------------------------

  private buildLounge(): void {
    // A bank of blue lockers on the east wall, and a blue picnic table.
    const lockers = lockerBank(4);
    lockers.position.set(8.55, 0, -6.6);
    lockers.rotation.y = -Math.PI / 2;
    this.group.add(lockers);
    this.e.solid(8.55, 1.0, -5.4, 0.3, 1.0, 1.3);
    const table = picnicTable();
    table.position.set(5.6, 0, -5.4);
    table.rotation.y = 0.3;
    this.group.add(table);
    this.e.solid(5.6, 0.4, -5.4, 1.0, 0.4, 0.5);
    // Benches facing the window.
    for (const x of [-3.2, 3.2]) {
      const b = new THREE.Group();
      b.position.set(x, 0, 5.0);
      part(b, box, 0x5a626c, [0, 0.4, 0], [1.8, 0.08, 0.45]);
      for (const sx of [-1, 1]) part(b, box, 0x30363e, [sx * 0.8, 0.2, 0], [0.08, 0.4, 0.4]);
      this.group.add(b);
      this.e.solid(x, 0.25, 5.0, 0.9, 0.25, 0.25);
    }
    // Plants in the corners (the only living things for a long way down), and a bin by the terminal.
    for (const [x, z] of [[-8.3, -6.3], [8.3, 6.4], [-8.3, 6.4], [8.35, -3.75]]) {
      const p = plant();
      p.position.set(x, 0, z);
      this.group.add(p);
    }
    const bin = new THREE.Group();
    bin.position.set(-8.4, 0, -3.2);
    part(bin, cyl, 0x4a5058, [0, 0.3, 0], [0.22, 0.6, 0.22]);
    part(bin, cyl, 0x30363e, [0, 0.62, 0], [0.24, 0.03, 0.24]);
    this.group.add(bin);
    // Light strips in the floor lead from where you wake to the window.
    for (const sx of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 8.6), new THREE.MeshBasicMaterial({ color: 0x40a0ff, fog: false }));
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(sx * 1.2, 0.015, 0.4);
      dyn(strip);
      this.group.add(strip);
    }
  }

  private buildVending(): void {
    const g = new THREE.Group();
    g.position.set(8.5, 0, 5.5);
    g.rotation.y = -Math.PI / 2;
    this.group.add(g);
    part(g, box, 0x2a5a30, [0, 1.0, 0], [1.1, 2.0, 0.9], [0, 0, 0], 0, 0.5, 0.2);
    part(g, box, 0xe0b020, [0, 0.12, 0.46], [1.1, 0.16, 0.02]);
    part(g, box, 0x14161a, [0, 1.3, 0.46], [0.85, 1.2, 0.02]);
    for (let i = 0; i < 12; i++) part(g, cyl, [0x40a0ff, 0xff8030, 0x60e060, 0xffd030][i % 4], [-0.28 + (i % 3) * 0.28, 1.65 - Math.floor(i / 3) * 0.28, 0.43], [0.07, 0.18, 0.07]);
    part(g, box, 0x14161a, [0, 0.3, 0.46], [0.6, 0.18, 0.02]);
    const glow = dyn(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.18), new THREE.MeshBasicMaterial({ color: 0xfff6c0, fog: false })));
    glow.position.set(0, 1.95, 0.47);
    g.add(glow);
    this.e.solid(8.5, 1.0, 5.5, 0.45, 1.0, 0.55);
    const mk = (label: string, y: number, color: string, fn: () => void): WorldButton => {
      const b = this.e.panels.add(new WorldButton(this.e.scene, label, 0.75, 0.16, color, fn));
      b.mesh.position.set(0, y, 0.48);
      g.add(b.mesh);
      return b;
    };
    mk('ENERGY CELL $20', 0.95, '#2d7a3a', () => this.onVend?.('energy'));
    mk('SNACK $5', 0.74, '#7a5a1a', () => this.onVend?.('snack'));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.2), new THREE.MeshBasicMaterial({ map: this.textTexture('VENDING', '#fff0a0', '#2a5a30') }));
    sign.position.set(0, 2.1, 0.47);
    g.add(sign);
  }

  private textTexture(text: string, color: string, bg: string): THREE.CanvasTexture {
    const [c, t] = canvasTex(512, 114);
    const x = c.getContext('2d')!;
    x.fillStyle = bg;
    x.fillRect(0, 0, 512, 114);
    x.fillStyle = color;
    x.font = 'bold 72px system-ui';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, 256, 60);
    return t;
  }

  /** A wall monitor that says LOADING and then shows a poll nobody asked for. */
  private poll!: [HTMLCanvasElement, THREE.CanvasTexture];
  private pollTime = 0;

  private buildPoll(): void {
    this.poll = canvasTex(768, 384);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.1, 1.7, 0.08), mat(0x14161a));
    frame.position.set(6.2, 2.3, -6.96);
    this.group.add(frame);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.45), new THREE.MeshBasicMaterial({ map: this.poll[1], toneMapped: false }));
    m.position.set(6.2, 2.3, -6.91);
    this.group.add(m);
    this.drawPoll();
  }

  private drawPoll(): void {
    const c = this.poll[0].getContext('2d')!;
    c.fillStyle = '#0c0f12';
    c.fillRect(0, 0, 768, 384);
    c.strokeStyle = '#8a9096';
    c.lineWidth = 6;
    c.strokeRect(4, 4, 760, 376);
    c.fillStyle = '#e8ecee';
    c.font = 'bold 44px ui-monospace, monospace';
    c.textAlign = 'center';
    c.fillText('FACILITY POLL', 384, 60);
    const t = this.pollTime % 14;
    if (t < 4) {
      c.font = '34px ui-monospace, monospace';
      c.fillText('LOADING' + '.'.repeat(1 + Math.floor(t * 2) % 3), 384, 210);
    } else {
      c.textAlign = 'left';
      c.font = '30px ui-monospace, monospace';
      c.fillText('WILL YOU MAKE IT OUT?', 40, 120);
      const rows: Array<[string, number, string]> = [['YES', 0.14, '#60e080'], ['NO', 0.71, '#ff6060'], ['DEPENDS ON THE DOORS', 0.15, '#ffd060']];
      rows.forEach(([label, v, col], i) => {
        const y = 170 + i * 64;
        c.fillStyle = '#c8ced2';
        c.font = '24px ui-monospace, monospace';
        c.fillText(label, 40, y);
        c.fillStyle = col;
        c.fillRect(40, y + 8, 600 * v * Math.min(1, (t - 4) / 2), 22);
        c.fillStyle = '#e8ecee';
        c.fillText(`${Math.round(v * 100)}%`, 660, y + 26);
      });
    }
    this.poll[1].needsUpdate = true;
  }

  private buildBriefing(): void {
    this.briefing = canvasTex(1024, 640);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.625), new THREE.MeshBasicMaterial({ map: this.briefing[1], toneMapped: false }));
    m.position.set(-7.4, 2.3, -6.9);
    this.group.add(m);
    this.drawBriefing();
  }

  private drawBriefing(): void {
    const c = this.briefing[0].getContext('2d')!;
    c.fillStyle = '#0c141c';
    c.fillRect(0, 0, 1024, 640);
    c.strokeStyle = '#3a7aaa';
    c.lineWidth = 8;
    c.strokeRect(6, 6, 1012, 628);
    c.fillStyle = '#ffd060';
    c.font = 'bold 56px system-ui';
    c.textAlign = 'center';
    c.fillText('HAZARD BRIEFING', 512, 90);
    c.fillStyle = '#e8f0f4';
    c.font = '40px system-ui';
    c.textAlign = 'left';
    const words = TIPS[this.briefIndex % TIPS.length].split(' ');
    let line = '';
    let y = 220;
    for (const w of words) {
      if (c.measureText(line + w).width > 920) {
        c.fillText(line, 50, y);
        line = '';
        y += 56;
      }
      line += w + ' ';
    }
    c.fillText(line, 50, y);
    c.fillStyle = '#60c0ff';
    c.font = '30px system-ui';
    c.fillText(`TIP ${(this.briefIndex % TIPS.length) + 1} / ${TIPS.length}`, 50, 590);
    this.briefing[1].needsUpdate = true;
  }

  /** The terminal and wardrobe buttons only matter (and only cost) while you are in the lobby. */
  setPanelsVisible(on: boolean): void {
    if (on === this.panelsOn) return;
    this.panelsOn = on;
    for (const b of this.lobbyButtons) b.mesh.visible = on;
    this.refreshWardrobe();
  }

  /** Per frame. */
  update(dt: number, time: number, hands: THREE.Vector3[], items: THREE.Vector3[], itemSpeeds: number[]): void {
    this.glass.update(dt, hands, items, itemSpeeds);
    const inLobby = this.e.head.z < 7.3 && this.e.head.y > -1.5;
    this.drone.setActive(inLobby);
    if (inLobby) this.drone.update(dt);
    // The training course: reach the green plate.
    if (this.run >= 0) {
      const live = this.e.time - this.run;
      if (Math.floor(live * 10) !== Math.floor((live - dt) * 10)) this.drawCourse(live);
      const d = this.e.head;
      if (Math.hypot(d.x - this.finishPlate.x, d.z - this.finishPlate.z) < 0.9 && d.y > 3.6) {
        const best = this.save.data.bestCourse;
        this.save.data.bestCourse = !best || live < best ? Math.round(live * 10) / 10 : best;
        this.save.save();
        this.run = -1;
        this.e.audio.play('unlock');
        this.e.buzz('both', 0.8, 200);
        this.drawCourse(live);
        this.onCourse?.(live, !best || live <= best);
      }
      if (live > 300) this.run = -1;
    }
    this.pollTime += dt;
    if (inLobby && Math.floor(this.pollTime * 4) !== Math.floor((this.pollTime - dt) * 4)) this.drawPoll();
    this.briefTimer += dt;
    if (this.briefTimer > 7) {
      this.briefTimer = 0;
      this.briefIndex++;
      this.drawBriefing();
    }
    for (const r of this.racks) r.update(dt);
    // Typing is live when you stand at the terminal.
    const head = this.e.head;
    this.typing = head.x < -5.2 && Math.abs(head.z) < 3.2 && head.y > -1;
    this.cursor = Math.floor(time * 2);
    if (this.typing && Math.floor(time * 2) !== Math.floor((time - dt) * 2)) this.drawMonitor(this.monitor.canvas, this.monitor.tex);
    // The mirror only works when you are near it.
    // (Drawing the scene a second time is dear: only when you are near it and facing it.)
    this.reflector.visible = head.x > 2.5 && head.y > -1 && head.z < 4 && this.facingMirror();
  }

}
