import Peer, { type DataConnection } from 'peerjs';

/** Anything sent between players. `t` says what it is; the rest depends. */
export interface Msg {
  t: string;
  /** Who sent it (filled in on the way). */
  f?: string;
  /** Host only: pass this on to everyone else too. */
  rl?: 1;
  [key: string]: unknown;
}

/** Letters and digits that are hard to mix up, for the code you read out to a friend. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PREFIX = 'monke-';

/** Where the PeerJS signalling server is. Default: the public one. `?signal=host:port` points at your own (for testing). */
function signalling(): { host?: string; port?: number; path?: string; secure?: boolean; debug?: number } {
  const params = new URLSearchParams(location.search);
  const debug = params.has('netdebug') ? 3 : 0;
  const s = params.get('signal');
  if (!s) return { debug };
  const [host, port] = s.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: false, debug };
}

function randomCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return code;
}

/**
 * The connection between players, over WebRTC (via PeerJS; there is no game server). One player hosts and gives out a four-letter
 * code; the others join with it. Everyone connects to the host, which passes messages on, so the host is also the referee.
 * Voice calls go direct between every pair of players (see Voice).
 */
export class Net {
  role: 'host' | 'client' | null = null;
  peer: Peer | null = null;
  id = '';
  code = '';
  hostId = '';
  /** The host's connection to each guest, or a guest's connection to the host. */
  readonly conns = new Map<string, DataConnection>();
  onMessage: ((from: string, msg: Msg) => void) | null = null;
  onJoin: ((id: string) => void) | null = null;
  onLeave: ((id: string) => void) | null = null;
  onClosed: ((reason: string) => void) | null = null;
  /** Messages sent / received, for the readout. */
  sent = 0;
  received = 0;
  private waiting = new Map<string, (msg: Msg) => void>();

  get connected(): boolean {
    return this.role !== null && this.peer !== null && !this.peer.destroyed;
  }

  /** Starts hosting and returns the code to give to friends. */
  async host(): Promise<string> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = randomCode();
      try {
        await this.open(PREFIX + code);
        this.role = 'host';
        this.code = code;
        this.hostId = this.id;
        this.peer!.on('connection', (conn) => this.accept(conn));
        return code;
      } catch (e) {
        if (String(e).includes('unavailable-id')) continue; // someone else has that code: try another
        throw e;
      }
    }
    throw new Error('Could not get a code');
  }

  /** Joins a game by its code. Resolves once connected. */
  async join(code: string): Promise<void> {
    code = code.trim().toUpperCase();
    await this.open();
    const conn = this.peer!.connect(PREFIX + code, { reliable: true, serialization: 'binary' });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No game with that code answered')), 15000);
      conn.on('open', () => {
        clearTimeout(timer);
        resolve();
      });
      conn.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      this.peer!.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    this.role = 'client';
    this.code = code;
    this.hostId = conn.peer;
    this.conns.set(conn.peer, conn);
    this.wire(conn);
  }

  /** Waits for the first message of a kind (the welcome, for a joiner). */
  waitFor(type: string, ms = 20000): Promise<Msg> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The host did not answer')), ms);
      this.waiting.set(type, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  private open(id?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, signalling()) : new Peer(signalling());
      this.peer = peer;
      peer.on('open', (pid) => {
        this.id = pid;
        resolve();
      });
      peer.on('error', (e) => reject(e));
      peer.on('disconnected', () => {
        // Lost the signalling server: existing connections carry on, but note it.
        if (!peer.destroyed) peer.reconnect();
      });
    });
  }

  private accept(conn: DataConnection): void {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      this.wire(conn);
      this.onJoin?.(conn.peer);
    });
  }

  private wire(conn: DataConnection): void {
    conn.on('data', (data) => {
      const msg = data as Msg;
      if (!msg || typeof msg.t !== 'string') return;
      this.received++;
      if (this.role === 'host') msg.f = conn.peer; // a guest cannot pretend to be someone else
      const once = this.waiting.get(msg.t);
      if (once) {
        this.waiting.delete(msg.t);
        once(msg);
      }
      // The host passes on what guests want everyone to hear.
      if (this.role === 'host' && msg.rl) this.broadcast(msg, conn.peer);
      this.onMessage?.(conn.peer, msg);
    });
    const gone = () => {
      if (!this.conns.delete(conn.peer)) return;
      if (this.role === 'client') this.onClosed?.('The host left');
      else this.onLeave?.(conn.peer);
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  /** Sends to everyone (the host: all guests; a guest: the host, who passes it on if `r` is set). */
  send(msg: Msg): void {
    for (const conn of this.conns.values()) this.push(conn, msg);
  }

  /** Host only: to every guest except `except`. */
  broadcast(msg: Msg, except?: string): void {
    for (const [id, conn] of this.conns) if (id !== except) this.push(conn, { ...msg, f: msg.f ?? this.id });
  }

  sendTo(id: string, msg: Msg): void {
    const conn = this.conns.get(id);
    if (conn) this.push(conn, msg);
  }

  private push(conn: DataConnection, msg: Msg): void {
    if (!conn.open) return;
    this.sent++;
    conn.send(msg);
  }

  /** Tell the host a guest has been bitten, etc.: a message for one player. */
  bite(target: string, damage: number): void {
    this.sendTo(target, { t: 'bite', d: damage });
  }

  leave(): void {
    for (const conn of this.conns.values()) conn.close();
    this.conns.clear();
    this.peer?.destroy();
    this.peer = null;
    this.role = null;
    this.code = '';
  }
}
