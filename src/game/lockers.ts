import * as THREE from 'three';
import type { Engine } from './engine';
import { FLOOR_Y } from './nav';
import { box, cyl, mat, part } from './shapes';
import { surface } from './textures';

/**
 * A locker big enough to stand in. Step in and keep still, and its door swings shut and you are hidden: nothing sees you. But it
 * is not a wall: if something comes right up to it while it is hunting, it may check.
 */
export class Locker {
  readonly group = new THREE.Group();
  readonly door: THREE.Mesh;
  readonly center = new THREE.Vector3();
  closed = 0;
  private lamp: THREE.Mesh;

  constructor(
    e: Engine,
    x: number,
    z: number,
    /** The way it opens: +1 toward +x, -1 toward -x. */
    readonly facing: 1 | -1,
  ) {
    this.center.set(x, FLOOR_Y, z);
    this.group.position.set(x, FLOOR_Y, z);
    const W = 1.1;
    const D = 1.0;
    const H = 2.3;
    const wallMat = surface('wall', 1.2, H, 0x4a6a8a);
    const mk = (w: number, h: number, d: number, px: number, py: number, pz: number, collide = true): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(px, py, pz);
      this.group.add(m);
      if (collide) e.solid(x + px, FLOOR_Y + py, z + pz, w / 2, h / 2, d / 2);
    };
    mk(0.06, H, W, -facing * D / 2, H / 2, 0);
    mk(D, H, 0.06, 0, H / 2, -W / 2 + 0.03);
    mk(D, H, 0.06, 0, H / 2, W / 2 - 0.03);
    mk(D, 0.06, W, 0, H, 0);
    // The door, hinged on one side, with vents and a handle.
    const doorMat = surface('wall', 1.1, H, 0x6a8aaa);
    this.door = new THREE.Mesh(new THREE.BoxGeometry(0.05, H - 0.06, W - 0.06), doorMat);
    this.door.geometry.translate(0, 0, (W - 0.06) / 2);
    const hinge = new THREE.Group();
    hinge.position.set(facing * D / 2, H / 2, -W / 2 + 0.03);
    hinge.add(this.door);
    for (let i = 0; i < 4; i++) {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.4), mat(0x14161a));
      v.position.set(facing * 0.03, 0.6 + i * 0.1, (W - 0.06) / 2);
      this.door.add(v);
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.04), mat(0xc0c0c0, 0, 0.3, 0.8));
    handle.position.set(facing * 0.06, -0.1, W - 0.2);
    this.door.add(handle);
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0x30ff60 }));
    this.lamp.position.set(facing * 0.04, 0.95, (W - 0.06) / 2);
    this.door.add(this.lamp);
    this.group.add(hinge);
    (this as unknown as { hinge: THREE.Group }).hinge = hinge;
    // A coat hook and a sticker inside.
    part(this.group, cyl, 0x909090, [-facing * 0.45, 1.9, 0], [0.01, 0.1, 0.01]);
    part(this.group, box, 0xe0b020, [-facing * 0.46, 1.2, 0.2], [0.01, 0.2, 0.15]);
    e.scene.add(this.group);
    this.set(0);
  }

  /** 0 open, 1 shut. */
  set(v: number): void {
    this.closed = v;
    const hinge = (this as unknown as { hinge: THREE.Group }).hinge;
    hinge.rotation.y = this.facing * (1 - v) * 1.7;
    (this.lamp.material as THREE.MeshBasicMaterial).color.setHex(v > 0.5 ? 0xff3030 : 0x30ff60);
  }

  /** Is this point (the head) inside? */
  contains(head: THREE.Vector3): boolean {
    return Math.abs(head.x - this.center.x) < 0.5 && Math.abs(head.z - this.center.z) < 0.45 && head.y > FLOOR_Y + 0.2 && head.y < FLOOR_Y + 2.4;
  }
}
