/** What a slot in a plan takes: a kind of piece, or a rope tie round a joint. */
export type SlotKind = 'log' | 'pole' | 'stick' | 'tie';

/** One place in a structure where a part goes. Positions and axes are in the structure's own space (y up). */
export interface Slot {
  id: string;
  kind: SlotKind;
  pos: [number, number, number];
  /** The direction a long part lies in (either way round), or the joint's direction for a tie. */
  axis: [number, number, number];
  /** How long the part is drawn. A piece at least 60% of this will do. */
  length: number;
  radius: number;
  /** Slots that must be filled before this one can be. */
  requires: string[];
  /** Which step of the plan it belongs to. */
  step: number;
}

export interface Blueprint {
  id: string;
  name: string;
  blurb: string;
  /** What you need to gather, in words. */
  needs: string;
  /** The plan that must be finished to unlock this one, or null if it is there from the start. */
  unlockedBy: string | null;
  /** Tells the player how to unlock it. */
  hint: string;
  steps: string[];
  slots: Slot[];
  /** Radius of the ground it needs to be clear and level (metres). */
  footprint: number;
}

/** A rafter running from the ridge down to the ground behind the posts. */
function rafter(i: number): Slot {
  const x = -0.7 + 0.35 * i;
  // From (x, 0.97, 0) at the ridge to (x, 0.03, -0.75) on the ground.
  const dy = -0.94;
  const dz = -0.75;
  const length = Math.hypot(dy, dz);
  return {
    id: `rafter-${i}`,
    kind: 'stick',
    pos: [x, 0.5, -0.375],
    axis: [0, dy / length, dz / length],
    length,
    radius: 0.025,
    requires: ['ridge'],
    step: 2,
  };
}

const LEAN_TO: Blueprint = {
  id: 'lean-to',
  name: 'Lean-to Shelter',
  blurb: 'Two posts, a ridge pole and a slope of sticks. Somewhere dry to rest.',
  needs: '2 logs, 1 pole, 5 sticks, 3 ropes',
  unlockedBy: null,
  hint: '',
  steps: [
    'Stand the two posts upright. Use logs, from chopping a tree.',
    'Lay the ridge pole across the tops of the posts. Craft a lashed pole in the book.',
    'Lean five sticks from the ridge down to the ground behind.',
    'Tie the three joints with rope. Hold the rope at the joint, hold the trigger, and circle it.',
  ],
  footprint: 1.7,
  slots: [
    { id: 'post-l', kind: 'log', pos: [-0.9, 0.475, 0], axis: [0, 1, 0], length: 0.95, radius: 0.11, requires: [], step: 0 },
    { id: 'post-r', kind: 'log', pos: [0.9, 0.475, 0], axis: [0, 1, 0], length: 0.95, radius: 0.11, requires: [], step: 0 },
    { id: 'ridge', kind: 'pole', pos: [0, 0.99, 0], axis: [1, 0, 0], length: 2.0, radius: 0.04, requires: ['post-l', 'post-r'], step: 1 },
    rafter(0),
    rafter(1),
    rafter(2),
    rafter(3),
    rafter(4),
    { id: 'tie-l', kind: 'tie', pos: [-0.9, 0.99, 0], axis: [1, 0, 0], length: 0.2, radius: 0.03, requires: ['post-l', 'ridge'], step: 3 },
    { id: 'tie-r', kind: 'tie', pos: [0.9, 0.99, 0], axis: [1, 0, 0], length: 0.2, radius: 0.03, requires: ['post-r', 'ridge'], step: 3 },
    { id: 'tie-m', kind: 'tie', pos: [0, 0.99, 0], axis: [1, 0, 0], length: 0.2, radius: 0.03, requires: ['rafter-2'], step: 3 },
  ],
};

const LOOKOUT: Blueprint = {
  id: 'lookout',
  name: 'Lookout Frame',
  blurb: 'Four posts, two beams and a log deck. Climb up and see over the bushes.',
  needs: '7 logs, 2 poles, 4 ropes',
  unlockedBy: 'lean-to',
  hint: 'Finish a lean-to.',
  steps: [
    'Stand the four posts upright at the corners.',
    'Lay a beam across the tops, front and back.',
    'Lay three logs across the beams to make the deck.',
    'Tie the four corners with rope.',
  ],
  footprint: 1.5,
  slots: [
    { id: 'post-fl', kind: 'log', pos: [-0.55, 0.65, 0.55], axis: [0, 1, 0], length: 1.3, radius: 0.11, requires: [], step: 0 },
    { id: 'post-fr', kind: 'log', pos: [0.55, 0.65, 0.55], axis: [0, 1, 0], length: 1.3, radius: 0.11, requires: [], step: 0 },
    { id: 'post-bl', kind: 'log', pos: [-0.55, 0.65, -0.55], axis: [0, 1, 0], length: 1.3, radius: 0.11, requires: [], step: 0 },
    { id: 'post-br', kind: 'log', pos: [0.55, 0.65, -0.55], axis: [0, 1, 0], length: 1.3, radius: 0.11, requires: [], step: 0 },
    { id: 'beam-f', kind: 'pole', pos: [0, 1.34, 0.55], axis: [1, 0, 0], length: 1.9, radius: 0.04, requires: ['post-fl', 'post-fr'], step: 1 },
    { id: 'beam-b', kind: 'pole', pos: [0, 1.34, -0.55], axis: [1, 0, 0], length: 1.9, radius: 0.04, requires: ['post-bl', 'post-br'], step: 1 },
    { id: 'deck-0', kind: 'log', pos: [-0.35, 1.49, 0], axis: [0, 0, 1], length: 1.3, radius: 0.11, requires: ['beam-f', 'beam-b'], step: 2 },
    { id: 'deck-1', kind: 'log', pos: [0, 1.49, 0], axis: [0, 0, 1], length: 1.3, radius: 0.11, requires: ['beam-f', 'beam-b'], step: 2 },
    { id: 'deck-2', kind: 'log', pos: [0.35, 1.49, 0], axis: [0, 0, 1], length: 1.3, radius: 0.11, requires: ['beam-f', 'beam-b'], step: 2 },
    { id: 'tie-fl', kind: 'tie', pos: [-0.55, 1.34, 0.55], axis: [1, 0, 0], length: 0.2, radius: 0.03, requires: ['post-fl', 'beam-f'], step: 3 },
    { id: 'tie-fr', kind: 'tie', pos: [0.55, 1.34, 0.55], axis: [1, 0, 0], length: 0.2, radius: 0.03, requires: ['post-fr', 'beam-f'], step: 3 },
    { id: 'tie-bl', kind: 'tie', pos: [-0.55, 1.34, -0.55], axis: [1, 0, 0], length: 0.2, radius: 0.03, requires: ['post-bl', 'beam-b'], step: 3 },
    { id: 'tie-br', kind: 'tie', pos: [0.55, 1.34, -0.55], axis: [1, 0, 0], length: 0.2, radius: 0.03, requires: ['post-br', 'beam-b'], step: 3 },
  ],
};

export const BLUEPRINTS: readonly Blueprint[] = [LEAN_TO, LOOKOUT];

export function blueprint(id: string): Blueprint {
  return BLUEPRINTS.find((b) => b.id === id)!;
}
