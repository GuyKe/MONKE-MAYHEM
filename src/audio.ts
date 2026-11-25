import * as THREE from 'three';

/** Every sound the game makes. */
export type SoundName =
  | 'click' | 'key' | 'buy' | 'equip' | 'deny' | 'chime' | 'unlock'
  | 'glassCrack' | 'glassShatter' | 'doorMotor' | 'doorSlam' | 'doorCrush' | 'doorBang' | 'doorLock'
  | 'lockdown' | 'thump' | 'growl' | 'screech' | 'step' | 'skitter' | 'ping' | 'blip' | 'glow' | 'torch'
  | 'thud' | 'splat' | 'die' | 'hand' | 'relay' | 'static';

/** How big the space you are in sounds. */
export type Zone = 'lobby' | 'room' | 'hall';

const REVERB: Record<Zone, { seconds: number; wet: number }> = {
  lobby: { seconds: 0.55, wet: 0.22 },
  room: { seconds: 1.4, wet: 0.35 },
  hall: { seconds: 3.6, wet: 0.7 },
};

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();

/**
 * Procedural sound with 3D positions and a reverb that follows the size of the space: tight in the lobby,
 * a long echo in the great hall. Voices (other players, later) run through the same chain.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private reverbIn!: GainNode;
  private noise!: AudioBuffer;
  private readonly convs = new Map<Zone, { node: ConvolverNode; gain: GainNode }>();
  private volume = 0.8;
  private alarmNodes: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;
  private hum: GainNode | null = null;
  readonly log: string[] = [];
  zone: Zone = 'lobby';

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Call from a click or when VR starts. Safe to call again. */
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
    this.master.connect(ctx.destination);
    this.dry = ctx.createGain();
    this.dry.connect(this.master);
    this.reverbIn = ctx.createGain();
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    // One convolver per size of space, mixed by where you are.
    (Object.keys(REVERB) as Zone[]).forEach((zone) => {
      const node = ctx.createConvolver();
      node.buffer = this.impulse(REVERB[zone].seconds);
      const gain = ctx.createGain();
      gain.gain.value = zone === this.zone ? REVERB[zone].wet : 0;
      this.reverbIn.connect(node);
      node.connect(gain);
      gain.connect(this.master);
      this.convs.set(zone, { node, gain });
    });
    // The hum of the facility.
    this.hum = ctx.createGain();
    this.hum.gain.value = 0.05;
    for (const f of [48, 50.5, 96]) {
      const o = ctx.createOscillator();
      o.type = f > 90 ? 'triangle' : 'sawtooth';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 180;
      o.connect(lp).connect(this.hum);
      o.start();
    }
    this.hum.connect(this.dry);
    void ctx.resume();
  }

  /** A burst of noise that dies away, the shape of a room. */
  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (t < 0.01 ? t * 100 : 1);
      }
    }
    return buffer;
  }

  /** The space you are in: sets how long the echoes last. */
  setZone(zone: Zone): void {
    if (zone === this.zone) return;
    this.zone = zone;
    if (!this.ctx) return;
    for (const [z, c] of this.convs) c.gain.gain.setTargetAtTime(z === zone ? REVERB[z].wet : 0, this.ctx.currentTime, 0.4);
  }

  listen(head: THREE.Vector3, quat: THREE.Quaternion): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    _fwd.set(0, 0, -1).applyQuaternion(quat);
    _up.set(0, 1, 0).applyQuaternion(quat);
    if (l.positionX) {
      l.positionX.value = head.x;
      l.positionY.value = head.y;
      l.positionZ.value = head.z;
      l.forwardX.value = _fwd.x;
      l.forwardY.value = _fwd.y;
      l.forwardZ.value = _fwd.z;
      l.upX.value = _up.x;
      l.upY.value = _up.y;
      l.upZ.value = _up.z;
    }
  }

  /** Where a sound goes in: a spot in the world (positional, with echo), or straight to the ears. */
  private out(at?: THREE.Vector3, wet = 0.5): AudioNode {
    const ctx = this.ctx!;
    const send = ctx.createGain();
    send.gain.value = wet;
    send.connect(this.reverbIn);
    if (!at) {
      const g = ctx.createGain();
      g.connect(this.dry);
      g.connect(send);
      return g;
    }
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1.5;
    p.rolloffFactor = 1.1;
    p.maxDistance = 90;
    if (p.positionX) {
      p.positionX.value = at.x;
      p.positionY.value = at.y;
      p.positionZ.value = at.z;
    }
    p.connect(this.dry);
    p.connect(send);
    return p;
  }

  private hit(name: string): boolean {
    this.log.push(name);
    if (this.log.length > 200) this.log.shift();
    return this.ctx !== null;
  }

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

  play(name: SoundName, at?: THREE.Vector3, strength = 1): void {
    if (!this.hit(name)) return;
    const v = Math.max(0.05, Math.min(1, strength));
    switch (name) {
      case 'click': this.tone(at, 0.05, 'square', 1500, 900, 0.07 * v); break;
      case 'key': this.tone(at, 0.04, 'square', 2000, 1400, 0.05); this.burst(at, 0.03, 'highpass', 4000, 4000, 1, 0.08); break;
      case 'buy': [660, 990, 1320].forEach((f, i) => this.tone(at, 0.18, 'triangle', f, f, 0.1, i * 0.06)); break;
      case 'equip': this.tone(at, 0.12, 'sine', 500, 900, 0.12); this.burst(at, 0.1, 'highpass', 3000, 5000, 1, 0.1); break;
      case 'deny': this.tone(at, 0.22, 'square', 180, 120, 0.12); break;
      case 'chime': this.tone(at, 0.6, 'sine', 880, 880, 0.1); this.tone(at, 0.7, 'sine', 1320, 1320, 0.07, 0.1); break;
      case 'unlock': [440, 660, 990].forEach((f, i) => this.tone(at, 0.5, 'triangle', f, f, 0.12, i * 0.12)); break;
      case 'glassCrack': this.burst(at, 0.12, 'highpass', 5000, 3500, 2, 0.9 * v); this.tone(at, 0.1, 'square', 2600, 1800, 0.12 * v); this.burst(at, 0.08, 'bandpass', 3200, 2000, 6, 0.5 * v, 0.05); break;
      case 'glassShatter':
        this.burst(at, 0.9, 'highpass', 3000, 1800, 0.7, 1.0);
        this.burst(at, 0.5, 'bandpass', 5200, 2200, 3, 0.7, 0.02);
        for (let i = 0; i < 9; i++) this.tone(at, 0.15, 'triangle', 3000 + Math.random() * 3000, 2000, 0.06, 0.05 + i * 0.07);
        this.tone(at, 0.4, 'sine', 90, 40, 0.5);
        break;
      case 'doorMotor': this.tone(at, 0.9, 'sawtooth', 70, 95, 0.12 * v); this.burst(at, 0.9, 'bandpass', 260, 420, 2, 0.14 * v); break;
      case 'doorSlam': this.tone(at, 0.25, 'sine', 90, 35, 0.9 * v); this.burst(at, 0.15, 'lowpass', 1200, 200, 1, 0.8 * v); this.burst(at, 0.12, 'bandpass', 2400, 1500, 4, 0.3 * v, 0.02); break;
      case 'doorCrush': this.tone(at, 0.5, 'sawtooth', 120, 30, 0.8); this.burst(at, 0.4, 'lowpass', 900, 80, 1, 1.0); this.burst(at, 0.25, 'bandpass', 1800, 700, 3, 0.6, 0.05); break;
      case 'doorBang': this.tone(at, 0.2, 'sine', 70, 40, 1.0 * v); this.burst(at, 0.2, 'bandpass', 700, 300, 2, 0.8 * v); break;
      case 'doorLock': this.tone(at, 0.08, 'square', 300, 200, 0.2); this.tone(at, 0.1, 'square', 220, 150, 0.2, 0.1); break;
      case 'lockdown': this.tone(undefined, 1.8, 'sawtooth', 120, 60, 0.4); this.burst(undefined, 1.8, 'lowpass', 600, 80, 1, 0.5); break;
      case 'thump': this.tone(at, 0.16, 'sine', 70, 38, 0.9 * v); break;
      case 'growl':
        this.tone(at, 1.3, 'sawtooth', 60, 40, 0.5 * v);
        this.tone(at, 1.2, 'sawtooth', 66, 36, 0.35 * v, 0.05);
        this.burst(at, 1.1, 'lowpass', 500, 110, 3, 0.45 * v);
        break;
      case 'screech':
        this.tone(at, 0.9, 'sawtooth', 900, 2400, 0.3 * v);
        this.tone(at, 0.9, 'square', 1330, 3100, 0.18 * v, 0.03);
        this.burst(at, 0.9, 'bandpass', 3000, 1500, 4, 0.35 * v);
        break;
      case 'step': this.tone(at, 0.2, 'sine', 90, 45, 0.7 * v); this.burst(at, 0.08, 'lowpass', 600, 150, 1, 0.35 * v); break;
      case 'skitter': for (let i = 0; i < 5; i++) this.burst(at, 0.04, 'bandpass', 3500, 2500, 6, 0.3 * v, i * 0.05); break;
      case 'ping': this.tone(at, 0.9, 'sine', 1400, 1400, 0.16 * v); this.tone(at, 1.1, 'sine', 2100, 2100, 0.08 * v, 0.05); break;
      case 'blip': this.tone(at, 0.12, 'sine', 1800, 1800, 0.18 * v); break;
      case 'glow': this.burst(at, 0.12, 'bandpass', 2600, 1800, 4, 0.5); this.tone(at, 0.08, 'triangle', 700, 500, 0.15); break;
      case 'torch': this.tone(at, 0.04, 'square', 900, 700, 0.1); this.burst(at, 0.04, 'highpass', 3000, 3000, 1, 0.2); break;
      case 'thud': this.tone(at, 0.14, 'sine', 120, 50, 0.7 * v); this.burst(at, 0.07, 'lowpass', 800, 200, 1, 0.5 * v); break;
      case 'splat': this.burst(at, 0.3, 'lowpass', 700, 120, 2, 0.8 * v); this.tone(at, 0.2, 'sine', 140, 50, 0.4 * v); break;
      case 'die': this.tone(undefined, 1.6, 'sawtooth', 220, 40, 0.4); this.burst(undefined, 1.6, 'lowpass', 900, 60, 1, 0.5); break;
      case 'hand': this.tone(at, 0.06, 'sine', 160, 90, 0.4 * v); this.burst(at, 0.04, 'lowpass', 900, 300, 1, 0.25 * v); break;
      case 'relay': [330, 440, 660, 880].forEach((f, i) => this.tone(at, 0.4, 'square', f, f, 0.08, i * 0.1)); break;
      case 'static': this.burst(at, 0.4, 'bandpass', 2000, 4000, 0.6, 0.3 * v); break;
    }
  }

  /** The lockdown siren, on or off. */
  setAlarm(on: boolean): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (on && !this.alarmNodes) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 620;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 1.1;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 260;
      lfo.connect(lfoGain).connect(osc.frequency);
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      gain.gain.setTargetAtTime(0.14, ctx.currentTime, 0.2);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      osc.connect(lp).connect(gain);
      const target = this.out();
      gain.connect(target);
      osc.start();
      lfo.start();
      this.alarmNodes = { osc, lfo, gain };
    } else if (!on && this.alarmNodes) {
      const n = this.alarmNodes;
      n.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
      n.osc.stop(ctx.currentTime + 1);
      n.lfo.stop(ctx.currentTime + 1);
      this.alarmNodes = null;
    }
  }

  /** Louder hum when things are tense. */
  setTension(t: number): void {
    if (this.hum && this.ctx) this.hum.gain.setTargetAtTime(0.04 + 0.12 * Math.max(0, Math.min(1, t)), this.ctx.currentTime, 0.5);
  }

  /** Plays someone's voice from a place in the world, through the same echo as everything else. */
  attachStream(stream: MediaStream): { setPosition(p: THREE.Vector3): void; level(): number; dispose(): void } | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const el = document.createElement('audio');
    el.srcObject = stream;
    el.muted = true;
    void el.play().catch(() => undefined);
    const src = ctx.createMediaStreamSource(stream);
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1.5;
    panner.rolloffFactor = 1.4;
    panner.maxDistance = 40;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const send = ctx.createGain();
    send.gain.value = 0.6;
    src.connect(analyser);
    src.connect(panner);
    panner.connect(this.dry);
    panner.connect(send);
    send.connect(this.reverbIn);
    const data = new Uint8Array(analyser.fftSize);
    return {
      setPosition: (p) => {
        if (panner.positionX) {
          panner.positionX.value = p.x;
          panner.positionY.value = p.y;
          panner.positionZ.value = p.z;
        }
      },
      level: () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const b of data) peak = Math.max(peak, Math.abs(b - 128));
        return Math.min(1, peak / 80);
      },
      dispose: () => {
        src.disconnect();
        panner.disconnect();
        send.disconnect();
        el.srcObject = null;
      },
    };
  }

  /** Lets you hear your own microphone from your head, with the room's echo (to check it works). Returns a stop function. */
  monitor(stream: MediaStream): (() => void) | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const src = ctx.createMediaStreamSource(stream);
    const g = ctx.createGain();
    g.gain.value = 0.7;
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.25;
    src.connect(g).connect(delay);
    delay.connect(this.dry);
    delay.connect(this.reverbIn);
    return () => {
      src.disconnect();
      g.disconnect();
      delay.disconnect();
    };
  }
}
