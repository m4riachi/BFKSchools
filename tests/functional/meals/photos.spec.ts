/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { MON, addItem, menuOf, setupMenuSchool } from '#tests/helpers/menus'
import sharp from 'sharp'
import drive from '@adonisjs/drive/services/main'
import testUtils from '@adonisjs/core/services/test_utils'
import MealPhoto from '#models/meal_photo'
import MealPhotoService from '#services/meal_photo_service'
import type User from '#models/user'
import type Meal from '#models/meal'
import { MEAL_PHOTOS } from '#config/meals'
import {
  createMeal,
  createStaff,
  hugePngHeader,
  jpegWithExif,
  photosOf,
  pngBuffer,
  storedBytes,
  webpBuffer,
} from '#tests/helpers/meals'

type FakeDisk = ReturnType<typeof drive.fake>

const KEY =
  /^meals\/\d+\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/
const THUMB = /^meals\/\d+\/[0-9a-f-]{36}_thumb\.webp$/

function upload(
  client: any,
  user: User,
  meal: Meal,
  files: Array<{ data: Buffer; filename: string; field?: string }>
) {
  const request = client
    .post(`/admin/meals/${meal.id}/photos`)
    .loginAs(user)
    .withCsrfToken()
    .redirects(0)
  for (const file of files) {
    request.file(file.field ?? 'photos[]', file.data, { filename: file.filename })
  }
  return request
}

/** Every file currently on the fake disk. */
async function storedKeys(disk: FakeDisk) {
  const { objects } = await disk.listAll('meals', { recursive: true })
  return [...objects].flatMap((object) => ('key' in object ? [object.key] : []))
}

test.group('Meal photos | upload', (group) => {
  let fakeDisk: FakeDisk
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    fakeDisk = drive.fake('fs')
    return async () => {
      drive.restore('fs')
      await truncate()
    }
  })

  test('uploading one image creates a WebP and a WebP thumbnail', async ({ client, assert }) => {
    const manager = await createStaff('manager')
    const meal = await createMeal()

    const response = await upload(client, manager, meal, [
      { data: await pngBuffer(96, 64), filename: '../../etc/passwd.png' },
    ])
    assert.equal(response.header('location'), `/admin/meals/${meal.id}/edit`)

    const [photo] = await photosOf(meal.id)
    assert.match(photo.path, KEY)
    assert.match(photo.thumbPath, THUMB)
    assert.isTrue(photo.path.startsWith(`meals/${meal.id}/`))
    assert.notInclude(photo.path, 'passwd')
    assert.equal(photo.thumbPath, photo.path.replace('.webp', '_thumb.webp'))
    assert.equal(photo.disk, 'fs')
    assert.isTrue(photo.isCover, 'the first photo becomes the cover')
    assert.equal(photo.position, 0)
    fakeDisk.assertExists([photo.path, photo.thumbPath])

    const full = await sharp(await storedBytes(photo.path)).metadata()
    const thumb = await sharp(await storedBytes(photo.thumbPath)).metadata()
    assert.equal(full.format, 'webp')
    assert.equal(thumb.format, 'webp')
    assert.equal(full.width, 96, 'never enlarged')
    assert.equal(photo.width, 96)
    assert.equal(photo.height, 64)
    assert.isAbove(photo.sizeBytes!, 0)
  })

  test('several files at once; large ones are resized to 1600 / 400 px', async ({
    client,
    assert,
  }) => {
    const manager = await createStaff('admin')
    const meal = await createMeal()

    await upload(client, manager, meal, [
      { data: await pngBuffer(2400, 1200), filename: 'wide.png' },
      { data: await jpegWithExif(), filename: 'b.jpg' },
      { data: await webpBuffer(), filename: 'c.webp' },
    ])

    const photos = await photosOf(meal.id)
    assert.lengthOf(photos, 3)
    assert.deepEqual(
      photos.map((photo) => photo.position),
      [0, 1, 2]
    )
    assert.deepEqual(
      photos.map((photo) => photo.isCover),
      [true, false, false]
    )
    const full = await sharp(await storedBytes(photos[0].path)).metadata()
    const thumb = await sharp(await storedBytes(photos[0].thumbPath)).metadata()
    assert.equal(full.width, MEAL_PHOTOS.fullSize)
    assert.equal(full.height, 800)
    assert.equal(thumb.width, MEAL_PHOTOS.thumbSize)
    assert.equal(thumb.height, 200)
    assert.lengthOf(await storedKeys(fakeDisk), 6)
  })

  test('EXIF and GPS metadata are stripped', async ({ client, assert }) => {
    const manager = await createStaff('manager')
    const meal = await createMeal()
    const original = await jpegWithExif()
    const originalMetadata = await sharp(original).metadata()
    assert.isDefined(originalMetadata.exif, 'fixture carries EXIF')

    await upload(client, manager, meal, [{ data: original, filename: 'gps.jpg' }])

    const [photo] = await photosOf(meal.id)
    for (const key of [photo.path, photo.thumbPath]) {
      const bytes = await storedBytes(key)
      const metadata = await sharp(bytes).metadata()
      assert.isUndefined(metadata.exif)
      assert.isUndefined(metadata.xmp)
      assert.notInclude(bytes.toString('latin1'), 'Secret Kitchen')
    }
  })

  test('rejects {$self.label} and stores nothing')
    .with([
      {
        label: 'a text file renamed .jpg',
        data: async () => Buffer.from('hello, I am not an image at all'),
        error: "n'est pas une image",
      },
      {
        label: 'an HTML file renamed .png',
        data: async () => Buffer.from('<html><script>alert(1)</script></html>'),
        error: "n'est pas une image",
      },
      {
        label: 'an SVG image',
        data: async () =>
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>'
          ),
        error: "n'est pas une image",
      },
      {
        label: 'a GIF image',
        data: async () =>
          sharp({ create: { width: 80, height: 80, channels: 3, background: '#fff' } })
            .gif()
            .toBuffer(),
        error: "n'est pas une image",
      },
      {
        label: 'a truncated JPEG',
        data: async () => {
          const jpeg = await jpegWithExif(400, 300)
          return jpeg.subarray(0, 300)
        },
        error: 'illisible',
      },
      {
        label: 'a decompression bomb (huge pixel count)',
        data: async () => hugePngHeader(20_000, 20_000),
        error: 'trop grande résolution',
      },
      {
        label: 'a tiny image',
        data: async () => pngBuffer(20, 20),
        error: 'trop petite',
      },
      {
        label: 'a file over the size limit',
        data: async () => {
          const big = Buffer.alloc(MEAL_PHOTOS.maxFileBytes + 1024)
          big.set([0xff, 0xd8, 0xff], 0)
          return big
        },
        error: 'trop volumineux',
      },
    ])
    .run(async ({ client, assert }, row) => {
      const manager = await createStaff('manager')
      const meal = await createMeal()

      const response = await upload(client, manager, meal, [
        { data: await pngBuffer(), filename: 'good.png' },
        { data: await row.data(), filename: 'evil.jpg' },
      ])

      response.assertStatus(302)
      assert.include(String(response.flashMessage('error')), row.error)
      assert.lengthOf(await photosOf(meal.id), 0, 'all or nothing')
      assert.lengthOf(await storedKeys(fakeDisk), 0)
    })

  test('more files than allowed per upload are refused', async ({ client, assert }) => {
    const manager = await createStaff('manager')
    const meal = await createMeal()
    const png = await pngBuffer()
    const files = Array.from({ length: MEAL_PHOTOS.maxFilesPerUpload + 1 }, (_, i) => ({
      data: png,
      filename: `${i}.png`,
    }))

    const response = await upload(client, manager, meal, files)
    assert.include(
      String(response.flashMessage('error')),
      `au plus ${MEAL_PHOTOS.maxFilesPerUpload}`
    )
    assert.lengthOf(await photosOf(meal.id), 0)
  })

  test('a meal cannot exceed its photo limit', async ({ client, assert }) => {
    const manager = await createStaff('manager')
    const meal = await createMeal()
    for (let i = 0; i < MEAL_PHOTOS.maxPerMeal; i++) {
      await MealPhoto.create({
        mealId: meal.id,
        disk: 'fs',
        path: `meals/${meal.id}/x${i}.webp`,
        thumbPath: `meals/${meal.id}/x${i}_thumb.webp`,
        position: i,
        isCover: i === 0,
      })
    }
    const response = await upload(client, manager, meal, [
      { data: await pngBuffer(), filename: 'one-more.png' },
    ])
    assert.include(String(response.flashMessage('error')), `au plus ${MEAL_PHOTOS.maxPerMeal}`)
    assert.lengthOf(await photosOf(meal.id), MEAL_PHOTOS.maxPerMeal)
    assert.lengthOf(await storedKeys(fakeDisk), 0)
  })

  test('a body over the route limit is refused (413) without storing anything', async ({
    client,
    assert,
  }) => {
    const manager = await createStaff('manager')
    const meal = await createMeal()
    const chunk = Buffer.alloc(MEAL_PHOTOS.maxFileBytes - 1024, 1)
    const files: Array<{ data: Buffer; filename: string; field?: string }> = Array.from(
      { length: 6 },
      (_, i) => ({ data: chunk, filename: `${i}.jpg` })
    )
    files.push({ data: chunk, filename: 'extra.bin', field: 'other' })

    const response = await upload(client, manager, meal, files)
    response.assertStatus(302)
    assert.include(String(response.flashMessage('error')), 'Envoi trop volumineux')
    assert.lengthOf(await photosOf(meal.id), 0)
    assert.lengthOf(await storedKeys(fakeDisk), 0)
  })

  test('an empty upload is refused', async ({ client, assert }) => {
    const manager = await createStaff('manager')
    const meal = await createMeal()
    const response = await client
      .post(`/admin/meals/${meal.id}/photos`)
      .loginAs(manager)
      .withCsrfToken()
      .form({ photos: 'nope' })
      .redirects(0)
    assert.include(String(response.flashMessage('error')), 'au moins une photo')
  })
})

test.group('Meal photos | order, cover, delete', (group) => {
  let fakeDisk: FakeDisk
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    fakeDisk = drive.fake('fs')
    return async () => {
      drive.restore('fs')
      await truncate()
    }
  })

  async function mealWithPhotos(client: any, count: number) {
    const manager = await createStaff('manager')
    const meal = await createMeal()
    const png = await pngBuffer()
    await upload(
      client,
      manager,
      meal,
      Array.from({ length: count }, (_, i) => ({ data: png, filename: `${i}.png` }))
    )
    return { manager, meal, photos: await photosOf(meal.id) }
  }

  const coverIds = async (mealId: number) => {
    const covers = await MealPhoto.query().where('meal_id', mealId).where('is_cover', true)
    return covers.map((p) => p.id)
  }
  const idsOf = async (mealId: number) => {
    const photos = await photosOf(mealId)
    return photos.map((photo) => photo.id)
  }

  test('reordering rewrites every position', async ({ client, assert }) => {
    const { manager, meal, photos } = await mealWithPhotos(client, 3)
    const order = [photos[2].id, photos[0].id, photos[1].id]

    const response = await client
      .put(`/admin/meals/${meal.id}/photos/order`)
      .loginAs(manager)
      .json({ ids: order })
      .withCsrfToken()
      .redirects(0)
    assert.equal(response.header('location'), `/admin/meals/${meal.id}/edit`)

    assert.deepEqual(await idsOf(meal.id), order)
    assert.deepEqual(await coverIds(meal.id), [photos[0].id], 'the cover does not move')
  })

  test('an order that is not exactly the meal photos is refused', async ({ client, assert }) => {
    const { manager, meal, photos } = await mealWithPhotos(client, 2)
    const other = await mealWithPhotos(client, 1)

    for (const ids of [
      [photos[0].id],
      [photos[0].id, photos[1].id, other.photos[0].id],
      [photos[0].id, other.photos[0].id],
    ]) {
      const response = await client
        .put(`/admin/meals/${meal.id}/photos/order`)
        .loginAs(manager)
        .json({ ids })
        .withCsrfToken()
        .redirects(0)
      assert.include(String(response.flashMessage('error')), 'Rechargez la page')
    }
    const duplicate = await client
      .put(`/admin/meals/${meal.id}/photos/order`)
      .loginAs(manager)
      .json({ ids: [photos[0].id, photos[0].id] })
      .withCsrfToken()
      .redirects(0)
    assert.property(duplicate.flashMessage('inputErrorsBag') as object, 'ids')

    assert.deepEqual(
      await idsOf(meal.id),
      photos.map((photo) => photo.id)
    )
    const [otherPhoto] = await photosOf(other.meal.id)
    assert.equal(otherPhoto.position, 0)
  })

  test('choosing a cover leaves exactly one cover', async ({ client, assert }) => {
    const { manager, meal, photos } = await mealWithPhotos(client, 3)

    for (const target of [photos[2], photos[1], photos[1]]) {
      await client
        .post(`/admin/meals/${meal.id}/photos/${target.id}/cover`)
        .loginAs(manager)
        .withCsrfToken()
        .redirects(0)
      assert.deepEqual(await coverIds(meal.id), [target.id])
    }
  })

  test('a photo of another meal cannot be used', async ({ client, assert }) => {
    const { manager, meal, photos } = await mealWithPhotos(client, 2)
    const other = await mealWithPhotos(client, 1)

    const cover = await client
      .post(`/admin/meals/${meal.id}/photos/${other.photos[0].id}/cover`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    cover.assertStatus(404)
    const remove = await client
      .delete(`/admin/meals/${meal.id}/photos/${other.photos[0].id}`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    remove.assertStatus(404)

    assert.deepEqual(await coverIds(meal.id), [photos[0].id])
    assert.lengthOf(await photosOf(other.meal.id), 1)
    fakeDisk.assertExists(other.photos[0].path)
  })

  test('deleting a photo removes both files; the next photo becomes cover', async ({
    client,
    assert,
  }) => {
    const { manager, meal, photos } = await mealWithPhotos(client, 3)
    await client
      .put(`/admin/meals/${meal.id}/photos/order`)
      .loginAs(manager)
      .json({ ids: [photos[0].id, photos[2].id, photos[1].id] })
      .withCsrfToken()
      .redirects(0)

    await client
      .delete(`/admin/meals/${meal.id}/photos/${photos[0].id}`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)

    fakeDisk.assertMissing([photos[0].path, photos[0].thumbPath])
    fakeDisk.assertExists([photos[1].path, photos[2].thumbPath])
    assert.isNull(await MealPhoto.find(photos[0].id))
    assert.deepEqual(await coverIds(meal.id), [photos[2].id], 'first remaining by position')

    // Deleting a non-cover photo keeps the cover.
    await client
      .delete(`/admin/meals/${meal.id}/photos/${photos[1].id}`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    assert.deepEqual(await coverIds(meal.id), [photos[2].id])

    // Last photo: no photos, no cover, no files.
    await client
      .delete(`/admin/meals/${meal.id}/photos/${photos[2].id}`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    assert.lengthOf(await photosOf(meal.id), 0)
    assert.lengthOf(await storedKeys(fakeDisk), 0)
  })

  test('the database allows at most one cover per meal', async ({ client, assert }) => {
    const { meal, photos } = await mealWithPhotos(client, 2)
    await assert.rejects(
      () => MealPhoto.query().where('id', photos[1].id).update({ isCover: true }),
      /meal_photos_one_cover_per_meal/
    )
    assert.deepEqual(await coverIds(meal.id), [photos[0].id])
  })
})

test.group('Meal photos | serving', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    drive.fake('fs')
    return async () => {
      drive.restore('fs')
      await truncate()
    }
  })

  test('s3 photos redirect to the signed URL exactly as signed (no ?v= appended)', async ({
    client,
    assert,
  }) => {
    const manager = await createStaff('manager')
    const meal = await createMeal()
    await upload(client, manager, meal, [{ data: await pngBuffer(), filename: 'a.png' }])
    const [photo] = await photosOf(meal.id)
    await db.from('meal_photos').where('id', photo.id).update({ disk: 's3' })

    const signed = 'https://bucket.example/meals/1/a_thumb.webp?X-Amz-Signature=abc&x-id=GetObject'
    const original = MealPhotoService.prototype.disk
    MealPhotoService.prototype.disk = function (name: string) {
      return name === 's3'
        ? ({ getSignedUrl: async () => signed } as unknown as ReturnType<typeof original>)
        : original.call(this, name)
    }
    try {
      const response = await client
        .get(`/media/meal-photos/${photo.id}/thumb?v=0123456789ab`)
        .loginAs(manager)
        .redirects(0)
      response.assertStatus(302)
      assert.equal(response.header('location'), signed)
    } finally {
      MealPhotoService.prototype.disk = original
    }
  })

  test('photos are served as WebP with safe headers to logged-in users', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const parent = await UserFactory.apply('parent').merge({ schoolId: school.id }).create()
    const kitchen = await createStaff('kitchen')
    const meal = await createMeal()
    await upload(client, manager, meal, [{ data: await pngBuffer(), filename: 'a.png' }])
    const [photo] = await photosOf(meal.id)

    // MealPolicy.viewPhoto: kitchen sees every photo; a parent only meals on a
    // published menu of their school (or ordered) — otherwise 404.
    ;(await client.get(`/media/meal-photos/${photo.id}/thumb`).loginAs(kitchen)).assertStatus(200)
    ;(await client.get(`/media/meal-photos/${photo.id}/thumb`).loginAs(parent)).assertStatus(404)
    await addItem(school, manager, MON, meal)
    const menu = await menuOf(school)
    ;(await client.get(`/media/meal-photos/${photo.id}/thumb`).loginAs(parent)).assertStatus(404)
    const at = new Date('2026-11-19T10:00:00Z')
    await db
      .from('weekly_menus')
      .where('id', menu.id)
      .update({
        status: 'published',
        publish_at: at,
        published_at: at,
        order_deadline_at: new Date('2026-11-22T20:00:00Z'),
      })
    const otherSchool = await setupMenuSchool()
    const stranger = await UserFactory.apply('parent')
      .merge({ schoolId: otherSchool.school.id })
      .create()
    ;(await client.get(`/media/meal-photos/${photo.id}/thumb`).loginAs(stranger)).assertStatus(404)

    for (const variant of ['full', 'thumb']) {
      const response = await client.get(`/media/meal-photos/${photo.id}/${variant}`).loginAs(parent)
      response.assertStatus(200)
      assert.equal(response.header('content-type'), 'image/webp')
      assert.equal(response.header('x-content-type-options'), 'nosniff')
      assert.include(String(response.header('content-security-policy')), 'sandbox')
      assert.include(String(response.header('content-disposition')), 'inline')
    }
  })

  test('guests, unknown ids and unknown variants get nothing', async ({ client }) => {
    const manager = await createStaff('manager')
    const meal = await createMeal()
    await upload(client, manager, meal, [{ data: await pngBuffer(), filename: 'a.png' }])
    const [photo] = await photosOf(meal.id)

    const guest = await client.get(`/media/meal-photos/${photo.id}/full`).redirects(0)
    guest.assertStatus(302)
    guest.assertHeader('location', '/login')

    const unknown = await client.get(`/media/meal-photos/${photo.id + 1000}/full`).loginAs(manager)
    unknown.assertStatus(404)
    const variant = await client.get(`/media/meal-photos/${photo.id}/original`).loginAs(manager)
    variant.assertStatus(404)
    const traversal = await client
      .get(`/media/meal-photos/${photo.id}/..%2F..%2F.env`)
      .loginAs(manager)
    traversal.assertStatus(404)
  })
})
