import * as THREE from 'three';

/** Health, poison and the leeches on you. */
export class Vitals {
  readonly max = 100;
  health = 100;
  /** Seconds of poison left. */
  poison = 0;
  leeches = 0;
  alive = true;
  deaths = 0;
  /** Red flash after being hurt, 0 to 1 (fades). */
  flash = 0;
  /** Called when health runs out. */
  onDeath: (() => void) | null = null;
  /** Called when something hurts you, with a short cause. */
  onHurt: ((amount: number, cause: string) => void) | null = null;
  /** Bumped when anything the gauge shows changes. */
  version = 0;

  private time = 0;
  private lastHurt = -99;

  /** A blow: flashes the screen. */
  hurt(amount: number, cause = ''): void {
    if (!this.alive || amount <= 0) return;
    this.flash = Math.min(1, this.flash + amount / 40 + 0.3);
    this.lastHurt = this.time;
    this.onHurt?.(amount, cause);
    this.drain(amount);
  }

  /** Quiet damage over time (poison, leeches). */
  drain(amount: number): void {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.alive = false;
      this.deaths++;
      this.onDeath?.();
    }
  }

  heal(amount: number): void {
    if (!this.alive) return;
    this.health = Math.min(this.max, this.health + amount);
  }

  poisonFor(seconds: number): void {
    this.poison = Math.min(60, this.poison + seconds);
  }

  /** Back on your feet. */
  revive(): void {
    this.health = this.max;
    this.poison = 0;
    this.leeches = 0;
    this.flash = 0;
    this.alive = true;
  }

  update(dt: number): void {
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 1.6);
    if (!this.alive) return;
    if (this.poison > 0) {
      this.poison = Math.max(0, this.poison - dt);
      this.drain(1.3 * dt);
    }
    if (this.leeches > 0) this.drain(this.leeches * 0.9 * dt);
    if (this.poison <= 0 && this.leeches === 0 && this.time - this.lastHurt > 6 && this.health < this.max) this.heal(1.4 * dt);
  }
}

/** The gauge on your left forearm, and the tint over your eyes (red when hurt, blue under water, black when dead). */
export class VitalsView {
  /** The gauge: a small panel that hugs the forearm and faces you. */
  readonly gauge: THREE.Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private lastKey = '';
  private readonly flashMesh: THREE.Mesh;
  private readonly waterMesh: THREE.Mesh;
  private readonly blackMesh: THREE.Mesh;
  /** 0 = awake, 1 = black. */
  fade = 0;
  fadeTarget = 0;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    private readonly vitals: Vitals,
  ) {
    this.canvas.width = 256;
    this.canvas.height = 128;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.gauge = new THREE.Mesh(
      new THREE.PlaneGeometry(0.115, 0.0575),
      new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false, fog: false, transparent: true }),
    );
    this.gauge.frustumCulled = false;
    this.gauge.visible = false;
    scene.add(this.gauge);

    // Full-view tints, a little in front of the eyes.
    const make = (material: THREE.MeshBasicMaterial): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), material);
      mesh.position.z = -0.28;
      mesh.renderOrder = 999;
      mesh.frustumCulled = false;
      mesh.visible = false;
      camera.add(mesh);
      return mesh;
    };
    const flash = new THREE.CanvasTexture(vignette());
    this.flashMesh = make(new THREE.MeshBasicMaterial({ map: flash, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false, opacity: 0 }));
    this.waterMesh = make(new THREE.MeshBasicMaterial({ color: 0x1d5f7a, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false, opacity: 0.45 }));
    this.blackMesh = make(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false, opacity: 0 }));
    this.blackMesh.position.z = -0.27;
  }

  /** Per frame. `forearm` is where the gauge sits (null hides it), `head` is where to face. */
  update(dt: number, forearm: THREE.Vector3 | null, head: THREE.Vector3, underwater: boolean): void {
    const v = this.vitals;
    if (forearm) {
      this.gauge.visible = true;
      this.gauge.position.copy(forearm).addScaledVector(_v.subVectors(head, forearm).normalize(), 0.07);
      this.gauge.lookAt(head);
      this.draw();
    } else {
      this.gauge.visible = false;
    }
    this.fade += (this.fadeTarget - this.fade) * Math.min(1, dt * 3);
    (this.flashMesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.85, v.flash * 0.9);
    this.flashMesh.visible = v.flash > 0.01;
    this.waterMesh.visible = underwater;
    (this.blackMesh.material as THREE.MeshBasicMaterial).opacity = this.fade;
    this.blackMesh.visible = this.fade > 0.01;
  }

  private draw(): void {
    const v = this.vitals;
    const key = `${Math.round(v.health)}|${Math.ceil(v.poison)}|${v.leeches}|${v.alive}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, 256, 128);
    c.fillStyle = 'rgba(28,20,12,0.82)';
    round(c, 2, 2, 252, 124, 16);
    c.fill();
    c.strokeStyle = '#b9902f';
    c.lineWidth = 4;
    c.stroke();
    // Health bar.
    const f = Math.max(0, Math.min(1, v.health / v.max));
    c.fillStyle = '#3a2a1a';
    round(c, 16, 22, 224, 32, 8);
    c.fill();
    c.fillStyle = f > 0.5 ? '#4fb04a' : f > 0.25 ? '#e0b030' : '#d8402e';
    round(c, 16, 22, Math.max(6, 224 * f), 32, 8);
    c.fill();
    c.fillStyle = '#fff';
    c.font = 'bold 22px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText(String(Math.round(v.health)), 128, 47);
    // Status icons.
    c.textAlign = 'left';
    c.font = 'bold 24px system-ui, sans-serif';
    c.fillStyle = v.poison > 0 ? '#8be04a' : 'rgba(255,255,255,0.25)';
    c.fillText(v.poison > 0 ? `☠ ${Math.ceil(v.poison)}s` : '☠', 18, 100);
    c.fillStyle = v.leeches > 0 ? '#e8504a' : 'rgba(255,255,255,0.25)';
    c.fillText(v.leeches > 0 ? `leech x${v.leeches}` : 'leech', 110, 100);
    this.texture.needsUpdate = true;
  }
}

const _v = new THREE.Vector3();

function round(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function vignette(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d')!;
  const g = c.createRadialGradient(64, 64, 24, 64, 64, 66);
  g.addColorStop(0, 'rgba(190,20,10,0)');
  g.addColorStop(1, 'rgba(190,20,10,1)');
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  return canvas;
}
