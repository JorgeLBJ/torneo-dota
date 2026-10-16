import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MAX_BANNER_BYTES, processBannerImage } from '../src/images/process.js';

const WRONG_TYPE = 'La imagen debe ser JPG, PNG o WebP de hasta 10 MB.';

const picture = (width: number, height: number, format: 'jpeg' | 'png' | 'webp' = 'png') =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 60, b: 120 } } })
    .composite([{ input: Buffer.from(`<svg width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 3}" fill="#e6b65f"/></svg>`) }])
    [format]()
    .toBuffer();

const ok = async (input: Uint8Array) => {
  const result = await processBannerImage(input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

describe('processBannerImage', () => {
  it('limits uploads to 10 MB, separately from the 5 MB emblem limit', () => {
    expect(MAX_BANNER_BYTES).toBe(10 * 1024 * 1024);
  });

  it.each(['jpeg', 'png', 'webp'] as const)('turns a %s into WebP at 1920 and 1280 px wide, aspect kept', async (format) => {
    const out = await ok(await picture(2400, 1350, format));
    expect(await sharp(out.large.bytes).metadata()).toMatchObject({ format: 'webp', width: 1920, height: 1080 });
    expect(await sharp(out.small.bytes).metadata()).toMatchObject({ format: 'webp', width: 1280, height: 720 });
    expect(out.large).toMatchObject({ width: 1920, height: 1080 });
    expect(out.small).toMatchObject({ width: 1280, height: 720 });
  });

  it('does not crop: a tall picture keeps its proportions', async () => {
    const out = await ok(await picture(1000, 2000));
    expect(await sharp(out.large.bytes).metadata()).toMatchObject({ width: 1000, height: 2000 });
    expect(await sharp(out.small.bytes).metadata()).toMatchObject({ width: 1000, height: 2000 });
  });

  it('never enlarges a small image', async () => {
    const out = await ok(await picture(1000, 500));
    expect(out.large).toMatchObject({ width: 1000, height: 500 });
    expect(out.small).toMatchObject({ width: 1000, height: 500 });
  });

  it('only shrinks the small variant when the picture is between 1280 and 1920', async () => {
    const out = await ok(await picture(1600, 900));
    expect(out.large).toMatchObject({ width: 1600, height: 900 });
    expect(out.small).toMatchObject({ width: 1280, height: 720 });
  });

  it('applies the EXIF orientation and drops metadata', async () => {
    const tagged = await sharp(await picture(400, 200, 'jpeg')).withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'secret' } } }).jpeg().toBuffer();
    const out = await ok(tagged);
    const meta = await sharp(out.large.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([200, 400]);
    expect(meta.exif).toBeUndefined();
  });

  it('produces much smaller files than a PNG', async () => {
    const png = await picture(1920, 1080, 'png');
    const out = await ok(png);
    expect(out.large.bytes.length).toBeLessThan(png.length);
    expect(out.small.bytes.length).toBeLessThan(out.large.bytes.length);
  });

  it('rejects something that is not an image', async () => {
    const result = await processBannerImage(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'));
    expect(result).toEqual({ ok: false, error: WRONG_TYPE });
  });

  it('rejects an empty upload and one over 10 MB', async () => {
    expect(await processBannerImage(new Uint8Array(0))).toEqual({ ok: false, error: WRONG_TYPE });
    expect(await processBannerImage(new Uint8Array(MAX_BANNER_BYTES + 1))).toEqual({ ok: false, error: WRONG_TYPE });
  });

  it('rejects a picture above the side guard', async () => {
    const wide = await sharp({ create: { width: 8001, height: 10, channels: 3, background: '#000' } }).png().toBuffer();
    const result = await processBannerImage(wide);
    expect(result.ok).toBe(false);
  });
});
