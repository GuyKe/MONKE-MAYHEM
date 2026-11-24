import * as THREE from 'three';
import { smoothstep } from './noise';

export type Phase = 'night' | 'dawn' | 'day' | 'dusk';

export interface AtmosphereOptions {
  /** Time of day to start at, 0-1 (0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset). */
  startTime?: number;
  /** Real seconds for one full day. */
  cycleSeconds?: number;
}

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uMoonDir;
  uniform float uNight;
  uniform float uTime;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    float h = max(vDir.y, 0.0);
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.35, h));
    col = mix(col, uZenith, smoothstep(0.35, 1.0, h));

    // Sun: a bright disc and a wide glow.
    float s = max(dot(vDir, uSunDir), 0.0);
    col += uSunColor * (pow(s, 1200.0) * 3.0 + pow(s, 10.0) * 0.35);

    // Moon and stars, only at night.
    float m = max(dot(vDir, uMoonDir), 0.0);
    col += (vec3(0.85, 0.9, 1.0) * pow(m, 3500.0) * 2.0 + vec3(0.08, 0.1, 0.18) * pow(m, 40.0)) * uNight;
    vec3 cell = floor(vDir * 200.0);
    float r = hash(cell);
    float star = step(0.9965, r) * smoothstep(0.02, 0.25, vDir.y) * uNight;
    col += vec3(star * (0.55 + 0.45 * sin(uTime * 2.5 + r * 60.0)));

    gl_FragColor = vec4(col, 1.0);
  }
`;

const MOTE_VERTEX = /* glsl */ `
  attribute float aPhase;
  uniform vec3 uViewer;
  uniform float uTime;
  uniform float uSize;
  uniform float uBox;
  uniform float uPulse;
  varying float vAlpha;
  void main() {
    // Each mote drifts slowly and wraps around the viewer, so the air stays full wherever you go.
    vec3 drift = vec3(sin(uTime * 0.31 + aPhase * 6.28), sin(uTime * 0.43 + aPhase * 9.0) * 0.6, cos(uTime * 0.27 + aPhase * 5.0)) * 1.4;
    vec3 p = position + drift;
    // Wrap sideways only; height follows the viewer so the air is full on hills too.
    vec2 wrapped = uViewer.xz + mod(p.xz - uViewer.xz + uBox * 0.5, uBox) - uBox * 0.5;
    vec3 world = vec3(wrapped.x, uViewer.y - 2.0 + p.y, wrapped.y);
    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(uSize * (300.0 / max(-mv.z, 0.5)), 26.0 * uSize);
    float fade = 1.0 - smoothstep(uBox * 0.3, uBox * 0.5, length(world - uViewer));
    float blink = mix(1.0, 0.35 + 0.65 * sin(uTime * 1.7 + aPhase * 40.0) * 0.5 + 0.325, uPulse);
    vAlpha = fade * blink;
  }
`;

const MOTE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, a * vAlpha * uOpacity);
  }
`;

const NIGHT = { zenith: 0x050a1c, mid: 0x0a1230, horizon: 0x141c34 };
const DAY = { zenith: 0x4f8fcf, mid: 0x9cc7e0, horizon: 0xcfe3d8 };
const TWILIGHT = { zenith: 0x2c3566, mid: 0x9a5f6a, horizon: 0xf0a070 };

const _a = new THREE.Color();
const _b = new THREE.Color();

/**
 * The sky and everything that changes through the day: a sun and moon crossing the sky,
 * stars, colours that shift through dawn and dusk, fog that thickens at night and at dawn,
 * and drifting dust by day and fireflies by night.
 */
export class Atmosphere {
  /** Sky dome. Parent it to the player rig so it always surrounds the player. */
  readonly sky: THREE.Mesh;
  /** Time of day, 0-1 (0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset). */
  time: number;
  cycleSeconds: number;
  /** Whole days that have passed since the start. */
  day = 1;
  /** Multiplies how thick the fog is (a setting). */
  fogScale = 1;
  /** Drifting dust and fireflies (off with Reduce motion). */
  motes = true;
  /** When set, the sun stays where it is at this time of day. */
  frozenAt: number | null = null;

  /** 0 in full daylight, 1 in full night. */
  night = 0;
  /** Direction toward the sun. */
  readonly sunDir = new THREE.Vector3(0, 1, 0);

  private readonly fog: THREE.FogExp2;
  private readonly background = new THREE.Color();
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly moon: THREE.DirectionalLight;
  private readonly skyMaterial: THREE.ShaderMaterial;
  private readonly dust: THREE.Points;
  private readonly fireflies: THREE.Points;
  private elapsed = 0;

  constructor(scene: THREE.Scene, options: AtmosphereOptions = {}) {
    this.time = options.startTime ?? 0.3;
    this.cycleSeconds = options.cycleSeconds ?? 600;

    this.fog = new THREE.FogExp2(0xcfe3d8, 0.026);
    scene.fog = this.fog;
    scene.background = this.background;
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a5a32, 1.5);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.moon = new THREE.DirectionalLight(0x6a7fb8, 0);
    scene.add(this.hemi, this.sun, this.moon);

    this.skyMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uMid: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 0.9, 0.7) },
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uNight: { value: 0 },
        uTime: { value: 0 },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), this.skyMaterial);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;

    this.dust = makeMotes(260, 0.7, new THREE.Color(0xe8f0d8), 0);
    this.fireflies = makeMotes(160, 0.9, new THREE.Color(0xc8ff5a), 1);
    scene.add(this.dust, this.fireflies);

    this.update(0, new THREE.Vector3());
  }

  get phase(): Phase {
    const e = this.sunDir.y;
    if (e < -0.12) return 'night';
    if (e < 0.18) return this.time < 0.5 ? 'dawn' : 'dusk';
    return 'day';
  }

  /** 24-hour clock text, for example "07:30". */
  get clock(): string {
    const minutes = Math.floor(this.time * 24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  /** Advances the day and updates the sky, light and fog. `viewer` is the player's head position. */
  update(dt: number, viewer: THREE.Vector3): void {
    this.elapsed += dt;
    if (this.frozenAt !== null) this.time = this.frozenAt;
    else this.time += dt / this.cycleSeconds;
    while (this.time >= 1) {
      this.time -= 1;
      this.day++;
    }

    const angle = (this.time - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(angle) * 0.3, Math.sin(angle), Math.cos(angle) * 0.95).normalize();
    const e = this.sunDir.y;

    // How much of the day it is, and how close to dawn or dusk.
    const daylight = smoothstep(-0.08, 0.28, e);
    this.night = 1 - smoothstep(-0.22, 0.02, e);
    const twilight = Math.max(0, 1 - Math.abs(e - 0.02) / 0.3) * (1 - 0.35 * daylight);

    const zenith = this.mix(NIGHT.zenith, DAY.zenith, daylight, TWILIGHT.zenith, twilight * 0.6);
    const mid = this.mix(NIGHT.mid, DAY.mid, daylight, TWILIGHT.mid, twilight * 0.8);
    const horizon = this.mix(NIGHT.horizon, DAY.horizon, daylight, TWILIGHT.horizon, twilight * 0.9);

    const u = this.skyMaterial.uniforms;
    (u.uZenith.value as THREE.Color).copy(zenith);
    (u.uMid.value as THREE.Color).copy(mid);
    (u.uHorizon.value as THREE.Color).copy(horizon);
    (u.uSunDir.value as THREE.Vector3).copy(this.sunDir);
    (u.uMoonDir.value as THREE.Vector3).copy(this.sunDir).negate();
    (u.uSunColor.value as THREE.Color).setRGB(1, 0.78 + 0.18 * daylight, 0.55 + 0.4 * daylight).multiplyScalar(smoothstep(-0.12, 0.05, e));
    u.uNight.value = this.night;
    u.uTime.value = this.elapsed;

    // Fog takes the colour of the horizon, and is heaviest at night and in the morning mist.
    const morning = smoothstep(0.17, 0.25, this.time) * (1 - smoothstep(0.25, 0.36, this.time));
    this.fog.color.copy(horizon).multiplyScalar(0.92);
    this.fog.density = (0.026 + 0.012 * this.night + 0.004 * twilight + 0.012 * morning) * this.fogScale;
    this.background.copy(this.fog.color);

    // Light: warm sun by day, cool moon and a dim blue sky by night.
    this.hemi.color.copy(this.mix(0x1a2650, 0xcfe8ff, daylight, 0xd09a80, twilight * 0.4));
    this.hemi.groundColor.copy(_a.set(0x0b1019).lerp(_b.set(0x4a5a32), daylight));
    this.hemi.intensity = 0.7 + 0.8 * daylight;
    this.sun.color.setRGB(1, 0.72 + 0.26 * daylight, 0.5 + 0.42 * daylight);
    this.sun.intensity = 2.2 * smoothstep(-0.05, 0.3, e);
    this.sun.position.copy(this.sunDir).multiplyScalar(100);
    this.moon.intensity = 0.55 * this.night;
    this.moon.position.copy(this.sunDir).multiplyScalar(-100);

    // Air: dust in daylight, fireflies at night.
    for (const [points, opacity] of [
      [this.dust, 0.45 * daylight],
      [this.fireflies, this.night],
    ] as const) {
      const m = points.material as THREE.ShaderMaterial;
      m.uniforms.uViewer.value.copy(viewer);
      m.uniforms.uTime.value = this.elapsed;
      m.uniforms.uOpacity.value = opacity;
      points.visible = this.motes && opacity > 0.01;
    }
  }

  /** Blend night -> day by `t`, then toward a twilight tint by `tw`. */
  private mix(night: number, day: number, t: number, twilight: number, tw: number): THREE.Color {
    _a.set(night).lerp(_b.set(day), t).lerp(_b.set(twilight), tw);
    return _a.clone();
  }
}

function makeMotes(count: number, size: number, color: THREE.Color, pulse: number): THREE.Points {
  const BOX = 30;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = Math.random() * BOX;
    positions[i * 3 + 1] = Math.random() * 9 - 1; // from ground level up to about head height and beyond
    positions[i * 3 + 2] = Math.random() * BOX;
    phases[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: MOTE_VERTEX,
    fragmentShader: MOTE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: {
      uViewer: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uSize: { value: size },
      uBox: { value: BOX },
      uPulse: { value: pulse },
      uColor: { value: color },
      uOpacity: { value: 0 },
    },
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}
