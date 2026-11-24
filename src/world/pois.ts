import * as THREE from 'three';
import type { PoiInfo } from './forest';
import type { MapMarker } from './mapview';
import type { Sticks } from './sticks';

export interface PoiHooks {
  /** A wood-cutting vehicle is in a barn here. */
  onVehicle?(x: number, y: number, z: number, yaw: number): void;
  say(text: string): void;
  pulse(strength: number, ms: number): void;
}

/** You find a place when you come this close to its edge (metres). */
const FIND_MARGIN = 12;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * The old places scattered through the forest. Each has things lying about inside it (rope, stones, logs, now and
 * then an axe), and is drawn on your map once you have found it.
 */
export class Pois {
  readonly markers: MapMarker[];

  constructor(
    private readonly infos: ReadonlyArray<PoiInfo>,
    sticks: Sticks,
    private readonly hooks: PoiHooks,
  ) {
    this.markers = infos.map((p) => ({ x: p.x, z: p.z, label: p.label, kind: p.type, discovered: false }));
    // Put the loot inside.
    for (const poi of infos) {
      for (const item of poi.loot) {
        const quat = new THREE.Quaternion();
        const a = Math.random() * Math.PI * 2;
        if (item.kind === 'stone' || item.kind === 'rope') quat.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
        else quat.setFromUnitVectors(UP, new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
        sticks.craft(item.kind, new THREE.Vector3(item.x, item.y + 0.1, item.z), quat, item.length ? { length: item.length } : {});
      }
      if (poi.vehicle) this.hooks.onVehicle?.(poi.vehicle.x, poi.vehicle.y, poi.vehicle.z, poi.vehicle.yaw);
    }
  }

  /** Which places have been found (for the save). */
  export(): number[] {
    return this.markers.flatMap((m, i) => (m.discovered ? [i] : []));
  }

  restore(found: number[]): void {
    for (const i of found) if (this.markers[i]) this.markers[i].discovered = true;
  }

  get found(): number {
    return this.markers.filter((m) => m.discovered).length;
  }

  /** Call every frame with the player's position. */
  update(viewer: THREE.Vector3): void {
    this.infos.forEach((poi, i) => {
      const marker = this.markers[i];
      if (marker.discovered) return;
      if (Math.hypot(viewer.x - poi.x, viewer.z - poi.z) < poi.footprint + FIND_MARGIN) {
        marker.discovered = true;
        this.hooks.say(`Found: ${poi.label}`);
        this.hooks.pulse(0.8, 140);
      }
    });
  }
}
