import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Throttle {
  trigger(): void;
  cancel(): void;
}
interface Core {
  createThrottle(run: () => void, ms: number, timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }): Throttle;
  newKeys(before: string[], after: string[]): string[];
}
const sandbox: Record<string, unknown> = {};
runInNewContext(readFileSync(new URL('../public/admin-live-core.js', import.meta.url), 'utf8'), sandbox);
const core = sandbox.AdminLiveCore as Core;

describe('createThrottle', () => {
  let run: ReturnType<typeof vi.fn<() => void>>;
  let th: Throttle;
  beforeEach(() => {
    vi.useFakeTimers();
    run = vi.fn<() => void>();
    th = core.createThrottle(run, 3000, { setTimeout: ((f: () => void, ms: number) => setTimeout(f, ms)) as typeof setTimeout, clearTimeout: ((id: never) => clearTimeout(id)) as typeof clearTimeout });
  });
  afterEach(() => vi.useRealTimers());

  it('runs at once on the first event (leading)', () => {
    th.trigger();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst into one trailing run after the window', () => {
    th.trigger();
    th.trigger();
    th.trigger();
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2999);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps at most one run per window under steady events', () => {
    for (let s = 0; s < 9; s++) {
      th.trigger();
      vi.advanceTimersByTime(1000);
    }
    expect(run.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('runs leading again once the window passed quietly', () => {
    th.trigger();
    vi.advanceTimersByTime(3000);
    th.trigger();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('cancel drops the pending run', () => {
    th.trigger();
    th.trigger();
    th.cancel();
    vi.advanceTimersByTime(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('newKeys', () => {
  it('returns keys that were not there before, in order', () => {
    expect(core.newKeys(['1', '2'], ['3', '1', '4', '2'])).toEqual(['3', '4']);
  });
  it('is empty when nothing is new', () => {
    expect(core.newKeys(['1'], ['1'])).toEqual([]);
    expect(core.newKeys(['1', '2'], [])).toEqual([]);
  });
  it('treats everything as new from an empty list', () => {
    expect(core.newKeys([], ['5'])).toEqual(['5']);
  });
});
