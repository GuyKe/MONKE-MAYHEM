import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

/** Collision group bits. */
export const GROUP_WORLD = 0x0001;
export const GROUP_PLAYER = 0x0002;
export const GROUP_STICK = 0x0004;
/** Parts built into a structure. Solid like the world, but a hand tying a joint can pass through them. */
export const GROUP_STRUCTURE = 0x0008;

/** Packs Rapier interaction groups: high 16 bits = membership, low 16 = filter. */
export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16 | (filter & 0xffff)) >>> 0;
}

/** Static scenery: is world, collides with everything. */
export const WORLD_GROUPS = groups(GROUP_WORLD, 0xffff);
/** The player's body capsule: only collides with the world. */
export const PLAYER_GROUPS = groups(GROUP_PLAYER, GROUP_WORLD | GROUP_STRUCTURE);
/** Sticks: collide with the world and each other, never with the player's body or hand sweeps. */
export const STICK_GROUPS = groups(GROUP_STICK, GROUP_WORLD | GROUP_STICK | GROUP_STRUCTURE);
/** Built structure parts: they collide with everything. */
export const STRUCTURE_GROUPS = groups(GROUP_STRUCTURE, 0xffff);
/** Filter used by hand sweeps and the body controller: hit world only. */
export const QUERY_WORLD = groups(0xffff, GROUP_WORLD | GROUP_STRUCTURE);
/** The same, but ignoring built structures (used by a hand that is tying a joint). */
export const QUERY_TERRAIN = groups(0xffff, GROUP_WORLD);

export async function createPhysicsWorld(): Promise<RAPIER.World> {
  await RAPIER.init();
  return new RAPIER.World({ x: 0, y: -9.81, z: 0 });
}
