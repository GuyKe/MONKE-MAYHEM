import * as THREE from 'three';
import type { PieceKind } from './sticks';

export type RuinType = 'cabin' | 'stones' | 'camp' | 'tower';

/** One solid piece of a ruin, in the ruin's own space (y up from the ground, +z is the front). */
export type RuinPart =
  | { shape: 'log'; pos: [number, number, number]; length: number; radius: number; axis: [number, number, number]; color: number; surface: 'bark' | 'wood' }
  | { shape: 'box'; pos: [number, number, number]; size: [number, number, number]; yaw: number; color: number; collide: boolean }
  | { shape: 'rock'; pos: [number, number, number]; scale: [number, number, number]; euler: [number, number, number]; color: number };

export interface RuinLoot {
  kind: PieceKind;
  /** Position in the ruin's own space. */
  pos: [number, number, number];
}

export interface Ruin {
  type: RuinType;
  label: string;
  /** Radius of flat, tree-free ground wanted around it (metres). */
  footprint: number;
  parts: RuinPart[];
  loot: RuinLoot[];
}

export const RUIN_LABELS: Record<RuinType, string> = {
  cabin: 'Ruined Cabin',
  stones: 'Standing Stones',
  camp: 'Abandoned Camp',
  tower: 'Fallen Lookout',
};

const DARK_WOOD = 0x4a3220;
const GREY_WOOD = 0x6b5a48;
const MOSS_STONE = 0x7f857a;
const PALE_STONE = 0x9b9d94;
const CHAR = 0x2a211c;

const log = (x: number, y: number, z: number, length: number, radius: number, axis: [number, number, number], color = DARK_WOOD, surface: 'bark' | 'wood' = 'bark'): RuinPart => ({
  shape: 'log',
  pos: [x, y, z],
  length,
  radius,
  axis,
  color,
  surface,
});
const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, color = GREY_WOOD, collide = true): RuinPart => ({
  shape: 'box',
  pos: [x, y, z],
  size: [sx, sy, sz],
  yaw,
  color,
  collide,
});
const rock = (x: number, y: number, z: number, sx: number, sy: number, sz: number, euler: [number, number, number] = [0, 0, 0], color = MOSS_STONE): RuinPart => ({
  shape: 'rock',
  pos: [x, y, z],
  scale: [sx, sy, sz],
  euler,
  color,
});

/** A ring of stones for a fire. */
function fireRing(cx: number, cz: number, radius: number, count: number, rand: () => number): RuinPart[] {
  const parts: RuinPart[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand() * 0.2;
    const s = 0.14 + rand() * 0.07;
    parts.push(rock(cx + Math.cos(a) * radius, s * 0.55, cz + Math.sin(a) * radius, s, s * 0.8, s, [rand() * 3, rand() * 6, rand() * 3], 0x8a8c84));
  }
  parts.push(box(cx, 0.02, cz, radius * 1.6, 0.03, radius * 1.6, 0, CHAR, false)); // the burnt ground
  return parts;
}

/** Designs a ruin. The same `rand` always gives the same ruin. */
export function designRuin(type: RuinType, rand: () => number): Ruin {
  switch (type) {
    case 'cabin':
      return cabin(rand);
    case 'stones':
      return stones(rand);
    case 'camp':
      return camp(rand);
    default:
      return tower(rand);
  }
}

function cabin(rand: () => number): Ruin {
  const parts: RuinPart[] = [];
  const R = 0.19;
  // Walls of stacked logs, tumbled down more the higher you look.
  const courses = 5;
  const keep = (j: number) => j < 2 || rand() > [0, 0, 0.3, 0.5, 0.78][j];
  for (let j = 0; j < courses; j++) {
    const y = 0.2 + j * 0.37;
    const logs: Array<[number, number, number, number, [number, number, number]]> = [
      // back wall
      [-1.0, y, -1.5, 2.0, [1, 0, 0]],
      [1.0, y, -1.5, 2.0, [1, 0, 0]],
      // front wall, with a gap for the door
      [-1.3, y, 1.5, 1.4, [1, 0, 0]],
      [1.3, y, 1.5, 1.4, [1, 0, 0]],
      // sides
      [-2.0, y, -0.75, 1.5, [0, 0, 1]],
      [-2.0, y, 0.75, 1.5, [0, 0, 1]],
      [2.0, y, -0.75, 1.5, [0, 0, 1]],
      [2.0, y, 0.75, 1.5, [0, 0, 1]],
    ];
    for (const [x, yy, z, length, axis] of logs) if (keep(j)) parts.push(log(x, yy, z, length * 0.97, R, axis, DARK_WOOD));
  }
  // What is left of the roof, and a beam that fell in.
  parts.push(log(0, 2.1, -1.2, 4.4, 0.1, [1, 0, 0], GREY_WOOD, 'wood'));
  if (rand() < 0.6) parts.push(log(0, 2.1, 0.4, 4.4, 0.1, [1, 0, 0], GREY_WOOD, 'wood'));
  parts.push(log(0.4, 0.15, 0.3, 2.6, 0.1, [0.9, 0, 0.45], GREY_WOOD, 'wood'));
  parts.push(box(0, 0.03, 0, 3.7, 0.05, 2.7, 0, 0x3a2b1e, false)); // the floor boards
  parts.push(...fireRing(-1.3, -0.8, 0.45, 6, rand));
  return {
    type: 'cabin',
    label: RUIN_LABELS.cabin,
    footprint: 4,
    parts,
    loot: [
      { kind: 'axe', pos: [0.1, 0.2, -0.3] },
      { kind: 'rope', pos: [-1.2, 0.2, 0.3] },
      { kind: 'rope', pos: [1.2, 0.2, -1.0] },
      { kind: 'rope', pos: [0.9, 0.2, 1.0] },
      { kind: 'pole', pos: [0.2, 0.22, -1.0] },
      { kind: 'log', pos: [1.1, 0.25, 0.4] },
      { kind: 'log', pos: [-0.5, 0.25, 1.0] },
      { kind: 'stick', pos: [-0.6, 0.2, -1.1] },
    ],
  };
}

function stones(rand: () => number): Ruin {
  const parts: RuinPart[] = [];
  const count = 7;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.15;
    const h = 1.1 + rand() * 0.8; // half-height
    const x = Math.cos(a) * 3.6;
    const z = Math.sin(a) * 3.6;
    if (i === 3) {
      // One has fallen and lies across the ring.
      parts.push(rock(x, 0.35, z, 0.55, h, 0.45, [0, a, Math.PI / 2 - 0.1], PALE_STONE));
    } else {
      parts.push(rock(x, h * 0.85, z, 0.55 + rand() * 0.25, h, 0.45 + rand() * 0.15, [(rand() - 0.5) * 0.12, a, (rand() - 0.5) * 0.12], PALE_STONE));
    }
  }
  parts.push(box(0, 0.24, 0, 1.3, 0.48, 0.8, 0.3, 0x8c8e86, true)); // the altar
  return {
    type: 'stones',
    label: RUIN_LABELS.stones,
    footprint: 5,
    parts,
    loot: [
      { kind: 'stone', pos: [0.3, 0.8, 0.1] },
      { kind: 'stone', pos: [-0.3, 0.8, -0.1] },
      { kind: 'rope', pos: [0.0, 0.6, 0.0] },
      { kind: 'stone', pos: [1.4, 0.2, 0.4] },
      { kind: 'stone', pos: [-1.5, 0.2, -0.6] },
      { kind: 'stick', pos: [1.0, 0.2, -1.2] },
    ],
  };
}

function camp(rand: () => number): Ruin {
  const parts: RuinPart[] = [];
  // The frame of a lean-to, half fallen.
  parts.push(log(-0.9, 0.475, -1.0, 0.95, 0.11, [0, 1, 0], DARK_WOOD));
  parts.push(log(0.9, 0.475, -1.0, 0.95, 0.11, [0.25, 1, 0], DARK_WOOD)); // leaning
  parts.push(log(0, 0.99, -1.0, 2.0, 0.04, [1, 0, 0], GREY_WOOD, 'wood'));
  parts.push(log(-0.35, 0.5, -1.375, 1.19, 0.025, [0, -0.92, -0.75], GREY_WOOD, 'wood'));
  parts.push(log(0.35, 0.5, -1.375, 1.19, 0.025, [0, -0.92, -0.75], GREY_WOOD, 'wood'));
  parts.push(...fireRing(0, 1.2, 0.5, 8, rand));
  parts.push(log(-1.1, 0.15, 1.2, 1.0, 0.13, [0.1, 0, 1], DARK_WOOD));
  parts.push(log(1.1, 0.15, 1.2, 1.0, 0.13, [-0.1, 0, 1], DARK_WOOD));
  return {
    type: 'camp',
    label: RUIN_LABELS.camp,
    footprint: 3.6,
    parts,
    loot: [
      { kind: 'rope', pos: [0.4, 0.2, -0.5] },
      { kind: 'rope', pos: [-0.7, 0.2, 0.0] },
      { kind: 'stone', pos: [0.9, 0.2, 0.5] },
      { kind: 'stone', pos: [-1.3, 0.2, 0.7] },
      { kind: 'log', pos: [1.5, 0.25, -0.2] },
      { kind: 'stick', pos: [0.1, 0.2, 0.3] },
      { kind: 'stick', pos: [-0.2, 0.2, 0.7] },
      { kind: 'stick', pos: [0.6, 0.2, 0.9] },
    ],
  };
}

function tower(rand: () => number): Ruin {
  const parts: RuinPart[] = [];
  const P = 1.1;
  const H = 5.2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(log(sx * P, H / 2, sz * P, H, 0.17, [0, 1, 0], DARK_WOOD));
  // Braces you can climb on, low and high.
  for (const y of [1.3, 3.2]) {
    for (const sz of [-1, 1]) parts.push(log(0, y, sz * P, 2.3, 0.09, [1, 0, 0], GREY_WOOD, 'wood'));
    for (const sx of [-1, 1]) parts.push(log(sx * P, y, 0, 2.3, 0.09, [0, 0, 1], GREY_WOOD, 'wood'));
  }
  // The platform, with a few boards gone.
  for (let i = 0; i < 6; i++) {
    if (i === 2 || rand() < 0.15) continue;
    parts.push(box(0, 3.34, -1.0 + i * 0.4, 2.7, 0.08, 0.34, 0, GREY_WOOD, true));
  }
  return {
    type: 'tower',
    label: RUIN_LABELS.tower,
    footprint: 3.6,
    parts,
    loot: [
      { kind: 'rope', pos: [-0.5, 3.6, -0.4] },
      { kind: 'rope', pos: [0.6, 3.6, 0.7] },
      { kind: 'stone', pos: [0.2, 3.6, -0.7] },
      { kind: 'log', pos: [0.0, 3.7, 0.0] },
      { kind: 'stick', pos: [-0.7, 3.6, 0.6] },
      { kind: 'rope', pos: [0.8, 0.2, 1.8] },
    ],
  };
}

/** The rotation that lays a part along `axis` (either way round). */
export function axisQuaternion(axis: [number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...axis).normalize());
}
