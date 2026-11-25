import * as THREE from 'three';
import type { GameAudio } from '../audio';

/**
 * Your microphone, and (later, when players can join each other) everyone else's voices.
 * Voices come out of the speaking player's head, fade with distance, and echo with the room, because they go through the same
 * reverb as every other sound.
 */
export class Voice {
  enabled = false;
  denied = false;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private data = new Uint8Array(256);
  private stopMonitor: (() => void) | null = null;
  private readonly remotes = new Map<string, { setPosition(p: THREE.Vector3): void; level(): number; dispose(): void }>();

  constructor(private readonly audio: GameAudio) {}

  async enable(): Promise<boolean> {
    if (this.enabled) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      this.denied = true;
      return false;
    }
    this.audio.start();
    const ctx = this.audio.context;
    if (ctx) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    }
    this.enabled = true;
    return true;
  }

  disable(): void {
    this.setMonitor(false);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analyser = null;
    this.enabled = false;
  }

  /** Hear yourself with the room's echo, to check the microphone. */
  setMonitor(on: boolean): void {
    this.stopMonitor?.();
    this.stopMonitor = null;
    if (on && this.stream) this.stopMonitor = this.audio.monitor(this.stream);
  }

  /** How loudly you are speaking right now, 0 to 1. */
  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.data);
    let peak = 0;
    for (const b of this.data) peak = Math.max(peak, Math.abs(b - 128));
    return Math.min(1, peak / 70);
  }

  // --- For multiplayer (later): another player's voice ----------------------------------------------------------------

  addRemote(id: string, stream: MediaStream): void {
    this.removeRemote(id);
    const v = this.audio.attachStream(stream);
    if (v) this.remotes.set(id, v);
  }

  moveRemote(id: string, head: THREE.Vector3): void {
    this.remotes.get(id)?.setPosition(head);
  }

  removeRemote(id: string): void {
    this.remotes.get(id)?.dispose();
    this.remotes.delete(id);
  }
}
