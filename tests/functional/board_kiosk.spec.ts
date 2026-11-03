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

    // A second visit: the day is locked (ordered here), nothing can change — even with the old token.
    const again = (
      await client.post(`/board/${SLUG}/kiosk/session`).json({ pin: child.pin })
    ).body()
    assert.equal(again.locked.by, 'kiosk')
    assert.equal(again.token, '')
    assert.sameMembers(
      again.locked.lines.map((line: { name: string }) => line.name),
      [ctx.main.nameEn, ctx.juice.nameEn]
    )
    const change = await client
      .post(`/board/${SLUG}/kiosk/order`)
      .json({ token: session.token, subscriptionMealId: ctx.alt.id, specialMealIds: [] })
    change.assertStatus(422)
    assert.include(change.body().error.toLowerCase(), 'already')

    // A day the parent ordered in the app is locked too, with its own message.
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
    assert.equal(byApp.locked.by, 'app')
    assert.deepEqual(byApp.locked.lines, [{ name: ctx.alt.nameEn, quantity: 1 }])
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

    // After the board's cutoff (09:00) the day is closed, even though tomorrow would be open for parents.
    freezeClock('2026-11-24T09:30')
    const closed = await client.post(`/board/${SLUG}/kiosk/session`).json({ pin: child.pin })
    closed.assertStatus(422)
    assert.include(closed.body().error, 'closed for today (until 09:00)')

    // The limiter: 12 codes per 5 minutes from one address.
    freezeClock('2026-11-24T08:00')
    let last = 0
    for (let i = 0; i < 14; i += 1) {
      last = (await client.post(`/board/${SLUG}/kiosk/session`).json({ pin: '9999' })).status()
    }
    assert.equal(last, 429)
  })
})
