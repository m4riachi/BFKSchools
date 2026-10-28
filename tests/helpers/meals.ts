import { deflateSync, crc32 } from 'node:zlib'
import sharp from 'sharp'
import drive from '@adonisjs/drive/services/main'
import { UserFactory } from '#database/factories/user_factory'
import { MealFactory } from '#database/factories/meal_factory'
import MealPhoto from '#models/meal_photo'
import type Meal from '#models/meal'

/** A manager (meals are BFK-wide: no school needed). */
export function createStaff(role: 'admin' | 'manager' | 'kitchen' | 'parent' = 'manager') {
  return UserFactory.apply(role).create()
}

export function createMeal(overrides: Partial<Meal> = {}) {
  return MealFactory.merge(overrides).create()
}

/** Tiny fixture images generated on the fly (no binary files in the repo). */
export function pngBuffer(width = 32 * 3, height = 32 * 2) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } },
  })
    .png()
    .toBuffer()
}

/** A JPEG carrying EXIF data (copyright + GPS) to check that it is stripped. */
export function jpegWithExif(width = 120, height = 90) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 140, b: 90 } },
  })
    .jpeg()
    .withExif({
      IFD0: { Copyright: 'Secret Kitchen', Artist: 'Spy' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '33/1 35/1 0/1' },
    })
    .toBuffer()
}

export function webpBuffer(width = 80, height = 80) {
  return sharp({
    create: { width, height, channels: 4, background: { r: 10, g: 10, b: 200, alpha: 1 } },
  })
    .webp()
    .toBuffer()
}

/**
 * A structurally valid PNG whose header claims width × height pixels (a
 * decompression bomb: the pixel data itself is never decoded).
 */
export function hugePngHeader(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(width + 1))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export async function photosOf(mealId: number) {
  return MealPhoto.query().where('meal_id', mealId).orderBy('position').orderBy('id')
}

/** Reads a stored file from the (fake) fs disk. */
export async function storedBytes(key: string) {
  return Buffer.from(await drive.use('fs').getBytes(key))
}
