import * as THREE from 'three';
import type { Atmosphere } from '../world/atmosphere';
import type { Animals } from '../world/animals';
import type { Building } from '../world/building';
import type { Crocs } from '../world/crocs';
import type { Fire } from '../world/fire';
import type { Forest } from '../world/forest';
import type { Fruits } from '../world/fruit';
import type { Logger } from '../world/logger';
import type { Stick, Sticks } from '../world/sticks';
import type { TreeRopes } from '../world/ropes';
import type { Survival } from '../player/survival';
import type { Vitals } from '../player/vitals';
import type { SaveData } from '../save';
import type { Msg, Net } from './net';
import type { PoseMsg, RemotePlayers } from './avatars';
import type { Voice } from './voice';

export interface SyncDeps {
  net: Net;
  sticks: Sticks;
  animals: Animals | null;
  crocs: Crocs | null;
  forest: Forest | null;
  ropes: TreeRopes | null;
  fruits: Fruits | null;
  fire: Fire;
  building: Building;
  atmosphere: Atmosphere | null;
  survival: Survival;
  logger: { current: Logger | null };
  avatars: RemotePlayers;
  voice: Voice;
  vitals: Vitals;
  seed: number;
  say(text: string): void;
  collect(): SaveData;
  /** The player's own head, hands and where they face, for sending. */
  pose(): PoseMsg;
  /** Something about the roster changed (for the menu). */
  onRoster?(names: string[]): void;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** How often (per second) each kind of update goes out. */
const RATE = { pose: 20, pieces: 15, animals: 8, crocs: 10, structures: 2, time: 0.5, logger: 10 };
/** A piece nobody is moving for this long is handed back to the host. */
const HAND_BACK_AFTER = 1.2;

/**
 * Keeps everyone's game the same. Every machine builds the same forest from the same seed; this sends what changes:
 *  - **players**: where each one's head and hands are, and their voices (see Voice);
 *  - **pieces** (sticks, stones, tools, food...): made, put away and moved. Whoever last handled a piece looks after its
 *    movement until it comes to rest, then the host does;
 *  - **animals and crocodiles**: the host simulates them and everyone else follows; hits go to the host, which owns kills and meat;
 *  - **the world**: felled trees, taken ropes and berries, campfires, structures, the time of day, the wood-cutting vehicle.
 * A joiner gets the host's whole world in one go (the save data) and then these updates.
 */
export class Sync {
  /** This player's number (the host is 0). */
  index = 0;
  readonly roster = new Map<string, { index: number; name: string }>();
  private applying = false;
  private readonly clocks = { pose: 0, pieces: 0, animals: 0, crocs: 0, structures: 0, time: 0, logger: 0 };
  private lastSites = '';
  private readonly resting = new Map<Stick, number>();
  private nextIndex = 1;

  constructor(private readonly d: SyncDeps) {}

  private get net(): Net {
    return this.d.net;
  }

  get isHost(): boolean {
    return this.net.role === 'host';
  }

  /** The id other machines know this player's pieces by (null means the host's). */
  private get me(): string | null {
    return this.isHost ? null : this.net.id;
  }

  get name(): string {
    return this.index === 0 ? 'Host' : `Guest ${this.index + 1}`;
  }

  /** Call once connected (after the welcome, for a joiner). */
  start(index: number): void {
    const d = this.d;
    this.index = index;
    this.roster.set(this.net.id, { index, name: this.name });
    d.sticks.netPrefix = `m${index}-`;
    d.sticks.onCraft = (s) => {
      if (this.applying) return;
      s.owner = this.me;
      this.send({ t: 'sp', ...this.describe(s), o: s.owner, rl: 1 });
    };
    d.sticks.onStash = (s) => {
      if (this.applying) return;
      this.send({ t: 'rm', n: s.nid, rl: 1 });
    };
    d.forest?.setOnFell((i, x, z) => {
      if (!this.applying) this.send({ t: 'fl', i, x: r2(x), z: r2(z), rl: 1 });
    });
    if (d.ropes) d.ropes.onTake = (i) => void (!this.applying && this.send({ t: 'rp', i, rl: 1 }));
    if (d.fruits) d.fruits.onTake = (i, at) => void (!this.applying && this.send({ t: 'fr', i, at, rl: 1 }));
    d.fire.onCampfire = (x, z, scale) => void (!this.applying && this.send({ t: 'fi', x: r2(x), z: r2(z), s: scale, rl: 1 }));
    this.lastSites = JSON.stringify(d.building.export());
    if (d.animals && !this.isHost) d.animals.remote = true;
    if (d.crocs && !this.isHost) d.crocs.remote = true;
    this.net.onMessage = (from, msg) => this.handle(from, msg);
    this.net.onLeave = (id) => this.left(id);
    this.net.onJoin = (id) => this.joined(id);
    this.net.onClosed = (reason) => {
      d.say(reason + '. You are on your own now.');
      this.stop();
    };
    d.voice.listen();
    this.rosterChanged();
  }

  stop(): void {
    const d = this.d;
    d.sticks.onCraft = d.sticks.onStash = null;
    d.forest?.setOnFell(null);
    if (d.ropes) d.ropes.onTake = null;
    if (d.fruits) d.fruits.onTake = null;
    d.fire.onCampfire = null;
    if (d.animals) d.animals.remote = false;
    if (d.crocs) d.crocs.remote = false;
    d.avatars.clear();
    d.voice.stop();
    this.net.leave();
    this.roster.clear();
    this.rosterChanged();
  }

  private rosterChanged(): void {
    this.d.onRoster?.([...this.roster.values()].sort((a, b) => a.index - b.index).map((p) => p.name));
  }

  private send(msg: Msg): void {
    this.net.send(msg);
  }

  // --- Joining and leaving ----------------------------------------------------------------

  /** Host: someone connected. Send them the world. */
  private joined(id: string): void {
    const index = this.nextIndex++;
    const name = `Guest ${index + 1}`;
    this.roster.set(id, { index, name });
    const roster = [...this.roster.entries()].map(([pid, p]) => ({ id: pid, index: p.index }));
    this.net.sendTo(id, {
      t: 'welcome',
      seed: this.d.seed,
      index,
      host: this.net.id,
      roster,
      snapshot: this.d.collect() as unknown as Record<string, unknown>,
      deadAnimals: this.d.animals?.deadIds ?? [],
    });
    this.net.broadcast({ t: 'hello', id, index }, id);
    this.d.avatars.add(id, index, name);
    this.d.say(`${name} joined.`);
    this.rosterChanged();
  }

  private left(id: string): void {
    const p = this.roster.get(id);
    this.roster.delete(id);
    this.d.avatars.remove(id);
    this.d.voice.hangUp(id);
    // What they were looking after goes back to the host.
    for (const s of this.d.sticks.list) if (s.owner === id) s.owner = null;
    if (this.isHost) this.net.broadcast({ t: 'bye', id });
    if (p) this.d.say(`${p.name} left.`);
    this.rosterChanged();
  }

  /** A joiner calls this with the welcome, once the world is built. */
  adoptRoster(roster: Array<{ id: string; index: number }>): void {
    for (const p of roster) {
      if (p.id === this.net.id) continue;
      const name = p.index === 0 ? 'Host' : `Guest ${p.index + 1}`;
      this.roster.set(p.id, { index: p.index, name });
      this.d.avatars.add(p.id, p.index, name);
      // Ring everyone already here, so we can talk.
      this.d.voice.call(p.id);
    }
    this.rosterChanged();
  }

  // --- Describing things -------------------------------------------------------------------

  private describe(s: Stick): Record<string, unknown> {
    return {
      n: s.nid,
      k: s.kind,
      p: [r3(s.pos.x), r3(s.pos.y), r3(s.pos.z)],
      q: [r3(s.quat.x), r3(s.quat.y), r3(s.quat.z), r3(s.quat.w)],
      l: r3(s.length),
      rad: r3(s.radius),
      c: s.baseColor.getHex(),
      st: s.state,
      a: r3(s.age),
      w: r2(s.wrap),
      d: s.durability,
    };
  }

  // --- Every frame ---------------------------------------------------------------------------

  update(dt: number): void {
    const d = this.d;
    const c = this.clocks;
    const tick = (name: keyof typeof RATE): boolean => {
      c[name] += dt;
      if (c[name] < 1 / RATE[name]) return false;
      c[name] = 0;
      return true;
    };
    d.avatars.update(dt);
    d.voice.update(d.avatars.heads());

    if (tick('pose')) this.send({ t: 'pl', ...d.pose(), rl: 1 });
    if (tick('pieces')) this.sendPieces(1 / RATE.pieces);
    if (tick('structures')) {
      const now = JSON.stringify(d.building.export());
      if (now !== this.lastSites) {
        this.lastSites = now;
        this.send({ t: 'st', s: JSON.parse(now), rl: 1 });
      }
    }
    if (this.isHost) {
      const viewers = [d.avatars.heads().map((h) => h.pos), []].flat();
      if (d.animals && tick('animals')) {
        viewers.push(this.localHead());
        this.send({ t: 'an', a: d.animals.snapshot(viewers, 130) });
        viewers.pop();
      }
      if (d.crocs && tick('crocs')) this.send({ t: 'cr', c: d.crocs.snapshot() });
      if (tick('time') && d.atmosphere) this.send({ t: 'tm', time: r3(d.atmosphere.time), day: d.atmosphere.day, days: r3(d.survival.days) });
    }
    const logger = d.logger.current;
    if (logger && logger.rider !== null && tick('logger')) this.send({ t: 'lg', x: r2(logger.x), z: r2(logger.z), h: r2(logger.heading), rl: 1 });
  }

  private head = new THREE.Vector3();
  private localHead(): THREE.Vector3 {
    const p = this.d.pose().h;
    return this.head.set(p[0], p[1], p[2]);
  }

  /** Pose updates for the pieces this machine is looking after. */
  private sendPieces(step: number): void {
    const out: Array<Array<number | string>> = [];
    for (const s of this.d.sticks.list) {
      if (s.hidden || s.owner !== this.me) continue;
      if (s.heldBy === null && s.body.isSleeping()) {
        // At rest. A guest who was looking after it hands it back to the host after a moment.
        if (this.me !== null) {
          const t = (this.resting.get(s) ?? 0) + step;
          this.resting.set(s, t);
          if (t > HAND_BACK_AFTER) {
            this.resting.delete(s);
            s.owner = null;
            this.send({ t: 'own', n: s.nid, o: null, p: [r3(s.pos.x), r3(s.pos.y), r3(s.pos.z)], q: [r3(s.quat.x), r3(s.quat.y), r3(s.quat.z), r3(s.quat.w)], rl: 1 });
          }
        }
        continue;
      }
      this.resting.delete(s);
      const v = s.body.linvel();
      out.push([s.nid, r3(s.pos.x), r3(s.pos.y), r3(s.pos.z), r3(s.quat.x), r3(s.quat.y), r3(s.quat.z), r3(s.quat.w), r2(v.x), r2(v.y), r2(v.z)]);
      if (out.length >= 120) break;
    }
    if (out.length) this.send({ t: 'ps', p: out as unknown as Record<string, unknown>[], rl: 1 });
  }

  // --- What arrives -------------------------------------------------------------------------

  private handle(from: string, msg: Msg): void {
    const d = this.d;
    const apply = (fn: () => void) => {
      this.applying = true;
      try {
        fn();
      } finally {
        this.applying = false;
      }
    };
    const sender = msg.f ?? from;
    switch (msg.t) {
      case 'hello': {
        const m = msg as unknown as { id: string; index: number };
        const name = m.index === 0 ? 'Host' : `Guest ${m.index + 1}`;
        this.roster.set(m.id, { index: m.index, name });
        d.avatars.add(m.id, m.index, name);
        d.say(`${name} joined.`);
        this.rosterChanged();
        break;
      }
      case 'saved':
        d.say('The host saved the game.');
        break;
      case 'bye':
        this.left((msg as unknown as { id: string }).id);
        break;
      case 'pl': {
        const p = this.roster.get(sender);
        if (p) d.avatars.add(sender, p.index, p.name);
        d.avatars.pose(sender, msg as unknown as PoseMsg);
        break;
      }
      case 'sp':
        apply(() => this.spawnCopy(msg as unknown as Record<string, unknown>));
        break;
      case 'rm':
        apply(() => {
          const s = d.sticks.byNid.get(msg.n as string);
          if (s) d.sticks.stash(s, true);
        });
        break;
      case 'own': {
        const s = d.sticks.byNid.get(msg.n as string);
        if (s) {
          s.owner = (msg.o as string | null) ?? null;
          if (msg.p && msg.q && s.owner === null) this.place(s, msg.p as number[], msg.q as number[]);
        }
        break;
      }
      case 'ps':
        for (const row of msg.p as Array<Array<number | string>>) this.pose(row);
        break;
      case 'an':
        d.animals?.applySnapshot(msg.a as number[][]);
        break;
      case 'ak':
        d.animals?.killRemote(msg.i as number);
        break;
      case 'ah':
        if (this.isHost && d.animals) {
          const a = d.animals.ground.find((g) => g.id === msg.i);
          if (a) d.animals.damage(a, msg.d as number);
        }
        break;
      case 'cr':
        d.crocs?.applySnapshot(msg.c as number[][]);
        break;
      case 'ck':
        d.crocs?.killRemote(msg.i as number);
        break;
      case 'ch':
        if (this.isHost && d.crocs) {
          const c = d.crocs.list.find((k) => d.crocs!.lakeIndex(k) === msg.i);
          if (c) d.crocs.damage(c, msg.d as number);
        }
        break;
      case 'bite':
        d.vitals.hurt(msg.d as number, 'crocodile');
        d.say('The crocodile bit you!');
        break;
      case 'tm':
        if (d.atmosphere) {
          d.atmosphere.time = msg.time as number;
          d.atmosphere.day = msg.day as number;
        }
        d.survival.days = msg.days as number;
        break;
      case 'fl':
        apply(() => void d.forest?.fellRemote(msg.i as number, msg.x as number, msg.z as number));
        break;
      case 'rp':
        apply(() => {
          const r = d.ropes?.ropes[msg.i as number];
          if (r && !r.taken) d.ropes!.take(r, true);
        });
        break;
      case 'fr': {
        const f = d.fruits?.all[msg.i as number];
        if (f) {
          f.taken = true;
          f.regrowAt = msg.at as number;
        }
        break;
      }
      case 'fi':
        apply(() => void d.fire.addCampfire(msg.x as number, msg.z as number, msg.s as number, true));
        break;
      case 'st':
        apply(() => {
          d.building.merge(msg.s as never);
          this.lastSites = JSON.stringify(d.building.export());
        });
        break;
      case 'lg': {
        const l = d.logger.current;
        if (l && l.rider === null) {
          l.x = msg.x as number;
          l.z = msg.z as number;
          l.heading = msg.h as number;
        }
        break;
      }
    }
  }

  /** Makes a copy of a piece another player made. */
  private spawnCopy(m: Record<string, unknown>): void {
    const old = this.d.sticks.byNid.get(m.n as string);
    if (old && !old.hidden) return;
    const p = m.p as number[];
    const q = m.q as number[];
    const piece = this.d.sticks.craft(m.k as never, new THREE.Vector3(p[0], p[1], p[2]), new THREE.Quaternion(q[0], q[1], q[2], q[3]), {
      nid: m.n as string,
      length: m.l as number,
      radius: m.rad as number,
      color: m.c as number,
      state: m.st as never,
      age: m.a as number,
      wrap: m.w as number,
      durability: m.d as number,
    });
    if (piece) piece.owner = (m.o as string | null) ?? null;
  }

  private place(s: Stick, p: number[], q: number[]): void {
    if (s.hidden) return;
    s.body.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
    s.body.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
  }

  /** A pose for a piece someone else is moving. */
  private pose(row: Array<number | string>): void {
    const s = this.d.sticks.byNid.get(row[0] as string);
    if (!s || s.hidden || s.owner === this.me) return;
    const n = row as number[];
    s.body.setTranslation({ x: n[1], y: n[2], z: n[3] }, true);
    s.body.setRotation({ x: n[4], y: n[5], z: n[6], w: n[7] }, true);
    s.body.setLinvel({ x: n[8], y: n[9], z: n[10] }, true);
  }

  /** This player took hold of a piece: from now on they look after it. */
  claim(s: Stick): void {
    if (s.owner === this.me) return;
    s.owner = this.me;
    this.send({ t: 'own', n: s.nid, o: this.me, rl: 1 });
  }

  /** Sends what is needed to the host to hit an animal or crocodile. */
  hitAnimal(id: number, amount: number): void {
    this.net.sendTo(this.net.hostId, { t: 'ah', i: id, d: amount });
  }

  hitCroc(lake: number, amount: number): void {
    this.net.sendTo(this.net.hostId, { t: 'ch', i: lake, d: amount });
  }

  animalDied(id: number): void {
    if (this.isHost) this.net.broadcast({ t: 'ak', i: id });
  }

  crocDied(lake: number): void {
    if (this.isHost) this.net.broadcast({ t: 'ck', i: lake });
  }
}
