import type { Animals } from './world/animals';
import type { Forest } from './world/forest';
import type { FallingLeaves } from './world/leaves';
import type { Sticks } from './world/sticks';
import { VIEW_DISTANCE_M, type SettingsData } from './settings';

export type QualityLevel = 'high' | 'medium' | 'low';

/** What each level draws. `view` multiplies the view distance setting. */
const LEVELS: Record<QualityLevel, { view: number; detail: number; grass: number; pieces: number; animals: number; leaves: number }> = {
  high: { view: 1, detail: 30, grass: 34, pieces: 100, animals: 95, leaves: 140 },
  medium: { view: 0.85, detail: 24, grass: 24, pieces: 70, animals: 70, leaves: 80 },
  low: { view: 0.7, detail: 18, grass: 0, pieces: 45, animals: 50, leaves: 30 },
};
const ORDER: QualityLevel[] = ['high', 'medium', 'low'];

/**
 * Keeps the frame rate up. The setting is a fixed level, or Auto: it watches how long frames take and steps the level
 * down when they run long (so a headset that cannot keep up draws less), and back up when there is plenty of room.
 * Each level changes how far the forest, grass, loose pieces, animals and falling leaves are drawn.
 */
export class Quality {
  level: QualityLevel = 'high';
  auto = true;
  /** Frame time the headset should hit, in ms (set from its refresh rate). */
  targetMs = 1000 / 72;
  /** Never adjust by itself (the slow desktop emulator). */
  fixed = false;
  /** Changes made so far, for the readout. */
  changes = 0;
  private sum = 0;
  private frames = 0;
  private window = 0;
  private sinceChange = 0;
  private roomy = 0;
  private viewSetting: SettingsData['viewDistance'] = 'medium';

  constructor(
    private readonly forest: Forest | null,
    private readonly sticks: Sticks,
    private readonly animals: Animals | null,
    private readonly leaves: FallingLeaves | null,
  ) {}

  /** Applies a setting. */
  configure(quality: SettingsData['quality'], viewDistance: SettingsData['viewDistance']): void {
    this.viewSetting = viewDistance;
    this.auto = quality === 'auto' && !this.fixed;
    if (quality !== 'auto') this.level = quality;
    this.apply();
  }

  private apply(): void {
    const l = LEVELS[this.level];
    this.forest?.setViewRadius(VIEW_DISTANCE_M[this.viewSetting] * l.view);
    this.forest?.setDetail(l.detail, l.grass);
    this.sticks.drawDistance = l.pieces;
    if (this.animals) this.animals.activeRadius = l.animals;
    if (this.leaves) this.leaves.maxCount = l.leaves;
  }

  /** Call every frame in VR with the real frame time (seconds). */
  update(frameDt: number): void {
    if (!this.auto) return;
    this.sum += frameDt;
    this.frames++;
    this.window += frameDt;
    this.sinceChange += frameDt;
    if (this.window < 2) return;
    const avgMs = (this.sum / this.frames) * 1000;
    this.sum = 0;
    this.frames = 0;
    this.window = 0;
    const index = ORDER.indexOf(this.level);
    if (avgMs > this.targetMs * 1.2 && index < ORDER.length - 1 && this.sinceChange > 3) {
      this.level = ORDER[index + 1]; // running long: draw less
      this.change();
    } else if (avgMs < this.targetMs * 0.85 && index > 0) {
      // Plenty of room, for a good while: draw more again.
      this.roomy++;
      if (this.roomy >= 5 && this.sinceChange > 12) {
        this.level = ORDER[index - 1];
        this.change();
      }
    } else {
      this.roomy = 0;
    }
  }

  private change(): void {
    this.sinceChange = 0;
    this.roomy = 0;
    this.changes++;
    this.apply();
  }
}
