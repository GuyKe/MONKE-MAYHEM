import * as THREE from 'three';
import { RAPIER, WORLD_GROUPS } from '../physics';

/**
 * Milestone 2 movement test course: flat ground plus boxes, trunks, a ramp,
 * a wall and a high platform. Replaced by the forest in milestone 3.
 */
export function buildTestArena(scene: THREE.Scene, world: RAPIER.World): void {
  scene.background = new THREE.Color(0x9cc7e0);
  scene.fog = new THREE.Fog(0x9cc7e0, 20, 70);

  const hemi = new THREE.HemisphereLight(0xd8ecff, 0x4a5a32, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.8);
  sun.position.set(8, 15, 6);
  scene.add(sun);

  // Ground: 60 × 60 m, top surface at y = 0.
  const groundSize = 60;
  const groundMat = new THREE.MeshLambertMaterial({ map: gridTexture(groundSize) });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  addCollider(world, RAPIER.ColliderDesc.cuboid(groundSize / 2, 0.5, groundSize / 2).setTranslation(0, -0.5, 0));

  const wood = new THREE.MeshLambertMaterial({ color: 0x8a5a33 });
  const bark = new THREE.MeshLambertMaterial({ color: 0x5b3d26 });
  const stone = new THREE.MeshLambertMaterial({ color: 0x8b8f86 });
  const moss = new THREE.MeshLambertMaterial({ color: 0x5f7f3a });

  // Crates of increasing height to hop onto.
  [0.4, 0.8, 1.3, 1.9].forEach((h, i) => box(scene, world, wood, 1.2, h, 1.2, -4 + i * 1.6, h / 2, -4));

  // Tree-trunk stand-ins to climb.
  [[4, -3], [6.5, -6], [3, -9], [8, -1.5]].forEach(([x, z], i) => {
    cylinder(scene, world, bark, 0.3 + (i % 2) * 0.15, 7, x, 3.5, z);
  });

  // Ramp.
  box(scene, world, stone, 2.5, 0.2, 6, -8, 1.2, 2, new THREE.Euler(-0.4, 0, 0));

  // Climbing wall and a high platform behind it.
  box(scene, world, stone, 6, 3, 0.4, 0, 1.5, -12);
  box(scene, world, moss, 4, 0.3, 4, 0, 2.85, -14.2);

  // Low beam to swing under / over.
  box(scene, world, wood, 0.25, 0.25, 4, -4, 1.4, 6);
  box(scene, world, wood, 0.25, 1.4, 0.25, -4, 0.7, 4);
  box(scene, world, wood, 0.25, 1.4, 0.25, -4, 0.7, 8);
}

function addCollider(world: RAPIER.World, desc: RAPIER.ColliderDesc): RAPIER.Collider {
  desc.setCollisionGroups(WORLD_GROUPS).setFriction(0.9);
  return world.createCollider(desc);
}

function box(
  scene: THREE.Scene,
  world: RAPIER.World,
  material: THREE.Material,
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  rotation = new THREE.Euler(),
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.rotation.copy(rotation);
  scene.add(mesh);
  const q = new THREE.Quaternion().setFromEuler(rotation);
  addCollider(
    world,
    RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
  );
  return mesh;
}

function cylinder(
  scene: THREE.Scene,
  world: RAPIER.World,
  material: THREE.Material,
  radius: number, height: number,
  x: number, y: number, z: number,
): void {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.85, radius, height, 10), material);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  addCollider(world, RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(x, y, z));
}

/** Grass-coloured 1 m grid so movement speed is easy to read. */
function gridTexture(metres: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#6f9a45';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#5c8338';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(metres, metres);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
