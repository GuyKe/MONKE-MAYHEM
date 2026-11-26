import * as THREE from 'three';
import { WorldButton } from '../ui/panel';
import type { Engine } from './engine';
import { box, cyl, dyn, mat, part, sphere } from './shapes';

export const TIPS = [
  'Doors crush. A door coming down on you is instant. Never stand under one.',
  'Monsters hear running, landing, shouting and the radar ping. Move slowly to stay quiet.',
  'Shut a door on a monster and it is stunned. Jam a door and they have to batter it down.',
  'The mimic only moves when you are not looking. Never turn your back.',
  'Lockers hide you if you keep still. Something hunting may still check.',
  'Flashlights show you the way, and show you to them. Glowsticks can be thrown to lure.',
  'Two relays open the exit gate: one in the power room, one in the boiler room.',
  'When the power fails, stay still and use your own light.',
  'Lockdown puts every door out of your control. Get out of the doorways.',
  'Find the data logs. Someone left them for a reason.',
  'Push off walls and ceilings with your hands: you can climb almost anything.',
  'The catwalk is faster and safer than the floor, until the stairs.',
];

/** A little helper drone that follows you round the lobby, looks at you, and gives advice when poked. */
export class Drone {
  readonly group = new THREE.Group();
  private readonly eye: THREE.Mesh;
  private readonly rotors: THREE.Mesh[] = [];
  private readonly button: WorldButton;
  private tip = 0;
  private time = 0;
  private readonly target = new THREE.Vector3();
  onTip: ((text: string) => void) | null = null;

  constructor(private readonly e: Engine) {
    dyn(this.group);
    part(this.group, sphere, 0xe8ecee, [0, 0, 0], [0.13, 0.11, 0.13]);
    part(this.group, cyl, 0x30363e, [0, 0, 0], [0.135, 0.012, 0.135]);
    this.eye = part(this.group, sphere, 0x40e0ff, [0, 0.01, -0.1], [0.05, 0.05, 0.03], [0, 0, 0], 0x20c0e0);
    part(this.group, cyl, 0x30363e, [0, 0.13, 0.02], [0.006, 0.07, 0.006]);
    part(this.group, sphere, 0xff4060, [0, 0.2, 0.02], [0.015, 0.015, 0.015], [0, 0, 0], 0xff2040);
    for (const sx of [-1, 1]) {
      part(this.group, box, 0x30363e, [sx * 0.15, 0.04, 0.02], [0.06, 0.012, 0.012]);
      const r = part(this.group, cyl, 0xaab4bc, [sx * 0.19, 0.06, 0.02], [0.07, 0.004, 0.07]);
      this.rotors.push(r);
    }
    this.button = e.panels.add(new WorldButton(e.scene, 'BOT-9: TIPS', 0.3, 0.07, '#1a3a4a', () => this.speak()));
    this.button.moves = true;
    this.button.mesh.position.set(0, 0.3, 0);
    this.group.add(this.button.mesh);
    e.scene.add(this.group);
    this.group.position.set(1.4, 1.2, -2.4);
  }

  private speak(): void {
    const text = TIPS[this.tip++ % TIPS.length];
    this.e.audio.play('blip', this.group.position, 0.8);
    this.onTip?.(text);
  }

  setActive(on: boolean): void {
    this.group.visible = on;
    this.button.mesh.visible = on;
  }

  update(dt: number): void {
    this.time += dt;
    const head = this.e.head;
    // It hovers off your right shoulder, a bit above, and bobs.
    const f = _f.set(0, 0, -1).applyQuaternion(this.e.headQuat);
    f.y = 0;
    f.normalize();
    const right = _r.set(-f.z, 0, f.x);
    this.target.copy(head).addScaledVector(right, 0.75).addScaledVector(f, 0.55);
    this.target.y = head.y + 0.55 + Math.sin(this.time * 2) * 0.05;
    this.group.position.lerp(this.target, Math.min(1, dt * 2.5));
    this.group.lookAt(head.x, head.y, head.z);
    for (const r of this.rotors) r.rotation.y += dt * 40;
    (this.eye.material as THREE.MeshLambertMaterial).emissiveIntensity = 1.2 + 0.4 * Math.sin(this.time * 5);
    this.button.mesh.lookAt(head);
  }
}

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
export const _droneMat = mat;
