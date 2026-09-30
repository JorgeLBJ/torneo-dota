import { createHash } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { SAFE_KEY, type ImageStore } from './image-store.js';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Public base URL of the bucket (r2.dev or a custom domain). */
  publicBaseUrl: string;
}

/**
 * Cloudflare R2 through its S3-compatible API. Requests are signed with SigV4 by `aws4fetch` (a few hundred
 * lines, no dependencies) instead of the much larger AWS SDK; only PUT and DELETE are needed.
 */
export class R2ImageStore implements ImageStore {
  private readonly client: AwsClient;
  private readonly endpoint: string;
  private readonly publicBase: string;

  constructor(
    private readonly config: R2Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.client = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: 's3', region: 'auto' });
    this.endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
    this.publicBase = config.publicBaseUrl.replace(/\/+$/, '');
  }

  private objectUrl(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error(`Invalid image key "${key}"`);
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    return `${this.endpoint}/${this.config.bucket}/${encoded}`;
  }

  async put(key: string, bytes: Uint8Array, contentType: string, cacheControl: string): Promise<void> {
    const signed = await this.client.sign(this.objectUrl(key), {
      method: 'PUT',
      body: new Blob([bytes as BlobPart]),
      // Signing the payload hash (not UNSIGNED-PAYLOAD) lets R2 reject an upload that was altered or truncated.
      headers: {
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
        'X-Amz-Content-Sha256': createHash('sha256').update(bytes).digest('hex'),
      },
    });
    const res = await this.fetchImpl(signed);
    if (!res.ok) throw new Error(`R2 PUT ${key} failed with status ${res.status}`);
  }

  async delete(key: string): Promise<void> {
    const signed = await this.client.sign(this.objectUrl(key), { method: 'DELETE' });
    const res = await this.fetchImpl(signed);
    if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${key} failed with status ${res.status}`);
  }

  publicUrl(key: string): string {
    return `${this.publicBase}/${key}`;
  }
}
