/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import { SchoolFactory } from '#database/factories/school_factory'
import { UserFactory } from '#database/factories/user_factory'
import SchoolApiKey from '#models/school_api_key'
import ApiKeyService from '#services/api_key_service'
import { API_LIMITS } from '#start/limiter'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { setupMenuSchool, WED } from '#tests/helpers/menus'
import { family, orderSchool, orders, TUE } from '#tests/helpers/orders'

const URL = '/api/v1/revenue/daily'

async function keysFor(schoolId: number) {
  const admin = await UserFactory.apply('admin').merge({ schoolId }).create()
  return (await app.container.make(ApiKeyService)).generate(schoolId, admin)
}

test.group('Revenue API', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => limiter.clear(['memory']))
  group.each.teardown(() => restoreClock())

  /** TUE: two children with a main meal, one with 2 juices (10 MAD each). WED: cancelled. */
  async function orderedWeek(settings: Record<string, unknown> = {}) {
    const ctx = await orderSchool(settings)
    const first = await family(ctx.school)
    const second = await family(ctx.school)
    freezeClock('2026-11-20T12:00')
    const service = await orders()
    await service.saveDay(
      first.child.id,
      TUE,
      { subscriptionMealId: ctx.main.id, supplements: [{ mealId: ctx.juice.id, qty: 2 }] },
      { user: first.parent }
    )
    await service.saveDay(
      second.child.id,
      TUE,
      { subscriptionMealId: ctx.alt.id, supplements: [] },
      { user: second.parent }
    )
    await service.saveDay(
      first.child.id,
      WED,
      { subscriptionMealId: ctx.main.id, supplements: [] },
      { user: first.parent }
    )
    await service.cancelDay(first.child.id, WED, { user: first.parent })
    return { ...ctx, keys: await keysFor(ctx.school.id) }
  }

  test('a day: subscription meals × the amount in the settings + extras', async ({
    client,
    assert,
  }) => {
    const { keys } = await orderedWeek({ subscription_meal_price_cents: 3000 })
    const response = await client
      .get(URL)
      .qs({ date: TUE })
      .header('X-Api-Key', keys.publicKey)
      .header('X-Api-Secret', keys.secret)
    response.assertStatus(200)
    assert.equal(response.header('cache-control'), 'no-store')
    const body = response.body()
    assert.equal(body.currency, 'MAD')
    assert.equal(body.subscriptionMealPriceCents, 3000)
    assert.deepEqual(body.days, [
      {
        date: TUE,
        provisional: true,
        subscriptionMeals: 2,
        subscriptionAmountCents: 6000,
        extras: 2,
        extrasAmountCents: 2000,
        totalCents: 8000,
        total: '80.00',
      },
    ])
  })

  test('a period lists every date, leaves out cancelled orders and adds up', async ({
    client,
    assert,
  }) => {
    const { keys } = await orderedWeek({ subscription_meal_price_cents: 3000 })
    freezeClock(`${WED}T12:00`)
    const response = await client
      .get(URL)
      .qs({ from: TUE, to: WED })
      .header('X-Api-Key', keys.publicKey)
      .header('X-Api-Secret', keys.secret)
    response.assertStatus(200)
    const { days, totals } = response.body()
    assert.deepEqual(
      days.map((day: { date: string; totalCents: number; provisional: boolean }) => [
        day.date,
        day.totalCents,
        day.provisional,
      ]),
      [
        [TUE, 8000, false],
        [WED, 0, true],
      ]
    )
    assert.equal(totals.totalCents, 8000)
    assert.equal(totals.subscriptionMeals, 2)
  })

  test('without an amount in the settings, only the extras count and it says so', async ({
    client,
    assert,
  }) => {
    const { keys } = await orderedWeek()
    const response = await client
      .get(URL)
      .qs({ date: TUE })
      .header('X-Api-Key', keys.publicKey)
      .header('X-Api-Secret', keys.secret)
    assert.isNull(response.body().subscriptionMealPriceCents)
    assert.equal(response.body().totals.subscriptionMeals, 2)
    assert.equal(response.body().totals.subscriptionAmountCents, 0)
    assert.equal(response.body().totals.totalCents, 2000)
  })

  test('without parameters: today in the school time zone', async ({ client, assert }) => {
    const { keys } = await orderedWeek()
    freezeClock('2026-11-24T00:30')
    const response = await client
      .get(URL)
      .header('X-Api-Key', keys.publicKey)
      .header('X-Api-Secret', keys.secret)
    assert.equal(response.body().from, TUE)
    assert.equal(response.body().to, TUE)
  })

  test('keys only open the school they belong to', async ({ client, assert }) => {
    const { keys } = await orderedWeek({ subscription_meal_price_cents: 3000 })
    const other = await SchoolFactory.create()
    const otherKeys = await keysFor(other.id)
    const response = await client
      .get(URL)
      .qs({ date: TUE })
      .header('X-Api-Key', otherKeys.publicKey)
      .header('X-Api-Secret', otherKeys.secret)
    response.assertStatus(200)
    assert.equal(response.body().totals.totalCents, 0)

    // A valid secret does not open another school's public key.
    const mixed = await client
      .get(URL)
      .header('X-Api-Key', keys.publicKey)
      .header('X-Api-Secret', otherKeys.secret)
    mixed.assertStatus(401)
  })

  test('missing or wrong keys get 401 in JSON, and keys in the URL do not count', async ({
    client,
    assert,
  }) => {
    const school = await SchoolFactory.create()
    const keys = await keysFor(school.id)
    const attempts = [
      client.get(URL),
      client.get(URL).header('X-Api-Key', keys.publicKey),
      client.get(URL).header('X-Api-Secret', keys.secret),
      client.get(URL).header('X-Api-Key', keys.publicKey).header('X-Api-Secret', 'wrong'),
      client.get(URL).header('X-Api-Key', 'wrong').header('X-Api-Secret', keys.secret),
      client.get(URL).qs({ 'X-Api-Key': keys.publicKey, 'X-Api-Secret': keys.secret }),
    ]
    for (const attempt of attempts) {
      const response = await attempt
      response.assertStatus(401)
      assert.equal(response.body().error.code, 'invalid_api_key')
    }
  })

  test('a logged-in admin without keys is refused too', async ({ client }) => {
    const { admin } = await setupMenuSchool()
    const response = await client.get(URL).loginAs(admin)
    response.assertStatus(401)
  })

  test('invalid periods get 422', async ({ client, assert }) => {
    const school = await SchoolFactory.create()
    const keys = await keysFor(school.id)
    const queries = [
      { date: '2026-02-30' },
      { date: 'yesterday' },
      { date: TUE, from: TUE, to: TUE },
      { from: TUE },
      { to: TUE },
      { from: WED, to: TUE },
      { from: '2026-01-01', to: '2027-01-02' },
    ]
    for (const query of queries) {
      const response = await client
        .get(URL)
        .qs(query)
        .header('X-Api-Key', keys.publicKey)
        .header('X-Api-Secret', keys.secret)
      response.assertStatus(422)
      assert.equal(response.body().error.code, 'invalid_query', JSON.stringify(query))
    }

    const longest = await client
      .get(URL)
      .qs({ from: '2026-01-01', to: '2027-01-01' })
      .header('X-Api-Key', keys.publicKey)
      .header('X-Api-Secret', keys.secret)
    longest.assertStatus(200)
    assert.lengthOf(longest.body().days, 366)
  })

  test('too many requests get 429 with Retry-After', async ({ client, assert }) => {
    for (let index = 0; index < API_LIMITS.ip.requests; index++) await client.get(URL)
    const response = await client.get(URL)
    response.assertStatus(429)
    assert.equal(response.body().error.code, 'too_many_requests')
    assert.isAbove(Number(response.header('retry-after')), 0)
  })
})

test.group('API keys in the settings', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => limiter.clear(['memory']))

  test('an admin generates keys: the page shows the public key, never the secret', async ({
    client,
    assert,
  }) => {
    const { school, admin } = await setupMenuSchool()
    const empty = await client.get('/admin/settings').loginAs(admin).withInertia()
    assert.isNull(empty.body().props.api.publicKey)
    assert.match(empty.body().props.api.endpoint, /\/api\/v1\/revenue\/daily$/)

    const created = await client
      .post('/admin/settings/api-keys')
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
    created.assertStatus(302)

    const key = await SchoolApiKey.findByOrFail('schoolId', school.id)
    const page = await client.get('/admin/settings').loginAs(admin).withInertia()
    assert.equal(page.body().props.api.publicKey, key.publicKey)

    const shown = await client.get('/admin/settings/api-keys/secret').loginAs(admin)
    shown.assertStatus(200)
    assert.equal(shown.header('cache-control'), 'no-store')
    const secret = shown.body().secret
    assert.match(secret, /^bfk_sk_[0-9a-f]{64}$/)
    assert.notInclude(key.secretEncrypted, secret)
    assert.notInclude(JSON.stringify(page.body()), secret)
  })

  test('new keys replace the old ones at once', async ({ client, assert }) => {
    const { school, admin } = await setupMenuSchool()
    const old = await keysFor(school.id)
    await client.post('/admin/settings/api-keys').loginAs(admin).withCsrfToken().redirects(0)

    assert.lengthOf(await SchoolApiKey.query().where('school_id', school.id), 1)
    const response = await client
      .get(URL)
      .header('X-Api-Key', old.publicKey)
      .header('X-Api-Secret', old.secret)
    response.assertStatus(401)
  })

  test('managers, kitchen and parents cannot generate or read keys', async ({ client }) => {
    const { school } = await setupMenuSchool()
    await keysFor(school.id)
    for (const role of ['manager', 'kitchen', 'parent'] as const) {
      const user = await UserFactory.apply(role).merge({ schoolId: school.id }).create()
      const read = await client
        .get('/admin/settings/api-keys/secret')
        .loginAs(user)
        .header('Accept', 'application/json')
      read.assertStatus(403)
      const write = await client
        .post('/admin/settings/api-keys')
        .loginAs(user)
        .withCsrfToken()
        .header('Accept', 'application/json')
      write.assertStatus(403)
    }
  })

  test('without keys, or with an unreadable secret, the secret page answers 404', async ({
    client,
  }) => {
    const { school, admin } = await setupMenuSchool()
    const none = await client.get('/admin/settings/api-keys/secret').loginAs(admin)
    none.assertStatus(404)

    await keysFor(school.id)
    const key = await SchoolApiKey.findByOrFail('schoolId', school.id)
    key.secretEncrypted = 'not-readable'
    await key.save()
    const broken = await client.get('/admin/settings/api-keys/secret').loginAs(admin)
    broken.assertStatus(404)
  })
})
