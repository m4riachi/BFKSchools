/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import app from '@adonisjs/core/services/app'
import MealOrder from '#models/meal_order'
import MenuItem from '#models/menu_item'
import Notification from '#models/notification'
import OutboundEmail from '#models/outbound_email'
import OrderAuditLog from '#models/order_audit_log'
import HolidayService from '#services/holiday_service'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { addHoliday } from '#tests/helpers/menus'
import {
  MON,
  TUE,
  WED,
  addChild,
  auditOf,
  family,
  itemFor,
  orderOf,
  orderSchool,
  orders,
  ruleOf,
} from '#tests/helpers/orders'

/** Before the deadline (Sun 22 Nov 20:00): every day of the week is open. */
const OPEN = '2026-11-20T12:00'

test.group('Orders | saveDay', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('creates an order with snapshot prices and one audit row', async ({ assert }) => {
    const { school, menu, main, juice } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    const service = await orders()
    const outcome = await service.saveDay(
      child.id,
      TUE,
      { subscriptionMealId: main.id, supplements: [{ mealId: juice.id, qty: 2 }] },
      { user: parent, ip: '203.0.113.7' }
    )
    assert.equal(outcome.action, 'create')
    const order = (await orderOf(child, TUE))!
    assert.equal(order.status, 'active')
    assert.equal(order.origin, 'parent')
    assert.equal(order.weeklyMenuId, menu.id)
    assert.deepEqual(
      order.items.map((line) => [
        line.mealId,
        line.quantity,
        line.unitPriceCents,
        line.lineTotalCents,
      ]),
      [
        [main.id, 1, 4500, 4500],
        [juice.id, 2, 1000, 2000],
      ]
    )
    const [audit] = await auditOf(child)
    assert.equal(audit.action, 'create')
    assert.equal(audit.actorId, parent.id)
    assert.equal(audit.actorRole, 'parent')
    assert.equal(audit.ipAddress, '203.0.113.7')
    assert.isNull(audit.before)
    assert.equal(audit.after!.status, 'active')
    assert.lengthOf(audit.after!.items, 2)
  })

  test('changes are diffed and audited; an identical save changes nothing', async ({ assert }) => {
    const { school, alt, main, juice } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    const service = await orders()
    const actor = { user: parent }
    await service.saveDay(child.id, WED, { subscriptionMealId: main.id, supplements: [] }, actor)
    const second = await service.saveDay(
      child.id,
      WED,
      { subscriptionMealId: main.id, supplements: [{ mealId: juice.id, qty: 1 }] },
      actor
    )
    assert.equal(second.action, 'update')
    const same = await service.saveDay(
      child.id,
      WED,
      { subscriptionMealId: main.id, supplements: [{ mealId: juice.id, qty: 1 }] },
      actor
    )
    assert.isNull(same.action)
    const audits = await auditOf(child)
    assert.deepEqual(
      audits.map((row) => row.action),
      ['create', 'update']
    )
    assert.lengthOf(audits[1].before!.items, 1)
    assert.lengthOf(audits[1].after!.items, 2)
    // Allergy-free child: switching to the nut dish is fine.
    await service.saveDay(child.id, WED, { subscriptionMealId: alt.id, supplements: [] }, actor)
    const order = (await orderOf(child, WED))!
    assert.deepEqual(
      order.items.map((line) => line.mealId),
      [alt.id]
    )
  })

  test('editing a meal price never changes existing snapshots', async ({ assert }) => {
    const { school, main, juice } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    const service = await orders()
    await service.saveDay(
      child.id,
      TUE,
      { subscriptionMealId: main.id, supplements: [] },
      { user: parent }
    )
    main.priceCents = 9900
    await main.save()
    juice.priceCents = 1500
    await juice.save()
    await service.saveDay(
      child.id,
      TUE,
      { subscriptionMealId: main.id, supplements: [{ mealId: juice.id, qty: 1 }] },
      { user: parent }
    )
    const order = (await orderOf(child, TUE))!
    assert.deepEqual(
      order.items.map((line) => [line.mealId, line.unitPriceCents]),
      [
        [main.id, 4500],
        [juice.id, 1500],
      ]
    )
  })

  test('refuses invalid selections and leaves the database untouched', async ({ assert }) => {
    const { school, main, alt, juice } = await orderSchool()
    const { parent, child } = await family(school, { allergies: ['nuts'] })
    const other = await (await import('#tests/helpers/menus')).subscriptionMeal()
    freezeClock(OPEN)
    const service = await orders()
    const actor = { user: parent }
    const cases: [string, Parameters<typeof service.saveDay>[2]][] = [
      ['MEAL_NOT_ON_MENU', { subscriptionMealId: other.id, supplements: [] }],
      [
        'TWO_SUBSCRIPTION_MEALS',
        { subscriptionMealId: main.id, supplements: [{ mealId: alt.id, qty: 1 }] },
      ],
      [
        'SUPPLEMENT_QUANTITY',
        { subscriptionMealId: main.id, supplements: [{ mealId: juice.id, qty: 6 }] },
      ],
      ['ALLERGY_BLOCKED', { subscriptionMealId: alt.id, supplements: [] }],
      ['ALLERGY_BLOCKED', { subscriptionMealId: alt.id, supplements: [], confirmAllergy: true }],
      ['EMPTY_SELECTION', { subscriptionMealId: null, supplements: [] }],
    ]
    for (const [rule, selection] of cases) {
      assert.equal(await ruleOf(service.saveDay(child.id, TUE, selection, actor)), rule)
    }
    assert.isNull(await orderOf(child, TUE))
    assert.lengthOf(await auditOf(child), 0)
  })

  test('warn_confirm accepts an allergen once confirmed (D9 alternative)', async ({ assert }) => {
    const { school, alt } = await orderSchool({ allergy_rule: 'warn_confirm' })
    const { parent, child } = await family(school, { allergies: ['nuts'] })
    freezeClock(OPEN)
    const service = await orders()
    assert.equal(
      await ruleOf(
        service.saveDay(
          child.id,
          TUE,
          { subscriptionMealId: alt.id, supplements: [] },
          { user: parent }
        )
      ),
      'ALLERGY_CONFIRM_REQUIRED'
    )
    await service.saveDay(
      child.id,
      TUE,
      { subscriptionMealId: alt.id, supplements: [], confirmAllergy: true },
      { user: parent }
    )
    assert.equal((await orderOf(child, TUE))!.items[0].mealId, alt.id)
  })

  test('D2: no subscription → no main meal, extras allowed', async ({ assert }) => {
    const { school, main, juice } = await orderSchool()
    const { parent, child } = await family(school, { subscribed: false })
    freezeClock(OPEN)
    const service = await orders()
    assert.equal(
      await ruleOf(
        service.saveDay(
          child.id,
          TUE,
          { subscriptionMealId: main.id, supplements: [] },
          { user: parent }
        )
      ),
      'NO_SUBSCRIPTION'
    )
    await service.saveDay(
      child.id,
      TUE,
      { subscriptionMealId: null, supplements: [{ mealId: juice.id, qty: 3 }] },
      { user: parent }
    )
    assert.equal((await orderOf(child, TUE))!.items[0].quantity, 3)
  })

  test('meal availability is checked when ordering (inactive meal, removed item)', async ({
    assert,
  }) => {
    const { school, menu, main, juice } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    const service = await orders()
    juice.isActive = false
    await juice.save()
    assert.equal(
      await ruleOf(
        service.saveDay(
          child.id,
          TUE,
          { subscriptionMealId: main.id, supplements: [{ mealId: juice.id, qty: 1 }] },
          { user: parent }
        )
      ),
      'MEAL_UNAVAILABLE'
    )
    const item = await itemFor(menu.id, WED, main)
    await MenuItem.query().where('id', item.id).update({ removed_at: new Date().toISOString() })
    assert.equal(
      await ruleOf(
        service.saveDay(
          child.id,
          WED,
          { subscriptionMealId: main.id, supplements: [] },
          { user: parent }
        )
      ),
      'MEAL_NOT_ON_MENU'
    )
  })

  test('the window decides: cutoff, holiday, inactive child', async ({ assert }) => {
    const { school, main } = await orderSchool()
    const { parent, child } = await family(school)
    await addHoliday(school, WED, 'Closed')
    freezeClock('2026-11-23T18:00') // Tuesday's cutoff
    const service = await orders()
    const sel = { subscriptionMealId: main.id, supplements: [] }
    assert.equal(
      await ruleOf(service.saveDay(child.id, TUE, sel, { user: parent })),
      'AFTER_CUTOFF'
    )
    assert.equal(
      await ruleOf(service.saveDay(child.id, MON, sel, { user: parent })),
      'AFTER_CUTOFF'
    )
    assert.equal(await ruleOf(service.saveDay(child.id, WED, sel, { user: parent })), 'HOLIDAY')
    child.isActive = false
    await child.save()
    freezeClock(OPEN)
    assert.equal(
      await ruleOf((await orders()).saveDay(child.id, TUE, sel, { user: parent })),
      'INACTIVE'
    )
    assert.lengthOf(await MealOrder.all(), 0)
  })

  test('"no meal this day" keeps a cancelled row; ordering again re-activates it', async ({
    assert,
  }) => {
    const { school, main } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    const service = await orders()
    const absent = await service.cancelDay(child.id, TUE, { user: parent })
    assert.equal(absent.action, 'cancel')
    let order = (await orderOf(child, TUE))!
    assert.equal(order.status, 'cancelled')
    assert.equal(order.cancelReason, 'absent')
    // Twice: nothing new.
    assert.isNull((await service.cancelDay(child.id, TUE, { user: parent })).action)

    const again = await service.saveDay(
      child.id,
      TUE,
      { subscriptionMealId: main.id, supplements: [] },
      { user: parent }
    )
    assert.equal(again.action, 'reactivate')
    order = (await orderOf(child, TUE))!
    assert.equal(order.status, 'active')
    assert.isNull(order.cancelReason)
    await service.cancelDay(child.id, TUE, { user: parent })
    assert.equal((await orderOf(child, TUE))!.status, 'cancelled')
    assert.deepEqual(
      (await auditOf(child)).map((row) => row.action),
      ['cancel', 'reactivate', 'cancel']
    )
    assert.lengthOf(await MealOrder.all(), 1)
  })

  test('staff override: reason required, audited, parent notified; structural locks stay', async ({
    assert,
  }) => {
    const { school, manager, main } = await orderSchool()
    const { parent, child } = await family(school)
    await addHoliday(school, WED, 'Closed')
    freezeClock('2026-11-24T10:00') // Tuesday: today, after its cutoff
    const service = await orders()
    const sel = { subscriptionMealId: main.id, supplements: [] }
    assert.equal(
      await ruleOf(service.saveDay(child.id, TUE, sel, { user: manager })),
      'REASON_REQUIRED'
    )
    assert.equal(
      await ruleOf(service.saveDay(child.id, TUE, sel, { user: manager }, { reason: '  ' })),
      'REASON_REQUIRED'
    )
    assert.equal(
      await ruleOf(service.saveDay(child.id, TUE, sel, { user: parent })),
      'AFTER_CUTOFF'
    )

    const outcome = await service.saveDay(
      child.id,
      TUE,
      sel,
      { user: manager },
      { reason: 'Phone call' }
    )
    assert.equal(outcome.action, 'staff_override')
    const order = (await orderOf(child, TUE))!
    assert.equal(order.origin, 'staff')
    const [audit] = await auditOf(child)
    assert.equal(audit.action, 'staff_override')
    assert.equal(audit.actorRole, 'manager')
    assert.equal(audit.reason, 'Phone call')
    const notice = await Notification.findByOrFail('user_id', parent.id)
    assert.equal(notice.type, 'order_changed_by_staff')
    const email = await OutboundEmail.findByOrFail('user_id', parent.id)
    assert.equal(email.mailKey, 'order_changed_by_staff')

    assert.equal(
      await ruleOf(service.saveDay(child.id, WED, sel, { user: manager }, { reason: 'x y z' })),
      'HOLIDAY'
    )
    // Staff cancellation of a locked day.
    const cancelled = await service.cancelDay(child.id, TUE, { user: manager }, { reason: 'Sick' })
    assert.equal(cancelled.action, 'staff_override')
    const after = (await orderOf(child, TUE))!
    assert.equal(after.cancelReason, 'staff')
    assert.equal(after.cancelNote, 'Sick')
  })

  test('applyToChildren checks every child separately', async ({ assert }) => {
    const { school, main, alt } = await orderSchool()
    const { parent, child } = await family(school)
    const allergic = await addChild(parent, { allergies: ['nuts'] })
    const stranger = await family(school)
    freezeClock(OPEN)
    const service = await orders()
    const results = await service.applyToChildren(
      { user: parent },
      TUE,
      { subscriptionMealId: alt.id, supplements: [] },
      [child.id, allergic.id, stranger.child.id]
    )
    assert.deepEqual(
      results.map((r) => [r.childId, r.ok, r.ok ? r.action : r.rule]),
      [
        [child.id, true, 'create'],
        [allergic.id, false, 'ALLERGY_BLOCKED'],
        [stranger.child.id, false, 'NOT_FOUND'],
      ]
    )
    assert.isNull(await orderOf(stranger.child, TUE))
    assert.isNull(await orderOf(allergic, TUE))

    const absent = await service.applyToChildren({ user: parent }, WED, { absent: true }, [
      child.id,
      allergic.id,
    ])
    assert.isTrue(absent.every((r) => r.ok))
    assert.equal((await orderOf(allergic, WED))!.cancelReason, 'absent')
    void main
  })
})

test.group('Orders | concurrency', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('two parents ordering the last portion: exactly one succeeds', async ({ assert }) => {
    const { school, menu, main } = await orderSchool()
    const a = await family(school)
    const b = await family(school)
    const item = await itemFor(menu.id, TUE, main)
    await MenuItem.query().where('id', item.id).update({ max_quantity: 1 })
    freezeClock(OPEN)
    const service = await orders()
    const sel = { subscriptionMealId: main.id, supplements: [] }
    const results = await Promise.allSettled([
      service.saveDay(a.child.id, TUE, sel, { user: a.parent }),
      service.saveDay(b.child.id, TUE, sel, { user: b.parent }),
    ])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    assert.equal(rejected.reason.rule, 'SOLD_OUT')
    assert.lengthOf(await MealOrder.query().where('status', 'active'), 1)
  })

  test('the same child in two tabs: one row, consistent audit', async ({ assert }) => {
    const { school, main, alt } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    const service = await orders()
    await Promise.all([
      service.saveDay(
        child.id,
        TUE,
        { subscriptionMealId: main.id, supplements: [] },
        { user: parent }
      ),
      service.saveDay(
        child.id,
        TUE,
        { subscriptionMealId: alt.id, supplements: [] },
        { user: parent }
      ),
    ])
    assert.lengthOf(await MealOrder.all(), 1)
    const audits = await auditOf(child)
    assert.deepEqual(
      audits.map((row) => row.action),
      ['create', 'update']
    )
    const order = (await orderOf(child, TUE))!
    assert.equal(order.items[0].mealId, audits[1].after!.items[0].mealId)
  })

  test('an order and a holiday for the same date never both stand', async ({ assert }) => {
    const { school, main } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    const service = await orders()
    const holidays = await app.container.make(HolidayService)
    const results = await Promise.allSettled([
      service.saveDay(
        child.id,
        WED,
        { subscriptionMealId: main.id, supplements: [] },
        { user: parent }
      ),
      holidays.createManual(school, { name: 'Storm', startDate: WED }, { confirmImpact: true }),
    ])
    assert.equal(results[1].status, 'fulfilled')
    const order = await orderOf(child, WED)
    if (results[0].status === 'fulfilled') {
      // The order committed first: the holiday cancelled it.
      assert.equal(order!.status, 'cancelled')
      assert.equal(order!.cancelReason, 'holiday')
    } else {
      assert.equal((results[0] as PromiseRejectedResult).reason.rule, 'HOLIDAY')
      assert.isNull(order)
    }
    assert.lengthOf(await MealOrder.query().where('status', 'active'), 0)
  })

  test('a parent order racing the deadline auto-assign leaves one row', async ({ assert }) => {
    const { school, main, alt } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock('2026-11-22T20:00')
    const service = await orders()
    const { jobs } = await import('#tests/helpers/menus')
    await Promise.all([
      service.saveDay(
        child.id,
        WED,
        { subscriptionMealId: alt.id, supplements: [] },
        { user: parent }
      ),
      (await jobs()).applyDeadline(),
    ])
    const wed = await MealOrder.query().where('child_id', child.id).where('date', WED)
    assert.lengthOf(wed, 1)
    const order = (await orderOf(child, WED))!
    assert.equal(order.items[0].mealId, alt.id)
    // Other days got the default.
    assert.equal((await orderOf(child, TUE))!.items[0].mealId, main.id)
    const actions = (
      await OrderAuditLog.query().where('child_id', child.id).where('date', WED)
    ).map((r) => r.action)
    assert.isTrue(
      JSON.stringify(actions) === '["create"]' ||
        JSON.stringify(actions) === '["auto_assign","update"]',
      JSON.stringify(actions)
    )
  })
})
