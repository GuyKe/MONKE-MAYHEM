import * as THREE from 'three';

/** Every sound the game makes, for tests and for calling from other systems. */
export type SoundName =
  | 'click' | 'whoosh' | 'chop' | 'smash' | 'creak' | 'crash' | 'rope' | 'splash' | 'snap' | 'thud' | 'hurt' | 'die'
  | 'scrape' | 'eat' | 'chime' | 'page' | 'squelch' | 'unlock' | 'build' | 'break' | 'bird' | 'owl' | 'ignite';

export interface AmbientState {
  /** 0 by day, 1 at night. */
  night: number;
  /** Metres to the edge of the nearest lake (negative inside). */
  lakeDistance: number;
  /** Nearest campfire distance, or Infinity. */
  fireDistance: number;
  /** 0 to 1: sticks rubbed together. */
  rub: number;
  inWater: boolean;
  underwater: boolean;
  /** Metres per second the body is swimming at (0 when not). */
  swimSpeed: number;
  /** Flying fast through the air. */
  airSpeed: number;
  /** Closest hunting crocodile, metres, or Infinity. */
  crocDistance: number;
}

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();

/**
 * Sound, made on the spot with Web Audio (there are no audio files). One-shot sounds are short bursts of filtered noise
 * and tones, placed in 3D where they happen; the forest's own sound (wind, birds by day, crickets by night, lapping
 * water, a crackling fire) runs continuously and follows what is near you. Starts when you press Play, since browsers
 * only allow sound after a click.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private filter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private volume = 0.8;
  private wind!: GainNode;
  private water!: GainNode;
  private crickets!: GainNode;
  private rubGain!: GainNode;
  private paddle = 0;
  private birdTimer = 3;
  private fireTimer = 0;
  private wasInWater = false;
  private windTime = 0;
  /** Sounds played so far, for tests. */
  readonly log: string[] = [];

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Call from a click (Play). Safe to call again. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 22000;
    this.filter.connect(this.master);
    this.master.connect(ctx.destination);
    // A couple of seconds of white noise, reused for everything.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.wind = this.loop('bandpass', 380, 0.6);
    this.water = this.loop('bandpass', 1100, 0.9);
    this.crickets = this.loop('highpass', 6500, 4);
    this.rubGain = this.loop('bandpass', 2400, 3);
    void ctx.resume();
  }

  /** The audio context once sound has started (null before the first click). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Plays another player's voice from a place in the world (move it with `setPosition` as they move). `level()` is how loud
   * they are speaking right now, 0 to 1.
   */
  attachStream(stream: MediaStream): { setPosition(p: THREE.Vector3): void; level(): number; dispose(): void } | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    // Some browsers only let a remote stream flow if it is also attached to a (silent) element.
    const el = document.createElement('audio');
    el.srcObject = stream;
    el.muted = true;
    void el.play().catch(() => undefined);
    const src = ctx.createMediaStreamSource(stream);
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 2;
    panner.rolloffFactor = 1.1;
    panner.maxDistance = 120;
    const gain = ctx.createGain();
    gain.gain.value = 1.6;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const buf = new Uint8Array(analyser.fftSize);
    src.connect(analyser);
    src.connect(panner);
    panner.connect(gain).connect(this.filter);
    return {
      setPosition: (p) => {
        if (panner.positionX) {
          panner.positionX.value = p.x;
          panner.positionY.value = p.y;
          panner.positionZ.value = p.z;
        }
      },
      level: () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        return Math.min(1, peak / 40);
      },
      dispose: () => {
        src.disconnect();
        panner.disconnect();
        el.srcObject = null;
      },
    };
  }

  /** The listener is your head. */
  listen(head: THREE.Vector3, quat: THREE.Quaternion): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    _fwd.set(0, 0, -1).applyQuaternion(quat);
    _up.set(0, 1, 0).applyQuaternion(quat);
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setValueAtTime(head.x, t);
      l.positionY.setValueAtTime(head.y, t);
      l.positionZ.setValueAtTime(head.z, t);
      l.forwardX.setValueAtTime(_fwd.x, t);
      l.forwardY.setValueAtTime(_fwd.y, t);
      l.forwardZ.setValueAtTime(_fwd.z, t);
      l.upX.setValueAtTime(_up.x, t);
      l.upY.setValueAtTime(_up.y, t);
      l.upZ.setValueAtTime(_up.z, t);
    }
  }

  // --- Building blocks -----------------------------------------------------------------

  /** A looping noise voice through a filter, silent until something sets its gain. */
  private loop(type: BiquadFilterType, freq: number, q: number): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.filter);
    src.start(0, Math.random() * 1.5);
    return g;
  }

  /** Where a sound comes out: at a point in the world, or straight to your ears. */
  private out(at?: THREE.Vector3): AudioNode {
    if (!at || !this.ctx) return this.filter;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1.2;
    p.rolloffFactor = 1.4;
    p.maxDistance = 80;
    if (p.positionX) {
      p.positionX.value = at.x;
      p.positionY.value = at.y;
      p.positionZ.value = at.z;
    }
    p.connect(this.filter);
    return p;
  }

  private hit(name: string): boolean {
    this.log.push(name);
    if (this.log.length > 200) this.log.shift();
    return this.ctx !== null;
  }

  /** A burst of noise. `f0` to `f1` sweeps the filter. */
  private burst(at: THREE.Vector3 | undefined, dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, vol: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out(at));
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  /** A pitched note that glides from `f0` to `f1`. */
  private tone(at: THREE.Vector3 | undefined, dur: number, type: OscillatorType, f0: number, f1: number, vol: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out(at));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // --- One-shot sounds --------------------------------------------------------------------

  /** A hand landing on a surface. `strength` is 0 to 1. */
  slap(surface: string, strength: number, at: THREE.Vector3): void {
    if (!this.hit(`slap:${surface}`)) return;
    const v = 0.12 + 0.5 * Math.min(1, strength);
    switch (surface) {
      case 'stone': this.burst(at, 0.09, 'bandpass', 2600, 1800, 3, v); this.tone(at, 0.06, 'triangle', 900, 500, v * 0.3); break;
      case 'ice': this.burst(at, 0.14, 'highpass', 4200, 3000, 1.5, v * 0.8); this.tone(at, 0.1, 'sine', 2400, 1800, v * 0.2); break;
      case 'mud': this.burst(at, 0.16, 'lowpass', 500, 160, 1, v * 1.1); break;
      case 'wood': this.tone(at, 0.09, 'triangle', 260, 170, v * 0.7); this.burst(at, 0.05, 'bandpass', 1400, 900, 2, v * 0.4); break;
      case 'bark': this.burst(at, 0.08, 'bandpass', 700, 400, 1.4, v); this.tone(at, 0.07, 'sine', 140, 90, v * 0.5); break;
      default: this.burst(at, 0.1, 'lowpass', 900, 250, 0.8, v); break; // dirt and moss
    }
  }

  play(name: SoundName, at?: THREE.Vector3, strength = 1): void {
    if (!this.hit(name)) return;
    const v = Math.max(0.05, Math.min(1, strength));
    switch (name) {
      case 'click': this.tone(at, 0.04, 'square', 1200, 700, 0.07 * v); break;
      case 'whoosh': this.burst(at, 0.28, 'bandpass', 500, 2600, 0.8, 0.3 * v); break;
      case 'chop': this.burst(at, 0.1, 'lowpass', 1800, 300, 1, 0.8); this.tone(at, 0.12, 'triangle', 190, 80, 0.55); this.burst(at, 0.05, 'highpass', 3500, 3500, 1, 0.25, 0.01); break;
      case 'smash': this.burst(at, 0.07, 'bandpass', 3200, 2000, 4, 0.7); this.tone(at, 0.05, 'square', 1800, 900, 0.1); this.burst(at, 0.06, 'highpass', 5000, 5000, 1, 0.3, 0.03); break;
      case 'creak': this.tone(at, 1.1, 'sawtooth', 90, 150, 0.12); this.tone(at, 1.1, 'sawtooth', 134, 80, 0.08, 0.1); this.burst(at, 1.0, 'bandpass', 300, 700, 5, 0.18); break;
      case 'crash':
        this.burst(at, 0.9, 'lowpass', 2200, 120, 0.7, 1);
        this.tone(at, 0.7, 'sine', 70, 28, 0.9);
        for (let i = 0; i < 6; i++) this.burst(at, 0.12, 'bandpass', 1500 + Math.random() * 1500, 800, 2, 0.4, 0.05 + i * 0.07 + Math.random() * 0.05);
        break;
      case 'rope': this.burst(at, 0.35, 'bandpass', 1800, 900, 1.2, 0.35); this.burst(at, 0.2, 'highpass', 4000, 2500, 1, 0.2, 0.15); break;
      case 'splash': this.burst(at, 0.5, 'bandpass', 1600, 500, 0.7, 0.9 * v); this.burst(at, 0.35, 'highpass', 3000, 1500, 0.7, 0.4 * v, 0.05); this.tone(at, 0.2, 'sine', 180, 60, 0.3 * v); break;
      case 'snap': this.burst(at, 0.12, 'bandpass', 2800, 1200, 5, 0.9); this.tone(at, 0.15, 'sawtooth', 220, 70, 0.4); break;
      case 'thud': this.tone(at, 0.12, 'sine', 120, 50, 0.7 * v); this.burst(at, 0.06, 'lowpass', 800, 200, 1, 0.5 * v); break;
      case 'hurt': this.tone(undefined, 0.3, 'sawtooth', 240, 110, 0.35); this.burst(undefined, 0.2, 'lowpass', 1200, 300, 1, 0.4); break;
      case 'die': this.tone(undefined, 1.4, 'sawtooth', 200, 40, 0.4); this.burst(undefined, 1.4, 'lowpass', 900, 60, 1, 0.5); break;
      case 'eat': for (let i = 0; i < 3; i++) this.burst(undefined, 0.07, 'bandpass', 2200, 1200, 2.5, 0.5, i * 0.12); break;
      case 'chime': this.tone(undefined, 0.5, 'sine', 880, 880, 0.12); this.tone(undefined, 0.6, 'sine', 1320, 1320, 0.08, 0.09); break;
      case 'unlock': [660, 880, 1320].forEach((f, i) => this.tone(undefined, 0.5, 'triangle', f, f, 0.12, i * 0.1)); break;
      case 'page': this.burst(at, 0.22, 'highpass', 2500, 6000, 0.6, 0.25); this.burst(at, 0.1, 'bandpass', 1500, 900, 1, 0.12, 0.1); break;
      case 'squelch': this.burst(undefined, 0.25, 'bandpass', 400, 150, 4, 0.5); this.tone(undefined, 0.2, 'sine', 180, 90, 0.2); break;
      case 'build': this.tone(at, 0.1, 'triangle', 220, 160, 0.5); this.burst(at, 0.12, 'lowpass', 1500, 300, 1, 0.5); this.tone(at, 0.1, 'triangle', 330, 240, 0.2, 0.08); break;
      case 'break': this.burst(at, 0.2, 'bandpass', 2000, 600, 2, 0.8); this.tone(at, 0.2, 'sawtooth', 300, 90, 0.4); break;
      case 'scrape': this.burst(at, 0.1, 'bandpass', 3000, 2000, 3, 0.3 * v); break;
      case 'ignite': this.burst(at, 0.5, 'bandpass', 900, 3000, 1, 0.5); break;
      case 'bird': {
        const f = 2200 + Math.random() * 1800;
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) this.tone(at, 0.09, 'sine', f * (1 + 0.2 * (i % 2)), f * (1.5 - 0.2 * (i % 2)), 0.1, i * 0.13);
        break;
      }
      case 'owl': this.tone(at, 0.4, 'sine', 420, 360, 0.2); this.tone(at, 0.6, 'sine', 400, 300, 0.2, 0.5); break;
    }
  }

  /** Picks a sound to go with a line of text the game shows above the book. */
  messageSound(text: string): void {
    if (/^New (recipe|plan)|finished!|^Found:/.test(text)) this.play('unlock');
    else if (/Timber/.test(text)) this.play('creak');
    else if (/^(Sweet|Roasted|Raw meat|Rotten)/.test(text)) this.play('eat');
    else if (/leech|Got it off/i.test(text)) this.play('squelch');
    else if (/Campfire lit|catches/.test(text)) this.play('ignite');
    else if (/^You (killed|made|wake)|is dead|Lashed/.test(text)) this.play('chime');
    else if (/This is home/.test(text)) this.play('unlock');
  }

  // --- The forest's own sound -----------------------------------------------------------

  update(dt: number, s: AmbientState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.windTime += dt;
    // Underwater everything is muffled.
    this.filter.frequency.setTargetAtTime(s.underwater ? 420 : 22000, t, 0.08);
    // Wind: always there, swelling now and then, louder when you fly through the air.
    const gust = 0.5 + 0.5 * Math.sin(this.windTime * 0.35) * Math.sin(this.windTime * 0.13 + 1);
    this.wind.gain.setTargetAtTime((0.05 + 0.06 * gust) * (s.underwater ? 0.2 : 1) + Math.min(0.35, s.airSpeed * 0.04), t, 0.3);
    // Lapping water near a lake.
    const near = Math.max(0, Math.min(1, 1 - s.lakeDistance / 28));
    this.water.gain.setTargetAtTime(s.underwater ? 0 : 0.11 * near * near * (0.7 + 0.3 * Math.sin(this.windTime * 1.7)), t, 0.4);
    // Crickets at night.
    this.crickets.gain.setTargetAtTime(Math.max(0, s.night - 0.5) * 0.045 * (0.6 + 0.4 * Math.sin(this.windTime * 9)) * (s.underwater ? 0 : 1), t, 0.2);
    // Rubbing sticks.
    this.rubGain.gain.setTargetAtTime(s.rub > 0.02 ? 0.05 + 0.1 * s.rub : 0, t, 0.08);

    // Birds by day, the odd owl by night, from somewhere around you.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0 && !s.underwater) {
      this.birdTimer = 2 + Math.random() * 6;
      const a = Math.random() * Math.PI * 2;
      const d = 10 + Math.random() * 30;
      const at = this.listenerPos().add(new THREE.Vector3(Math.cos(a) * d, 4 + Math.random() * 8, Math.sin(a) * d));
      this.play(s.night > 0.6 ? (Math.random() < 0.3 ? 'owl' : 'bird') : s.night < 0.3 ? 'bird' : 'bird', at, 0.6);
    }

    // A campfire crackles: little pops, more often and louder when close.
    if (s.fireDistance < 25 && !s.underwater) {
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this.fireTimer = 0.04 + Math.random() * 0.25;
        const loud = Math.max(0.1, 1 - s.fireDistance / 25);
        this.burst(undefined, 0.03 + Math.random() * 0.04, 'bandpass', 1500 + Math.random() * 3500, 900, 2, 0.35 * loud * loud);
      }
    }

    // Swimming: a splash going in or out, and a stroke sound while paddling.
    if (s.inWater !== this.wasInWater) {
      this.wasInWater = s.inWater;
      this.play('splash', this.listenerPos().add(new THREE.Vector3(0, -0.3, 0)), 0.7);
    }
    this.paddle -= dt;
    if (s.swimSpeed > 0.6 && this.paddle <= 0) {
      this.paddle = 0.5;
      this.burst(undefined, 0.25, 'bandpass', 900, 500, 0.8, Math.min(0.4, 0.08 + s.swimSpeed * 0.06));
    }
  }

  private listenerPos(): THREE.Vector3 {
    const l = this.ctx!.listener;
    return new THREE.Vector3(l.positionX?.value ?? 0, l.positionY?.value ?? 0, l.positionZ?.value ?? 0);
  }
}
