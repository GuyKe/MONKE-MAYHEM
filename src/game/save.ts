/** What the game remembers between visits: who you are, what you own and wear, how you have done. Kept in this browser. */

export type Slot = 'hat' | 'skin' | 'acc';

export interface Profile {
  name: string;
  credits: number;
  owned: string[];
  equipped: Record<Slot, string>;
  stats: { escapes: number; deaths: number; crushed: number; seconds: number };
  mic: boolean;
  /** Data logs found (their numbers). */
  logs: number[];
  /** Best time round the training course, seconds (0 = none). */
  bestCourse: number;
}

const KEY = 'lockdown.profile';

export const DEFAULT_PROFILE: Profile = {
  name: 'SUBJECT',
  credits: 100,
  owned: ['skin_orange', 'hat_none', 'acc_none'],
  equipped: { hat: 'hat_none', skin: 'skin_orange', acc: 'acc_none' },
  stats: { escapes: 0, deaths: 0, crushed: 0, seconds: 0 },
  mic: false,
  logs: [],
  bestCourse: 0,
};

export class Save {
  data: Profile;

  constructor() {
    this.data = JSON.parse(JSON.stringify(DEFAULT_PROFILE)) as Profile;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Profile>;
        this.data = { ...this.data, ...saved, equipped: { ...this.data.equipped, ...saved.equipped }, stats: { ...this.data.stats, ...saved.stats } };
        this.data.owned = Array.from(new Set([...DEFAULT_PROFILE.owned, ...(saved.owned ?? [])]));
      }
    } catch {
      // private window: the profile lasts until the page closes
    }
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // ignore
    }
  }

  setName(name: string): void {
    this.data.name = (name.trim().toUpperCase().replace(/[^A-Z0-9 _-]/g, '') || 'SUBJECT').slice(0, 12);
    this.save();
  }

  addCredits(n: number): void {
    this.data.credits = Math.max(0, this.data.credits + Math.round(n));
    this.save();
  }
}
