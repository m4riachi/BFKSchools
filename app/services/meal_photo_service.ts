import { randomUUID } from 'node:crypto'
import { inject } from '@adonisjs/core'
import Clock from '#services/clock'
import db from '@adonisjs/lucid/services/db'
import drive from '@adonisjs/drive/services/main'
import logger from '@adonisjs/core/services/logger'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { DriveDisks } from '@adonisjs/drive/types'
import env from '#start/env'
import Meal from '#models/meal'
import MealPhoto from '#models/meal_photo'
import ImageProcessor, { InvalidImageError } from '#services/image_processor'
import BusinessRuleException from '#exceptions/business_rule_exception'
import { MEAL_PHOTOS } from '#config/meals'

/** One file part of the upload request, buffered in memory by the controller. */
export type UploadedPhoto = {
  /** Client file name — only used (sanitized) in error messages, never as a key. */
  clientName: string
  data: Buffer
  /** More bytes than MEAL_PHOTOS.maxFileBytes were sent (the rest was dropped). */
  tooLarge: boolean
}

export type DiskName = keyof DriveDisks

const DISKS: readonly string[] = ['fs', 's3']

/** Client file name safe to show in a message: no control chars, ≤ 60 chars. */
export function displayFileName(name: string): string {
  const clean = name.replace(/\p{C}/gu, '').trim()
  if (!clean) return '?'
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean
}

/**
 * Meal photos (docs/ERD.md §meal_photos).
 *
 * Invariants, all enforced under a `FOR UPDATE` lock on the meal row:
 * - a meal with photos has exactly one cover (partial unique index =
 *   at most one; `ensureCover()` after every add/remove = at least one);
 * - at most MEAL_PHOTOS.maxPerMeal photos;
 * - photos of a soft-deleted meal can no longer be changed (they stay
 *   readable for order history; their files are kept).
 *
 * Files: random keys `meals/<meal id>/<uuid>.webp` + `<uuid>_thumb.webp`
 * (never the client's name). Files are written before the DB transaction
 * and removed again if it fails; deleted photos' files are removed after
 * the commit.
 */
@inject()
export default class MealPhotoService {
  constructor(
    protected images: ImageProcessor,
    protected clock: Clock
  ) {}

  /** Disk used for new uploads (DRIVE_DISK). */
  defaultDisk(): DiskName {
    return env.get('DRIVE_DISK')
  }

  disk(name: string) {
    if (!DISKS.includes(name)) throw new Error(`Unknown drive disk "${name}"`)
    return drive.use(name as DiskName)
  }

  /**
   * Validates every file, re-encodes them, stores them and adds the rows.
   * All or nothing: one invalid file rejects the whole upload.
   */
  async upload(meal: Meal, files: UploadedPhoto[]): Promise<MealPhoto[]> {
    if (files.length === 0) throw new BusinessRuleException('meals.photos.errors.none')
    if (files.length > MEAL_PHOTOS.maxFilesPerUpload) {
      throw new BusinessRuleException('meals.photos.errors.too_many_files', {
        values: { max: MEAL_PHOTOS.maxFilesPerUpload },
      })
    }
    await this.assertRoomFor(meal.id, files.length)

    const encoded = []
    for (const file of files) {
      const name = displayFileName(file.clientName)
      if (file.tooLarge) {
        throw new BusinessRuleException('meals.photos.errors.too_large', {
          values: { name, max: MEAL_PHOTOS.maxFileBytes / (1024 * 1024) },
        })
      }
      try {
        encoded.push(await this.images.process(file.data))
      } catch (error) {
        if (!(error instanceof InvalidImageError)) throw error
        throw new BusinessRuleException(`meals.photos.errors.${error.reason}`, {
          values: {
            name,
            max: MEAL_PHOTOS.maxFileBytes / (1024 * 1024),
            pixels: Math.round(MEAL_PHOTOS.maxInputPixels / 1_000_000),
            min: MEAL_PHOTOS.minSide,
          },
        })
      }
    }

    const diskName = this.defaultDisk()
    const disk = this.disk(diskName)
    const written: string[] = []
    const rows: Array<Partial<MealPhoto>> = []
    try {
      for (const image of encoded) {
        const base = `meals/${meal.id}/${randomUUID()}`
        const path = `${base}.webp`
        const thumbPath = `${base}_thumb.webp`
        await disk.put(path, image.full.data, { contentType: 'image/webp' })
        written.push(path)
        await disk.put(thumbPath, image.thumb.data, { contentType: 'image/webp' })
        written.push(thumbPath)
        rows.push({
          mealId: meal.id,
          disk: diskName,
          path,
          thumbPath,
          width: image.full.width,
          height: image.full.height,
          sizeBytes: image.full.size,
          isCover: false,
        })
      }

      return await db.transaction(async (trx) => {
        await this.lockEditableMeal(trx, meal.id)
        const { total, maxPosition } = await this.stats(trx, meal.id)
        if (total + rows.length > MEAL_PHOTOS.maxPerMeal) {
          throw new BusinessRuleException('meals.photos.errors.meal_full', {
            values: { max: MEAL_PHOTOS.maxPerMeal },
          })
        }
        const created: MealPhoto[] = []
        let position = maxPosition + 1
        for (const row of rows) {
          created.push(await MealPhoto.create({ ...row, position: position++ }, { client: trx }))
        }
        await this.ensureCover(trx, meal.id)
        return created
      })
    } catch (error) {
      await this.removeFiles(disk, written)
      throw error
    }
  }

  /** New order: `ids` must be every photo of the meal, exactly once. */
  async reorder(meal: Meal, ids: number[]) {
    await db.transaction(async (trx) => {
      await this.lockEditableMeal(trx, meal.id)
      const photos = await MealPhoto.query({ client: trx }).where('meal_id', meal.id)
      const current = new Set(photos.map((photo) => photo.id))
      if (ids.length !== current.size || !ids.every((id) => current.has(id))) {
        throw new BusinessRuleException('meals.photos.errors.order_mismatch')
      }
      for (const [position, id] of ids.entries()) {
        await trx
          .from('meal_photos')
          .where('id', id)
          .where('meal_id', meal.id)
          .update({ position, updated_at: this.clock.now().toJSDate() })
      }
    })
  }

  /** Makes this photo the only cover of its meal. */
  async setCover(meal: Meal, photoId: number) {
    await db.transaction(async (trx) => {
      await this.lockEditableMeal(trx, meal.id)
      const photo = await this.findPhoto(trx, meal.id, photoId)
      // Unset first: the partial unique index allows one cover at a time.
      await trx
        .from('meal_photos')
        .where('meal_id', meal.id)
        .where('is_cover', true)
        .whereNot('id', photo.id)
        .update({ is_cover: false, updated_at: this.clock.now().toJSDate() })
      await trx
        .from('meal_photos')
        .where('id', photo.id)
        .update({ is_cover: true, updated_at: this.clock.now().toJSDate() })
    })
  }

  /** Deletes the row, promotes a new cover if needed, then removes both files. */
  async delete(meal: Meal, photoId: number) {
    const photo = await db.transaction(async (trx) => {
      await this.lockEditableMeal(trx, meal.id)
      const found = await this.findPhoto(trx, meal.id, photoId)
      await found.useTransaction(trx).delete()
      await this.ensureCover(trx, meal.id)
      return found
    })
    await this.removeFiles(this.disk(photo.disk), [photo.path, photo.thumbPath])
  }

  /**
   * Copies every photo of `source` (files and rows) to `target`, keeping the
   * order and the cover. Used by "duplicate meal"; runs inside the caller's
   * transaction. Copied files are removed again if the transaction fails
   * (the caller must call `cleanup` from its catch block).
   */
  async copyAll(trx: TransactionClientContract, source: Meal, target: Meal) {
    const photos = await MealPhoto.query({ client: trx })
      .where('meal_id', source.id)
      .orderBy('position')
      .orderBy('id')
    const written: Array<{ disk: string; key: string }> = []
    const cleanup = async () => {
      for (const file of written) await this.removeFiles(this.disk(file.disk), [file.key])
    }
    try {
      for (const [position, photo] of photos.entries()) {
        const disk = this.disk(photo.disk)
        const base = `meals/${target.id}/${randomUUID()}`
        const path = `${base}.webp`
        const thumbPath = `${base}_thumb.webp`
        await disk.copy(photo.path, path)
        written.push({ disk: photo.disk, key: path })
        await disk.copy(photo.thumbPath, thumbPath)
        written.push({ disk: photo.disk, key: thumbPath })
        await MealPhoto.create(
          {
            mealId: target.id,
            disk: photo.disk,
            path,
            thumbPath,
            position,
            isCover: false,
            width: photo.width,
            height: photo.height,
            sizeBytes: photo.sizeBytes,
          },
          { client: trx }
        )
      }
      const cover = photos.findIndex((photo) => photo.isCover)
      if (cover >= 0) {
        await trx
          .from('meal_photos')
          .where('meal_id', target.id)
          .where('position', cover)
          .update({ is_cover: true })
      }
      await this.ensureCover(trx, target.id)
    } catch (error) {
      await cleanup()
      throw error
    }
    return { cleanup }
  }

  /**
   * Makes the first photo (by position) the cover when the meal has photos
   * but no cover.
   */
  async ensureCover(trx: TransactionClientContract, mealId: number) {
    await trx.rawQuery(
      `UPDATE meal_photos SET is_cover = true, updated_at = now()
        WHERE id = (SELECT id FROM meal_photos WHERE meal_id = ? ORDER BY position, id LIMIT 1)
          AND NOT EXISTS (SELECT 1 FROM meal_photos WHERE meal_id = ? AND is_cover)`,
      [mealId, mealId]
    )
  }

  protected async assertRoomFor(mealId: number, count: number) {
    const { total } = await this.stats(db.connection(), mealId)
    if (total + count > MEAL_PHOTOS.maxPerMeal) {
      throw new BusinessRuleException('meals.photos.errors.meal_full', {
        values: { max: MEAL_PHOTOS.maxPerMeal },
      })
    }
  }

  protected async stats(client: Pick<TransactionClientContract, 'from'>, mealId: number) {
    const row = await client
      .from('meal_photos')
      .where('meal_id', mealId)
      .count('* as total')
      .max('position as max_position')
      .first()
    return {
      total: Number(row?.total ?? 0),
      maxPosition:
        row?.max_position === null || row?.max_position === undefined
          ? -1
          : Number(row.max_position),
    }
  }

  /** Locks the meal row; deleted meals are a 404 for photo management. */
  protected async lockEditableMeal(trx: TransactionClientContract, mealId: number) {
    return Meal.query({ client: trx })
      .withScopes((scopes) => scopes.catalog())
      .where('id', mealId)
      .forUpdate()
      .firstOrFail()
  }

  protected async findPhoto(trx: TransactionClientContract, mealId: number, photoId: number) {
    return MealPhoto.query({ client: trx })
      .where('id', photoId)
      .where('meal_id', mealId)
      .firstOrFail()
  }

  /** Best effort: a file that can't be removed is logged, never fatal. */
  protected async removeFiles(disk: ReturnType<typeof drive.use>, keys: string[]) {
    for (const key of keys) {
      try {
        await disk.delete(key)
      } catch (error) {
        logger.warn({ err: error, key }, 'meal photo: could not delete file')
      }
    }
  }
}
