/** Choices the player can change, from the main menu or the pages of the book. Saved in the browser. */
export interface SettingsData {
  /** How far you can see (and how much is drawn). */
  viewDistance: 'low' | 'medium' | 'high';
  grass: boolean;
  /** Takes effect next time the forest is built. */
  animals: boolean;
  /** Takes effect next time the forest is built. */
  treeDensity: 'sparse' | 'normal' | 'dense';
  /** How thick the fog and mist are. */
  atmosphere: 'light' | 'normal' | 'heavy';
  dayLength: 'short' | 'normal' | 'long' | 'always-day';
  /** 0 (off) to 1 (full). */
  haptics: number;
  /** Sound volume, 0 (off) to 1. */
  volume: number;
  /** Which hip the book hangs on. */
  bookSide: 'left' | 'right';
  /** The text readout at the top left of the screen (desktop only). */
  showDebug: boolean;
  /** The screen darkens round the edges when you move fast, which helps with motion sickness. */
  vignette: 'off' | 'low' | 'medium' | 'high';
  /** The host's game saves by itself every 40 seconds (as a single-player game does). */
  hostAutosave: boolean;
  /** Turning with the thumbstick: not at all, in jumps, or smoothly. (Turning your head always works.) */
  turning: 'off' | 'snap' | 'smooth';
  /** Degrees per snap. */
  snapAngle: '30' | '45' | '90';
  turnSpeed: 'slow' | 'medium' | 'fast';
  /** No drifting dust, fireflies or falling leaves. */
  reduceMotion: boolean;
  /** How much is drawn. Auto watches the frame rate and adjusts. */
  quality: 'auto' | 'high' | 'medium' | 'low';
  /** How sharp the picture is. Takes effect the next time you enter VR. */
  sharpness: 'low' | 'normal' | 'high';
}

export const DEFAULT_SETTINGS: SettingsData = {
  viewDistance: 'medium',
  grass: true,
  animals: true,
  treeDensity: 'normal',
  atmosphere: 'normal',
  dayLength: 'normal',
  haptics: 1,
  volume: 0.8,
  bookSide: 'left',
  showDebug: true,
  hostAutosave: true,
  turning: 'snap',
  snapAngle: '45',
  turnSpeed: 'medium',
  vignette: 'medium',
  reduceMotion: false,
  quality: 'auto',
  sharpness: 'normal',
};

/** What each choice means in numbers. */
export const VIEW_DISTANCE_M = { low: 62, medium: 78, high: 100 } as const;
export const TREE_SPACING_M = { sparse: 6.2, normal: 4.8, dense: 4.1 } as const;
/** How dark the comfort vignette gets at its strongest. */
export const VIGNETTE_STRENGTH = { off: 0, low: 0.45, medium: 0.75, high: 0.95 } as const;
/** Degrees per second for smooth turning. */
export const TURN_SPEED_DEG = { slow: 60, medium: 110, fast: 180 } as const;
/** Render resolution relative to the headset's default. */
export const SHARPNESS = { low: 0.8, normal: 1, high: 1.2 } as const;
export const FOG_SCALE = { light: 0.7, normal: 1, heavy: 1.35 } as const;
/** Seconds for a whole day; 0 means the sun stays up. */
export const DAY_SECONDS = { short: 300, normal: 600, long: 1200, 'always-day': 0 } as const;

const KEY = 'monke.settings';

type Listener = (key: keyof SettingsData, value: SettingsData[keyof SettingsData]) => void;

export class Settings {
  readonly data: SettingsData = { ...DEFAULT_SETTINGS };
  private readonly listeners: Listener[] = [];

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<SettingsData>;
      for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof SettingsData>) {
        const value = saved[key];
        if (value !== undefined && typeof value === typeof DEFAULT_SETTINGS[key]) (this.data as unknown as Record<string, unknown>)[key] = value;
      }
    } catch {
      /* storage can be unavailable (private windows etc.) */
    }
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    if (this.data[key] === value) return;
    this.data[key] = value;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
    for (const listener of this.listeners) listener(key, value);
  }

  /** Called whenever a setting changes. */
  onChange(listener: Listener): void {
    this.listeners.push(listener);
  }
}
