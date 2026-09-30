import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalImageStore } from '../src/storage/local.js';
import { R2ImageStore } from '../src/storage/r2.js';
import { imageStoreFromEnv } from '../src/storage/from-env.js';

const dirs: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'img-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const bytes = new Uint8Array([1, 2, 3, 4, 5]);
const CACHE = 'public, max-age=31536000, immutable';

describe('LocalImageStore', () => {
  it('writes the object under its key, reads it back and serves it from /uploads', async () => {
    const dir = tmp();
    const store = new LocalImageStore(dir);
    await store.put('teams/1/2-ab.webp', bytes, 'image/webp', CACHE);
    expect(readFileSync(join(dir, 'teams/1/2-ab.webp'))).toEqual(Buffer.from(bytes));
    expect(store.publicUrl('teams/1/2-ab.webp')).toBe('/uploads/teams/1/2-ab.webp');
    expect(await store.read('teams/1/2-ab.webp')).toEqual(Buffer.from(bytes));
  });

  it('deletes objects and does not mind one that is already gone', async () => {
    const dir = tmp();
    const store = new LocalImageStore(dir);
    await store.put('teams/1/2-ab.webp', bytes, 'image/webp', CACHE);
    await store.delete('teams/1/2-ab.webp');
    expect(existsSync(join(dir, 'teams/1/2-ab.webp'))).toBe(false);
    await expect(store.delete('teams/1/2-ab.webp')).resolves.toBeUndefined();
  });

  it('refuses keys that could leave its folder', async () => {
    const store = new LocalImageStore(tmp());
    for (const key of ['../x.webp', 'teams/../../x.webp', '/etc/passwd', 'teams\\x.webp', '', 'a'.repeat(300)]) {
      await expect(store.put(key, bytes, 'image/webp', CACHE)).rejects.toThrow(/key/i);
      expect(await store.read(key)).toBeNull();
    }
  });
});

describe('R2ImageStore (no network: fetch is mocked)', () => {
  const config = {
    accountId: 'acc123',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secret',
    bucket: 'torneos',
    publicBaseUrl: 'https://pub-abc.r2.dev/',
  };
  const recorder = (status = 200) => {
    const calls: Request[] = [];
    const fetchImpl = async (input: Request | string | URL) => {
      calls.push(input as Request);
      return new Response(null, { status });
    };
    return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
  };

  it('PUTs a signed request to the S3-compatible endpoint with the right headers', async () => {
    const { calls, fetchImpl } = recorder();
    await new R2ImageStore(config, fetchImpl).put('teams/1/2-ab.webp', bytes, 'image/webp', CACHE);
    expect(calls).toHaveLength(1);
    const req = calls[0]!;
    expect(req.method).toBe('PUT');
    expect(req.url).toBe('https://acc123.r2.cloudflarestorage.com/torneos/teams/1/2-ab.webp');
    expect(req.headers.get('content-type')).toBe('image/webp');
    expect(req.headers.get('cache-control')).toBe(CACHE);
    expect(req.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[^,]+, Signature=[0-9a-f]{64}$/);
    expect(req.headers.get('x-amz-date')).toMatch(/^\d{8}T\d{6}Z$/);
    expect(req.headers.get('x-amz-content-sha256')).toMatch(/^[0-9a-f]{64}$/);
    expect(new Uint8Array(await req.arrayBuffer())).toEqual(bytes);
  });

  it('signs the real SHA-256 of the body, so R2 can reject a truncated or altered upload', async () => {
    const { calls, fetchImpl } = recorder();
    const payload = new Uint8Array(Array.from({ length: 2048 }, (_, i) => (i * 7) % 251));
    await new R2ImageStore(config, fetchImpl).put('teams/1/3-cd.webp', payload, 'image/webp', CACHE);
    const req = calls[0]!;
    const sent = Buffer.from(await req.arrayBuffer());
    expect(sent.equals(Buffer.from(payload))).toBe(true);
    expect(req.headers.get('x-amz-content-sha256')).toBe(createHash('sha256').update(sent).digest('hex'));
    expect(req.headers.get('x-amz-content-sha256')).not.toBe('UNSIGNED-PAYLOAD');
    expect(req.headers.get('authorization')).toContain('x-amz-content-sha256');
  });

  it('the secret never appears in the request', async () => {
    const { calls, fetchImpl } = recorder();
    await new R2ImageStore(config, fetchImpl).put('k.webp', bytes, 'image/webp', CACHE);
    const headers = [...calls[0]!.headers.entries()].flat().join(' ');
    expect(headers).not.toContain('secret');
  });

  it('DELETEs, and treats 204 and 404 as success', async () => {
    for (const status of [204, 404]) {
      const { calls, fetchImpl } = recorder(status);
      await new R2ImageStore(config, fetchImpl).delete('teams/1/2-ab.webp');
      expect(calls[0]!.method).toBe('DELETE');
      expect(calls[0]!.url).toBe('https://acc123.r2.cloudflarestorage.com/torneos/teams/1/2-ab.webp');
    }
  });

  it('fails loudly on a rejected request, without leaking credentials in the message', async () => {
    const { fetchImpl } = recorder(403);
    const store = new R2ImageStore(config, fetchImpl);
    await expect(store.put('k.webp', bytes, 'image/webp', CACHE)).rejects.toThrow(/403/);
    await expect(store.put('k.webp', bytes, 'image/webp', CACHE)).rejects.not.toThrow(/secret|AKIDEXAMPLE/);
    await expect(store.delete('k.webp')).rejects.toThrow(/403/);
  });

  it('builds public URLs from the public base URL (trailing slash tolerated)', () => {
    const store = new R2ImageStore(config, recorder().fetchImpl);
    expect(store.publicUrl('teams/1/2-ab.webp')).toBe('https://pub-abc.r2.dev/teams/1/2-ab.webp');
  });

  it('encodes reserved characters in keys but keeps the slashes', async () => {
    const { calls, fetchImpl } = recorder();
    await new R2ImageStore(config, fetchImpl).put('teams/1/a@2x.webp', bytes, 'image/webp', CACHE);
    expect(calls[0]!.url).toBe('https://acc123.r2.cloudflarestorage.com/torneos/teams/1/a%402x.webp');
  });
});

describe('choosing the store from the environment', () => {
  const r2 = { R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd', R2_PUBLIC_BASE_URL: 'https://pub.example' };

  it('uses R2 when all five variables are set', () => {
    const choice = imageStoreFromEnv({ ...r2, NODE_ENV: 'production' });
    expect(choice.kind).toBe('r2');
    expect(choice.store).toBeInstanceOf(R2ImageStore);
  });

  it('falls back to the local folder in development', () => {
    const choice = imageStoreFromEnv({});
    expect(choice.kind).toBe('local');
    expect(choice.store).toBeInstanceOf(LocalImageStore);
  });

  it('in production without R2, disables uploads unless local storage is explicitly allowed', () => {
    const off = imageStoreFromEnv({ NODE_ENV: 'production' });
    expect(off.kind).toBe('disabled');
    expect(off.store).toBeNull();
    expect(off.message).toMatch(/R2_/);
    expect(imageStoreFromEnv({ NODE_ENV: 'production', IMAGE_STORE: 'local' }).kind).toBe('local');
  });

  it('a partly filled R2 configuration fails fast, naming what is missing, in any environment', () => {
    const { R2_BUCKET: _a, R2_ACCOUNT_ID: _b, ...partial } = r2;
    for (const NODE_ENV of ['production', 'development']) {
      expect(() => imageStoreFromEnv({ ...partial, NODE_ENV })).toThrow(/Configuración de R2 incompleta: faltan R2_ACCOUNT_ID, R2_BUCKET\./);
    }
    expect(() => imageStoreFromEnv({ ...r2, R2_BUCKET: '   ' })).toThrow(/R2_BUCKET/);
  });

  it('honours IMAGES_DIR for the local folder', () => {
    const dir = tmp();
    const choice = imageStoreFromEnv({ IMAGES_DIR: dir });
    expect(choice.kind).toBe('local');
    expect((choice.store as LocalImageStore).dir).toBe(dir);
  });
});
