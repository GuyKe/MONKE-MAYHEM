/**
 * A tiny frame profiler for finding what costs time on the headset (`?perf`). Call `begin()` at the start of a frame
 * and `lap(name)` after each piece of work: it adds the time since the last lap to that name, smoothed over frames.
 * Costs nothing when off.
 */
export class Perf {
  readonly times: Record<string, number> = {};
  private last = 0;

  constructor(readonly enabled: boolean) {}

  begin(): void {
    if (this.enabled) this.last = performance.now();
  }

  lap(name: string): void {
    if (!this.enabled) return;
    const now = performance.now();
    const ms = now - this.last;
    this.last = now;
    this.times[name] = (this.times[name] ?? ms) * 0.95 + ms * 0.05;
  }

  /** The biggest costs first, as text. */
  report(): string {
    return Object.entries(this.times)
      .sort((a, b) => b[1] - a[1])
      .map(([name, ms]) => `${name.padEnd(14)} ${ms.toFixed(2)} ms`)
      .join('\n');
  }
}
