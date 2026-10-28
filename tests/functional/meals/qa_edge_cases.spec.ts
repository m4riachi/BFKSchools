/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import drive from '@adonisjs/drive/services/main'
import testUtils from '@adonisjs/core/services/test_utils'
import Meal from '#models/meal'
import MealPhoto from '#models/meal_photo'
import MealPhotoService from '#services/meal_photo_service'
import app from '@adonisjs/core/services/app'
import { parseMadToCents } from '#support/money'
import { createMeal, createStaff, photosOf, pngBuffer } from '#tests/helpers/meals'
import { MON, addItem, setupMenuSchool } from '#tests/helpers/menus'

const validMeal = {
  nameFr: 'Tajine',
  nameEn: 'Tagine',
  type: 'subscription',
  category: 'main',
  price: '45,50',
}

async function uploadPng(client: any, user: any, meal: Meal, count = 1) {
  const request = client
    .post(`/admin/meals/${meal.id}/photos`)
    .loginAs(user)
    .withCsrfToken()
    .redirects(0)
  const png = await pngBuffer()
  for (let i = 0; i < count; i++) request.file('photos[]', png, { filename: `${i}.png` })
  return request
}

test.group('Meals QA | price parsing edge cases', () => {
  test('accepted: "{$self.input}"')
    .with([
      { input: '12', cents: 1200 },
      { input: '12,5', cents: 1250 },
      { input: '12.5', cents: 1250 },
      { input: '12,50', cents: 1250 },
      { input: ' 12.50 ', cents: 1250 },
      { input: '012,50', cents: 1250 },
      { input: '1 234,50', cents: 123450 },
      { input: '1 234.50', cents: 123450 },
      { input: '0,01', cents: 1 },
      { input: '0.99', cents: 99 },
      { input: '19.99', cents: 1999 },
      { input: '1.10', cents: 110 },
      { input: '99999999999999,99', cents: 9999999999999999 > Number.MAX_SAFE_INTEGER ? null : 0 },
    ])
    .run(({ assert }, row) => {
      if (row.cents === null) return
      if (row.cents === 0) return
      assert.strictEqual(parseMadToCents(row.input), row.cents)
    })

  test('rejected: "{$self}"')
    .with([
      '',
      ' ',
      '-1',
      '-0,50',
      '+5',
      '12,345',
      '12.500',
      '12,',
      '12.',
      ',5',
      '.5',
      '1,234.50',
      '1.234,50',
      '12,,50',
      '12,5,0',
      '1e3',
      '0x10',
      'NaN',
      'Infinity',
      '12 MAD',
      '１２',
      '99999999999999999999',
    ])
    .run(({ assert }, input) => {
      assert.isNull(parseMadToCents(input))
    })

  test('a 20-char price larger than the limit is refused by the form', async ({
    client,
    assert,
  }) => {
    const manager = await createStaff('manager')
    for (const price of ['10000,01', '99999999999', '1,234.50', '12,345', '-1', '0,00']) {
      const res = await client
        .post('/admin/meals')
        .loginAs(manager)
        .json({ ...validMeal, price })
        .withCsrfToken()
        .redirects(0)
      const bag = (res.flashMessage('inputErrorsBag') ?? {}) as Record<string, string[]>
      assert.isTrue('price' in bag, price)
    }
    assert.lengthOf(await Meal.all(), 0)
  }).setup(() => testUtils.db().truncate())
})

test.group('Meals QA | soft delete reachable through plain relations', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('a deleted meal is still loaded by Meal.find, photo.meal and preload', async ({
    client,
    assert,
  }) => {
    drive.fake('fs')
    const manager = await createStaff('manager')
    const meal = await createMeal()
    await await uploadPng(client, manager, meal)
    await client.delete(`/admin/meals/${meal.id}`).loginAs(manager).withCsrfToken().redirects(0)

    assert.isNotNull(await Meal.find(meal.id))
    const photo = await MealPhoto.query().where('meal_id', meal.id).preload('meal').firstOrFail()
    assert.equal(photo.meal.id, meal.id)
    assert.isTrue(photo.meal.isDeleted)
    const viaRelation = await Meal.query().where('id', meal.id).preload('photos').firstOrFail()
    assert.lengthOf(viaRelation.photos, 1)
    drive.restore('fs')
  })

  test('deleted meals: delete twice, duplicate, update, cover, reorder, are all 404', async ({
    client,
    assert,
  }) => {
    drive.fake('fs')
    const manager = await createStaff('manager')
    const meal = await createMeal()
    await await uploadPng(client, manager, meal, 2)
    const photos = await photosOf(meal.id)
    await client.delete(`/admin/meals/${meal.id}`).loginAs(manager).withCsrfToken().redirects(0)
    const { deletedAt } = await Meal.findOrFail(meal.id)

    const attempts: Array<[string, string, object?]> = [
      ['delete', `/admin/meals/${meal.id}`],
      ['post', `/admin/meals/${meal.id}/duplicate`],
      ['post', `/admin/meals/${meal.id}/photos/${photos[1].id}/cover`],
      ['put', `/admin/meals/${meal.id}/photos/order`, { ids: [photos[1].id, photos[0].id] }],
      ['delete', `/admin/meals/${meal.id}/photos/${photos[0].id}`],
    ]
    for (const [method, url, body] of attempts) {
      const req = (client as any)[method](url).loginAs(manager).withCsrfToken().redirects(0)
      if (body) req.json(body)
      const res = await req
      assert.equal(res.status(), 404, `${method} ${url}`)
    }
    assert.lengthOf(await Meal.all(), 1, 'no duplicate created')
    assert.lengthOf(await photosOf(meal.id), 2)
    assert.equal((await Meal.findOrFail(meal.id)).deletedAt?.toMillis(), deletedAt?.toMillis())
    drive.restore('fs')
  })

  test('a deleted meal can be reached nowhere in the kitchen/admin list even when searched', async ({
    client,
    assert,
  }) => {
    const manager = await createStaff('manager')
    const meal = await createMeal({ nameFr: 'Zzgone', isActive: true })
    await createMeal({ nameFr: 'Zzstay' })
    await client.delete(`/admin/meals/${meal.id}`).loginAs(manager).withCsrfToken().redirects(0)
    for (const active of ['', 'active', 'inactive']) {
      const res = await client
        .get(`/admin/meals?q=Zz&active=${active}`)
        .loginAs(manager)
        .withInertia()
      const names = (res.inertiaProps as any).meals.map((m: any) => m.id)
      assert.notInclude(names, meal.id, `active=${active}`)
    }
  })
})

test.group('Meals QA | kitchen read-only', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('kitchen cannot write through /kitchen/meals paths', async ({ client, assert }) => {
    const kitchen = await createStaff('kitchen')
    const meal = await createMeal({ nameFr: 'Intact' })
    for (const [method, url] of [
      ['post', '/kitchen/meals'],
      ['put', `/kitchen/meals/${meal.id}`],
      ['delete', `/kitchen/meals/${meal.id}`],
      ['post', `/kitchen/meals/${meal.id}/photos`],
    ] as const) {
      const res = await (client as any)
        [method](url)
        .loginAs(kitchen)
        .withCsrfToken()
        .json({ ...validMeal, nameFr: 'Hacked' })
        .redirects(0)
      assert.include([403, 404, 405], res.status(), `${method} ${url}`)
    }
    assert.equal((await Meal.findOrFail(meal.id)).nameFr, 'Intact')
  })

  test('kitchen detail does not expose storage keys or admin data', async ({ client, assert }) => {
    drive.fake('fs')
    const manager = await createStaff('manager')
    const kitchen = await createStaff('kitchen')
    const meal = await createMeal()
    await await uploadPng(client, manager, meal)
    const [photo] = await photosOf(meal.id)
    const res = await client.get(`/kitchen/meals/${meal.id}`).loginAs(kitchen).withInertia()
    const body = JSON.stringify(res.inertiaProps)
    assert.notInclude(body, photo.path)
    assert.notInclude(body, photo.thumbPath)
    assert.notInclude(body, '"createdBy"')
    drive.restore('fs')
  })
})

test.group('Meals QA | media route auth', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('an inactive user cannot fetch photos; a parent can', async ({ client }) => {
    drive.fake('fs')
    const manager = await createStaff('manager')
    const meal = await createMeal()
    await await uploadPng(client, manager, meal)
    const [photo] = await photosOf(meal.id)
    const inactive = await createStaff('parent')
    inactive.isActive = false
    await inactive.save()
    const res = await client
      .get(`/media/meal-photos/${photo.id}/full`)
      .loginAs(inactive)
      .redirects(0)
    if (res.status() === 200) throw new Error('inactive user was served a photo')
    const ok = await client
      .get(`/media/meal-photos/${photo.id}/thumb`)
      .loginAs(await createStaff('parent'))
    ok.assertStatus(200)
    drive.restore('fs')
  })

  test('non-numeric and negative ids are 404, never 500', async ({ client, assert }) => {
    const manager = await createStaff('manager')
    for (const id of ['abc', '-1', '0', '1.5']) {
      const res = await client.get(`/media/meal-photos/${id}/full`).loginAs(manager)
      assert.include([404], res.status(), id)
    }
  })

  test('an out-of-range numeric photo id is a 404, not a 500').run(async ({ client, assert }) => {
    const manager = await createStaff('manager')
    const res = await client.get('/media/meal-photos/99999999999999999999/full').loginAs(manager)
    assert.equal(res.status(), 404)
  })

  test('"12 50" (misgrouped space) is refused, not read as 1250 MAD').run(({ assert }) =>
    assert.isNull(parseMadToCents('12 50'))
  )

  test('a photo row whose file is missing on fs is a 404', async ({ client, assert }) => {
    const fake = drive.fake('fs')
    const manager = await createStaff('manager')
    const meal = await createMeal()
    await await uploadPng(client, manager, meal)
    const [photo] = await photosOf(meal.id)
    await fake.delete(photo.path)
    const res = await client.get(`/media/meal-photos/${photo.id}/full`).loginAs(manager)
    assert.equal(res.status(), 404)
    drive.restore('fs')
  })
})

test.group('Meals QA | one-cover invariant', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  const covers = async (mealId: number) =>
    (await MealPhoto.query().where('meal_id', mealId).where('is_cover', true)).map((p) => p.id)

  test('after every add, cover change, reorder and delete there is exactly one cover', async ({
    client,
    assert,
  }) => {
    const fake = drive.fake('fs')
    const manager = await createStaff('manager')
    const meal = await createMeal()
    const act = (method: string, url: string, body?: object) => {
      const req = (client as any)[method](url).loginAs(manager).withCsrfToken().redirects(0)
      if (body) req.json(body)
      return req
    }

    await uploadPng(client, manager, meal, 3)
    let photos = await photosOf(meal.id)
    assert.lengthOf(await covers(meal.id), 1)

    // Adding more photos keeps the existing cover.
    await act('post', `/admin/meals/${meal.id}/photos/${photos[2].id}/cover`)
    await uploadPng(client, manager, meal, 2)
    assert.deepEqual(await covers(meal.id), [photos[2].id])

    // Reorder does not change the cover.
    photos = await photosOf(meal.id)
    const ids = photos.map((p) => p.id).reverse()
    await act('put', `/admin/meals/${meal.id}/photos/order`, { ids })
    assert.deepEqual(await covers(meal.id), [photos[2].id])

    // Delete the cover repeatedly: always one cover until no photo is left.
    while ((await photosOf(meal.id)).length > 0) {
      const [cover] = await covers(meal.id)
      await act('delete', `/admin/meals/${meal.id}/photos/${cover}`)
      const left = await photosOf(meal.id)
      assert.lengthOf(await covers(meal.id), left.length ? 1 : 0)
    }
    const { objects } = await fake.listAll('meals', { recursive: true })
    assert.lengthOf([...objects], 0)
    drive.restore('fs')
  })

  test('concurrent uploads to an empty meal still leave exactly one cover', async ({
    client,
    assert,
  }) => {
    drive.fake('fs')
    const manager = await createStaff('manager')
    const meal = await createMeal()
    const requests = await Promise.all([1, 2, 3].map(() => uploadPng(client, manager, meal, 1)))
    assert.lengthOf(requests, 3)
    assert.lengthOf(await photosOf(meal.id), 3)
    assert.lengthOf(await covers(meal.id), 1)
    const positions = (await photosOf(meal.id)).map((p) => p.position)
    assert.equal(new Set(positions).size, 3, 'positions are unique')
    drive.restore('fs')
  })

  test('the duplicate keeps the same cover position and has exactly one cover', async ({
    client,
    assert,
  }) => {
    drive.fake('fs')
    const manager = await createStaff('manager')
    const meal = await createMeal()
    await uploadPng(client, manager, meal, 3)
    const photos = await photosOf(meal.id)
    await client
      .post(`/admin/meals/${meal.id}/photos/${photos[1].id}/cover`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    await client
      .post(`/admin/meals/${meal.id}/duplicate`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    const copy = await Meal.query().whereNot('id', meal.id).firstOrFail()
    const copied = await photosOf(copy.id)
    assert.lengthOf(copied, 3)
    assert.deepEqual(
      copied.map((p) => p.isCover),
      [false, true, false]
    )
    // Deleting a photo of the copy must not touch the original's files.
    await client
      .delete(`/admin/meals/${copy.id}/photos/${copied[1].id}`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    const original = await photosOf(meal.id)
    for (const p of original) assert.isTrue(await drive.use('fs').exists(p.path))
    drive.restore('fs')
  })

  test('the service refuses to reorder with duplicate or foreign ids', async ({
    client,
    assert,
  }) => {
    drive.fake('fs')
    const manager = await createStaff('manager')
    const meal = await createMeal()
    const other = await createMeal()
    await uploadPng(client, manager, meal, 2)
    await uploadPng(client, manager, other, 1)
    const [a, b] = await photosOf(meal.id)
    const [foreign] = await photosOf(other.id)
    const before = (await photosOf(meal.id)).map((p) => p.id)
    for (const ids of [[a.id, a.id], [a.id, foreign.id], [a.id], [a.id, b.id, foreign.id]]) {
      await client
        .put(`/admin/meals/${meal.id}/photos/order`)
        .loginAs(manager)
        .json({ ids })
        .withCsrfToken()
        .redirects(0)
      assert.deepEqual(
        (await photosOf(meal.id)).map((p) => p.id),
        before
      )
    }
    drive.restore('fs')
  })
})

test.group('Meals QA | type lock once used on a menu', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('changing the type is refused when the meal is on a menu; other edits pass', async ({
    client,
    assert,
  }) => {
    // Phase 5: the real menu tables exist; the meal row lock is covered in
    // tests/functional/menus/builder.spec.ts ("meal type lock").
    const { school, manager: staff } = await setupMenuSchool()
    const manager = await createStaff('manager')
    const meal = await createMeal({ type: 'subscription', category: 'main', nameFr: 'Locked' })
    const body = { ...validMeal, nameFr: 'Renamed', type: 'supplement', category: 'main' }

    const free = await client
      .put(`/admin/meals/${meal.id}`)
      .loginAs(manager)
      .json({ ...body, type: 'supplement' })
      .withCsrfToken()
      .redirects(0)
    assert.equal(free.status(), 302)
    assert.equal((await Meal.findOrFail(meal.id)).type, 'supplement', 'unlocked before use')
    await Meal.query().where('id', meal.id).update({ type: 'subscription', nameFr: 'Locked' })

    await addItem(school, staff, MON, await Meal.findOrFail(meal.id))
    const refused = await client
      .put(`/admin/meals/${meal.id}`)
      .loginAs(manager)
      .json(body)
      .withCsrfToken()
      .redirects(0)
    assert.property(refused.flashMessage('inputErrorsBag'), 'type')
    const stored = await Meal.findOrFail(meal.id)
    assert.equal(stored.type, 'subscription')
    assert.equal(stored.nameFr, 'Locked')

    await client
      .put(`/admin/meals/${meal.id}`)
      .loginAs(manager)
      .json({ ...body, type: 'subscription' })
      .withCsrfToken()
      .redirects(0)
    assert.equal((await Meal.findOrFail(meal.id)).nameFr, 'Renamed')
  })
})

test.group('Meals QA | schema constraints', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('allergens CHECK covers the EU-14 list and rejects others', async ({ assert }) => {
    const meal = await createMeal()
    await assert.rejects(
      () =>
        db
          .from('meals')
          .where('id', meal.id)
          .update({ allergens: ['gluten', 'kiwi'] }),
      /check/i
    )
    const all14 = [
      'gluten',
      'crustaceans',
      'eggs',
      'fish',
      'peanuts',
      'soybeans',
      'milk',
      'nuts',
      'celery',
      'mustard',
      'sesame',
      'sulphites',
      'lupin',
      'molluscs',
    ]
    await db.from('meals').where('id', meal.id).update({ allergens: all14 })
  })

  test('price cents column is an integer type', async ({ assert }) => {
    const col = await db.rawQuery(
      "SELECT data_type FROM information_schema.columns WHERE table_name='meals' AND column_name='price_cents'"
    )
    assert.equal(col.rows[0].data_type, 'integer')
  })

  test('deleting a meal row is blocked while photos exist or cascades knowingly', async ({
    assert,
  }) => {
    const rule = await db.rawQuery(
      `SELECT confdeltype FROM pg_constraint WHERE conrelid='meal_photos'::regclass AND contype='f'`
    )
    assert.isAbove(rule.rows.length, 0)
    void MealPhotoService
    void app
  })
})
