import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import drive from '@adonisjs/drive/services/main'
import testUtils from '@adonisjs/core/services/test_utils'
import Meal from '#models/meal'
import { createMeal, createStaff, photosOf, pngBuffer } from '#tests/helpers/meals'

const validMeal = {
  nameFr: 'Couscous aux sept légumes',
  nameEn: 'Seven-vegetable couscous',
  descriptionFr: 'Semoule, légumes de saison.',
  descriptionEn: 'Semolina, seasonal vegetables.',
  type: 'subscription',
  category: 'main',
  price: '45,50',
  allergens: ['gluten', 'celery'],
  tags: ['vegetarian'],
  isActive: true,
  externalRecipeRef: 'BFK-REC-0042',
}

/** A supplement (D31: the only priced meals). */
const validSupplement = {
  ...validMeal,
  nameFr: 'Jus d’orange',
  nameEn: 'Orange juice',
  type: 'supplement',
  category: 'drink',
  price: '12,50',
}

test.group('Meals | create, edit, validation', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('a manager creates a subscription meal: a posted price is ignored, 0 is stored (D31)', async ({
    client,
    assert,
  }) => {
    const manager = await createStaff('manager')
    // `validMeal` posts price "45,50" for a subscription meal: never trusted.
    const response = await client
      .post('/admin/meals')
      .loginAs(manager)
      .json(validMeal)
      .withCsrfToken()
      .redirects(0)

    const meal = await Meal.findByOrFail('name_fr', validMeal.nameFr)
    assert.equal(response.header('location'), `/admin/meals/${meal.id}/edit`)
    assert.equal(meal.priceCents, 0)
    assert.equal(meal.nameEn, validMeal.nameEn)
    assert.equal(meal.type, 'subscription')
    assert.equal(meal.category, 'main')
    assert.deepEqual(meal.allergens, ['gluten', 'celery'])
    assert.deepEqual(meal.tags, ['vegetarian'])
    assert.isTrue(meal.isActive)
    assert.equal(meal.externalRecipeRef, 'BFK-REC-0042')
    assert.equal(meal.createdBy, manager.id)
    assert.isNull(meal.deletedAt)
  })

  test('a subscription meal needs no price; even an invalid one is ignored (D31)', async ({
    client,
    assert,
  }) => {
    const manager = await createStaff('manager')
    const withoutPrice = { ...validMeal, price: undefined } // dropped from the JSON body
    for (const [index, body] of [
      withoutPrice,
      { ...validMeal, price: 'abc' },
      { ...validMeal, price: '-5' },
    ].entries()) {
      const response = await client
        .post('/admin/meals')
        .loginAs(manager)
        .json({ ...body, nameFr: `Plat ${index}` })
        .withCsrfToken()
        .redirects(0)
      assert.notExists(response.flashMessage('inputErrorsBag'))
      const meal = await Meal.findByOrFail('name_fr', `Plat ${index}`)
      assert.equal(meal.priceCents, 0)
    }
  })

  test('a supplement is stored with its price in centimes', async ({ client, assert }) => {
    const manager = await createStaff('manager')
    await client
      .post('/admin/meals')
      .loginAs(manager)
      .json(validSupplement)
      .withCsrfToken()
      .redirects(0)
    const meal = await Meal.findByOrFail('name_fr', validSupplement.nameFr)
    assert.equal(meal.type, 'supplement')
    assert.equal(meal.priceCents, 1250)
  })

  test('a supplement without a price is refused', async ({ client, assert }) => {
    const manager = await createStaff('manager')
    const withoutPrice = { ...validSupplement, price: undefined } // dropped from the JSON body
    for (const body of [withoutPrice, { ...validSupplement, price: '' }]) {
      const response = await client
        .post('/admin/meals')
        .loginAs(manager)
        .json(body)
        .withCsrfToken()
        .redirects(0)
      response.assertStatus(302)
      const bag = (response.flashMessage('inputErrorsBag') ?? {}) as Record<string, string[]>
      assert.property(bag, 'price')
    }
    assert.lengthOf(await Meal.all(), 0)
  })

  test('price "{$self}" is parsed without floats')
    .with([
      ['12', 1200],
      ['12,5', 1250],
      ['12.50', 1250],
      ['0,01', 1],
      ['1 234,56', 123456],
      ['10000', 1_000_000],
    ] as const)
    .run(async ({ client, assert }, [price, cents]) => {
      const admin = await createStaff('admin')
      await client
        .post('/admin/meals')
        .loginAs(admin)
        .json({ ...validSupplement, price })
        .withCsrfToken()
        .redirects(0)
      const meal = await Meal.findByOrFail('name_fr', validSupplement.nameFr)
      assert.equal(meal.priceCents, cents)
    })

  test('invalid input is reported per field and nothing is saved', async ({ client, assert }) => {
    const manager = await createStaff('manager')
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ nameFr: '' }, 'nameFr'],
      [{ nameEn: '   ' }, 'nameEn'],
      [{ type: 'dessert' }, 'type'],
      [{ category: 'soup' }, 'category'],
      [{ price: '12,345' }, 'price'],
      [{ price: '0' }, 'price'],
      [{ price: '-5' }, 'price'],
      [{ price: 'abc' }, 'price'],
      [{ price: '10000,01' }, 'price'],
      [{ price: 12.5 }, 'price'],
      [{ allergens: ['gluten', 'kiwi'] }, 'allergens.1'],
      [{ allergens: ['milk', 'milk'] }, 'allergens'],
      [{ tags: ['organic'] }, 'tags.0'],
      [{ nameFr: 'x'.repeat(121) }, 'nameFr'],
      [{ externalRecipeRef: 'ref\u0000x' }, 'externalRecipeRef'],
    ]
    for (const [override, field] of cases) {
      const response = await client
        .post('/admin/meals')
        .loginAs(manager)
        .json({ ...validSupplement, ...override })
        .withCsrfToken()
        .redirects(0)
      response.assertStatus(302)
      const bag = (response.flashMessage('inputErrorsBag') ?? {}) as Record<string, string[]>
      assert.isTrue(field in bag, `${JSON.stringify(override)} → ${Object.keys(bag)}`)
    }
    assert.lengthOf(await Meal.all(), 0)
  })

  test('validation messages are translated', async ({ client, assert }) => {
    const manager = await createStaff('manager')
    const response = await client
      .post('/admin/meals')
      .loginAs(manager)
      .json({ ...validSupplement, price: '12,345' })
      .withCsrfToken()
      .redirects(0)
    const bag = response.flashMessage('inputErrorsBag') as Record<string, string[]>
    assert.include(String(bag.price), 'au plus 2 décimales')
  })

  test('the database refuses unknown allergens, types and invalid prices', async ({ assert }) => {
    const base = { name_fr: 'A', name_en: 'A', type: 'subscription', category: 'main' }
    await assert.rejects(
      () => db.table('meals').insert({ ...base, allergens: ['kiwi'] }),
      /meals_allergens_check/
    )
    await assert.rejects(
      // An unknown type also fails the D31 price rule (which names both types).
      () => db.table('meals').insert({ ...base, type: 'extra' }),
      /meals_type_check|meals_price_cents_check/
    )
    await assert.rejects(
      () => db.table('meals').insert({ ...base, price_cents: -1 }),
      /meals_price_cents_check/
    )
    // D31: a subscription meal is free; a supplement has a positive price.
    await assert.rejects(
      () => db.table('meals').insert({ ...base, price_cents: 4500 }),
      /meals_price_cents_check/
    )
    await assert.rejects(
      () => db.table('meals').insert({ ...base, type: 'supplement', price_cents: 0 }),
      /meals_price_cents_check/
    )
    await db.table('meals').insert({ ...base, price_cents: 0 })
    await db.table('meals').insert({ ...base, name_fr: 'B', type: 'supplement', price_cents: 1 })
  })

  test('a manager edits a meal', async ({ client, assert }) => {
    const manager = await createStaff('manager')
    const meal = await createMeal()

    const response = await client
      .put(`/admin/meals/${meal.id}`)
      .loginAs(manager)
      .json({
        ...validMeal,
        nameFr: 'Tajine',
        type: 'supplement',
        price: '8',
        tags: [],
        allergens: [],
        isActive: false,
        externalRecipeRef: '',
      })
      .withCsrfToken()
      .redirects(0)

    assert.equal(response.header('location'), `/admin/meals/${meal.id}/edit`)
    await meal.refresh()
    assert.equal(meal.nameFr, 'Tajine')
    assert.equal(meal.type, 'supplement')
    assert.equal(meal.priceCents, 800)
    assert.deepEqual(meal.tags, [])
    assert.isFalse(meal.isActive)
    assert.isNull(meal.externalRecipeRef)
  })

  test('an unused supplement switched to subscription loses its price (D31)', async ({
    client,
    assert,
  }) => {
    const manager = await createStaff('manager')
    const meal = await createMeal({ type: 'supplement', category: 'drink', priceCents: 1500 })
    await client
      .put(`/admin/meals/${meal.id}`)
      .loginAs(manager)
      .json({ ...validMeal, nameFr: 'Ex-jus', type: 'subscription', price: '15' })
      .withCsrfToken()
      .redirects(0)
    await meal.refresh()
    assert.equal(meal.type, 'subscription')
    assert.equal(meal.priceCents, 0)

    // Back to supplement: a price is required again.
    const response = await client
      .put(`/admin/meals/${meal.id}`)
      .loginAs(manager)
      .json({ ...validSupplement, nameFr: 'Ex-jus', price: '' })
      .withCsrfToken()
      .redirects(0)
    const bag = (response.flashMessage('inputErrorsBag') ?? {}) as Record<string, string[]>
    assert.property(bag, 'price')
    await meal.refresh()
    assert.equal(meal.type, 'subscription')
  })

  test('the edit page of a subscription meal has no price (D31)', async ({ client, assert }) => {
    const manager = await createStaff('manager')
    const meal = await createMeal()
    const response = await client.get(`/admin/meals/${meal.id}/edit`).loginAs(manager).withInertia()
    const props = response.inertiaProps as { meal: { priceInput: string; price: string | null } }
    assert.equal(props.meal.priceInput, '')
    assert.isNull(props.meal.price)
  })

  test('the edit page shows the meal with a localized price input', async ({ client, assert }) => {
    const manager = await createStaff('manager')
    const meal = await createMeal({ type: 'supplement', priceCents: 1250 })
    const response = await client.get(`/admin/meals/${meal.id}/edit`).loginAs(manager).withInertia()
    response.assertStatus(200)
    response.assertInertiaComponent('admin/meals/form')
    const props = response.inertiaProps as { meal: { priceInput: string; price: string } }
    assert.equal(props.meal.priceInput, '12,50')
    assert.match(props.meal.price, /^12,50\s?MAD$/)
  })
})

test.group('Meals | duplicate', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => drive.restore('fs'))

  test('duplicating copies the fields and the photos, inactive', async ({ client, assert }) => {
    const fakeDisk = drive.fake('fs')
    const manager = await createStaff('manager')
    const meal = await createMeal({
      nameFr: 'Pastilla',
      nameEn: 'Pastilla',
      descriptionFr: 'Feuilletée',
      allergens: ['gluten', 'eggs'],
      tags: ['halal'],
      type: 'supplement',
      category: 'snack',
      priceCents: 5200,
      externalRecipeRef: 'R-1',
    })
    await client
      .post(`/admin/meals/${meal.id}/photos`)
      .loginAs(manager)
      .withCsrfToken()
      .file('photos[]', await pngBuffer(), { filename: 'a.png' })
      .file('photos[]', await pngBuffer(), { filename: 'b.png' })
      .redirects(0)
    const original = await photosOf(meal.id)
    assert.lengthOf(original, 2)
    await client
      .post(`/admin/meals/${meal.id}/photos/${original[1].id}/cover`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)

    const response = await client
      .post(`/admin/meals/${meal.id}/duplicate`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)

    const copy = await Meal.query().whereNot('id', meal.id).firstOrFail()
    assert.equal(response.header('location'), `/admin/meals/${copy.id}/edit`)
    assert.equal(copy.nameFr, 'Pastilla (copie)')
    assert.equal(copy.nameEn, 'Pastilla (copy)')
    assert.equal(copy.descriptionFr, 'Feuilletée')
    assert.equal(copy.priceCents, 5200)
    assert.deepEqual(copy.allergens, ['gluten', 'eggs'])
    assert.deepEqual(copy.tags, ['halal'])
    assert.equal(copy.externalRecipeRef, 'R-1')
    assert.isFalse(copy.isActive)

    const copied = await photosOf(copy.id)
    assert.lengthOf(copied, 2)
    assert.deepEqual(
      copied.map((photo) => photo.isCover),
      [false, true]
    )
    for (const photo of copied) {
      assert.match(photo.path, new RegExp(`^meals/${copy.id}/[0-9a-f-]{36}\\.webp$`))
      fakeDisk.assertExists([photo.path, photo.thumbPath])
    }
    // The source's files are untouched and distinct.
    fakeDisk.assertExists(original.flatMap((photo) => [photo.path, photo.thumbPath]))
  })
})

test.group('Meals | list and filters', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('filters by type, category, active flag and search', async ({ client, assert }) => {
    const manager = await createStaff('manager')
    const couscous = await createMeal({ nameFr: 'Couscous', nameEn: 'Couscous' })
    const tajine = await createMeal({ nameFr: 'Tajine', nameEn: 'Tagine', isActive: false })
    const yaourt = await createMeal({
      nameFr: 'Yaourt',
      nameEn: 'Yogurt',
      type: 'supplement',
      category: 'dessert',
      priceCents: 800,
    })
    const jus = await createMeal({
      nameFr: 'Jus 100%',
      nameEn: 'Juice',
      type: 'supplement',
      category: 'drink',
      externalRecipeRef: 'JUS_01',
    })
    await createMeal({
      nameFr: 'Ancien plat',
      nameEn: 'Old dish',
      isActive: false,
      deletedAt: DateTime.now(),
    })

    const ids = async (qs: string) => {
      const response = await client.get(`/admin/meals${qs}`).loginAs(manager).withInertia()
      response.assertStatus(200)
      const props = response.inertiaProps as {
        meals: Array<{ id: number }>
        meta: { total: number }
      }
      return props.meals.map((meal) => meal.id).sort((a, b) => a - b)
    }
    const sorted = (...list: number[]) => list.sort((a, b) => a - b)

    assert.deepEqual(await ids(''), sorted(couscous.id, tajine.id, yaourt.id, jus.id))
    assert.deepEqual(await ids('?type=supplement'), sorted(yaourt.id, jus.id))
    assert.deepEqual(await ids('?type=subscription'), sorted(couscous.id, tajine.id))
    assert.deepEqual(await ids('?category=drink'), [jus.id])
    assert.deepEqual(await ids('?active=inactive'), [tajine.id])
    assert.deepEqual(await ids('?active=active'), sorted(couscous.id, yaourt.id, jus.id))
    assert.deepEqual(await ids('?q=yog'), [yaourt.id])
    assert.deepEqual(await ids('?q=jus_'), [jus.id])
    assert.deepEqual(await ids('?q=100%25'), [jus.id])
    assert.deepEqual(await ids('?q=%25'), [jus.id], 'LIKE wildcards are escaped')
    assert.deepEqual(await ids('?type=bogus'), sorted(couscous.id, tajine.id, yaourt.id, jus.id))
  })

  test('the grid shows the cover thumbnail URL, never a storage key', async ({
    client,
    assert,
  }) => {
    const fakeDisk = drive.fake('fs')
    try {
      const manager = await createStaff('manager')
      const meal = await createMeal()
      await client
        .post(`/admin/meals/${meal.id}/photos`)
        .loginAs(manager)
        .withCsrfToken()
        .file('photos', await pngBuffer(), { filename: 'a.png' })
        .redirects(0)
      const [photo] = await photosOf(meal.id)
      fakeDisk.assertExists(photo.thumbPath)

      const response = await client.get('/admin/meals').loginAs(manager).withInertia()
      const props = response.inertiaProps as {
        meals: Array<{ cover: { thumbUrl: string } | null; photosCount: number }>
      }
      assert.match(
        props.meals[0].cover?.thumbUrl ?? '',
        new RegExp(`^/media/meal-photos/${photo.id}/thumb\\?v=[0-9a-f]{12}$`)
      )
      assert.equal(props.meals[0].photosCount, 1)
      assert.notInclude(JSON.stringify(response.inertiaProps), 'meals/')
    } finally {
      drive.restore('fs')
    }
  })
})

test.group('Meals | soft delete', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => drive.restore('fs'))

  test('deleting hides the meal from the catalog and pickers but keeps the row', async ({
    client,
    assert,
  }) => {
    const fakeDisk = drive.fake('fs')
    const manager = await createStaff('manager')
    const meal = await createMeal({ nameFr: 'Lasagnes' })
    const other = await createMeal()
    await client
      .post(`/admin/meals/${meal.id}/photos`)
      .loginAs(manager)
      .withCsrfToken()
      .file('photos', await pngBuffer(), { filename: 'a.png' })
      .redirects(0)
    const [photo] = await photosOf(meal.id)

    const response = await client
      .delete(`/admin/meals/${meal.id}`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    assert.equal(response.header('location'), '/admin/meals')

    // The row stays, flagged deleted and inactive (history and statements).
    const stored = await Meal.findOrFail(meal.id)
    assert.isNotNull(stored.deletedAt)
    assert.isFalse(stored.isActive)
    assert.isTrue(stored.isDeleted)

    // Catalog and menu-picker scopes exclude it.
    const catalog = await Meal.query().withScopes((s) => s.catalog())
    const offerable = await Meal.query().withScopes((s) => s.offerable())
    assert.deepEqual(
      catalog.map((m) => m.id),
      [other.id]
    )
    assert.deepEqual(
      offerable.map((m) => m.id),
      [other.id]
    )
    const list = await client.get('/admin/meals').loginAs(manager).withInertia()
    assert.deepEqual(
      (list.inertiaProps as { meals: Array<{ id: number }> }).meals.map((m) => m.id),
      [other.id]
    )
    const kitchen = await createStaff('kitchen')
    const kitchenList = await client.get('/kitchen/meals').loginAs(kitchen).withInertia()
    assert.deepEqual(
      (kitchenList.inertiaProps as { meals: Array<{ id: number }> }).meals.map((m) => m.id),
      [other.id]
    )

    // Back-office routes treat it as gone.
    const edit = await client.get(`/admin/meals/${meal.id}/edit`).loginAs(manager)
    edit.assertStatus(404)
    const kitchenShow = await client.get(`/kitchen/meals/${meal.id}`).loginAs(kitchen)
    kitchenShow.assertStatus(404)
    const update = await client
      .put(`/admin/meals/${meal.id}`)
      .loginAs(manager)
      .json(validMeal)
      .withCsrfToken()
      .redirects(0)
    update.assertStatus(404)
    const upload = await client
      .post(`/admin/meals/${meal.id}/photos`)
      .loginAs(manager)
      .withCsrfToken()
      .file('photos', await pngBuffer(), { filename: 'a.png' })
      .redirects(0)
    upload.assertStatus(404)
    const removePhoto = await client
      .delete(`/admin/meals/${meal.id}/photos/${photo.id}`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    removePhoto.assertStatus(404)

    // Its photos are kept and still served (order history).
    assert.lengthOf(await photosOf(meal.id), 1)
    fakeDisk.assertExists([photo.path, photo.thumbPath])
    const image = await client.get(`/media/meal-photos/${photo.id}/thumb`).loginAs(manager)
    image.assertStatus(200)
  })

  test('a deleted meal can never be active (database check)', async ({ assert }) => {
    const meal = await createMeal()
    await assert.rejects(
      () =>
        db.from('meals').where('id', meal.id).update({ deleted_at: new Date(), is_active: true }),
      /meals_deleted_inactive_check/
    )
  })
})
