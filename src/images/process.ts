import sharp from 'sharp';
import { fail, ok, type Checked } from '../checked.js';

// Turns an uploaded picture into the two WebP files the site serves for a team emblem.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 8000;
/** Decoded size guard: 25 megapixels is a 6000x4000 camera photo, and stays safe inside a 256 MB container. */
export const MAX_IMAGE_PIXELS = 25_000_000;
const ALLOWED = new Set(['jpeg', 'png', 'webp']);

/** The avatar slot is 16:9: one file for normal screens, one at twice the size for dense ones. */
const SIZES = { x1: { width: 512, height: 288 }, x2: { width: 1024, height: 576 } } as const;

const INVALID = 'La imagen debe ser JPG, PNG o WebP de hasta 5 MB.';
const TOO_BIG = `La imagen es demasiado grande: el máximo es ${MAX_IMAGE_SIDE} px por lado y 25 megapíxeles.`;

export interface ProcessedImage {
  x1: Buffer;
  x2: Buffer;
}

/**
 * Validates by decoding (the file name and the declared type are never trusted), then auto-orients, crops to
 * cover, drops all metadata and encodes WebP. The pixel limit stops decompression bombs before they are decoded.
 */
export async function processTeamImage(input: Uint8Array): Promise<Checked<ProcessedImage>> {
  if (input.byteLength === 0 || input.byteLength > MAX_IMAGE_BYTES) return fail(INVALID);
  const open = () => sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' });
  try {
    const meta = await open().metadata();
    if (!meta.format || !ALLOWED.has(meta.format)) return fail(INVALID);
    if ((meta.width ?? 0) > MAX_IMAGE_SIDE || (meta.height ?? 0) > MAX_IMAGE_SIDE) return fail(TOO_BIG);
    if (meta.pages && meta.pages > 1) return fail(INVALID); // animated

    // Decode the upload once: orient, crop to cover at the larger size, keep that lossless...
    const master = await open()
      .rotate() // apply the EXIF orientation
      .resize(SIZES.x2.width, SIZES.x2.height, { fit: 'cover', position: 'centre' })
      .png({ compressionLevel: 0 })
      .toBuffer();
    // ...and encode both sizes from it (sharp writes no metadata unless asked).
    const webp = { quality: 82, effort: 5 } as const;
    const x2 = await sharp(master).webp(webp).toBuffer();
    const x1 = await sharp(master).resize(SIZES.x1.width, SIZES.x1.height).webp(webp).toBuffer();
    return ok({ x1, x2 });
  } catch (error) {
    // Pixel-limit errors are the bomb guard; anything else means the bytes did not decode as an image.
    return fail(/pixel limit/i.test((error as Error).message) ? TOO_BIG : INVALID);
  }
}
