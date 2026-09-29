import { describe, expect, it, vi } from 'vitest';
import { createShutdown } from '../src/shutdown.js';

function harness(overrides: { closeError?: Error; hangClose?: boolean } = {}) {
  const calls: string[] = [];
  let closeCallback: ((error?: Error) => void) | undefined;
  const server = {
    close: vi.fn((cb?: (error?: Error) => void) => {
      calls.push('server.close');
      closeCallback = cb;
      if (!overrides.hangClose) queueMicrotask(() => cb?.(overrides.closeError));
    }),
    closeAllConnections: vi.fn(() => calls.push('closeAllConnections')),
    closeIdleConnections: vi.fn(() => calls.push('closeIdleConnections')),
  };
  const db = { close: vi.fn(() => calls.push('db.close')) };
  const exit = vi.fn((code: number) => calls.push(`exit(${code})`));
  const log: string[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const shutdown = createShutdown({
    server,
    db,
    exit,
    log: (m) => log.push(m),
    timeoutMs: 10_000,
    setTimeout: (fn, ms) => {
      const timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (t) => void ((t as unknown as { cleared: boolean }).cleared = true),
  });
  return { shutdown, calls, log, server, db, exit, timers, finishClose: () => closeCallback?.() };
}

describe('graceful shutdown', () => {
  it('stops accepting, drops live connections (SSE), closes the database, then exits 0', async () => {
    const h = harness();
    await h.shutdown('SIGTERM');
    expect(h.calls).toEqual(['server.close', 'closeAllConnections', 'db.close', 'exit(0)']);
    expect(h.log[0]).toMatch(/SIGTERM/);
    expect(h.log.at(-1)).toMatch(/closed cleanly|Shutdown complete/i);
  });

  it('handles SIGINT the same way', async () => {
    const h = harness();
    await h.shutdown('SIGINT');
    expect(h.calls).toContain('db.close');
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it('runs only once when several signals arrive', async () => {
    const h = harness();
    await Promise.all([h.shutdown('SIGTERM'), h.shutdown('SIGINT'), h.shutdown('SIGTERM')]);
    expect(h.server.close).toHaveBeenCalledTimes(1);
    expect(h.db.close).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledTimes(1);
  });

  it('still closes the database and exits 1 when the server fails to close', async () => {
    const h = harness({ closeError: new Error('boom') });
    await h.shutdown('SIGTERM');
    expect(h.db.close).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(1);
  });

  it('gives up waiting after the timeout: closes the database anyway and exits 1', async () => {
    const h = harness({ hangClose: true });
    const done = h.shutdown('SIGTERM');
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(10_000);
    h.timers[0]!.fn();
    await done;
    expect(h.db.close).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(1);
    expect(h.log.join(' ')).toMatch(/timed out|timeout/i);
  });

  it('cancels the timeout when it finishes in time', async () => {
    const h = harness();
    await h.shutdown('SIGTERM');
    expect(h.timers[0]!.cleared).toBe(true);
  });

  it('survives a database that throws on close', async () => {
    const h = harness();
    h.db.close.mockImplementation(() => {
      throw new Error('locked');
    });
    await h.shutdown('SIGTERM');
    expect(h.exit).toHaveBeenCalledWith(1);
  });
});
