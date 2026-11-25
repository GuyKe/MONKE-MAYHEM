import type { PieceKind } from '../world/sticks';

/** Things that happen in the game and can unlock a recipe. */
export type JournalEvent = 'stash' | 'dusk' | 'throw' | 'craft:torch' | 'axe' | 'axe2' | 'log' | 'kill' | 'swim';

export type RecipeId = 'pole' | 'torch' | 'campfire' | 'knife' | 'club' | 'mirror';

export interface Recipe {
  id: RecipeId;
  name: string;
  /** Sticks used up. */
  cost: number;
  /** What it makes: a piece you can pick up, or a campfire built on the ground ahead of you. */
  makes: PieceKind | 'campfire';
  blurb: string;
  /** The event that unlocks it. */
  unlockedBy: JournalEvent;
  /** Tells the player how to unlock it. */
  hint: string;
}

export const RECIPES: readonly Recipe[] = [
  {
    id: 'pole',
    name: 'Lashed Pole',
    cost: 2,
    makes: 'pole',
    blurb: 'Two sticks bound end to end. Long and sturdy.',
    unlockedBy: 'stash',
    hint: 'Put a stick in the book.',
  },
  {
    id: 'torch',
    name: 'Torch',
    cost: 3,
    makes: 'torch',
    blurb: 'A bundle that burns. Light for the night.',
    unlockedBy: 'dusk',
    hint: 'Be out in the forest as evening falls.',
  },
  {
    id: 'campfire',
    name: 'Campfire',
    cost: 6,
    makes: 'campfire',
    blurb: 'A ring of stones and a fire that stays lit.',
    unlockedBy: 'craft:torch',
    hint: 'Craft a torch.',
  },
  {
    id: 'knife',
    name: 'Stone Knife',
    cost: 2,
    makes: 'knife',
    blurb: 'A short blade. Quick, and it takes little to make.',
    unlockedBy: 'axe',
    hint: 'Make a stone axe.',
  },
  {
    id: 'club',
    name: 'Heavy Club',
    cost: 4,
    makes: 'club',
    blurb: 'A knob of wood on a handle. Slow, but it hits hard.',
    unlockedBy: 'log',
    hint: 'Chop a log loose from a tree.',
  },
  {
    id: 'mirror',
    name: 'Mirror',
    cost: 3,
    makes: 'mirror',
    blurb: 'A polished disc on a handle. Hold it up to see yourself.',
    unlockedBy: 'swim',
    hint: 'Swim for a few seconds in a lake.',
  },
];

export type CraftStatus = 'locked' | 'need' | 'ready';

const STORAGE_KEY = 'monke.journal';

/**
 * The state behind the book: how many sticks are stashed, which recipes are unlocked, and the rules that
 * unlock them. Unlocked recipes are remembered in the browser between visits; stashed sticks are not.
 */
export class Journal {
  /** Sticks in the book, ready to craft with. */
  stash = 0;
  readonly unlocked = new Set<RecipeId>();
  /** Unlocked but not yet looked at, shown with a NEW tag. */
  readonly fresh = new Set<RecipeId>();
  /** Called when a recipe unlocks. */
  onUnlock: ((recipe: Recipe) => void) | null = null;
  /** Bumped whenever anything the panel shows changes, so it knows to redraw. */
  version = 0;

  constructor(reset = false) {
    if (reset) {
      this.save();
    } else {
      for (const id of this.load()) this.unlocked.add(id);
    }
  }

  recipe(id: RecipeId): Recipe {
    return RECIPES.find((r) => r.id === id)!;
  }

  status(recipe: Recipe): CraftStatus {
    if (!this.unlocked.has(recipe.id)) return 'locked';
    return this.stash >= recipe.cost ? 'ready' : 'need';
  }

  /** Something happened in the game. Unlocks any recipes waiting for it and returns them. */
  notify(event: JournalEvent): Recipe[] {
    const unlocked: Recipe[] = [];
    for (const recipe of RECIPES) {
      if (recipe.unlockedBy !== event || this.unlocked.has(recipe.id)) continue;
      this.unlocked.add(recipe.id);
      this.fresh.add(recipe.id);
      unlocked.push(recipe);
    }
    if (unlocked.length) {
      this.version++;
      this.save();
      for (const r of unlocked) this.onUnlock?.(r);
    }
    return unlocked;
  }

  addStick(): void {
    this.stash++;
    this.version++;
    this.notify('stash');
  }

  /** Uses up the sticks and returns the recipe if it can be made now, otherwise null. */
  craft(id: RecipeId): Recipe | null {
    const recipe = this.recipe(id);
    if (this.status(recipe) !== 'ready') return null;
    this.stash -= recipe.cost;
    this.version++;
    if (recipe.id === 'torch') this.notify('craft:torch');
    return recipe;
  }

  /** Forgets everything: unlocked recipes and the stash. */
  reset(): void {
    this.unlocked.clear();
    this.fresh.clear();
    this.stash = 0;
    this.version++;
    this.save();
  }

  /** Unlocks every recipe. */
  unlockAll(): void {
    for (const r of RECIPES) this.unlocked.add(r.id);
    this.version++;
    this.save();
  }

  markSeen(): void {
    if (this.fresh.size) {
      this.fresh.clear();
      this.version++;
    }
  }

  private load(): RecipeId[] {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { unlocked?: unknown };
      const ids = Array.isArray(raw.unlocked) ? raw.unlocked : [];
      return ids.filter((id): id is RecipeId => RECIPES.some((r) => r.id === id));
    } catch {
      return []; // storage can be unavailable (private windows etc.)
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ unlocked: [...this.unlocked] }));
    } catch {
      /* ignore */
    }
  }
}
