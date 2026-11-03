/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import Child from '#models/child'
import MealOrder from '#models/meal_order'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { builder, menuOf } from '#tests/helpers/menus'
import { family, itemFor, orderSchool, orders, TUE } from '#tests/helpers/orders'

const SLUG = 'bfk-kiosk-test'

async function enableBoard(client: any, admin: any) {
  const response = await client
    .post('/admin/settings/board')
    .loginAs(admin)
    .withCsrfToken()
    .json({ board_slug: SLUG })
    .redirects(0)
  response.assertStatus(302)
}

test.group('Board kiosk (D51)', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await limiter.clear(['memory'])
    return async () => {
      restoreClock()
      await truncate()
    }
  })

  test('code → dish → special → confirm: the order is saved for the first open day', async ({
    client,
    assert,
  }) => {
    const ctx = await orderSchool()
    await enableBoard(client, ctx.admin)
    const home = await family(ctx.school)
    const child = await Child.findOrFail(home.child.id)
    assert.match(child.pin, /^\d{4}$/)
    const menu = await menuOf(ctx.school)
    await (
      await builder()
    ).setSpecial(ctx.school, menu, (await itemFor(menu.id, TUE, ctx.juice)).id, ctx.manager)

    // Tuesday 08:00: the parents' window is closed (cutoff Monday 18:00), the board's is open until 09:00.
    freezeClock('2026-11-24T08:00')
    const start = await client.post(`/board/${SLUG}/kiosk/session`).json({ pin: child.pin })
    start.assertStatus(200)
    const session = start.body()
    assert.equal(session.childName, child.firstName)
    assert.equal(session.date, TUE)
    assert.sameMembers(
      session.dishes.map((o: { mealId: number }) => o.mealId),
      [ctx.main.id, ctx.alt.id]
    )
    assert.deepEqual(
      session.specials.map((o: { mealId: number }) => o.mealId),
      [ctx.juice.id]
    )
    assert.deepEqual(session.extras, [])
    assert.isTrue(
      session.dishes[0].photoUrl === null ||
        session.dishes[0].photoUrl.startsWith(`/board/${SLUG}/photos/`)
    )
    assert.notInclude(JSON.stringify(session), home.parent.email)

    const order = await client.post(`/board/${SLUG}/kiosk/order`).json({
      token: session.token,
      subscriptionMealId: ctx.main.id,
      specialMealIds: [ctx.juice.id],
      extraMealIds: [],
    })
    order.assertStatus(200)
    const printable = Buffer.from(order.body().ticket, 'base64').toString('latin1')
    assert.include(printable, child.firstName)
    assert.include(printable, '\x1dV\x42\x00')
    const saved = await MealOrder.query()
      .where('child_id', child.id)
      .where('date', TUE)
      .preload('items')
      .firstOrFail()
    assert.equal(saved.status, 'active')
    assert.equal(saved.origin, 'kiosk')
    assert.sameDeepMembers(
      saved.items.map((line) => [line.mealId, line.quantity]),
      [
        [ctx.main.id, 1],
        [ctx.juice.id, 1],
      ]
    )

    // D58: a second visit — the dish is already chosen, so it is fixed; the
    // child may still add supplements (no hard lock any more).
    const again = (
      await client.post(`/board/${SLUG}/kiosk/session`).json({ pin: child.pin })
    ).body()
    assert.isTrue(again.extrasOnly)
    assert.equal(again.fixedDishName, ctx.main.nameEn)
    assert.isNotEmpty(again.token)
    assert.lengthOf(again.dishes, 0)
    assert.sameMembers(
      again.ordered.map((line: { name: string }) => line.name),
      [ctx.main.nameEn, ctx.juice.nameEn]
    )
    // Trying to change the dish keeps the chosen one (the server ignores it).
    const change = await client.post(`/board/${SLUG}/kiosk/order`).json({
      token: again.token,
      subscriptionMealId: ctx.alt.id,
      specialMealIds: [ctx.juice.id],
      extraMealIds: [],
    })
    change.assertStatus(200)
    const afterChange = await MealOrder.query()
      .where('child_id', child.id)
      .where('date', TUE)
      .preload('items')
      .firstOrFail()
    assert.isTrue(afterChange.items.some((l) => l.mealId === ctx.main.id)) // dish unchanged
    assert.isFalse(afterChange.items.some((l) => l.mealId === ctx.alt.id))

    // D58: a dish ordered in the app is fixed too; the child can add extras.
    const other = await family(ctx.school)
    freezeClock('2026-11-20T12:00')
    await (
      await orders()
    ).saveDay(
      other.child.id,
      TUE,
      { subscriptionMealId: ctx.alt.id, supplements: [] },
      { user: other.parent }
    )
    freezeClock('2026-11-24T08:00')
    const byApp = (
      await client
        .post(`/board/${SLUG}/kiosk/session`)
        .json({ pin: (await Child.findOrFail(other.child.id)).pin })
    ).body()
    assert.isTrue(byApp.extrasOnly)
    assert.equal(byApp.fixedDishName, ctx.alt.nameEn)
    assert.isNotEmpty(byApp.token)
  })

  test('unknown code, tampered token, closed days and too many tries are refused', async ({
    client,
    assert,
  }) => {
    const ctx = await orderSchool()
    await enableBoard(client, ctx.admin)
    const home = await family(ctx.school)
    const child = await Child.findOrFail(home.child.id)
    freezeClock('2026-11-24T08:00')

    const wrong = await client
      .post(`/board/${SLUG}/kiosk/session`)
      .json({ pin: child.pin === '0000' ? '0001' : '0000' })
    wrong.assertStatus(422)
    assert.include(wrong.body().error, 'code')
    ;(await client.post(`/board/${SLUG}/kiosk/session`).json({ pin: '12' })).assertStatus(422)
    ;(
      await client.post('/board/no-such-board/kiosk/session').json({ pin: child.pin })
    ).assertStatus(404)

    const tampered = await client
      .post(`/board/${SLUG}/kiosk/order`)
      .json({ token: 'not-a-real-token-at-all', subscriptionMealId: ctx.main.id })
    tampered.assertStatus(422)

    // D58: after the dish cutoff (09:00) the board is extras-only (supplements
    // until 13:00), not closed — no dish to pick, but the child can add extras.
    freezeClock('2026-11-24T09:30')
    const extrasOnly = (
      await client.post(`/board/${SLUG}/kiosk/session`).json({ pin: child.pin })
    ).body()
    assert.isTrue(extrasOnly.extrasOnly)
    assert.lengthOf(extrasOnly.dishes, 0)
    // Only after the supplements cutoff (13:00) is the board closed for the day.
    freezeClock('2026-11-24T13:30')
    const closed = await client.post(`/board/${SLUG}/kiosk/session`).json({ pin: child.pin })
    closed.assertStatus(422)
    assert.include(closed.body().error, 'closed for today (until 13:00)')

    // The limiter: 12 codes per 5 minutes from one address.
    freezeClock('2026-11-24T08:00')
    let last = 0
    for (let i = 0; i < 14; i += 1) {
      last = (await client.post(`/board/${SLUG}/kiosk/session`).json({ pin: '9999' })).status()
    }
    assert.equal(last, 429)
  })

  test('D58: past the dish cutoff a child can order a supplement with no dish', async ({
    client,
    assert,
  }) => {
    const ctx = await orderSchool()
    await enableBoard(client, ctx.admin)
    const home = await family(ctx.school)
    const child = await Child.findOrFail(home.child.id)
    const menu = await menuOf(ctx.school)
    await (
      await builder()
    ).setSpecial(ctx.school, menu, (await itemFor(menu.id, TUE, ctx.juice)).id, ctx.manager)

    // 09:30: after the dish cutoff (09:00), before the supplements cutoff (13:00).
    freezeClock('2026-11-24T09:30')
    const session = (
      await client.post(`/board/${SLUG}/kiosk/session`).json({ pin: child.pin })
    ).body()
    assert.isTrue(session.extrasOnly)
    assert.isNull(session.fixedDishName)
    assert.lengthOf(session.dishes, 0)
    assert.isTrue(session.specials.some((o: { mealId: number }) => o.mealId === ctx.juice.id))

    const order = await client.post(`/board/${SLUG}/kiosk/order`).json({
      token: session.token,
      subscriptionMealId: ctx.main.id, // ignored: no dish may be chosen now
      specialMealIds: [ctx.juice.id],
      extraMealIds: [],
    })
    order.assertStatus(200)
    const saved = await MealOrder.query()
      .where('child_id', child.id)
      .where('date', TUE)
      .preload('items')
      .firstOrFail()
    assert.deepEqual(
      saved.items.map((l) => l.mealId),
      [ctx.juice.id] // the supplement only, no dish
    )
  })
})
