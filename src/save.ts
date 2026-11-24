import type { SiteSave } from './world/building';
import type { FoodState, PieceKind } from './world/sticks';

/** One piece lying in the world, as saved. */
export interface SavedPiece {
  /** Network id, so pieces keep their names when a player joins. */
  n?: string;
  k: PieceKind;
  p: [number, number, number];
  q: [number, number, number, number];
  l: number;
  r: number;
  /** Durability of a tool. */
  d: number;
  /** Rope wound round an axe head. */
  w: number;
  s: FoodState;
  /** Age of food, in game days. */
  a: number;
  /** Colour. */
  c: number;
}

/** Everything that makes this game this game: the forest is rebuilt from the seed, then this is laid over it. */
export interface SaveData {
  v: 1;
  seed: number;
  at: number;
  player: [number, number, number];
  health: number;
  poison: number;
  days: number;
  time: number;
  day: number;
  respawn: { x: number; z: number; label: string } | null;
  stash: number;
  pieces: SavedPiece[];
  sites: SiteSave[];
  ropes: number[];
  fruits: Array<[number, number]>;
  felled: number[];
  fires: Array<[number, number, number]>;
  explored: string;
  /** Where the wood-cutting vehicle was left: x, z, heading. */
  logger?: [number, number, number];
  found: number[];
  crocsDead: number[];
  /** Animals that have been killed (their ids), for a player joining. */
  animalsDead?: number[];
}

const KEY = 'monke.save';

/** The one saved game, in the browser's storage. */
export const SaveStore = {
  load(): SaveData | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as SaveData;
      return data && data.v === 1 && typeof data.seed === 'number' ? data : null;
    } catch {
      return null;
    }
  },

  write(data: SaveData): boolean {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch {
      return false; // storage full or unavailable
    }
  },

  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },

  /** A line for the menu: how far along the saved game is. */
  describe(data: SaveData): string {
    const shelters = data.sites.filter((s) => s.id === 'lean-to' || s.id === 'hut' || s.id === 'bed').length;
    const built = data.sites.length;
    const found = data.found.length;
    const when = new Date(data.at);
    const pad = (n: number) => String(n).padStart(2, '0');
    const parts = [`Day ${data.day}`, `${found} place${found === 1 ? '' : 's'} found`];
    if (built) parts.push(`${built} structure${built === 1 ? '' : 's'}${shelters ? ` (${shelters} shelter${shelters === 1 ? '' : 's'})` : ''}`);
    return `${parts.join(' · ')} — saved ${when.getDate()}/${when.getMonth() + 1} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
  },
};
