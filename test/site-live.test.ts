import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

interface Source {
  readyState: number;
  onerror: (() => void) | null;
  addEventListener(name: string, fn: () => void): void;
  close(): void;
}
interface Live {
  open(): void;
  close(): void;
  refreshSoon(): void;
}
interface Deps {
  eventsUrl: string;
  connect(url: string): Source;
  fetchFragment(): Promise<string | null>;
  swap(html: string): void;
  setLive(on: boolean): void;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  random(): number;
}
interface Core {
  backoffDelay(attempt: number, random: () => number): number;
  createLive(deps: Deps): Live;
}

const sandbox: Record<string, unknown> = {};
runInNewContext(readFileSync(new URL('../public/site-core.js', import.meta.url), 'utf8'), sandbox);
const core = sandbox.SiteCore as Core;

const CONNECTING = 0;
const CLOSED = 2;

class FakeSource implements Source {
  readyState = CONNECTING;
  onerror: (() => void) | null = null;
  closed = false;
  private handlers = new Map<string, () => void>();
  constructor(readonly url: string) {}
  addEventListener(name: string, fn: () => void) {
    this.handlers.set(name, fn);
  }
  close() {
    this.closed = true;
    this.readyState = CLOSED;
  }
  emit(name: string) {
    this.handlers.get(name)?.();
  }
  fail(readyState: number) {
    this.readyState = readyState;
    this.onerror?.();
  }
}

function harness(random = 0) {
  const sources: FakeSource[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextTimer = 1;
  const log = { live: [] as boolean[], swaps: [] as string[], fetches: 0 };
  let respond: (() => Promise<string | null>) | undefined;
  const deps: Deps = {
    eventsUrl: '/events',
    connect: (url) => {
      const source = new FakeSource(url);
      sources.push(source);
      return source;
    },
    fetchFragment: () => {
      log.fetches++;
      return respond ? respond() : Promise.resolve(`<p>v${log.fetches}</p>`);
    },
    swap: (html) => log.swaps.push(html),
    setLive: (on) => log.live.push(on),
    setTimeout: (fn, ms) => {
      timers.set(nextTimer, { fn, ms });
      return nextTimer++;
    },
    clearTimeout: (id) => void timers.delete(id),
    random: () => random,
  };
  const live = core.createLive(deps);
  /** Runs every pending timer (each may schedule more, which stay pending). */
  const fire = async () => {
    const due = [...timers.entries()];
    for (const [id, timer] of due) {
      timers.delete(id);
      timer.fn();
    }
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { live, sources, timers, log, fire, respondWith: (fn: () => Promise<string | null>) => (respond = fn) };
}

describe('backoffDelay', () => {
  it('grows exponentially with jitter, and is capped', () => {
    expect(core.backoffDelay(0, () => 1)).toBe(1000);
    expect(core.backoffDelay(0, () => 0)).toBe(500);
    expect(core.backoffDelay(1, () => 1)).toBe(2000);
    expect(core.backoffDelay(3, () => 1)).toBe(8000);
    expect(core.backoffDelay(20, () => 1)).toBe(30000);
    expect(core.backoffDelay(20, () => 0)).toBe(15000);
  });

  it('never returns less than half the exponential step', () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const step = Math.min(30000, 1000 * 2 ** attempt);
      for (const r of [0, 0.3, 0.99]) expect(core.backoffDelay(attempt, () => r)).toBeGreaterThanOrEqual(step / 2);
    }
  });
});

describe('live connection', () => {
  it('connects, shows the pill on hello and hides it on error', () => {
    const h = harness();
    h.live.open();
    expect(h.sources[0]!.url).toBe('/events');
    h.sources[0]!.emit('hello');
    h.sources[0]!.fail(CONNECTING);
    expect(h.log.live).toEqual([true, false]);
  });

  it('leaves reconnection to the browser while it is still trying', async () => {
    const h = harness();
    h.live.open();
    h.sources[0]!.fail(CONNECTING);
    await h.fire();
    expect(h.sources).toHaveLength(1);
  });

  it('reconnects by hand, with growing capped delays, after the browser gave up (HTTP error)', async () => {
    const h = harness(1);
    h.live.open();
    h.sources[0]!.fail(CLOSED);
    expect(h.sources[0]!.closed).toBe(true);
    expect([...h.timers.values()].map((t) => t.ms)).toEqual([1000]);
    await h.fire();
    expect(h.sources).toHaveLength(2);
    h.sources[1]!.fail(CLOSED);
    expect([...h.timers.values()].map((t) => t.ms)).toEqual([2000]);
    await h.fire();
    h.sources[2]!.fail(CLOSED);
    expect([...h.timers.values()].map((t) => t.ms)).toEqual([4000]);
  });

  it('starts the backoff over once a connection succeeds', async () => {
    const h = harness(1);
    h.live.open();
    h.sources[0]!.fail(CLOSED);
    await h.fire();
    h.sources[1]!.fail(CLOSED);
    await h.fire();
    h.sources[2]!.emit('hello');
    h.sources[2]!.fail(CLOSED);
    expect([...h.timers.values()].map((t) => t.ms)).toEqual([1000]);
  });

  it('stops everything on close', async () => {
    const h = harness();
    h.live.open();
    h.sources[0]!.fail(CLOSED);
    h.live.close();
    expect(h.timers.size).toBe(0);
    await h.fire();
    expect(h.sources).toHaveLength(1);
  });
});

describe('refreshing the page fragment', () => {
  it('waits a random 0-500 ms before fetching, so visitors do not all fetch at once', () => {
    for (const [random, ms] of [[0, 0], [0.5, 250], [0.999, 499]] as const) {
      const h = harness(random);
      h.live.open();
      h.sources[0]!.emit('change');
      expect([...h.timers.values()].map((t) => t.ms)).toEqual([ms]);
      expect(h.log.fetches).toBe(0);
    }
  });

  it('coalesces a burst of changes into one fetch and swaps the result in', async () => {
    const h = harness();
    h.live.open();
    for (let i = 0; i < 5; i++) h.sources[0]!.emit('change');
    expect(h.timers.size).toBe(1);
    await h.fire();
    expect(h.log.fetches).toBe(1);
    expect(h.log.swaps).toEqual(['<p>v1</p>']);
  });

  it('runs one fetch at a time and re-fetches once if a change arrived meanwhile', async () => {
    const h = harness();
    let release!: (html: string) => void;
    h.respondWith(() => new Promise<string>((resolve) => (release = resolve)));
    h.live.open();
    h.sources[0]!.emit('change');
    await h.fire();
    expect(h.log.fetches).toBe(1);
    h.sources[0]!.emit('change');
    await h.fire();
    expect(h.log.fetches).toBe(1); // still waiting for the first response
    h.respondWith(() => Promise.resolve('<p>second</p>'));
    release('<p>first</p>');
    await new Promise((resolve) => setImmediate(resolve));
    await h.fire();
    expect(h.log.fetches).toBe(2);
    expect(h.log.swaps).toEqual(['<p>first</p>', '<p>second</p>']);
  });

  it('ignores a failed or empty response and keeps working', async () => {
    const h = harness();
    h.live.open();
    h.respondWith(() => Promise.resolve(null));
    h.sources[0]!.emit('change');
    await h.fire();
    h.respondWith(() => Promise.reject(new Error('offline')));
    h.sources[0]!.emit('change');
    await h.fire();
    h.respondWith(() => Promise.resolve('<p>ok</p>'));
    h.sources[0]!.emit('change');
    await h.fire();
    expect(h.log.swaps).toEqual(['<p>ok</p>']);
  });

  it('catches up after a reconnect, but not on the very first connection', async () => {
    const h = harness();
    h.live.open();
    h.sources[0]!.emit('hello');
    expect(h.timers.size).toBe(0);
    h.sources[0]!.fail(CLOSED);
    await h.fire();
    h.sources[1]!.emit('hello');
    await h.fire();
    expect(h.log.fetches).toBe(1);
  });
});

describe('a refused connection (HTTP 503) is retried, not given up on', () => {
  it('keeps retrying forever with delays that grow and stop at the 30 s cap', async () => {
    const h = harness(1);
    h.live.open();
    const delays: number[] = [];
    for (let i = 0; i < 12; i++) {
      h.sources[i]!.fail(CLOSED);
      delays.push(...[...h.timers.values()].map((t) => t.ms));
      await h.fire();
    }
    expect(h.sources).toHaveLength(13);
    expect(delays.slice(0, 5)).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(Math.max(...delays)).toBe(30000);
    expect(delays.slice(5).every((d) => d === 30000)).toBe(true);
  });

  it('shows the live pill again as soon as a retry is accepted', async () => {
    const h = harness();
    h.live.open();
    h.sources[0]!.fail(CLOSED);
    await h.fire();
    h.sources[1]!.emit('hello');
    expect(h.log.live).toEqual([false, true]);
  });
});

describe('refreshSoon (used when a match slot starts or ends)', () => {
  it('schedules one jittered refresh, sharing the pipeline of change events', async () => {
    const h = harness(0.5);
    h.live.open();
    h.live.refreshSoon();
    h.live.refreshSoon();
    h.sources[0]!.emit('change');
    expect([...h.timers.values()].map((t) => t.ms)).toEqual([250]);
    await h.fire();
    expect(h.log.fetches).toBe(1);
  });
});
