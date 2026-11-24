import * as THREE from 'three';
import type { Settings, SettingsData } from '../settings';
import { SETTING_ROWS } from './menu';
import { ADMIN_ITEMS, type AdminActions } from '../admin';

export interface PauseHooks {
  /** Writes the game. Returns false if it could not. */
  save(): boolean;
  /** Takes the headset back to the main menu. */
  exit(): void;
  /** Multiplayer state, or null when playing alone. */
  net(): { role: 'host' | 'client'; code: string; players: string[]; mic: 'off' | 'on' | 'denied'; muted: boolean } | null;
  toggleMic(): void;
  /** Admin tools: whether they are unlocked, how to redeem a code, and what they do. */
  admin: { unlocked(): boolean; redeem(code: string): { ok: boolean; message: string }; actions: AdminActions };
}

type Screen = 'main' | 'settings' | 'controls' | 'multi' | 'code' | 'admin' | 'animals' | 'build' | 'powers' | { group: number } | { items: number };

interface Hit {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  act: () => void;
}

const W = 512;
const H = 680;
/** The panel's size in the world (metres). */
const PANEL_W = 0.62;
const PANEL_H = (PANEL_W * H) / W;
const INK = '#f1e7c4';
const GOLD = '#d9b548';
const GREEN = '#3f7d46';
const CONTROLS: Array<[string, string]> = [
  ['Move', 'Push off the ground, trunks and rocks with your hands. Pull back to go forward, push down to jump, let go to launch.'],
  ['Grip', 'Squeeze to pick up things, pick berries and leaves, pull ropes. Let go to drop, or swing and let go to throw.'],
  ['Trigger', 'Hold while you work: smashing, winding rope, sharpening, sawing.'],
  ['Book', 'Squeeze at your hip. Poke the pages; swipe an edge to turn them.'],
  ['Turn', 'Right thumbstick sideways (see Settings).'],
  ['This menu', 'Press B or Y (the upper face buttons) any time.'],
];

/**
 * The pause menu: press B or Y and a panel floats in front of you. Poke its buttons with a finger. Playing alone, the world
 * stands still while it is open; in a multiplayer game the world carries on (the others cannot be stopped).
 */
export class PauseMenu {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly mesh: THREE.Mesh;
  private screen: Screen = 'main';
  private hits: Hit[] = [];
  private hover = -1;
  private dirty = true;
  private status = '';
  private typed = '';
  private codeMessage = '';
  private amount = 1;
  private readonly armed = [true, true];
  open = false;
  private readonly _p = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly settings: Settings,
    private readonly hooks: PauseHooks,
  ) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, fog: false, depthTest: false }));
    this.mesh.renderOrder = 995;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Opens the panel in front of `head`, facing `yaw` (the way you are looking). */
  show(head: THREE.Vector3, yaw: number): void {
    this.open = true;
    this.screen = 'main';
    this.status = '';
    this.armed[0] = this.armed[1] = false;
    this.mesh.position.set(head.x - Math.sin(yaw) * 0.9, head.y - 0.02, head.z - Math.cos(yaw) * 0.9);
    this.mesh.rotation.set(0, yaw, 0);
    this.mesh.visible = true;
    this.dirty = true;
  }

  hide(): void {
    this.open = false;
    this.mesh.visible = false;
  }

  toggle(head: THREE.Vector3, yaw: number): void {
    if (this.open) this.hide();
    else this.show(head, yaw);
  }

  /** Per frame, with where the hands are (world positions, or null). */
  update(hands: [THREE.Vector3 | null, THREE.Vector3 | null]): void {
    if (!this.open) return;
    this.mesh.updateWorldMatrix(true, false);
    let hover = -1;
    for (let i = 0; i < 2; i++) {
      const p = hands[i];
      if (!p) continue;
      const local = this.mesh.worldToLocal(this._p.copy(p));
      const px = (local.x / PANEL_W + 0.5) * W;
      const py = (0.5 - local.y / PANEL_H) * H;
      const depth = local.z;
      const over = this.hits.findIndex((b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
      if (depth < 0.22 && depth > -0.1 && over >= 0) hover = over;
      // A finger that comes in from the front and passes through the panel presses what is under it.
      if (depth > 0.12) this.armed[i] = true;
      else if (this.armed[i] && depth < 0.06 && depth > -0.14 && over >= 0) {
        this.armed[i] = false;
        this.hits[over].act();
        this.dirty = true;
        break;
      }
    }
    if (hover !== this.hover) {
      this.hover = hover;
      this.dirty = true;
    }
    if (this.dirty) this.draw();
  }

  // --- Drawing -------------------------------------------------------------------------

  private go(screen: Screen): void {
    this.screen = screen;
    this.status = '';
    this.dirty = true;
  }

  private draw(): void {
    this.dirty = false;
    const c = this.ctx;
    this.hits = [];
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(16,26,20,0.93)';
    this.round(8, 8, W - 16, H - 16, 28);
    c.fill();
    c.strokeStyle = GOLD;
    c.lineWidth = 5;
    c.stroke();
    const net = this.hooks.net();
    const s = this.screen;
    if (s === 'main') this.drawMain(net);
    else if (s === 'settings') this.drawSettingsIndex();
    else if (s === 'controls') this.drawControls();
    else if (s === 'multi') this.drawMulti(net);
    else if (s === 'code') this.drawCode();
    else if (s === 'admin') this.drawAdmin();
    else if (s === 'animals') this.drawAnimals();
    else if (s === 'build') this.drawBuild();
    else if (s === 'powers') this.drawPowers();
    else if ('items' in s) this.drawItems(s.items);
    else this.drawGroup(s.group);
    this.texture.needsUpdate = true;
  }

  private round(x: number, y: number, w: number, h: number, r: number): void {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  private title(text: string): void {
    const c = this.ctx;
    c.fillStyle = INK;
    c.font = 'bold 38px Georgia, serif';
    c.textAlign = 'center';
    c.fillText(text, W / 2, 70);
    c.strokeStyle = GOLD;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(60, 88);
    c.lineTo(W - 60, 88);
    c.stroke();
    c.textAlign = 'left';
  }

  private button(label: string, x: number, y: number, w: number, h: number, act: () => void, on = false, color = '#2d4a35', size = 26): void {
    const c = this.ctx;
    const index = this.hits.length;
    const hover = this.hover === index;
    c.fillStyle = on ? GOLD : hover ? '#4b8a54' : color;
    this.round(x, y, w, h, 14);
    c.fill();
    if (hover) {
      c.strokeStyle = '#fff3b0';
      c.lineWidth = 4;
      c.stroke();
    }
    c.fillStyle = on ? '#1f1608' : '#f3f0dc';
    c.font = `bold ${size}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.fillText(label, x + w / 2, y + h / 2 + size * 0.35);
    c.textAlign = 'left';
    this.hits.push({ label, x, y, w, h, act });
  }

  private note(text: string, y: number, size = 20): number {
    const c = this.ctx;
    c.fillStyle = '#c9d9be';
    c.font = `${size}px Georgia, serif`;
    c.textAlign = 'center';
    let line = '';
    for (const word of text.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (c.measureText(test).width > W - 90 && line) {
        c.fillText(line, W / 2, y);
        y += size * 1.35;
        line = word;
      } else line = test;
    }
    if (line) {
      c.fillText(line, W / 2, y);
      y += size * 1.35;
    }
    c.textAlign = 'left';
    return y;
  }

  private drawMain(net: ReturnType<PauseHooks['net']>): void {
    this.title(net ? 'Game menu' : 'Paused');
    let y = 118;
    const row = (label: string, act: () => void, opts: { on?: boolean; color?: string } = {}) => {
      this.button(label, 50, y, W - 100, 62, act, opts.on, opts.color);
      y += 74;
    };
    row('Resume', () => this.hide(), { color: GREEN });
    row(this.status || 'Save game', () => {
      this.status = this.hooks.save() ? 'Saved ✓' : 'Could not save';
    });
    row('Settings', () => this.go('settings'));
    row(net ? `Multiplayer: ${net.role === 'host' ? net.code : 'joined'}` : 'Multiplayer', () => this.go('multi'));
    row('Controls', () => this.go('controls'));
    if (this.hooks.admin.unlocked()) row('Admin', () => this.go('admin'), { color: '#8a6a1a' });
    else row('Enter code', () => this.go('code'));
    row('Quit to main menu', () => this.hooks.exit(), { color: '#8a3a22' });
    if (net) this.note('The world carries on while you are in this menu.', y + 6, 18);
  }

  private drawSettingsIndex(): void {
    this.title('Settings');
    let y = 118;
    SETTING_ROWS.forEach((group, i) => {
      this.button(group.title, 50, y, W - 100, 64, () => this.go({ group: i }));
      y += 78;
    });
    this.button('Back', 50, H - 100, W - 100, 62, () => this.go('main'), false, '#6a3e22');
  }

  private drawGroup(index: number): void {
    const group = SETTING_ROWS[index];
    this.title(group.title);
    const c = this.ctx;
    let y = 118;
    for (const row of group.rows) {
      c.fillStyle = INK;
      c.font = '22px Georgia, serif';
      c.fillText(row.label, 40, y + 4);
      const options: Array<[string | boolean | number, string]> =
        row.kind === 'choice' ? row.options.map(([v, l]) => [v, l.replace('Always day', 'All day').replace('Left hip', 'Left').replace('Right hip', 'Right')]) : [[0, 'Off'], [0.25, '25%'], [0.5, '50%'], [0.75, '75%'], [1, 'Full']];
      const current = this.settings.data[row.key];
      const w = (W - 80 - (options.length - 1) * 6) / options.length;
      options.forEach(([value, label], i) => {
        const on = row.kind === 'slider' ? Math.abs(Number(current) - Number(value)) < 0.13 : current === value;
        this.button(label, 40 + i * (w + 6), y + 16, w, 52, () => this.settings.set(row.key, value as never), on, '#4a3b28', 20);
      });
      y += 96;
    }
    this.button('Back', 50, H - 100, W - 100, 62, () => this.go('settings'), false, '#6a3e22');
  }

  private drawControls(): void {
    this.title('Controls');
    const c = this.ctx;
    let y = 130;
    for (const [term, text] of CONTROLS) {
      c.fillStyle = GOLD;
      c.font = 'bold 22px Georgia, serif';
      c.textAlign = 'left';
      c.fillText(term, 44, y);
      c.textAlign = 'left';
      y = this.noteLeft(text, y + 24, 18) + 8;
    }
    this.button('Back', 50, H - 100, W - 100, 62, () => this.go('main'), false, '#6a3e22');
  }

  private noteLeft(text: string, y: number, size: number): number {
    const c = this.ctx;
    c.fillStyle = '#dfe8d4';
    c.font = `${size}px Georgia, serif`;
    let line = '';
    for (const word of text.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (c.measureText(test).width > W - 90 && line) {
        c.fillText(line, 44, y);
        y += size * 1.3;
        line = word;
      } else line = test;
    }
    if (line) {
      c.fillText(line, 44, y);
      y += size * 1.3;
    }
    return y;
  }

  // --- Code entry and the admin tools ------------------------------------------------------------

  private drawCode(): void {
    this.title('Enter code');
    const c = this.ctx;
    c.fillStyle = '#10201a';
    this.round(40, 100, W - 80, 54, 12);
    c.fill();
    c.fillStyle = INK;
    c.font = 'bold 30px monospace';
    c.textAlign = 'center';
    c.fillText(this.typed || '…', W / 2, 138);
    c.textAlign = 'left';
    const keys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const size = 58;
    const gap = 6;
    const x0 = (W - (6 * size + 5 * gap)) / 2;
    for (let i = 0; i < keys.length; i++) {
      const ch = keys[i];
      this.button(ch, x0 + (i % 6) * (size + gap), 196 + Math.floor(i / 6) * (size - 6 + gap), size, size - 6, () => {
        if (this.typed.length < 16) this.typed += ch;
        this.codeMessage = '';
      }, false, '#2d4a35', 26);
    }
    const y = 196 + 6 * (size - 6 + gap) + 4;
    this.button('Del', 40, y, 120, 50, () => (this.typed = this.typed.slice(0, -1)), false, '#6a3e22', 22);
    this.button('Clear', 168, y, 120, 50, () => (this.typed = ''), false, '#6a3e22', 22);
    this.button('Redeem', 296, y, 176, 50, () => {
      const result = this.hooks.admin.redeem(this.typed);
      this.codeMessage = result.message;
      if (result.ok) {
        this.typed = '';
        this.go('admin');
      }
    }, false, GREEN, 24);
    if (this.codeMessage) this.note(this.codeMessage, 180, 17);
    this.button('Back', 50, H - 64, W - 100, 44, () => this.go('main'), false, '#6a3e22', 22);
  }

  private drawAdmin(): void {
    this.title('Admin');
    let y = 112;
    const row = (label: string, act: () => void) => {
      this.button(label, 50, y, W - 100, 62, act, false, '#4a3b1a');
      y += 74;
    };
    row('Spawn items', () => this.go({ items: 0 }));
    row('Spawn animals', () => this.go('animals'));
    row('Build a structure', () => this.go('build'));
    row('Car (wood-cutting vehicle)', () => {
      this.hooks.admin.actions.vehicle();
      this.status = '';
    });
    row('Powers', () => this.go('powers'));
    this.button('Back', 50, H - 88, W - 100, 56, () => this.go('main'), false, '#6a3e22');
  }

  private drawItems(page: number): void {
    this.title('Spawn items');
    const per = 12;
    const items = ADMIN_ITEMS.slice(page * per, page * per + per);
    const w = (W - 100 - 10) / 2;
    items.forEach((item, i) => {
      this.button(item.label, 50 + (i % 2) * (w + 10), 108 + Math.floor(i / 2) * 68, w, 58, () => this.hooks.admin.actions.spawnItem(item, this.amount), false, '#2d4a35', 21);
    });
    const y = 108 + 6 * 68 + 6;
    this.button(`Amount: ${this.amount}`, 50, y, 160, 52, () => (this.amount = this.amount === 1 ? 5 : this.amount === 5 ? 10 : 1), false, '#4a3b1a', 20);
    if (page > 0) this.button('‹ Prev', 220, y, 120, 52, () => this.go({ items: page - 1 }), false, '#6a3e22', 20);
    if ((page + 1) * per < ADMIN_ITEMS.length) this.button('Next ›', 352, y, 110, 52, () => this.go({ items: page + 1 }), false, '#6a3e22', 20);
    this.button('Back', 50, H - 76, W - 100, 52, () => this.go('admin'), false, '#6a3e22');
  }

  private drawAnimals(): void {
    this.title('Spawn animals');
    let y = 118;
    for (const [label, species] of [['Rabbit', 'rabbit'], ['Deer', 'deer']] as const) {
      this.button(label, 50, y, W - 100, 62, () => {
        this.status = this.hooks.admin.actions.spawnAnimal(species) ? `${label} spawned` : 'Not available here';
      }, false, '#2d4a35');
      y += 74;
    }
    this.button('Campfire', 50, y, W - 100, 62, () => this.hooks.admin.actions.campfire(), false, '#8a4a1a');
    y += 74;
    if (this.status) this.note(this.status, y + 10, 22);
    this.button('Back', 50, H - 88, W - 100, 56, () => this.go('admin'), false, '#6a3e22');
  }

  private drawBuild(): void {
    this.title('Build a structure');
    const plans = this.hooks.admin.actions.buildable();
    const w = (W - 100 - 10) / 2;
    plans.forEach((p, i) => {
      this.button(p.name, 50 + (i % 2) * (w + 10), 108 + Math.floor(i / 2) * 68, w, 58, () => this.hooks.admin.actions.build(p.id), false, '#2d4a35', 19);
    });
    this.note('Appears finished, in front of you.', 108 + Math.ceil(plans.length / 2) * 68 + 14, 19);
    this.button('Back', 50, H - 88, W - 100, 56, () => this.go('admin'), false, '#6a3e22');
  }

  private drawPowers(): void {
    this.title('Powers');
    let y = 112;
    const row = (label: string, act: () => void) => {
      this.button(label, 50, y, W - 100, 60, act, false, '#4a3b1a');
      y += 70;
    };
    const a = this.hooks.admin.actions;
    row('Heal fully', () => a.heal());
    row('Unlock all recipes and plans', () => a.unlockAll());
    row('Make it day', () => a.setTime(0.45));
    row('Make it night', () => a.setTime(0.0));
    this.button('Back', 50, H - 88, W - 100, 56, () => this.go('admin'), false, '#6a3e22');
  }

  private drawMulti(net: ReturnType<PauseHooks['net']>): void {
    this.title('Multiplayer');
    const c = this.ctx;
    let y = 130;
    if (!net) {
      this.note('You are playing alone. To host or join a game, take the headset off and use Multiplayer on the main menu.', y, 22);
    } else {
      c.fillStyle = INK;
      c.font = 'bold 30px monospace';
      c.textAlign = 'center';
      c.fillText(net.role === 'host' ? `Code: ${net.code}` : `In ${net.code}'s game`, W / 2, y);
      c.textAlign = 'left';
      y += 44;
      c.font = '24px Georgia, serif';
      c.fillStyle = '#dfe8d4';
      for (const name of net.players) {
        c.fillText(`•  ${name}`, 90, y);
        y += 34;
      }
      y += 12;
      const label = net.mic === 'denied' ? 'Microphone blocked' : net.mic === 'off' ? 'Turn microphone on' : net.muted ? 'Muted: tap to unmute' : 'Microphone on: tap to mute';
      this.button(label, 50, y, W - 100, 62, () => this.hooks.toggleMic(), net.mic === 'on' && !net.muted);
    }
    this.button('Back', 50, H - 100, W - 100, 62, () => this.go('main'), false, '#6a3e22');
  }

  /** The current settings (for the readout). */
  get data(): SettingsData {
    return this.settings.data;
  }
}
