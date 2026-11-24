import type { PieceKind } from './world/sticks';

/** The code that unlocks the admin tools (main menu or pause menu → Enter code). */
export const ADMIN_CODE = 'SECRETADMIN123';

const KEY = 'monke.admin';

/** Admin tools: once the code is redeemed they stay unlocked in this browser. */
export class Admin {
  unlocked = false;

  constructor() {
    try {
      this.unlocked = localStorage.getItem(KEY) === '1';
    } catch {
      /* storage can be unavailable */
    }
  }

  /** Tries a code. Returns a line to show the player. */
  redeem(code: string): { ok: boolean; message: string } {
    const typed = code.trim().toUpperCase();
    if (typed === ADMIN_CODE) {
      const already = this.unlocked;
      this.unlocked = true;
      try {
        localStorage.setItem(KEY, '1');
      } catch {
        /* ignore */
      }
      return { ok: true, message: already ? 'Admin is already unlocked.' : 'Code accepted. Admin unlocked: open the in-game menu and press Admin.' };
    }
    return { ok: false, message: typed ? 'That code is not valid.' : 'Type a code first.' };
  }
}

/** Something the admin can spawn as a piece. */
export interface AdminItem {
  label: string;
  kind: PieceKind;
  length?: number;
  state?: 'raw' | 'roast' | 'rotten';
}

/** Every kind of piece in the game (sticks in each size, meat in each state). */
export const ADMIN_ITEMS: AdminItem[] = [
  { label: 'Small stick', kind: 'stick', length: 0.4 },
  { label: 'Medium stick', kind: 'stick', length: 0.75 },
  { label: 'Large stick', kind: 'stick', length: 1.1 },
  { label: 'Long stick', kind: 'stick', length: 1.8 },
  { label: 'Pole', kind: 'pole' },
  { label: 'Log', kind: 'log' },
  { label: 'Stone', kind: 'stone' },
  { label: 'Rope', kind: 'rope' },
  { label: 'Leaves', kind: 'leaf' },
  { label: 'Mud', kind: 'mud' },
  { label: 'Torch', kind: 'torch' },
  { label: 'Spear', kind: 'spear' },
  { label: 'Stone axe', kind: 'axe' },
  { label: 'Lashed axe', kind: 'axe2' },
  { label: 'Club', kind: 'club' },
  { label: 'Knife', kind: 'knife' },
  { label: 'Mirror', kind: 'mirror' },
  { label: 'Fruit', kind: 'fruit' },
  { label: 'Raw meat', kind: 'meat', state: 'raw' },
  { label: 'Roast meat', kind: 'meat', state: 'roast' },
  { label: 'Rotten meat', kind: 'meat', state: 'rotten' },
];

/** What the pause menu asks the game to do for the admin. */
export interface AdminActions {
  spawnItem(item: AdminItem, count: number): void;
  spawnAnimal(species: 'rabbit' | 'deer'): boolean;
  campfire(): void;
  /** Builds a finished structure in front of you. */
  build(id: string): void;
  buildable(): Array<{ id: string; name: string }>;
  /** The wood-cutting vehicle. */
  vehicle(): void;
  heal(): void;
  unlockAll(): void;
  setTime(time: number): void;
}
