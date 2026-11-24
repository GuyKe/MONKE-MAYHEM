import * as THREE from 'three';

/** A hand's pointing ray, for lasers. */
export interface PointerRay {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  trigger: boolean;
}

/** The visible part of a laser: a thin beam from the hand and a dot where it lands. */
export class Laser {
  private readonly beam: THREE.Mesh;
  private readonly dot: THREE.Mesh;
  private readonly _end = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    // A thin tube (a one-pixel line would be nearly invisible in a headset), one metre long along +Z, stretched to reach.
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.85, depthTest: false }));
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.01, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    this.beam.renderOrder = 996;
    this.dot.renderOrder = 997;
    this.beam.frustumCulled = this.dot.frustumCulled = false;
    this.beam.visible = this.dot.visible = false;
    scene.add(this.beam, this.dot);
  }

  /** Shows the beam from `origin`, ending at `point` (or 1.5 m along `dir` if it hits nothing). `hot`: over something pressable. */
  show(origin: THREE.Vector3, dir: THREE.Vector3, point: THREE.Vector3 | null, hot: boolean): void {
    const end = point ?? this._end.copy(origin).addScaledVector(dir, 1.5);
    this.beam.visible = true;
    this.beam.position.copy(origin);
    this.beam.lookAt(end);
    this.beam.scale.set(1, 1, origin.distanceTo(end));
    this.dot.visible = !!point;
    if (point) this.dot.position.copy(point);
    (this.dot.material as THREE.MeshBasicMaterial).color.set(hot ? 0xfff3b0 : 0xffffff);
    (this.beam.material as THREE.MeshBasicMaterial).color.set(hot ? 0xfff3b0 : 0x9fe8ff);
  }

  hide(): void {
    this.beam.visible = this.dot.visible = false;
  }
}
