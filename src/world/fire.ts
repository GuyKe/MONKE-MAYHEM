import * as THREE from 'three';
import { RAPIER, WORLD_GROUPS } from '../physics';
import { SURFACES, setSurface } from './materials';
import type { Stick, Sticks } from './sticks';

interface Emitter {
  pos: THREE.Vector3;
  /** Brightness multiplier: a campfire throws more light than a torch. */
  power: number;
}

const FLAME_COLOR = 0xff8a2a;
const CORE_COLOR = 0xffd070;
/** At most this many fires light the scene at once (the nearest ones). Each costs shader time. */
const LIGHTS = 2;
const _p = new THREE.Vector3();

/**
 * Fire: flames on torches and campfires, and the real light they give. Only the two nearest fires
 * are given actual point lights, the rest are just glowing flames, which keeps it cheap in a headset.
 */
export class Fire {
  private readonly torchFlames = new Map<Stick, THREE.Group>();
  private readonly campfires: Array<{ pos: THREE.Vector3; group: THREE.Group; seed: number }> = [];
  private readonly lights: THREE.PointLight[] = [];
  private readonly flameGeometry = new THREE.ConeGeometry(0.06, 0.24, 6, 1, true).translate(0, 0.12, 0);
  private readonly flameMaterial = new THREE.MeshBasicMaterial({
    color: FLAME_COLOR,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly coreMaterial = new THREE.MeshBasicMaterial({
    color: CORE_COLOR,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private time = 0;
  private readonly emitters: Emitter[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly sticks: Sticks,
    private readonly world: RAPIER.World,
    private readonly surfaceAt: (x: number, z: number) => number,
  ) {
    // The lights always exist (intensity 0 when unused) so the scene never has to recompile its shaders.
    for (let i = 0; i < LIGHTS; i++) {
      const light = new THREE.PointLight(FLAME_COLOR, 0, 16, 1.6);
      scene.add(light);
      this.lights.push(light);
    }
  }

  get campfireCount(): number {
    return this.campfires.length;
  }

  /** Builds a campfire on the ground at (x, z) and returns where it is. */
  addCampfire(x: number, z: number): THREE.Vector3 {
    const y = this.surfaceAt(x, z);
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const stone = new THREE.MeshLambertMaterial({ color: SURFACES.stone.color, flatShading: true });
    const stoneGeo = new THREE.DodecahedronGeometry(0.11, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rock = new THREE.Mesh(stoneGeo, stone);
      rock.position.set(Math.cos(a) * 0.46, 0.06, Math.sin(a) * 0.46);
      rock.rotation.set(i, i * 2, i * 3);
      rock.scale.set(1, 0.8 + (i % 3) * 0.15, 1);
      group.add(rock);
    }
    const wood = new THREE.MeshLambertMaterial({ color: 0x3d2a1a, flatShading: true });
    const logGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6);
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(logGeo, wood);
      log.position.y = 0.08;
      log.rotation.set(Math.PI / 2, 0, (i / 3) * Math.PI);
      group.add(log);
    }
    const embers = new THREE.Mesh(
      new THREE.CircleGeometry(0.38, 12).rotateX(-Math.PI / 2).translate(0, 0.03, 0),
      new THREE.MeshBasicMaterial({ color: 0x401408 }),
    );
    group.add(embers);
    for (let i = 0; i < 3; i++) {
      const flame = new THREE.Mesh(this.flameGeometry, i === 0 ? this.coreMaterial : this.flameMaterial);
      flame.name = 'flame';
      const a = (i / 3) * Math.PI * 2;
      flame.position.set(Math.cos(a) * 0.1, 0.05, Math.sin(a) * 0.1);
      flame.scale.setScalar(i === 0 ? 1.7 : 2.2);
      group.add(flame);
    }
    this.scene.add(group);

    // The ring of stones is solid.
    setSurface(
      this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(0.08, 0.5).setTranslation(x, y + 0.08, z).setCollisionGroups(WORLD_GROUPS).setFriction(0.9),
      ),
      SURFACES.stone,
    );

    const pos = new THREE.Vector3(x, y + 0.5, z);
    this.campfires.push({ pos, group, seed: Math.random() * 10 });
    return pos;
  }

  /** Animates flames and moves the lights to the fires nearest `viewer`. `night` is 0 by day, 1 at night. */
  update(dt: number, viewer: THREE.Vector3, night: number): void {
    this.time += dt;
    this.emitters.length = 0;

    // Torches: a flame at the tip of every torch that is out in the world.
    for (const stick of this.sticks.list) {
      if (stick.kind !== 'torch') continue;
      let flame = this.torchFlames.get(stick);
      if (!flame) {
        flame = new THREE.Group();
        const outer = new THREE.Mesh(this.flameGeometry, this.flameMaterial);
        const core = new THREE.Mesh(this.flameGeometry, this.coreMaterial);
        core.scale.setScalar(0.6);
        flame.add(outer, core);
        this.scene.add(flame);
        this.torchFlames.set(stick, flame);
      }
      flame.visible = !stick.hidden;
      if (stick.hidden) continue;
      _p.set(0, stick.length / 2, 0).applyQuaternion(stick.quat).add(stick.pos);
      flame.position.copy(_p);
      flame.quaternion.identity(); // flames always lick upward, whichever way the torch is held
      const flicker = 1 + 0.18 * Math.sin(this.time * 17 + stick.id) + 0.1 * Math.sin(this.time * 29 + stick.id * 2);
      flame.scale.set(1 / Math.sqrt(flicker), flicker, 1 / Math.sqrt(flicker));
      this.emitters.push({ pos: flame.position.clone().add(_p.set(0, 0.15, 0)), power: 1 });
    }

    // Campfires.
    for (const fire of this.campfires) {
      fire.group.children.forEach((child, i) => {
        if (child.name !== 'flame') return;
        const f = 1 + 0.22 * Math.sin(this.time * 13 + fire.seed + i) + 0.12 * Math.sin(this.time * 23 + fire.seed * 2 + i * 3);
        child.scale.y = (i % 2 ? 2.2 : 1.7) * f;
        child.rotation.y += dt * 2;
      });
      this.emitters.push({ pos: fire.pos, power: 2 });
    }

    // Give the two nearest fires a real light.
    this.emitters.sort((a, b) => a.pos.distanceToSquared(viewer) - b.pos.distanceToSquared(viewer));
    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      const e = this.emitters[i];
      if (!e || e.pos.distanceTo(viewer) > 60) {
        light.intensity = 0;
        continue;
      }
      const flicker = 1 + 0.12 * Math.sin(this.time * 11 + i * 5) + 0.08 * Math.sin(this.time * 19 + i);
      light.position.copy(e.pos);
      // Daytime sun swamps a fire; at night it is the brightest thing around.
      light.intensity = e.power * flicker * (1.2 + 3 * night);
      light.distance = 10 + 6 * e.power;
    }
  }
}
