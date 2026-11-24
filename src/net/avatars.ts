import * as THREE from 'three';
import { Body, buildHandGeometry } from '../player/body';

/** What a player sends about themselves, many times a second. */
export interface PoseMsg {
  /** Head position and orientation. */
  h: [number, number, number];
  q: [number, number, number, number];
  /** Hands: position (null if the controller is not tracked). */
  l: [number, number, number] | null;
  r: [number, number, number] | null;
  lq?: [number, number, number, number];
  rq?: [number, number, number, number];
}

interface Avatar {
  id: string;
  index: number;
  name: string;
  body: Body;
  hands: [THREE.Mesh, THREE.Mesh];
  label: THREE.Sprite;
  head: THREE.Vector3;
  headQ: THREE.Quaternion;
  want: { head: THREE.Vector3; headQ: THREE.Quaternion; l: THREE.Vector3 | null; r: THREE.Vector3 | null; lq: THREE.Quaternion; rq: THREE.Quaternion };
  l: THREE.Vector3;
  r: THREE.Vector3;
  lq: THREE.Quaternion;
  rq: THREE.Quaternion;
  seen: number;
  /** 0..1: speaking, so the name lights up. */
  talking: number;
}

const _q = new THREE.Quaternion();

function nameLabel(text: string, hue: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const c = canvas.getContext('2d')!;
  c.fillStyle = 'rgba(20,24,18,0.7)';
  c.beginPath();
  c.roundRect(4, 8, 248, 48, 16);
  c.fill();
  c.fillStyle = `hsl(${Math.round(hue * 360)}, 55%, 78%)`;
  c.font = 'bold 30px system-ui, sans-serif';
  c.textAlign = 'center';
  c.fillText(text, 128, 43);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true, fog: false }));
  sprite.scale.set(0.5, 0.125, 1);
  sprite.renderOrder = 990;
  return sprite;
}

/** The other players: each is a gorilla (the same body as yours) with hands, a name over its head, moving as they do. */
export class RemotePlayers {
  readonly players = new Map<string, Avatar>();
  private readonly handMat = new THREE.MeshLambertMaterial({ color: 0x4a3426, vertexColors: true, flatShading: true });

  constructor(private readonly scene: THREE.Scene) {}

  /** A player's colour, from their number. */
  static hue(index: number): number {
    return (index * 0.173 + 0.08) % 1;
  }

  add(id: string, index: number, name: string): Avatar {
    let a = this.players.get(id);
    if (a) return a;
    const hue = RemotePlayers.hue(index);
    const body = new Body(this.scene, true);
    body.tint(hue);
    const hands: [THREE.Mesh, THREE.Mesh] = [
      new THREE.Mesh(buildHandGeometry(1, 0.07), this.handMat),
      new THREE.Mesh(buildHandGeometry(-1, 0.07), this.handMat),
    ];
    for (const h of hands) {
      h.frustumCulled = false;
      this.scene.add(h);
    }
    const label = nameLabel(name, hue);
    this.scene.add(label);
    a = {
      id,
      index,
      name,
      body,
      hands,
      label,
      head: new THREE.Vector3(),
      headQ: new THREE.Quaternion(),
      want: { head: new THREE.Vector3(), headQ: new THREE.Quaternion(), l: null, r: null, lq: new THREE.Quaternion(), rq: new THREE.Quaternion() },
      l: new THREE.Vector3(),
      r: new THREE.Vector3(),
      lq: new THREE.Quaternion(),
      rq: new THREE.Quaternion(),
      seen: 0,
      talking: 0,
    };
    this.players.set(id, a);
    return a;
  }

  remove(id: string): void {
    const a = this.players.get(id);
    if (!a) return;
    a.body.dispose(this.scene);
    for (const h of a.hands) this.scene.remove(h);
    this.scene.remove(a.label);
    this.players.delete(id);
  }

  /** A new pose from a player. */
  pose(id: string, msg: PoseMsg): void {
    const a = this.players.get(id);
    if (!a) return;
    const first = a.seen === 0;
    a.seen = performance.now();
    a.want.head.set(...msg.h);
    a.want.headQ.set(...msg.q);
    a.want.l = msg.l ? (a.want.l ?? new THREE.Vector3()).set(...msg.l) : null;
    a.want.r = msg.r ? (a.want.r ?? new THREE.Vector3()).set(...msg.r) : null;
    if (msg.lq) a.want.lq.set(...msg.lq);
    if (msg.rq) a.want.rq.set(...msg.rq);
    if (first) {
      a.head.copy(a.want.head);
      a.headQ.copy(a.want.headQ);
      if (a.want.l) a.l.copy(a.want.l);
      if (a.want.r) a.r.copy(a.want.r);
    }
  }

  /** Where each player's head is now. */
  heads(): Array<{ id: string; pos: THREE.Vector3 }> {
    return [...this.players.values()].map((a) => ({ id: a.id, pos: a.head }));
  }

  update(dt: number): void {
    const k = Math.min(1, dt * 14);
    for (const a of this.players.values()) {
      if (a.seen === 0) continue;
      a.head.lerp(a.want.head, k);
      a.headQ.slerp(a.want.headQ, k);
      if (a.want.l) a.l.lerp(a.want.l, k);
      if (a.want.r) a.r.lerp(a.want.r, k);
      a.lq.slerp(a.want.lq, k);
      a.rq.slerp(a.want.rq, k);
      a.body.update(dt, a.head, a.headQ, [a.want.l ? a.l : null, a.want.r ? a.r : null]);
      a.hands[0].visible = !!a.want.l;
      a.hands[1].visible = !!a.want.r;
      a.hands[0].position.copy(a.l);
      a.hands[1].position.copy(a.r);
      a.hands[0].quaternion.copy(a.lq);
      a.hands[1].quaternion.copy(a.rq);
      a.label.position.set(a.head.x, a.head.y + 0.42, a.head.z);
      a.talking = Math.max(0, a.talking - dt * 3);
      (a.label.material as THREE.SpriteMaterial).opacity = 0.75 + 0.25 * a.talking;
      a.label.scale.setScalar(1 + 0.25 * a.talking);
      void _q;
    }
  }

  /** Marks a player as speaking (their name pulses). */
  talk(id: string, level: number): void {
    const a = this.players.get(id);
    if (a) a.talking = Math.max(a.talking, Math.min(1, level));
  }

  clear(): void {
    for (const id of [...this.players.keys()]) this.remove(id);
  }
}
