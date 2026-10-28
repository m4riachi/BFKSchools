/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import MealOrder from '#models/meal_order'
import OrderAuditLog from '#models/order_audit_log'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { addItem, jobs, supplementMeal, THU, TUE, WED } from '#tests/helpers/menus'
import { addChild, family, itemFor, orderOf, orderSchool, orders } from '#tests/helpers/orders'

/**
 * QA (independent): the server must refuse every crafted body, whatever the UI
 * would have sent. Each refusal leaves no order and no audit row.
 */
const OPEN = '2026-11-20T12:00'

test.group('QA | crafted bodies are refused server-side', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('table of forged selections', async ({ client, assert }) => {
    const { school, manager, main, alt, juice } = await orderSchool()
    const thuOnly = await supplementMeal()
    await addItem(school, manager, THU, thuOnly)
    const stranger = await supplementMeal() // never on any menu
    const { parent, child } = await family(school, { allergies: ['nuts'] })
    const nosub = await family(school, { subscribed: false })
    freezeClock(OPEN)

    type Body = Record<string, unknown>
    const cases: { t: string; as?: 'nosub'; date?: string; body: Body }[] = [
      { t: 'meal of another day', body: { supplements: [{ mealId: thuOnly.id, qty: 1 }] } },
      { t: 'meal on no menu', body: { supplements: [{ mealId: stranger.id, qty: 1 }] } },
      { t: 'subscription meal on no menu', body: { subscriptionMealId: stranger.id } },
      { t: 'unknown meal id', body: { subscriptionMealId: 999999 } },
      {
        t: 'two subscription meals (main + alt as supplement)',
        body: { subscriptionMealId: main.id, supplements: [{ mealId: alt.id, qty: 1 }] },
      },
      {
        t: 'two subscription meals (both as supplements)',
        body: {
          supplements: [
            { mealId: main.id, qty: 1 },
            { mealId: main.id, qty: 1 },
          ],
        },
      },
      { t: 'supplement used as the main meal', body: { subscriptionMealId: juice.id } },
      { t: 'supplement qty 6 (D14 max 5)', body: { supplements: [{ mealId: juice.id, qty: 6 }] } },
      { t: 'supplement qty 0', body: { supplements: [{ mealId: juice.id, qty: 0 }] } },
      { t: 'supplement qty -1', body: { supplements: [{ mealId: juice.id, qty: -1 }] } },
      { t: 'supplement qty 1.5', body: { supplements: [{ mealId: juice.id, qty: 1.5 }] } },
      { t: 'supplement qty huge', body: { supplements: [{ mealId: juice.id, qty: 1e12 }] } },
      {
        t: 'duplicate supplement lines',
        body: {
          supplements: [
            { mealId: juice.id, qty: 3 },
            { mealId: juice.id, qty: 3 },
          ],
        },
      },
      { t: 'empty selection', body: {} },
      {
        t: 'allergen (nuts) blocked, even with confirmAllergy',
        body: { subscriptionMealId: alt.id, confirmAllergy: true },
      },
      {
        t: 'D2: main meal without subscription',
        as: 'nosub',
        body: { subscriptionMealId: main.id },
      },
      {
        t: 'unpublished week (next Monday)',
        date: '2026-11-30',
        body: { subscriptionMealId: main.id },
      },
      { t: 'past day', date: '2026-11-10', body: { subscriptionMealId: main.id } },
    ]
    for (const c of cases) {
      const who = c.as === 'nosub' ? nosub : { parent, child }
      const res = await client
        .post(`/orders/${who.child.id}/days/${c.date ?? TUE}`)
        .loginAs(who.parent)
        .withCsrfToken()
        .json(c.body)
        .redirects(0)
      assert.notEqual(res.status(), 500, c.t)
      assert.oneOf(res.status(), [302, 404, 422], c.t)
    }
    assert.lengthOf(await MealOrder.query(), 0)
    assert.lengthOf(await OrderAuditLog.query(), 0)
  })

  test('sold-out: max_quantity enforced across children, over HTTP', async ({ client, assert }) => {
    const { school, juice } = await orderSchool()
    const a = await family(school)
    const b = await family(school)
    const item = await itemFor((await db.from('weekly_menus').firstOrFail()).id, TUE, juice)
    await db.from('menu_items').where('id', item.id).update({ max_quantity: 1 })
    freezeClock(OPEN)
    const body = { supplements: [{ mealId: juice.id, qty: 1 }] }
    await client
      .post(`/orders/${a.child.id}/days/${TUE}`)
      .loginAs(a.parent)
      .withCsrfToken()
      .json(body)
      .redirects(0)
    await client
      .post(`/orders/${b.child.id}/days/${TUE}`)
      .loginAs(b.parent)
      .withCsrfToken()
      .json(body)
      .redirects(0)
    assert.isNotNull(await orderOf(a.child, TUE))
    assert.isNull(await orderOf(b.child, TUE))
    // quantity 2 for a single child when only 1 is left
    const twice = await client
      .post(`/orders/${a.child.id}/days/${TUE}`)
      .loginAs(a.parent)
      .withCsrfToken()
      .json({ supplements: [{ mealId: juice.id, qty: 2 }] })
      .redirects(0)
    assert.notEqual(twice.status(), 500)
    assert.equal((await orderOf(a.child, TUE))!.items[0].quantity, 1)
  })

  test('apply-to-all: per-child checks (allergy, no subscription, window) and foreign ids', async ({
    client,
    assert,
  }) => {
    const { school, main, alt } = await orderSchool()
    const { parent, child } = await family(school, { allergies: ['nuts'] })
    const sibling = await addChild(parent, { subscribed: false })
    const other = await family(school)
    freezeClock(OPEN)
    await client
      .post(`/orders/days/${WED}/all`)
      .loginAs(parent)
      .withCsrfToken()
      .json({ subscriptionMealId: alt.id, supplements: [], childIds: [child.id, sibling.id] })
      .redirects(0)
    assert.isNull(await orderOf(child, WED), 'allergic child refused')
    assert.isNull(await orderOf(sibling, WED), 'unsubscribed sibling refused main meal')
    const foreign = await client
      .post(`/orders/days/${WED}/all`)
      .loginAs(parent)
      .withCsrfToken()
      .json({ subscriptionMealId: main.id, supplements: [], childIds: [child.id, other.child.id] })
      .redirects(0)
    assert.equal(foreign.status(), 404)
    assert.isNull(await orderOf(child, WED), 'nothing applied when a foreign id is present')
    assert.isNull(await orderOf(other.child, WED))
  })

  test('absent/cancel is also gated by the window (after cutoff, holiday-free published day)', async ({
    client,
    assert,
  }) => {
    const { school, main } = await orderSchool()
    const { parent, child } = await family(school)
    const svc = await orders()
    freezeClock(OPEN)
    await svc.saveDay(
      child.id,
      TUE,
      { subscriptionMealId: main.id, supplements: [] },
      { user: parent }
    )
    freezeClock('2026-11-23T18:00') // Tue cutoff reached
    const res = await client
      .post(`/orders/${child.id}/days/${TUE}/absent`)
      .loginAs(parent)
      .withCsrfToken()
      .redirects(0)
    assert.notEqual(res.status(), 500)
    assert.equal((await orderOf(child, TUE))!.status, 'active')
    const save = await client
      .post(`/orders/${child.id}/days/${TUE}`)
      .loginAs(parent)
      .withCsrfToken()
      .json({ supplements: [], subscriptionMealId: main.id })
      .redirects(0)
    assert.notEqual(save.status(), 500)
    assert.lengthOf(await OrderAuditLog.query().where('child_id', child.id), 1)
  })
})

test.group('QA | deadline job edge cases', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('a late job run never assigns past days; a second run is a no-op', async ({ assert }) => {
    const { school } = await orderSchool()
    const { child } = await family(school)
    freezeClock('2026-11-25T10:00') // Wednesday: Mon and Tue are past, deadline long gone
    const first = await (await jobs()).applyDeadline()
    if (first.acquired) assert.lengthOf(first.result, 1)
    const dates = (await MealOrder.query().where('child_id', child.id).orderBy('date')).map(
      (o) => o.date
    )
    assert.deepEqual(dates, [WED, THU, '2026-11-27'])
    const second = await (await jobs()).applyDeadline()
    if (second.acquired) assert.lengthOf(second.result, 0)
    assert.lengthOf(await MealOrder.query().where('child_id', child.id), 3)
    assert.lengthOf(await OrderAuditLog.query().where('child_id', child.id), 3)
  })

  test('the deadline job does not touch an unpublished (scheduled) week', async ({ assert }) => {
    const { school } = await orderSchool()
    await family(school)
    await db.from('weekly_menus').update({ status: 'scheduled' })
    freezeClock('2026-11-23T08:00')
    await (await jobs()).applyDeadline()
    assert.lengthOf(await MealOrder.query(), 0)
  })
})
