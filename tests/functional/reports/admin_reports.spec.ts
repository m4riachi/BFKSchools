/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { SchoolFactory } from '#database/factories/school_factory'
import { UserFactory } from '#database/factories/user_factory'
import LinkClick from '#models/link_click'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { setupMenuSchool, WED } from '#tests/helpers/menus'
import { family, orderSchool, orders, TUE } from '#tests/helpers/orders'

test.group('Reports page', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('the numbers of a period, for one school only', async ({ client, assert }) => {
    const { school, admin, main, alt, juice } = await orderSchool({
      subscription_meal_price_cents: 3000,
    })
    const first = await family(school)
    const second = await family(school)
    await family(school, { subscribed: false })

    const otherSchool = await SchoolFactory.create()
    const outsider = await UserFactory.apply('parent').merge({ schoolId: otherSchool.id }).create()

    freezeClock('2026-11-20T12:00')
    const service = await orders()
    await service.saveDay(
      first.child.id,
      TUE,
      { subscriptionMealId: main.id, supplements: [{ mealId: juice.id, qty: 2 }] },
      { user: first.parent }
    )
    await service.saveDay(
      second.child.id,
      TUE,
      { subscriptionMealId: alt.id, supplements: [] },
      { user: second.parent }
    )

    freezeClock(`${TUE}T12:00`)
    for (const parent of [first.parent, first.parent, second.parent]) {
      await client.get('/out/glovo').loginAs(parent).redirects(0)
    }
    await client.get('/out/delivery').loginAs(first.parent).redirects(0)
    await client.get('/out/delivery').loginAs(outsider).redirects(0)

    const response = await client
      .get('/admin/reports')
      .qs({ from: TUE, to: WED })
      .loginAs(admin)
      .withInertia()
    response.assertStatus(200)
    const report = response.body().props.report
    assert.equal(report.from, TUE)
    assert.equal(report.subscriptionMeals, 2)
    assert.equal(report.extras, 2)
    assert.match(report.revenue, /^80,00/)
    assert.equal(report.activeChildren, 3)
    assert.equal(report.activeSubscriptions, 2)
    assert.deepEqual(report.links, {
      glovo: { clicks: 3, parents: 2 },
      delivery: { clicks: 1, parents: 1 },
    })
    assert.lengthOf(report.topExtras, 1)
    assert.equal(report.topExtras[0].quantity, 2)
    assert.lengthOf(report.days, 1)
    assert.equal(report.days[0].date, TUE)
    assert.equal(report.days[0].glovo, 3)
  })

  test('charts list every date, and every week when the period is long', async ({
    client,
    assert,
  }) => {
    const { admin } = await setupMenuSchool()
    const report = async (from: string, to: string) =>
      (await client.get('/admin/reports').qs({ from, to }).loginAs(admin).withInertia()).body()
        .props.report.chart

    const short = await report('2026-11-02', '2026-11-08')
    assert.isFalse(short.byWeek)
    assert.lengthOf(short.points, 7)
    assert.equal(short.points[0].date, '2026-11-02')

    const long = await report('2026-09-02', '2026-12-15')
    assert.isTrue(long.byWeek)
    assert.equal(long.points[0].date, '2026-08-31')
    assert.lengthOf(long.points, 16)
  })

  test('a click just after midnight in Casablanca counts for that day', async ({
    client,
    assert,
  }) => {
    const { school, admin } = await setupMenuSchool()
    const { parent } = await family(school)
    freezeClock('2026-11-24T00:10')
    await client.get('/out/glovo').loginAs(parent).redirects(0)

    const clicks = async (day: string) =>
      (
        await client.get('/admin/reports').qs({ from: day, to: day }).loginAs(admin).withInertia()
      ).body().props.report.links.glovo.clicks
    assert.equal(await clicks('2026-11-24'), 1)
    assert.equal(await clicks('2026-11-23'), 0)
  })

  test('invalid dates fall back to this month', async ({ client, assert }) => {
    const { admin } = await setupMenuSchool()
    freezeClock('2026-11-18T12:00')
    for (const query of [
      { from: 'nope', to: 'nope' },
      { from: '2026-11-10' },
      { from: '2026-11-10', to: '2026-11-01' },
      { from: '2020-01-01', to: '2026-11-01' },
    ]) {
      const response = await client.get('/admin/reports').qs(query).loginAs(admin).withInertia()
      response.assertStatus(200)
      assert.equal(response.body().props.report.from, '2026-11-01', JSON.stringify(query))
      assert.equal(response.body().props.report.to, '2026-11-18')
    }
  })

  test('admins and managers open it; kitchen and parents do not', async ({ client }) => {
    const { school, admin, manager } = await setupMenuSchool()
    for (const user of [admin, manager]) {
      const response = await client.get('/admin/reports').loginAs(user).withInertia()
      response.assertStatus(200)
      response.assertInertiaComponent('admin/reports/index')
    }
    for (const role of ['kitchen', 'parent'] as const) {
      const user = await UserFactory.apply(role).merge({ schoolId: school.id }).create()
      const response = await client
        .get('/admin/reports')
        .loginAs(user)
        .header('Accept', 'application/json')
      response.assertStatus(403)
    }
  })
})

test.group('Outside links of the parent portal', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('a parent is counted, then sent to the address in the settings', async ({
    client,
    assert,
  }) => {
    const { school } = await setupMenuSchool({ glovo_url: 'https://example.test/glovo?a=1&b=2' })
    const { parent } = await family(school)
    const glovo = await client.get('/out/glovo').loginAs(parent).redirects(0)
    glovo.assertStatus(302)
    assert.equal(glovo.header('location'), 'https://example.test/glovo?a=1&b=2')
    const delivery = await client.get('/out/delivery').loginAs(parent).redirects(0)
    assert.equal(
      delivery.header('location'),
      'https://order.beldifusionkitchen.ma/marrakech/bfk-marrakech/store'
    )

    const clicks = await LinkClick.query().where('school_id', school.id).orderBy('id')
    assert.deepEqual(
      clicks.map((click) => [click.userId, click.link]),
      [
        [parent.id, 'glovo'],
        [parent.id, 'delivery'],
      ]
    )
  })

  test('a removed link counts nothing and goes home', async ({ client, assert }) => {
    const { school } = await setupMenuSchool({ glovo_url: null })
    const { parent } = await family(school)
    const response = await client.get('/out/glovo').loginAs(parent).redirects(0)
    assert.equal(response.header('location'), '/')
    assert.lengthOf(await LinkClick.all(), 0)
  })

  test('only logged-in parents; other names do not exist', async ({ client, assert }) => {
    const { school, admin } = await setupMenuSchool()
    const { parent } = await family(school)

    const guest = await client.get('/out/glovo').redirects(0)
    assert.equal(guest.status(), 302)
    assert.include(guest.header('location'), '/login')

    const staff = await client.get('/out/glovo').loginAs(admin).header('Accept', 'application/json')
    staff.assertStatus(403)

    const unknown = await client.get('/out/evil').loginAs(parent).redirects(0)
    unknown.assertStatus(404)
    assert.lengthOf(await LinkClick.all(), 0)
  })
})
