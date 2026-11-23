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
  /** Which hip the book hangs on. */
  bookSide: 'left' | 'right';
  /** The text readout at the top left of the screen (desktop only). */
  showDebug: boolean;
}

export const DEFAULT_SETTINGS: SettingsData = {
  viewDistance: 'medium',
  grass: true,
  animals: true,
  treeDensity: 'normal',
  atmosphere: 'normal',
  dayLength: 'normal',
  haptics: 1,
  bookSide: 'left',
  showDebug: true,
};

/** What each choice means in numbers. */
export const VIEW_DISTANCE_M = { low: 62, medium: 78, high: 100 } as const;
export const TREE_SPACING_M = { sparse: 6.2, normal: 4.8, dense: 4.1 } as const;
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
