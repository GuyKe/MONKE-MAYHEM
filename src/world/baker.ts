import * as THREE from 'three';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _normalMatrix = new THREE.Matrix3();

/**
 * Collects many pieces of geometry, each with its own transform and colour, into one mesh.
 * Used to turn a chunk's worth of trees, rocks and logs into a single draw call.
 */
export class Baker {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];
  private vertexCount = 0;

  get isEmpty(): boolean {
    return this.vertexCount === 0;
  }

  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.Color): void {
    const pos = geometry.getAttribute('position');
    const nor = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const index = geometry.getIndex();
    _normalMatrix.getNormalMatrix(matrix);
    const base = this.vertexCount;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(nor, i).applyMatrix3(_normalMatrix).normalize();
      this.positions.push(_v.x, _v.y, _v.z);
      this.normals.push(_n.x, _n.y, _n.z);
      this.colors.push(color.r, color.g, color.b);
      this.uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    if (index) {
      for (let i = 0; i < index.count; i++) this.indices.push(base + index.getX(i));
    } else {
      for (let i = 0; i < pos.count; i++) this.indices.push(base + i);
    }
    this.vertexCount += pos.count;
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.normals), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.colors), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uvs), 2));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(this.indices), 1));
    return geometry;
  }
}
