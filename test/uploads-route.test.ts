import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalImageStore } from '../src/storage/local.js';
import { makeApp, type TestApp } from './helpers/app.js';

let dir: string;
let t: TestApp;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'uploads-'));
  mkdirSync(join(dir, 'teams/1'), { recursive: true });
  writeFileSync(join(dir, 'teams/1/2-ab12.webp'), Buffer.from('RIFFxxxxWEBP'));
  writeFileSync(join(dir, '..', 'outside-secret.txt'), 'top secret');
  t = await makeApp({ imageStore: new LocalImageStore(dir) });
});
afterEach(() => {
  t.db.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(dir, '..', 'outside-secret.txt'), { force: true });
});

describe('GET /uploads/* (local image store)', () => {
  it('serves a stored image as WebP with long-lived immutable caching', async () => {
    const res = await t.get('/uploads/teams/1/2-ab12.webp');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('RIFFxxxxWEBP');
  });

  it('answers 404 for a missing file, a folder and the bare prefix', async () => {
    for (const path of ['/uploads/teams/1/nope.webp', '/uploads/teams/1', '/uploads/teams', '/uploads/']) {
      expect((await t.get(path)).status).toBe(404);
    }
  });

  it('never leaves the uploads folder, however the traversal is spelled', async () => {
    for (const path of [
      '/uploads/../outside-secret.txt',
      '/uploads/teams/../../outside-secret.txt',
      '/uploads/%2e%2e/outside-secret.txt',
      '/uploads/teams/1/%2e%2e/%2e%2e/%2e%2e/outside-secret.txt',
      '/uploads/..%2foutside-secret.txt',
      '/uploads/teams%5c..%5c..%5coutside-secret.txt',
      '/uploads//etc/passwd',
    ]) {
      const res = await t.get(path);
      expect(res.status, path).not.toBe(200);
      expect(await res.text(), path).not.toContain('top secret');
    }
  });

  it('does not exist when the store is not the local folder', async () => {
    const other = await makeApp({ imageStore: null });
    expect((await other.get('/uploads/teams/1/2-ab12.webp')).status).toBe(404);
    other.db.close();
  });
});
