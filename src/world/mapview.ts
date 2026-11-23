/** A place you can find, shown on the map once discovered. */
export interface MapMarker {
  x: number;
  z: number;
  label: string;
  kind: string;
  discovered: boolean;
}

export interface MapWater {
  x: number;
  z: number;
  r: number;
  ice: boolean;
}

/** Pixels across the terrain image, and cells across the explored mask. */
const IMAGE = 210;
const FOG = 84;
/** How far around you the map is revealed as you move (metres). */
const REVEAL = 55;

/**
 * The map: a hill-shaded picture of the whole forest that you reveal by walking around. Places you have not
 * been to stay blank. North (the way you face at the start) is up.
 */
export class MapView {
  private readonly terrain = document.createElement('canvas');
  private readonly mask = document.createElement('canvas');
  private readonly explored = new Uint8Array(FOG * FOG);
  private maskDirty = true;
  private lastX = Infinity;
  private lastZ = Infinity;
  /** Bumped when the map changes, so the page redraws. */
  version = 0;

  constructor(
    private readonly worldHalf: number,
    surfaceAt: (x: number, z: number) => number,
    water: ReadonlyArray<MapWater>,
  ) {
    this.terrain.width = this.terrain.height = IMAGE;
    this.mask.width = this.mask.height = FOG;
    const c = this.terrain.getContext('2d')!;
    const image = c.createImageData(IMAGE, IMAGE);
    const size = worldHalf * 2;
    const step = size / IMAGE;
    const h = (px: number, py: number) => surfaceAt(-worldHalf + px * step, -worldHalf + py * step);
    for (let py = 0; py < IMAGE; py++) {
      for (let px = 0; px < IMAGE; px++) {
        const height = h(px, py);
        // Light from the north-west: slopes facing it are brighter.
        const shade = 0.78 + Math.max(-0.35, Math.min(0.35, (h(px - 1, py - 1) - h(px + 1, py + 1)) * 0.5));
        const t = Math.max(0, Math.min(1, (height + 4) / 22));
        // Lowland green to hill brown to pale ridge.
        const r = (88 + 110 * t) * shade;
        const g = (128 + 40 * t - 30 * t * t) * shade;
        const b = (66 + 60 * t) * shade;
        const i = (py * IMAGE + px) * 4;
        image.data[i] = r;
        image.data[i + 1] = g;
        image.data[i + 2] = b;
        image.data[i + 3] = 255;
      }
    }
    c.putImageData(image, 0, 0);
    for (const w of water) {
      c.fillStyle = w.ice ? '#b9dff0' : '#6b5238';
      c.beginPath();
      c.arc(((w.x + worldHalf) / size) * IMAGE, ((w.z + worldHalf) / size) * IMAGE, Math.max(1.5, (w.r / size) * IMAGE), 0, Math.PI * 2);
      c.fill();
    }
  }

  /** Reveals the ground around (x, z). Call every frame; it only does work when you have moved. */
  explore(x: number, z: number): void {
    if (Math.hypot(x - this.lastX, z - this.lastZ) < 4) return;
    this.lastX = x;
    this.lastZ = z;
    const cell = (this.worldHalf * 2) / FOG;
    const cx = Math.floor((x + this.worldHalf) / cell);
    const cz = Math.floor((z + this.worldHalf) / cell);
    const reach = Math.ceil(REVEAL / cell);
    let changed = false;
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < 0 || gz < 0 || gx >= FOG || gz >= FOG || Math.hypot(dx, dz) * cell > REVEAL) continue;
        if (!this.explored[gz * FOG + gx]) {
          this.explored[gz * FOG + gx] = 1;
          changed = true;
        }
      }
    }
    if (changed) {
      this.maskDirty = true;
      this.version++;
    }
  }

  /** True if the player has been near (x, z). */
  isExplored(x: number, z: number): boolean {
    const cell = (this.worldHalf * 2) / FOG;
    const gx = Math.floor((x + this.worldHalf) / cell);
    const gz = Math.floor((z + this.worldHalf) / cell);
    return gx >= 0 && gz >= 0 && gx < FOG && gz < FOG && this.explored[gz * FOG + gx] === 1;
  }

  /** How much of the forest has been seen, 0 to 1. */
  get explorationFraction(): number {
    let n = 0;
    for (const e of this.explored) n += e;
    return n / this.explored.length;
  }

  /**
   * Draws the map into `c` at (x, y) with size w by h, with the player and any discovered places marked.
   * `heading` is the way the player faces (radians, 0 = north).
   */
  draw(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, player: { x: number; z: number; heading: number }, markers: ReadonlyArray<MapMarker>): void {
    if (this.maskDirty) this.refreshMask();
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    c.imageSmoothingEnabled = true;
    c.drawImage(this.terrain, x, y, w, h);
    // The unexplored parts are blank parchment.
    c.drawImage(this.mask, x, y, w, h);
    const size = this.worldHalf * 2;
    const at = (wx: number, wz: number): [number, number] => [x + ((wx + this.worldHalf) / size) * w, y + ((wz + this.worldHalf) / size) * h];

    for (const m of markers) {
      if (!m.discovered) continue;
      const [mx, my] = at(m.x, m.z);
      c.fillStyle = '#7a2a1a';
      c.beginPath();
      c.moveTo(mx, my - 11);
      c.lineTo(mx + 7, my);
      c.lineTo(mx, my + 11);
      c.lineTo(mx - 7, my);
      c.closePath();
      c.fill();
      c.strokeStyle = '#f6e7b8';
      c.lineWidth = 2;
      c.stroke();
    }
    // You: an arrow pointing the way you face.
    const [px, py] = at(player.x, player.z);
    c.translate(px, py);
    c.rotate(player.heading);
    c.fillStyle = '#fff3b0';
    c.strokeStyle = '#2a1a0a';
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(0, -12);
    c.lineTo(8, 9);
    c.lineTo(0, 4);
    c.lineTo(-8, 9);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
    // A frame.
    c.strokeStyle = '#6a3e22';
    c.lineWidth = 4;
    c.strokeRect(x, y, w, h);
  }

  private refreshMask(): void {
    this.maskDirty = false;
    const c = this.mask.getContext('2d')!;
    const image = c.createImageData(FOG, FOG);
    for (let i = 0; i < FOG * FOG; i++) {
      // Parchment where unexplored, clear where seen. Seen cells next to unseen ones fade a little.
      image.data[i * 4] = 226;
      image.data[i * 4 + 1] = 213;
      image.data[i * 4 + 2] = 182;
      image.data[i * 4 + 3] = this.explored[i] ? 0 : 255;
    }
    c.putImageData(image, 0, 0);
  }
}
