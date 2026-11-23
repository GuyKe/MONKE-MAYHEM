import { RAPIER } from '../physics';

/**
 * Surface materials. `slip` is the fraction (0-1) of a hand's sideways
 * motion along the surface that is lost to sliding instead of moving you:
 *   0   = the hand sticks completely (rough tree bark)
 *   0.9 = the hand skates (ice)
 * Pushing straight into a surface is never affected, only motion along it.
 */
export interface SurfaceMaterial {
  readonly name: string;
  readonly slip: number;
  readonly color: number;
}

export const SURFACES = {
  bark: { name: 'bark', slip: 0.0, color: 0x5b3d26 },
  wood: { name: 'wood', slip: 0.05, color: 0x8a5a33 },
  moss: { name: 'moss', slip: 0.1, color: 0x5f7f3a },
  dirt: { name: 'dirt', slip: 0.2, color: 0x7a5c3a },
  stone: { name: 'stone', slip: 0.3, color: 0x8b8f86 },
  mud: { name: 'mud', slip: 0.55, color: 0x4a3a2a },
  ice: { name: 'ice', slip: 0.9, color: 0xbfe6f5 },
} as const satisfies Record<string, SurfaceMaterial>;

/** Used for any collider that was never given a material. */
export const DEFAULT_SURFACE: SurfaceMaterial = SURFACES.dirt;

const byCollider = new Map<number, SurfaceMaterial>();

export function setSurface(collider: RAPIER.Collider, material: SurfaceMaterial): void {
  byCollider.set(collider.handle, material);
}

export function surfaceOf(collider: RAPIER.Collider | null | undefined): SurfaceMaterial {
  return (collider && byCollider.get(collider.handle)) || DEFAULT_SURFACE;
}
