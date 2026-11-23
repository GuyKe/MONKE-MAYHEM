import * as THREE from 'three';
import { LOCOMOTION } from '../config';

export type Handedness = 'left' | 'right';

/** One tracked controller: where it really is, plus the mitt we draw. */
export class Hand {
  /** Controller grip pose in tracking space (children of the rig). */
  grip: THREE.Object3D | null = null;
  source: XRInputSource | null = null;

  /** The mitt, drawn where the locomotion says the hand is (stopped at surfaces). */
  readonly mesh: THREE.Mesh;
  /** Faint marker at the raw controller position, shown when it's inside a surface. */
  readonly ghost: THREE.Mesh;

  private readonly material: THREE.MeshLambertMaterial;
  private readonly idleColor = new THREE.Color(0x4a3426);
  private readonly contactColor = new THREE.Color(0x7a5a3e);

  constructor(readonly handedness: Handedness, scene: THREE.Scene) {
    const r = LOCOMOTION.handRadius;
    this.material = new THREE.MeshLambertMaterial({ color: this.idleColor });
    const geo = new THREE.SphereGeometry(r, 16, 12);
    geo.scale(1.0, 0.75, 1.25); // flattened mitt shape
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.6, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 }),
    );
    this.ghost.visible = false;
    scene.add(this.ghost);
  }

  get tracked(): boolean {
    return this.grip !== null && this.source !== null;
  }

  /** Controller position in tracking space, or null if not tracked. */
  localPosition(target: THREE.Vector3): THREE.Vector3 | null {
    return this.tracked ? target.copy(this.grip!.position) : null;
  }

  /** Places the mitt at `visualPos` and the ghost at the raw controller position. */
  updateVisual(visualPos: THREE.Vector3, rawWorldPos: THREE.Vector3, touching: boolean): void {
    this.mesh.visible = this.tracked;
    if (!this.tracked) {
      this.ghost.visible = false;
      return;
    }
    this.mesh.position.copy(visualPos);
    this.mesh.quaternion.copy(this.grip!.quaternion); // rig has no rotation
    this.material.color.copy(touching ? this.contactColor : this.idleColor);

    this.ghost.position.copy(rawWorldPos);
    this.ghost.visible = visualPos.distanceToSquared(rawWorldPos) > 0.03 * 0.03;
  }

  pulse(intensity: number, durationMs: number): void {
    const actuator = this.source?.gamepad?.hapticActuators?.[0] as
      | { pulse?: (value: number, duration: number) => Promise<boolean> }
      | undefined;
    actuator?.pulse?.(intensity, durationMs)?.catch(() => {});
  }
}

/**
 * Hooks up the two XR controller grips and assigns them to left/right by
 * handedness (index order isn't guaranteed).
 */
export class Hands {
  readonly left: Hand;
  readonly right: Hand;

  constructor(renderer: THREE.WebGLRenderer, rig: THREE.Object3D, scene: THREE.Scene) {
    this.left = new Hand('left', scene);
    this.right = new Hand('right', scene);

    for (let i = 0; i < 2; i++) {
      const grip = renderer.xr.getControllerGrip(i);
      rig.add(grip);
      grip.addEventListener('connected', (event) => {
        const source = (event as unknown as { data: XRInputSource }).data;
        if (source.hand) return; // hand tracking isn't supported yet
        const hand = source.handedness === 'left' ? this.left : source.handedness === 'right' ? this.right : null;
        if (!hand) return;
        hand.grip = grip;
        hand.source = source;
      });
      grip.addEventListener('disconnected', () => {
        for (const hand of this.all) {
          if (hand.grip === grip) {
            hand.grip = null;
            hand.source = null;
          }
        }
      });
    }
  }

  get all(): [Hand, Hand] {
    return [this.left, this.right];
  }
}
