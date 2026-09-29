import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
