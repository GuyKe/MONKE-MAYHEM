import * as THREE from 'three';
import type { MediaConnection } from 'peerjs';
import type { GameAudio } from '../audio';
import type { Net } from './net';

type Sink = NonNullable<ReturnType<GameAudio['attachStream']>>;

/**
 * Voice chat. Each player's microphone is sent straight to each other player (a WebRTC call between every pair), and what
 * you hear comes from where that player's head is, so people nearby are loud and far ones are faint.
 */
export class Voice {
  private local: MediaStream | null = null;
  private silent: MediaStream | null = null;
  private readonly calls = new Map<string, MediaConnection>();
  private readonly sinks = new Map<string, Sink>();
  /** Voices that arrived before sound had started (it starts at the first click). */
  private readonly waiting = new Map<string, MediaStream>();
  /** Microphone state, for the menu: 'off' until asked, 'on', or 'denied'. */
  mic: 'off' | 'on' | 'denied' = 'off';
  muted = false;
  /** How loud you are, 0 to 1. */
  myLevel = 0;
  private analyser: AnalyserNode | null = null;
  private analyserCtx: AudioContext | null = null;
  private readonly buf = new Uint8Array(256);

  constructor(
    private readonly net: Net,
    private readonly audio: GameAudio,
    private readonly onTalk: (id: string, level: number) => void,
  ) {}

  /** Asks for the microphone (the browser or headset asks you). Returns whether it is on. */
  async startMic(): Promise<boolean> {
    if (this.local) return true;
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      this.mic = 'on';
      this.applyMute();
      this.measure(this.local);
      // Calls already made carry the silent stream: swap in the real one.
      for (const call of this.calls.values()) {
        const sender = call.peerConnection?.getSenders().find((s) => s.track?.kind === 'audio');
        const track = this.local.getAudioTracks()[0];
        if (sender && track) void sender.replaceTrack(track);
      }
      return true;
    } catch {
      this.mic = 'denied';
      return false;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMute();
  }

  private applyMute(): void {
    for (const t of this.local?.getAudioTracks() ?? []) t.enabled = !this.muted;
  }

  private measure(stream: MediaStream): void {
    try {
      const ctx = new AudioContext();
      this.analyserCtx = ctx;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(this.analyser);
    } catch {
      /* no level meter */
    }
  }

  /** What to send when there is no microphone: silence (so the call can still be made and we can still listen). */
  private outgoing(): MediaStream {
    if (this.local) return this.local;
    if (!this.silent) {
      const ctx = new AudioContext();
      this.silent = ctx.createMediaStreamDestination().stream;
    }
    return this.silent;
  }

  /** Call once connected: answers calls from the others. */
  listen(): void {
    this.net.peer?.on('call', (call) => {
      call.answer(this.outgoing());
      this.track(call);
    });
  }

  /** Rings another player. */
  call(id: string): void {
    if (this.calls.has(id) || !this.net.peer) return;
    this.track(this.net.peer.call(id, this.outgoing()));
  }

  private track(call: MediaConnection): void {
    this.calls.set(call.peer, call);
    call.on('stream', (stream) => this.arrived(call.peer, stream));
    call.on('close', () => this.hangUp(call.peer));
    call.on('error', () => this.hangUp(call.peer));
  }

  private arrived(id: string, stream: MediaStream): void {
    const sink = this.audio.attachStream(stream);
    if (sink) {
      this.sinks.get(id)?.dispose();
      this.sinks.set(id, sink);
    } else this.waiting.set(id, stream);
  }

  hangUp(id: string): void {
    this.calls.get(id)?.close();
    this.calls.delete(id);
    this.sinks.get(id)?.dispose();
    this.sinks.delete(id);
    this.waiting.delete(id);
  }

  /** Per frame: put each voice where its player is, and note who is talking. */
  update(heads: ReadonlyArray<{ id: string; pos: THREE.Vector3 }>): void {
    for (const [id, stream] of this.waiting) {
      const sink = this.audio.attachStream(stream);
      if (sink) {
        this.sinks.set(id, sink);
        this.waiting.delete(id);
      }
    }
    for (const h of heads) {
      const sink = this.sinks.get(h.id);
      if (!sink) continue;
      sink.setPosition(h.pos);
      const level = sink.level();
      if (level > 0.15) this.onTalk(h.id, level);
    }
    if (this.analyser) {
      this.analyser.getByteTimeDomainData(this.buf);
      let peak = 0;
      for (const v of this.buf) peak = Math.max(peak, Math.abs(v - 128));
      this.myLevel = this.muted ? 0 : Math.min(1, peak / 40);
    }
  }

  stop(): void {
    for (const id of [...this.calls.keys()]) this.hangUp(id);
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    this.mic = 'off';
    void this.analyserCtx?.close();
    this.analyserCtx = null;
    this.analyser = null;
  }

  /** How many voices are connected. */
  get voices(): number {
    return this.calls.size;
  }
}
