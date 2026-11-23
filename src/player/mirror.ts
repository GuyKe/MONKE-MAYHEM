import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { Stick, Sticks } from '../world/sticks';
import type { Body } from './body';
import { MIRROR_LAYER } from './body';

/** A mirror in reach (held, or lying this close) shows your reflection. */
const SHOW_DISTANCE = 4;
const DISC_RADIUS = 0.1;
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _up = new THREE.Vector3();

/**
 * The mirror: a polished disc on the end of a handle. Hold it up and it shows what the world looks like from the
 * other side, you included: a gorilla in leaf pants. The reflection is drawn only while a mirror is near you, because
 * it costs another look at the scene.
 */
export class MirrorView {
  private readonly group = new THREE.Group();
  private readonly reflector: Reflector;
  private active: Stick | null = null;

  constructor(
    scene: THREE.Scene,
    body: Body,
  ) {
    this.reflector = new Reflector(new THREE.CircleGeometry(DISC_RADIUS, 28), { textureWidth: 256, textureHeight: 256, clipBias: 0.003, color: 0xe4ece8 });
    // The head is hidden from your own eyes; it has to be there for the mirror.
    const draw = this.reflector.onBeforeRender;
    this.reflector.onBeforeRender = (renderer, sceneArg, camera, geometry, material, group) => {
      body.head.layers.set(0);
      draw.call(this.reflector, renderer, sceneArg, camera, geometry, material, group);
      body.head.layers.set(MIRROR_LAYER);
    };
    const frame = new THREE.Mesh(new THREE.TorusGeometry(DISC_RADIUS + 0.008, 0.012, 6, 28), new THREE.MeshLambertMaterial({ color: 0xb9902f, flatShading: true }));
    const back = new THREE.Mesh(new THREE.CircleGeometry(DISC_RADIUS, 20), new THREE.MeshLambertMaterial({ color: 0x7a5a3a, side: THREE.BackSide }));
    back.position.z = -0.002;
    this.group.add(this.reflector, frame, back);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** The mirror piece being shown, or null. */
  get shown(): Stick | null {
    return this.active;
  }

  update(sticks: Sticks, head: THREE.Vector3): void {
    // A held mirror first, then the nearest one lying close by.
    let best: Stick | null = null;
    let bestD = SHOW_DISTANCE;
    for (const s of sticks.list) {
      if (s.kind !== 'mirror' || s.hidden) continue;
      const d = s.heldBy ? 0 : s.pos.distanceTo(head);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    this.active = best;
    this.group.visible = best !== null;
    if (!best) return;
    // The disc sits on the end of the handle and turns its face toward you.
    _up.set(0, 1, 0).applyQuaternion(best.quat);
    _p.copy(best.pos).addScaledVector(_up, best.length / 2 + DISC_RADIUS + 0.01);
    _n.set(0, 0, 1).applyQuaternion(best.quat);
    if (_n.dot(_p.sub(head)) > 0) _n.negate();
    _p.copy(best.pos).addScaledVector(_up, best.length / 2 + DISC_RADIUS + 0.01);
    this.group.position.copy(_p);
    this.group.quaternion.setFromUnitVectors(_z, _n);
  }
}
