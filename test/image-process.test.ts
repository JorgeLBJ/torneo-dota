import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, processTeamImage } from '../src/images/process.js';

const WRONG_TYPE = 'La imagen debe ser JPG, PNG o WebP de hasta 5 MB.';

const photo = (width: number, height: number, format: 'jpeg' | 'png' | 'webp' = 'jpeg') =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .composite([{ input: Buffer.from(`<svg width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 3}" fill="#224"/></svg>`) }])
    [format]()
    .toBuffer();

const ok = async (input: Uint8Array) => {
  const result = await processTeamImage(input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

describe('accepting images', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('turns a %s into WebP at exactly 512x288 and 1024x576', async (format) => {
    const { x1, x2 } = await ok(await photo(1600, 900, format));
    const a = await sharp(x1).metadata();
    const b = await sharp(x2).metadata();
    expect([a.format, a.width, a.height]).toEqual(['webp', 512, 288]);
    expect([b.format, b.width, b.height]).toEqual(['webp', 1024, 576]);
  });

  it('crops to cover whatever the aspect ratio (tall, wide, square, tiny)', async () => {
    for (const [w, h] of [[600, 1200], [3000, 400], [500, 500], [64, 36]]) {
      const { x1, x2 } = await ok(await photo(w!, h!));
      expect(await sharp(x1).metadata()).toMatchObject({ width: 512, height: 288 });
      expect(await sharp(x2).metadata()).toMatchObject({ width: 1024, height: 576 });
    }
  });

  it('produces small files', async () => {
    const { x1, x2 } = await ok(await photo(1600, 900));
    expect(x1.length).toBeLessThan(40 * 1024);
    expect(x2.length).toBeLessThan(120 * 1024);
  });

  it('strips metadata (EXIF, ICC) from the output', async () => {
    const withExif = await sharp(await photo(800, 450)).withExif({ IFD0: { Copyright: 'secret-owner', Artist: 'someone' } }).jpeg().toBuffer();
    const { x1 } = await ok(withExif);
    const meta = await sharp(x1).metadata();
    expect(meta.exif).toBeUndefined();
    expect(x1.includes(Buffer.from('secret-owner'))).toBe(false);
  });

  it('applies the EXIF orientation before cropping', async () => {
    // Stored 100x50: red left half, blue right half; orientation 6 = display rotated 90 degrees clockwise,
    // so on screen red is on top and blue at the bottom.
    const raw = await sharp({ create: { width: 100, height: 50, channels: 3, background: { r: 0, g: 0, b: 255 } } })
      .composite([{ input: { create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } } }, left: 0, top: 0 }])
      .jpeg({ quality: 100 })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const { x1 } = await ok(raw);
    const { data, info } = await sharp(x1).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [data[(y * info.width + x) * 3]!, data[(y * info.width + x) * 3 + 2]!];
    const [topRed, topBlue] = pixel(256, 10);
    const [bottomRed, bottomBlue] = pixel(256, 278);
    expect(topRed).toBeGreaterThan(200);
    expect(topBlue).toBeLessThan(60);
    expect(bottomBlue).toBeGreaterThan(200);
    expect(bottomRed).toBeLessThan(60);
  });

  it('accepts the 5 MB limit and 8000 px on a side', async () => {
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
    const wide = await photo(8000, 16, 'png');
    expect((await processTeamImage(wide)).ok).toBe(true);
  });
});

describe('rejecting what is not a usable image', () => {
  const fails = async (input: Uint8Array, message: string) => {
    const result = await processTeamImage(input);
    expect(result).toEqual({ ok: false, error: message });
  };

  it('text, renamed or not, and empty input', async () => {
    await fails(Buffer.from('hola, esto no es una imagen'), WRONG_TYPE);
    await fails(new Uint8Array(0), WRONG_TYPE);
    await fails(Buffer.from('<?php echo 1; ?>'), WRONG_TYPE);
  });

  it('formats that are images but not allowed: GIF, SVG, TIFF', async () => {
    const raw = { create: { width: 40, height: 40, channels: 3 as const, background: '#fff' } };
    await fails(await sharp(raw).gif().toBuffer(), WRONG_TYPE);
    await fails(await sharp(raw).tiff().toBuffer(), WRONG_TYPE);
    await fails(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'), WRONG_TYPE);
  });

  it('a file that starts like a JPEG but is cut off or corrupt', async () => {
    const good = await photo(800, 450);
    await fails(good.subarray(0, 40), WRONG_TYPE);
    const corrupt = Buffer.from(good);
    corrupt.fill(0x41, 200, corrupt.length - 10);
    await fails(corrupt, WRONG_TYPE);
  });

  it('anything over 5 MB, before decoding it', async () => {
    await fails(Buffer.alloc(MAX_IMAGE_BYTES + 1, 1), WRONG_TYPE);
  });

  it('dimensions over 8000 px', async () => {
    const result = await processTeamImage(await photo(8001, 10, 'png'));
    expect(result).toEqual({ ok: false, error: 'La imagen es demasiado grande: el máximo es 8000 px por lado y 25 megapíxeles.' });
  });

  it('a decompression bomb: a small file that would decode to 49 megapixels', async () => {
    const bomb = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(MAX_IMAGE_BYTES);
    const result = await processTeamImage(bomb);
    expect(result).toEqual({ ok: false, error: 'La imagen es demasiado grande: el máximo es 8000 px por lado y 25 megapíxeles.' });
  });
});

describe('what the cropper sends: a 1024x576 picture, possibly with transparency', () => {
  const rgba = async (buf: Buffer) => sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (img: { data: Buffer; info: { width: number } }, x: number, y: number) => {
    const i = (y * img.info.width + x) * 4;
    return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!];
  };

  // A logo letterboxed in 16:9: transparent margins, an opaque red square in the middle, a half-transparent stripe.
  const logo = async () =>
    sharp({ create: { width: 1024, height: 576, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([
        { input: { create: { width: 400, height: 576, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }, left: 312, top: 0 },
        { input: { create: { width: 100, height: 576, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.5 } } }, left: 0, top: 0 },
      ])
      .png()
      .toBuffer();

  it('keeps the alpha channel in both WebP files', async () => {
    const { x1, x2 } = await ok(await logo());
    for (const [file, scale] of [[x2, 1], [x1, 0.5]] as const) {
      const meta = await sharp(file).metadata();
      expect(meta.hasAlpha).toBe(true);
      const img = await rgba(file);
      expect(at(img, Math.round(200 * scale), Math.round(300 * scale))[3]).toBe(0); // transparent margin
      expect(at(img, Math.round(512 * scale), Math.round(300 * scale))[3]).toBe(255); // opaque logo
      const stripe = at(img, Math.round(40 * scale), Math.round(300 * scale))[3];
      expect(stripe).toBeGreaterThan(110);
      expect(stripe).toBeLessThan(150);
    }
  });

  it('does not crop or shift a picture that is already 16:9', async () => {
    const edges = await sharp({ create: { width: 1024, height: 576, channels: 3, background: '#808080' } })
      .composite([
        { input: { create: { width: 1024, height: 4, channels: 3, background: '#ff0000' } }, left: 0, top: 0 },
        { input: { create: { width: 1024, height: 4, channels: 3, background: '#0000ff' } }, left: 0, top: 572 },
        { input: { create: { width: 4, height: 576, channels: 3, background: '#00ff00' } }, left: 0, top: 0 },
      ])
      .png()
      .toBuffer();
    const { x2 } = await ok(edges);
    const img = await rgba(x2);
    expect(img.info).toMatchObject({ width: 1024, height: 576 });
    const top = at(img, 600, 1);
    const bottom = at(img, 600, 574);
    const left = at(img, 1, 300);
    expect(top[0]).toBeGreaterThan(200);
    expect(top[2]).toBeLessThan(60);
    expect(bottom[2]).toBeGreaterThan(200);
    expect(bottom[0]).toBeLessThan(60);
    expect(left[1]).toBeGreaterThan(200);
    expect(left[0]).toBeLessThan(60);
  });

  it('opaque inputs stay opaque and small', async () => {
    const { x1 } = await ok(await photo(1024, 576, 'png'));
    const img = await rgba(x1);
    expect(at(img, 10, 10)[3]).toBe(255);
    expect(x1.length).toBeLessThan(40 * 1024);
  });
});
