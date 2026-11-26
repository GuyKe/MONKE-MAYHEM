import * as THREE from 'three';
import type { Engine } from './engine';
import { Grabbables, makeItem, type Item } from './grab';
import { box, cyl, mat, part, sphere } from './shapes';

export interface ItemContext {
  e: Engine;
  grab: Grabbables;
  /** A sound the monsters can hear: where, how far it carries. */
  noise(pos: THREE.Vector3, radius: number, kind: string): void;
  /** The monsters, for the radar. */
  monsters(): Array<{ pos: THREE.Vector3; kind: string }>;
  floorAt(x: number, y: number, z: number): number;
  /** A data log was read. */
  readLog?(id: number): void;
}

export const GLOW_COLORS = [0x40ff60, 0xff3a3a, 0x40a0ff, 0xffd030, 0xff40e0];

/** A glowstick: snap it and it glows. Throw it down a dark corridor to see, or to lure. */
export function makeGlowstick(ctx: ItemContext, at: THREE.Vector3, colorIndex = 0): Item {
  const color = GLOW_COLORS[colorIndex % GLOW_COLORS.length];
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 10), new THREE.MeshBasicMaterial({ color, fog: false }));
  tube.rotation.z = Math.PI / 2;
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  g.add(tube, halo);
  part(g, cyl, 0x303030, [0.085, 0, 0], [0.016, 0.01, 0.016], [0, 0, Math.PI / 2]);
  part(g, cyl, 0x303030, [-0.085, 0, 0], [0.016, 0.01, 0.016], [0, 0, Math.PI / 2]);
  g.position.copy(at);
  ctx.e.scene.add(g);
  const item = makeItem(g, 'glow', 0.1, {
    rest: 0.02,
    holdOffset: new THREE.Vector3(0, 0, -0.05),
    onImpact: (it, speed) => ctx.noise(it.obj.position, 3 + speed, 'glowstick'),
    onGrab: () => ctx.e.audio.play('glow', g.position, 0.8),
    onDrop: (it) => {
      if (it.vel.length() > 4) ctx.noise(it.obj.position, 5, 'throw');
    },
  });
  item.data.color = color;
  item.data.lit = false;
  ctx.grab.add(item);
  return item;
}

/** A flashlight: squeeze to carry it, pull the trigger to switch it. */
export function makeFlashlight(ctx: ItemContext, at: THREE.Vector3): Item {
  const g = new THREE.Group();
  part(g, cyl, 0x2a2c32, [0, 0, -0.04], [0.026, 0.16, 0.026], [Math.PI / 2, 0, 0], 0, 0.4, 0.6);
  part(g, cyl, 0x1a1c20, [0, 0, -0.14], [0.04, 0.05, 0.04], [Math.PI / 2, 0, 0], 0, 0.4, 0.6);
  part(g, cyl, 0xffffff, [0, 0, -0.17], [0.034, 0.004, 0.034], [Math.PI / 2, 0, 0], 0xfff4c0);
  part(g, box, 0xe0b020, [0, 0.02, 0.0], [0.012, 0.01, 0.04]);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.28, 2.4, 18, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -1.4), new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
  beam.visible = false;
  g.add(beam);
  g.position.copy(at);
  ctx.e.scene.add(g);
  let wasDown = false;
  const item = makeItem(g, 'torch', 0.12, {
    rest: 0.03,
    onHeld: (it, _hand, trigger) => {
      if (trigger && !wasDown) {
        it.data.on = !it.data.on;
        ctx.e.audio.play('torch', g.position, 0.8);
      }
      wasDown = trigger;
    },
    tick: (it) => {
      beam.visible = it.data.on === true;
    },
    onImpact: (it, speed) => ctx.noise(it.obj.position, 2 + speed * 1.4, 'flashlight'),
  });
  item.data.on = false;
  ctx.grab.add(item);
  return item;
}

/** A radar pinger: squeeze it, pull the trigger, and it sends a pulse and shows what came back. The pulse can be heard. */
export function makeRadar(ctx: ItemContext, at: THREE.Vector3): Item {
  const g = new THREE.Group();
  part(g, box, 0x30343c, [0, 0, -0.05], [0.1, 0.03, 0.17], [0, 0, 0], 0, 0.4, 0.5);
  part(g, cyl, 0x1a1c20, [0, 0.0, 0.05], [0.025, 0.07, 0.025], [Math.PI / 2, 0, 0]);
  part(g, cyl, 0x40e0ff, [0, 0.0, 0.1], [0.012, 0.02, 0.012], [Math.PI / 2, 0, 0], 0x20a0d0);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.rotation.x = -Math.PI / 2;
  screen.position.set(0, 0.0165, -0.05);
  g.add(screen);
  g.position.copy(at);
  ctx.e.scene.add(g);
  const RANGE = 30;
  let ping = -1;
  let cooldown = 0;
  let wasDown = false;
  const blips: Array<{ x: number; z: number; age: number; kind: string; shown: boolean }> = [];
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const draw = (): void => {
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#041208';
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = '#106a30';
    c.lineWidth = 2;
    for (const r of [40, 80, 120]) {
      c.beginPath();
      c.arc(128, 128, r, 0, Math.PI * 2);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(128, 8);
    c.lineTo(128, 248);
    c.moveTo(8, 128);
    c.lineTo(248, 128);
    c.stroke();
    if (ping >= 0) {
      c.strokeStyle = `rgba(80,255,140,${Math.max(0, 1 - ping / 1.4)})`;
      c.lineWidth = 4;
      c.beginPath();
      c.arc(128, 128, (ping / 1.4) * 120, 0, Math.PI * 2);
      c.stroke();
    }
    for (const b of blips) {
      const a = Math.max(0, 1 - b.age / 3.5);
      c.fillStyle = `rgba(255,60,60,${a})`;
      c.beginPath();
      c.arc(128 + b.x * (120 / RANGE), 128 + b.z * (120 / RANGE), 8, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#40ff90';
    c.beginPath();
    c.arc(128, 128, 5, 0, Math.PI * 2);
    c.fill();
    tex.needsUpdate = true;
  };
  draw();
  const item = makeItem(g, 'radar', 0.12, {
    rest: 0.03,
    holdQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, 0, 0)),
    onHeld: (it, hand, trigger, dt) => {
      cooldown -= dt;
      if (trigger && !wasDown && cooldown <= 0) {
        cooldown = 4;
        ping = 0;
        blips.length = 0;
        ctx.e.audio.play('ping', g.position, 1);
        ctx.noise(g.position, 16, 'radar');
        ctx.e.buzz(hand, 0.6, 120);
        // Blips are what the pulse finds, drawn relative to where you face.
        const yaw = Math.atan2(-_p.set(0, 0, -1).applyQuaternion(ctx.e.headQuat).x, -_p.z);
        for (const m of ctx.monsters()) {
          const dx = m.pos.x - ctx.e.head.x;
          const dz = m.pos.z - ctx.e.head.z;
          if (Math.hypot(dx, dz) > RANGE || Math.abs(m.pos.y - ctx.e.feet.y) > 12) continue;
          // Rotate into the player's frame so up is the way you look.
          const c = Math.cos(-yaw);
          const s = Math.sin(-yaw);
          blips.push({ x: dx * c - dz * s, z: dx * s + dz * c, age: -Math.hypot(dx, dz) / RANGE * 1.4, kind: m.kind, shown: false });
        }
      }
      wasDown = trigger;
      void it;
      _q.identity();
    },
    tick: (_it, dt) => {
      if (ping >= 0) {
        ping += dt;
        if (ping > 1.6) ping = -1;
      }
      for (const b of blips) {
        b.age += dt;
        if (!b.shown && b.age >= 0) {
          b.shown = true;
          ctx.e.audio.play('blip', g.position, 0.6);
          const d = Math.hypot(b.x, b.z);
          const h = ctx.grab.heldBy(0) === item ? 0 : ctx.grab.heldBy(1) === item ? 1 : -1;
          if (h !== -1) ctx.e.buzz(h as 0 | 1, 0.25 + 0.6 * Math.max(0, 1 - d / RANGE), 80);
        }
      }
      if (ping >= 0 || blips.length) draw();
      while (blips.length && blips[0].age > 3.6) blips.shift();
    },
    onImpact: (it, speed) => ctx.noise(it.obj.position, 2 + speed, 'radar drop'),
  });
  ctx.grab.add(item);
  return item;
}

/** A data log: a little tablet. Hold it for a moment and it plays what is on it. */
export function makeLog(ctx: ItemContext, at: THREE.Vector3, id: number): Item {
  const g = new THREE.Group();
  part(g, box, 0x1a1e24, [0, 0, 0], [0.1, 0.008, 0.14], [0, 0, 0], 0, 0.3, 0.6);
  const screen = part(g, box, 0x40ffa0, [0, 0.006, 0], [0.085, 0.003, 0.12], [0, 0, 0], 0x20c070);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0x40ffa0, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  g.add(halo);
  g.position.copy(at);
  ctx.e.scene.add(g);
  let held = 0;
  const item = makeItem(g, 'log', 0.1, {
    rest: 0.02,
    gravity: 0,
    holdQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 0, 0)),
    onGrab: (it) => {
      it.gravity = 9.8;
      held = 0;
    },
    onHeld: (it, _h, _t, dt) => {
      held += dt;
      if (held > 0.9 && it.data.read !== true) {
        it.data.read = true;
        ctx.readLog?.(id);
      }
    },
    tick: () => {
      (screen.material as THREE.MeshStandardMaterial).emissiveIntensity = 1 + 0.5 * Math.sin(performance.now() / 300 + id);
    },
  });
  item.data.id = id;
  ctx.grab.add(item);
  return item;
}

/** A rack on the wall that gives out gear: it fills its slot again after you take something. */
export class Rack {
  private item: Item | null = null;
  private timer = 0;

  constructor(
    ctx: ItemContext,
    readonly at: THREE.Vector3,
    private readonly make: () => Item,
  ) {
    void ctx;
    this.item = this.fresh();
  }

  /** A new item on the rack: it hangs there until taken. */
  private fresh(): Item {
    const it = this.make();
    it.gravity = 0;
    const og = it.onGrab;
    it.onGrab = (i, h) => {
      i.gravity = 9.8;
      og?.(i, h);
    };
    return it;
  }

  update(dt: number): void {
    if (this.item && (this.item.held !== -1 || this.item.obj.position.distanceTo(this.at) > 0.6)) {
      this.item = null;
      this.timer = 1.2;
    }
    if (!this.item) {
      this.timer -= dt;
      if (this.timer <= 0) this.item = this.fresh();
    }
  }
}

export const _itemParts = { mat, sphere };
