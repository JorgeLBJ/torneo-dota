import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tournament } from '../src/db/repository.js';
import { makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
let tournament: Tournament;
let other: Tournament;

const decoder = new TextDecoder();

const pending = new WeakMap<ReadableStreamDefaultReader<Uint8Array>, Promise<string>>();

/**
 * Reads the next chunk of an SSE body, or '' if nothing arrives within `ms`.
 * A read that timed out stays pending and is reused, so a late chunk is never lost.
 */
async function nextChunk(reader: ReadableStreamDefaultReader<Uint8Array>, ms = 500): Promise<string> {
  const read = pending.get(reader) ?? reader.read().then(({ value }) => (value ? decoder.decode(value) : ''));
  pending.set(reader, read);
  const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(''), ms));
  const text = await Promise.race([read, timeout]);
  if (text !== '' || (await Promise.race([read, Promise.resolve(null)])) !== null) pending.delete(reader);
  return text;
}

async function open(path: string, app: TestApp = t) {
  const res = await app.get(path);
  return { res, reader: res.body!.getReader() };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const listeners = () => t.events.emitter.listenerCount(`tournament:${tournament.id}:changed`) + t.events.emitter.listenerCount('tournament:any:changed');

beforeEach(async () => {
  t = await makeApp();
  tournament = t.repo.createTournament({ name: 'Torneo Oct', slug: 'torneo-oct' });
  other = t.repo.createTournament({ name: 'Copa Nov', slug: 'copa-nov' });
  t.repo.setActiveTournament(tournament.id);
});
afterEach(() => t.db.close());

describe('per-tournament stream', () => {
  it('answers 404 for an unknown tournament', async () => {
    const res = await t.get('/t/nope/events');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).not.toContain('text/event-stream');
  });

  it('opens with a hello event and the right headers, framing allowed', async () => {
    const { res, reader } = await open('/t/torneo-oct/events');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    expect(res.headers.get('x-frame-options')).toBeNull();
    expect(await nextChunk(reader)).toContain('event: hello');
    await reader.cancel();
  });

  it('pushes a change event when that tournament changes, and ignores other tournaments', async () => {
    const { reader } = await open('/t/torneo-oct/events');
    await nextChunk(reader);
    t.events.tournamentChanged(other.id);
    expect(await nextChunk(reader, 100)).toBe('');
    t.events.tournamentChanged(tournament.id);
    expect(await nextChunk(reader)).toContain('event: change');
    await reader.cancel();
  });

  it('sends a heartbeat on the configured interval', async () => {
    const fast = await makeApp({ heartbeatMs: 15 });
    fast.repo.createTournament({ name: 'Cup', slug: 'cup' });
    const { reader } = await open('/t/cup/events', fast);
    await nextChunk(reader);
    expect(await nextChunk(reader)).toContain('event: ping');
    await reader.cancel();
    fast.db.close();
  });

  it('removes its listener when the client goes away', async () => {
    expect(listeners()).toBe(0);
    const { reader } = await open('/t/torneo-oct/events');
    await nextChunk(reader);
    expect(listeners()).toBe(1);
    await reader.cancel();
    await settle();
    expect(listeners()).toBe(0);
  });
});

describe('root stream (follows the active tournament)', () => {
  it('pushes changes of the active tournament only', async () => {
    const { reader } = await open('/events');
    expect(await nextChunk(reader)).toContain('event: hello');
    t.events.tournamentChanged(other.id);
    expect(await nextChunk(reader, 100)).toBe('');
    t.events.tournamentChanged(tournament.id);
    expect(await nextChunk(reader)).toContain('event: change');
    await reader.cancel();
  });

  it('pushes when another tournament becomes active, even if the stream started before it', async () => {
    const { reader } = await open('/events');
    await nextChunk(reader);
    t.repo.setActiveTournament(other.id);
    t.events.tournamentChanged(other.id);
    t.events.tournamentChanged(tournament.id);
    expect(await nextChunk(reader)).toContain('event: change');
    // From now on the new active tournament is the one that matters.
    t.events.tournamentChanged(other.id);
    expect(await nextChunk(reader)).toContain('event: change');
    await reader.cancel();
  });

  it('wakes a "Próximamente" page when the first tournament is activated', async () => {
    t.db.prepare('UPDATE tournaments SET is_active = 0').run();
    const { reader } = await open('/events');
    await nextChunk(reader);
    t.repo.setActiveTournament(tournament.id);
    t.events.tournamentChanged(tournament.id);
    expect(await nextChunk(reader)).toContain('event: change');
    await reader.cancel();
    await settle();
    expect(listeners()).toBe(0);
  });
});

describe('connection limits', () => {
  const from = (ip: string) => ({ headers: { 'x-forwarded-for': ip } });
  const openFrom = async (app: TestApp, ip: string) => {
    const res = await app.send('GET', '/t/torneo-oct/events', from(ip));
    return { res, reader: res.body?.getReader() };
  };

  it('answers 503 with Retry-After beyond the per-client limit, and frees the slot on disconnect', async () => {
    const limited = await makeApp({ trustProxy: true, sseLimits: { global: 100, perIp: 2 } });
    limited.repo.createTournament({ name: 'Torneo Oct', slug: 'torneo-oct' });
    const a = await openFrom(limited, '9.9.9.9');
    const b = await openFrom(limited, '9.9.9.9');
    const c = await openFrom(limited, '9.9.9.9');
    expect([a.res.status, b.res.status, c.res.status]).toEqual([200, 200, 503]);
    expect(c.res.headers.get('retry-after')).toBe('30');
    expect((await openFrom(limited, '8.8.8.8')).res.status).toBe(200);
    await a.reader!.cancel();
    await settle();
    expect((await openFrom(limited, '9.9.9.9')).res.status).toBe(200);
    limited.db.close();
  });

  it('answers 503 beyond the global limit', async () => {
    const limited = await makeApp({ trustProxy: true, sseLimits: { global: 2, perIp: 10 } });
    limited.repo.createTournament({ name: 'Torneo Oct', slug: 'torneo-oct' });
    expect((await openFrom(limited, '1.1.1.1')).res.status).toBe(200);
    expect((await openFrom(limited, '2.2.2.2')).res.status).toBe(200);
    const over = await limited.send('GET', '/t/torneo-oct/events', from('3.3.3.3'));
    expect(over.status).toBe(503);
    expect(await over.text()).toContain('Demasiadas conexiones');
    limited.db.close();
  });

  it('does not count refused connections or plain page loads', async () => {
    const limited = await makeApp({ trustProxy: true, sseLimits: { global: 1, perIp: 1 } });
    limited.repo.createTournament({ name: 'Torneo Oct', slug: 'torneo-oct' });
    expect((await limited.send('GET', '/t/torneo-oct', from('5.5.5.5'))).status).toBe(200);
    expect((await openFrom(limited, '5.5.5.5')).res.status).toBe(200);
    expect((await openFrom(limited, '5.5.5.5')).res.status).toBe(503);
    limited.db.close();
  });
});

describe('root stream fan-out', () => {
  it('looks up the active tournament once per event, however many clients listen', async () => {
    const readers = await Promise.all([1, 2, 3, 4, 5].map(() => open('/events')));
    for (const { reader } of readers) await nextChunk(reader);
    const spy = vi.spyOn(t.repo, 'getActiveTournament');
    t.events.tournamentChanged(tournament.id);
    for (const { reader } of readers) expect(await nextChunk(reader)).toContain('event: change');
    expect(spy).toHaveBeenCalledTimes(1);
    for (const { reader } of readers) await reader.cancel();
    await settle();
    expect(t.events.emitter.listenerCount('tournament:any:changed')).toBe(0);
    spy.mockRestore();
  });
});

describe('over a real socket', () => {
  it('unsubscribes when the connection is dropped', async () => {
    const server = serve({ fetch: t.app.fetch, port: 0 });
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const req = request({ port, path: '/t/torneo-oct/events' });
    const opened = new Promise<string>((resolve) => {
      req.on('response', (res) => res.once('data', (chunk: Buffer) => resolve(chunk.toString())));
    });
    req.end();
    expect(await opened).toContain('event: hello');
    expect(listeners()).toBe(1);
    req.destroy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(listeners()).toBe(0);
    server.close();
  });
});
