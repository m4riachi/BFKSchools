import sharp, { type Metadata, type Sharp } from 'sharp'
import { MEAL_PHOTOS } from '#config/meals'

/**
 * Keep libvips from caching decoded images between uploads (memory stays
 * bounded to the image being processed).
 */
sharp.cache(false)

export type ImageFormat = (typeof MEAL_PHOTOS.formats)[number]

export type InvalidImageReason = 'type' | 'too_large' | 'too_many_pixels' | 'too_small' | 'corrupt'

export class InvalidImageError extends Error {
  constructor(readonly reason: InvalidImageReason) {
    super(`Invalid image: ${reason}`)
  }
}

export type EncodedImage = { data: Buffer; width: number; height: number; size: number }

/**
 * Detects JPEG / PNG / WebP from the first bytes of the file. The client's
 * file name, extension and Content-Type are never trusted.
 */
export function detectImageFormat(buffer: Buffer): ImageFormat | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg'
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png'
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}

/**
 * Validates an uploaded photo by content and re-encodes it:
 * - magic bytes must be JPEG/PNG/WebP, and sharp must decode the same format
 *   (no SVG, TIFF, HEIF, PDF… even though libvips could read them);
 * - `limitInputPixels` guards against decompression bombs; only the first
 *   frame of animated files is read;
 * - EXIF orientation is applied, then every metadata block (EXIF, GPS, XMP,
 *   ICC, comments) is dropped — sharp strips metadata unless asked to keep it;
 * - outputs: WebP ≤ 1600 px (longest side) and a WebP thumbnail ≤ 400 px.
 */
export default class ImageProcessor {
  async process(input: Buffer): Promise<{ full: EncodedImage; thumb: EncodedImage }> {
    if (input.length === 0 || input.length > MEAL_PHOTOS.maxFileBytes) {
      throw new InvalidImageError(input.length === 0 ? 'corrupt' : 'too_large')
    }
    const format = detectImageFormat(input)
    if (!format) throw new InvalidImageError('type')

    const options = {
      limitInputPixels: MEAL_PHOTOS.maxInputPixels,
      failOn: 'error' as const,
      animated: false,
    }

    let metadata: Metadata
    try {
      metadata = await sharp(input, options).metadata()
    } catch (error) {
      throw this.decodeError(error)
    }
    if (metadata.format !== format) throw new InvalidImageError('type')
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    if (width * height > MEAL_PHOTOS.maxInputPixels) {
      throw new InvalidImageError('too_many_pixels')
    }
    if (Math.min(width, height) < MEAL_PHOTOS.minSide) throw new InvalidImageError('too_small')

    try {
      const full = await this.encode(
        sharp(input, options).autoOrient(),
        MEAL_PHOTOS.fullSize,
        MEAL_PHOTOS.webpQuality
      )
      const thumb = await this.encode(
        sharp(full.data, options),
        MEAL_PHOTOS.thumbSize,
        MEAL_PHOTOS.thumbQuality
      )
      return { full, thumb }
    } catch (error) {
      throw this.decodeError(error)
    }
  }

  protected async encode(image: Sharp, size: number, quality: number) {
    const { data, info } = await image
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height, size: data.length }
  }

  protected decodeError(error: unknown) {
    if (error instanceof InvalidImageError) return error
    const message = error instanceof Error ? error.message : ''
    return new InvalidImageError(/pixel limit/i.test(message) ? 'too_many_pixels' : 'corrupt')
  }
}
