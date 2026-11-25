/** Levels and ranks: earned by playing the minigames, kept in this browser. */

export interface Rank {
  /** The level you need. */
  level: number;
  name: string;
  color: string;
}

export const RANKS: Rank[] = [
  { level: 0, name: 'NEWCOMER', color: '#9aa6b0' },
  { level: 1, name: 'BEGINNER', color: '#7fd06a' },
  { level: 5, name: 'OK', color: '#5ac0e0' },
  { level: 10, name: 'GREAT', color: '#c080ff' },
  { level: 50, name: 'MASTER', color: '#ffc040' },
  { level: 100, name: 'HOW', color: '#ff6a40' },
  { level: 200, name: 'HOW THE HELL', color: '#ff2a8a' },
];

/** From this level you are a Trusted user, with accessories. */
export const TRUSTED_LEVEL = 50;

/** XP needed to go from level n-1 to level n. */
export function xpCost(level: number): number {
  return 40 + 12 * level;
}

/** XP you need in total to be at `level`. */
export function xpForLevel(level: number): number {
  return 40 * level + 6 * level * (level + 1);
}

export function rankFor(level: number): Rank {
  let best = RANKS[0];
  for (const r of RANKS) if (level >= r.level) best = r;
  return best;
}

/** 0 = no accessories, 1 = trusted (50+), 2 = 100+, 3 = 200+. */
export function accessoryTier(level: number): 0 | 1 | 2 | 3 {
  return level >= 200 ? 3 : level >= 100 ? 2 : level >= TRUSTED_LEVEL ? 1 : 0;
}

const KEY = 'monke.progress';

export class Progress {
  xp = 0;

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.xp = Math.max(0, Number((JSON.parse(raw) as { xp?: number }).xp) || 0);
    } catch {
      // no storage: progress lasts until the page closes
    }
  }

  get level(): number {
    let level = 0;
    while (level < 5000 && this.xp >= xpForLevel(level + 1)) level++;
    return level;
  }

  get rank(): Rank {
    return rankFor(this.level);
  }

  get trusted(): boolean {
    return this.level >= TRUSTED_LEVEL;
  }

  /** How far through the current level, 0 to 1. */
  get fraction(): number {
    const l = this.level;
    return (this.xp - xpForLevel(l)) / xpCost(l + 1);
  }

  /** Adds XP. Returns true if that made a new level. */
  add(amount: number): boolean {
    const before = this.level;
    this.xp += Math.max(0, Math.round(amount));
    try {
      localStorage.setItem(KEY, JSON.stringify({ xp: this.xp }));
    } catch {
      // ignore
    }
    return this.level > before;
  }
}
