import * as THREE from 'three';
import type { Fire } from './fire';
import type { Side, Stick, Sticks } from './sticks';

export interface FrictionHooks {
  /** Something to tell the player (shown above the book). */
  onMessage?(text: string): void;
  /** A campfire was lit from a pile. */
  onCampfire?(sticksUsed: number): void;
  /** Sticks were rubbed hot but there was no pile to catch. */
  onSpark?(): void;
  /** Buzz a hand. */
  pulse?(side: Side, strength: number, ms: number): void;
}

/** How fast (m/s) two sticks must slide against each other for it to count as rubbing. */
const MIN_RUB_SPEED = 0.25;
/** Sticks this close (surface to surface, metres) are touching. */
const TOUCH_GAP = 0.014;
/** Heat gained per second at a good rubbing speed (so about 2.5 s of steady rubbing lights it). */
const HEAT_RATE = 0.42;
/** Heat lost per second when not rubbing. */
const COOL_RATE = 0.4;
/** Rubbing faster than this heats no faster. */
const MAX_SPEED_FACTOR = 1.5;

/** A pile is this many loose sticks lying together under the rubbing. */
export const PILE_MIN = 5;
/** Sticks within this distance (along the ground) of the rubbing count as part of the pile. */
const PILE_RADIUS = 0.7;
/** The rubbing must be no higher than this above the ground to light a pile. */
const PILE_REACH = 1.0;
/** How many sticks a campfire can use up at most. */
const PILE_MAX = 14;

const PARTICLE_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(aSize * (300.0 / max(-mv.z, 0.3)), 90.0);
  }
`;
const PARTICLE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    gl_FragColor = vec4(uColor, smoothstep(0.5, 0.0, d) * vAlpha);
  }
`;

/** A small fixed pool of soft round particles drawn in one call. */
class Particles {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly velocity: THREE.Vector3[] = [];
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private next = 0;

  constructor(
    private readonly count: number,
    color: number,
    additive: boolean,
    private readonly gravity: number,
    private readonly grow: number,
  ) {
    this.positions = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.alphas = new Float32Array(count);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count).fill(1);
    this.baseSize = new Float32Array(count);
    for (let i = 0; i < count; i++) this.velocity.push(new THREE.Vector3());
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    this.points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: PARTICLE_VERTEX,
        fragmentShader: PARTICLE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        fog: false,
        uniforms: { uColor: { value: new THREE.Color(color) } },
      }),
    );
    this.points.frustumCulled = false;
  }

  emit(at: THREE.Vector3, velocity: THREE.Vector3, life: number, size: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.positions.set([at.x, at.y, at.z], i * 3);
    this.velocity[i].copy(velocity);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
  }

  update(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.alphas[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const age = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const v = this.velocity[i];
      v.y += this.gravity * dt;
      this.positions[i * 3] += v.x * dt;
      this.positions[i * 3 + 1] += v.y * dt;
      this.positions[i * 3 + 2] += v.z * dt;
      this.sizes[i] = this.baseSize[i] * (1 + this.grow * age);
      this.alphas[i] = Math.max(0, 1 - age) * Math.min(1, age * 8 + 0.2);
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
    this.points.geometry.getAttribute('aSize').needsUpdate = true;
    this.points.geometry.getAttribute('aAlpha').needsUpdate = true;
  }
}

const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a0 = new THREE.Vector3();
const _a1 = new THREE.Vector3();
const _b0 = new THREE.Vector3();
const _b1 = new THREE.Vector3();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _r = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _axisA = new THREE.Vector3();
const _axisB = new THREE.Vector3();

/**
 * Closest points between segments p1-q1 and p2-q2, written to c1 and c2; returns the distance.
 * (The standard clamped solution for two line segments.)
 */
function closestSegments(
  p1: THREE.Vector3,
  q1: THREE.Vector3,
  p2: THREE.Vector3,
  q2: THREE.Vector3,
  c1: THREE.Vector3,
  c2: THREE.Vector3,
): number {
  const d1 = _axisA.subVectors(q1, p1);
  const d2 = _axisB.subVectors(q2, p2);
  const r = _r.subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  let s: number;
  let t: number;
  if (a < 1e-9 && e < 1e-9) {
    s = t = 0;
  } else if (a < 1e-9) {
    s = 0;
    t = clamp(f / e);
  } else {
    const c = d1.dot(r);
    if (e < 1e-9) {
      t = 0;
      s = clamp(-c / a);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > 1e-9 ? clamp((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a);
      }
    }
  }
  c1.copy(p1).addScaledVector(d1, s);
  c2.copy(p2).addScaledVector(d2, t);
  return c1.distanceTo(c2);
}

/**
 * Lighting a fire by rubbing sticks together.
 *
 * Hold two sticks together and rub them: the faster and steadier the rubbing, the hotter they get. You feel
 * it in your hands, see an ember glow at the rubbing point and then smoke and sparks. At full heat:
 *  - with a pile of sticks lying under it (5 or more within about 70 cm), the pile catches and becomes a
 *    campfire, a bigger one for a bigger pile;
 *  - without a pile you only get a small flame that burns for a few seconds.
 *
 * A pair counts as rubbing when they touch and slide along each other, and at least one is in a hand.
 */
export class FrictionFire {
  /** How hot the rubbed sticks are, 0 to 1. */
  heat = 0;
  /** True on frames when sticks are being rubbed. */
  rubbing = false;
  /** Where the rubbing is (valid while `rubbing`). */
  readonly contact = new THREE.Vector3();

  private readonly glow: THREE.Sprite;
  private readonly smoke: Particles;
  private readonly sparks: Particles;
  private smokeDebt = 0;
  private sparkDebt = 0;
  private buzz = 0;
  private cooldown = 0;
  private time = 0;

  constructor(
    scene: THREE.Scene,
    private readonly sticks: Sticks,
    private readonly fire: Fire,
    private readonly surfaceAt: (x: number, z: number) => number,
    private readonly hooks: FrictionHooks = {},
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const c = canvas.getContext('2d')!;
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,240,190,1)');
    g.addColorStop(0.3, 'rgba(255,150,50,0.8)');
    g.addColorStop(1, 'rgba(255,60,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
    );
    this.glow.visible = false;
    scene.add(this.glow);

    this.smoke = new Particles(40, 0xbfc4c0, false, 0.25, 2.2);
    this.sparks = new Particles(24, 0xffa040, true, -3.5, -0.4);
    scene.add(this.smoke.points, this.sparks.points);
  }

  update(dt: number): void {
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);

    const speed = this.findRub();
    this.rubbing = speed >= MIN_RUB_SPEED && this.cooldown === 0;

    if (this.rubbing) {
      const factor = Math.min(MAX_SPEED_FACTOR, (speed - MIN_RUB_SPEED + 0.2) / 0.8);
      this.heat = Math.min(1, this.heat + HEAT_RATE * factor * dt);
    } else {
      this.heat = Math.max(0, this.heat - COOL_RATE * dt);
    }

    // What you feel: a scraping rumble that grows as the sticks heat up.
    this.buzz -= dt;
    if (this.rubbing && this.buzz <= 0) {
      this.buzz = 0.07;
      this.buzzHands(0.12 + 0.55 * this.heat, 45);
    }

    // What you see: an ember glow, then smoke, then sparks.
    if (this.heat > 0.04) {
      this.glow.visible = true;
      this.glow.position.copy(this.contact);
      this.glow.scale.setScalar(0.03 + 0.16 * this.heat + 0.012 * Math.sin(this.time * 30));
      (this.glow.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.25 + this.heat);
    } else {
      this.glow.visible = false;
    }
    if (this.rubbing) {
      if (this.heat > 0.3) this.smokeDebt += (3 + 22 * this.heat) * dt;
      if (this.heat > 0.15) this.sparkDebt += (4 + 16 * this.heat) * dt;
    }
    for (; this.smokeDebt >= 1; this.smokeDebt--) {
      _vel.set((Math.random() - 0.5) * 0.15, 0.25 + Math.random() * 0.25, (Math.random() - 0.5) * 0.15);
      this.smoke.emit(this.contact, _vel, 1.6 + Math.random(), 0.05 + Math.random() * 0.04);
    }
    for (; this.sparkDebt >= 1; this.sparkDebt--) {
      _vel.set((Math.random() - 0.5) * 1.6, 0.5 + Math.random() * 1.2, (Math.random() - 0.5) * 1.6);
      this.sparks.emit(this.contact, _vel, 0.35 + Math.random() * 0.35, 0.025 + Math.random() * 0.02);
    }
    this.smoke.update(dt);
    this.sparks.update(dt);

    if (this.heat >= 1) this.ignite();
  }

  /**
   * Finds the fastest-rubbing pair of touching sticks (at least one in a hand), stores where they touch in
   * `contact`, and returns how fast they slide along each other (m/s), or 0 if none are rubbing.
   */
  private findRub(): number {
    let best = 0;
    for (const a of this.sticks.list) {
      if (a.heldBy === null || a.hidden) continue;
      this.ends(a, _a0, _a1);
      for (const b of this.sticks.list) {
        if (b === a || b.hidden || (b.heldBy !== null && b.id < a.id && a.heldBy !== null)) continue; // each held pair once
        if (a.pos.distanceToSquared(b.pos) > (a.length + b.length) ** 2 * 0.25 + 0.2) continue;
        this.ends(b, _b0, _b1);
        const gap = closestSegments(_a0, _a1, _b0, _b1, _c1, _c2) - a.radius - b.radius;
        if (gap > TOUCH_GAP) continue;

        // How fast does each stick's skin move at the touching point, relative to the other?
        this.pointVelocity(a, _c1, _va);
        this.pointVelocity(b, _c2, _vb);
        _vel.subVectors(_va, _vb);
        const sep = _c1.distanceTo(_c2);
        if (sep > 1e-4) _n.subVectors(_c1, _c2).divideScalar(sep);
        else _n.crossVectors(_axisA, _axisB).normalize();
        _vel.addScaledVector(_n, -_vel.dot(_n)); // sliding only: motion into or away from each other isn't rubbing
        const slide = _vel.length();
        if (slide > best) {
          best = slide;
          this.contact.addVectors(_c1, _c2).multiplyScalar(0.5);
        }
      }
    }
    return best;
  }

  private ends(s: Stick, p0: THREE.Vector3, p1: THREE.Vector3): void {
    const half = _r.set(0, s.length / 2, 0).applyQuaternion(s.quat);
    p0.copy(s.pos).sub(half);
    p1.copy(s.pos).add(half);
  }

  private pointVelocity(s: Stick, at: THREE.Vector3, out: THREE.Vector3): void {
    const v = s.body.linvel();
    const w = s.body.angvel();
    _r.subVectors(at, s.pos);
    out.set(v.x + (w.y * _r.z - w.z * _r.y), v.y + (w.z * _r.x - w.x * _r.z), v.z + (w.x * _r.y - w.y * _r.x));
  }

  private buzzHands(strength: number, ms: number): void {
    for (const stick of this.sticks.list) if (stick.heldBy !== null) this.hooks.pulse?.(stick.heldBy, strength, ms);
  }

  /** The sticks are hot enough to light something. */
  private ignite(): void {
    this.heat = 0;
    this.cooldown = 2;
    const at = this.contact.clone();
    const ground = this.surfaceAt(at.x, at.z);

    // The pile: loose sticks lying together near the ground under the rubbing.
    const pile: Stick[] = [];
    if (at.y - ground < PILE_REACH) {
      for (const s of this.sticks.list) {
        if (s.kind !== 'stick' || s.hidden || s.heldBy !== null) continue;
        if (Math.hypot(s.pos.x - at.x, s.pos.z - at.z) > PILE_RADIUS || Math.abs(s.pos.y - ground) > 0.6) continue;
        pile.push(s);
      }
    }

    if (pile.length >= PILE_MIN) {
      pile.sort((p, q) => Math.hypot(p.pos.x - at.x, p.pos.z - at.z) - Math.hypot(q.pos.x - at.x, q.pos.z - at.z));
      const used = pile.slice(0, PILE_MAX);
      let cx = 0;
      let cz = 0;
      for (const s of used) {
        cx += s.pos.x;
        cz += s.pos.z;
        this.sticks.stash(s); // they burn
      }
      cx = cx / used.length;
      cz = cz / used.length;
      this.fire.addCampfire(cx, cz, Math.min(1.5, 0.8 + 0.05 * used.length));
      this.hooks.onCampfire?.(used.length);
      this.hooks.onMessage?.('The pile catches. Campfire lit!');
      this.buzzHands(1, 160);
      this.burst(at, 18);
    } else {
      this.fire.addTinder(at.clone().setY(Math.max(at.y, ground + 0.05)), 10, 0.7);
      this.hooks.onSpark?.();
      this.hooks.onMessage?.(
        pile.length > 0
          ? `A spark! A pile needs ${PILE_MIN} sticks (${pile.length} here).`
          : `A spark! Pile up ${PILE_MIN} sticks and rub over them.`,
      );
      this.buzzHands(0.7, 100);
      this.burst(at, 8);
    }
  }

  private burst(at: THREE.Vector3, n: number): void {
    for (let i = 0; i < n; i++) {
      _vel.set((Math.random() - 0.5) * 2.4, 0.8 + Math.random() * 1.6, (Math.random() - 0.5) * 2.4);
      this.sparks.emit(at, _vel, 0.5 + Math.random() * 0.5, 0.03 + Math.random() * 0.03);
    }
  }
}
