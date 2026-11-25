import * as THREE from 'three';
import { LOCOMOTION } from '../config';
import { buildGloveGeometry } from '../game/avatar';

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
  private readonly idleColor = new THREE.Color(0xffffff);
  private readonly contactColor = new THREE.Color(0xbfe0ff);

  constructor(readonly handedness: Handedness, scene: THREE.Scene, private readonly rig: THREE.Object3D) {
    const r = LOCOMOTION.handRadius;
    this.material = new THREE.MeshLambertMaterial({ color: this.idleColor, vertexColors: true, flatShading: true });
    this.mesh = new THREE.Mesh(buildGloveGeometry(handedness === 'left' ? 1 : -1, r, 0xd05a10), this.material);
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.6, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 }),
    );
    this.ghost.visible = false;
    scene.add(this.ghost);
  }

  /** Changes the colour of the glove. */
  setGlove(color: number, radius = LOCOMOTION.handRadius): void {
    this.mesh.geometry.dispose();
    this.mesh.geometry = buildGloveGeometry(this.handedness === 'left' ? 1 : -1, radius, color);
  }

  get tracked(): boolean {
    return this.grip !== null && this.source !== null;
  }

  /** True while the trigger (index finger) is held. */
  get triggered(): boolean {
    return this.source?.gamepad?.buttons[0]?.pressed ?? false;
  }

  /** The thumbstick, left (-1) to right (1), or 0 if it is not touched. */
  get stickX(): number {
    return this.source?.gamepad?.axes[2] ?? 0;
  }

  /** True while the lower face button (A on the right controller, X on the left) is held. */
  get faceButton(): boolean {
    return this.source?.gamepad?.buttons[4]?.pressed ?? false;
  }

  /** True while the grip button is held. */
  get squeezed(): boolean {
    return this.source?.gamepad?.buttons[1]?.pressed ?? false;
  }

  /** Controller position in tracking space, or null if not tracked. */
  localPosition(target: THREE.Vector3): THREE.Vector3 | null {
    return this.tracked ? target.copy(this.grip!.position) : null;
  }

  /** The controller's orientation in the world (the grip's own turn, plus the rig's if the player has turned). */
  worldQuaternion(out: THREE.Quaternion): THREE.Quaternion {
    return out.copy(this.rig.quaternion).multiply(this.grip!.quaternion);
  }

  /** Places the mitt at `visualPos` and the ghost at the raw controller position. */
  updateVisual(visualPos: THREE.Vector3, rawWorldPos: THREE.Vector3, touching: boolean): void {
    this.mesh.visible = this.tracked;
    if (!this.tracked) {
      this.ghost.visible = false;
      return;
    }
    this.mesh.position.copy(visualPos);
    this.worldQuaternion(this.mesh.quaternion);
    this.material.color.copy(touching ? this.contactColor : this.idleColor);

    this.ghost.position.copy(rawWorldPos);
    this.ghost.visible = visualPos.distanceToSquared(rawWorldPos) > 0.03 * 0.03;
  }

  /** Scales every buzz (the "controller buzz" setting). 0 is off. */
  static hapticScale = 1;

  pulse(intensity: number, durationMs: number): void {
    intensity *= Hand.hapticScale;
    if (intensity <= 0.01) return;
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
    this.left = new Hand('left', scene, rig);
    this.right = new Hand('right', scene, rig);

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
