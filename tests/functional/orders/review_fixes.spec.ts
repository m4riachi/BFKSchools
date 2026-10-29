/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import app from '@adonisjs/core/services/app'
import MealOrder from '#models/meal_order'
import MenuItem from '#models/menu_item'
import Notification from '#models/notification'
import OutboundEmail from '#models/outbound_email'
import OrderAuditLog from '#models/order_audit_log'
import School from '#models/school'
import Subscription from '#models/subscription'
import type Child from '#models/child'
import ChildService from '#services/child_service'
import HolidayImpactService from '#services/holiday_impact_service'
import HolidayService from '#services/holiday_service'
import ParentService from '#services/parent_service'
import SubscriptionService from '#services/subscription_service'
import { buildOutboxMail } from '#mails/outbox_registry'
import OrderNoticeMail from '#mails/order_notice_mail'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { builder, jobs, subscriptionMeal } from '#tests/helpers/menus'
import {
  DAYS,
  FRI,
  MON,
  TUE,
  WED,
  family,
  itemFor,
  orderOf,
  orderSchool,
  orders,
  ruleOf,
} from '#tests/helpers/orders'

const OPEN = '2026-11-20T12:00'

function childInput(child: Child, isActive: boolean) {
  return {
    firstName: child.firstName,
    lastName: child.lastName,
    grade: child.grade,
    className: child.className,
    allergies: child.allergies,
    isActive,
  }
}

test.group('Review M1 | only school days can be ordered', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('a weekday removed from school_days or a date after the school year is refused, even for staff', async ({
    assert,
  }) => {
    const { school, manager, main } = await orderSchool()
    const { parent, child } = await family(school)
    await School.query()
      .where('id', school.id)
      .update({ school_days: '{1,2,3,4}', school_year_end: TUE })
    freezeClock(OPEN)
    const service = await orders()
    const sel = { subscriptionMealId: main.id, supplements: [] }
    assert.equal(
      await ruleOf(service.saveDay(child.id, FRI, sel, { user: parent })),
      'NOT_SCHOOL_DAY'
    )
    assert.equal(
      await ruleOf(service.saveDay(child.id, WED, sel, { user: parent })),
      'NOT_SCHOOL_DAY'
    )
    assert.equal(
      await ruleOf(service.saveDay(child.id, WED, sel, { user: manager }, { reason: 'try it' })),
      'NOT_SCHOOL_DAY'
    )
    assert.equal(await ruleOf(service.cancelDay(child.id, FRI, { user: parent })), 'NOT_SCHOOL_DAY')
    await service.saveDay(child.id, TUE, sel, { user: parent })
    assert.lengthOf(await MealOrder.all(), 1)

    // Auto-assign skips them too.
    freezeClock('2026-11-22T20:00')
    await (await jobs()).applyDeadline()
    const dates = (await MealOrder.query().where('child_id', child.id).orderBy('date')).map(
      (o) => o.date
    )
    assert.deepEqual(dates, [MON, TUE])
  })

  test('switching orders onto a day that is no longer a school day is refused', async ({
    assert,
  }) => {
    const { school, manager, menu, main, alt } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    await (
      await orders()
    ).saveDay(child.id, FRI, { subscriptionMealId: main.id, supplements: [] }, { user: parent })
    await School.query().where('id', school.id).update({ school_days: '{1,2,3,4}' })
    const fresh = await School.findOrFail(school.id)
    const item = await itemFor(menu.id, FRI, main)
    const altItem = await itemFor(menu.id, FRI, alt)
    assert.equal(
      await ruleOf(
        (await builder()).removeItem(fresh, menu, item.id, manager, {
          mode: 'switch',
          targetItemId: altItem.id,
        })
      ),
      'menus.errors.not_school_day'
    )
    // Cancelling them is still possible.
    await (await builder()).removeItem(fresh, menu, item.id, manager, { mode: 'cancel' })
    assert.equal((await orderOf(child, FRI))!.cancelReason, 'menu_change')
  })
})

test.group('Review M2 | removing a published default', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('before the deadline the next meal is promoted and parents are told; after it, no default', async ({
    assert,
  }) => {
    const { school, manager, menu, main, alt } = await orderSchool()
    const idle = await family(school)
    freezeClock(OPEN)
    const tueDefault = await itemFor(menu.id, TUE, main)
    await (await builder()).removeItem(school, menu, tueDefault.id, manager)
    const tueAlt = await itemFor(menu.id, TUE, alt)
    assert.isTrue((await MenuItem.findOrFail(tueAlt.id)).isDefault)
    const notices = await Notification.query().where('type', 'menu_change')
    assert.deepEqual(
      notices.map((n) => [n.userId, n.data.kind]),
      [[idle.parent.id, 'default_changed']]
    )

    freezeClock('2026-11-22T20:30')
    const wedDefault = await itemFor(menu.id, WED, main)
    await (await builder()).removeItem(school, menu, wedDefault.id, manager)
    const wedItems = await MenuItem.query()
      .where('weekly_menu_id', menu.id)
      .where('date', WED)
      .whereNull('removed_at')
    assert.isFalse(wedItems.some((item) => item.isDefault))
    assert.lengthOf(await Notification.query().where('type', 'menu_change'), 1)
    // Auto-assign reports the day without a default.
    const run = await (await jobs()).applyDeadline()
    if (run.acquired) {
      assert.deepEqual(run.result[0].days.find((d) => d.date === WED)?.skipped, { noDefault: true })
    }
    assert.isNull(await orderOf(idle.child, WED))
  })
})

test.group('Review M3 | deactivations and subscription changes', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  async function orderWeek(parent: any, child: Child, main: any, juice?: any) {
    const service = await orders()
    for (const date of DAYS) {
      await service.saveDay(
        child.id,
        date,
        {
          subscriptionMealId: main.id,
          supplements: juice && date === WED ? [{ mealId: juice.id, qty: 1 }] : [],
        },
        { user: parent }
      )
    }
  }

  test('deactivating a child cancels future orders (today kept), audited, notified once; D24', async ({
    assert,
  }) => {
    const { school, manager, main } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    await orderWeek(parent, child, main)
    freezeClock('2026-11-24T08:00') // Tuesday: today's order is kept
    const children = await app.container.make(ChildService)
    await children.update(child, childInput(child, false), manager)
    const rows = await MealOrder.query().where('child_id', child.id).orderBy('date')
    assert.deepEqual(
      rows.map((o) => [o.date, o.status, o.cancelReason]),
      [
        [MON, 'active', null],
        [TUE, 'active', null],
        [WED, 'cancelled', 'child_inactive'],
        ['2026-11-26', 'cancelled', 'child_inactive'],
        [FRI, 'cancelled', 'child_inactive'],
      ]
    )
    const audits = await OrderAuditLog.query().where('reason', 'child_inactive')
    assert.lengthOf(audits, 3)
    assert.isTrue(audits.every((a) => a.actorId === manager.id && a.action === 'staff_override'))
    assert.lengthOf(await Notification.query().where('type', 'order_changed_by_staff'), 1)
    const [email] = await OutboundEmail.query().where('mail_key', 'order_changed_by_staff')
    const built = await buildOutboxMail(email)
    assert.instanceOf((built as { mail: OrderNoticeMail }).mail, OrderNoticeMail)
    // Phase 8 layout: the intro, then the 3 days as a list.
    assert.lengthOf((built as { mail: OrderNoticeMail }).mail.content.paragraphs, 1)
    assert.lengthOf((built as { mail: OrderNoticeMail }).mail.content.items ?? [], 3)
    // N5: own subject with the count (not one child's name and an empty date).
    assert.equal(
      (built as { mail: OrderNoticeMail }).mail.content.subject,
      '3 repas annulés : inscription désactivée'
    )

    // Re-activating restores nothing; the parent can't reopen (D24), staff can.
    await children.update(child, childInput(child, true), manager)
    assert.equal((await orderOf(child, WED))!.status, 'cancelled')
    const service = await orders()
    const sel = { subscriptionMealId: main.id, supplements: [] }
    assert.equal(
      await ruleOf(service.saveDay(child.id, WED, sel, { user: parent })),
      'CANCELLED_BY_STAFF'
    )
    await service.saveDay(child.id, WED, sel, { user: manager }, { reason: 'Back at school' })
    assert.equal((await orderOf(child, WED))!.status, 'active')
  })

  test('deactivating a parent cancels their children future orders', async ({ assert }) => {
    const { school, manager, main } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    await orderWeek(parent, child, main)
    const parents = await app.container.make(ParentService)
    await parents.deactivate(parent, manager)
    assert.lengthOf(
      await MealOrder.query().where('child_id', child.id).where('status', 'active'),
      0
    )
    assert.lengthOf(await MealOrder.query().where('cancel_reason', 'child_inactive'), 5)
  })

  test('shortening a subscription removes only uncovered subscription meals', async ({
    assert,
  }) => {
    const { school, manager, main, juice } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    await orderWeek(parent, child, main, juice)
    const subscription = await Subscription.findByOrFail('child_id', child.id)
    const service = await app.container.make(SubscriptionService)
    await service.update(
      subscription,
      { startDate: subscription.startDate, endDate: TUE, status: 'active', notes: null },
      manager
    )
    assert.equal((await orderOf(child, TUE))!.status, 'active')
    const wed = (await orderOf(child, WED))!
    assert.equal(wed.status, 'active')
    assert.deepEqual(
      wed.items.map((i) => i.mealId),
      [juice.id]
    )
    const thu = (await orderOf(child, '2026-11-26'))!
    assert.equal(thu.status, 'cancelled')
    assert.equal(thu.cancelReason, 'subscription_ended')
    assert.lengthOf(await OrderAuditLog.query().where('reason', 'subscription_ended'), 3)

    // Deleting the period: Monday and Tuesday lose their main meal too.
    await service.delete(subscription, manager)
    assert.equal((await orderOf(child, MON))!.status, 'cancelled')
  })
})

test.group('Review D23–D25, L6, apply-all', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('D23: staff change past days of the current month only', async ({ assert }) => {
    const { school, manager, main } = await orderSchool()
    const { child } = await family(school)
    const sel = { subscriptionMealId: main.id, supplements: [] }
    freezeClock('2026-11-30T10:00')
    await (await orders()).saveDay(child.id, FRI, sel, { user: manager }, { reason: 'Late call' })
    freezeClock('2026-12-01T10:00')
    assert.equal(
      await ruleOf(
        (await orders()).cancelDay(child.id, FRI, { user: manager }, { reason: 'Too late' })
      ),
      'STAFF_PERIOD_CLOSED'
    )
    assert.equal((await orderOf(child, FRI))!.status, 'active')
  })

  test('D24: a staff cancellation shows as locked to the parent', async ({ client, assert }) => {
    const { school, manager, main } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    await (
      await orders()
    ).saveDay(child.id, TUE, { subscriptionMealId: main.id, supplements: [] }, { user: parent })
    await (await orders()).cancelDay(child.id, TUE, { user: manager }, { reason: 'Trip' })
    const view = await client
      .get(`/?child=${child.id}&week=2026-11-23`)
      .loginAs(parent)
      .withInertia()
    const tue = (view.inertiaProps as any).view.days.find((d: any) => d.date === TUE)
    assert.equal(tue.state, 'locked')
    assert.equal(tue.reason, 'CANCELLED_BY_STAFF')
    assert.equal(
      await ruleOf((await orders()).cancelDay(child.id, TUE, { user: parent })),
      'CANCELLED_BY_STAFF'
    )
  })

  test('D25: switching to a cheaper meal lowers the price and the email says so', async ({
    assert,
  }) => {
    const { school, manager, menu, main } = await orderSchool()
    const cheap = await subscriptionMeal({ priceCents: 3000 })
    await (await import('#tests/helpers/menus')).addItem(school, manager, TUE, cheap)
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    await (
      await orders()
    ).saveDay(child.id, TUE, { subscriptionMealId: main.id, supplements: [] }, { user: parent })
    const item = await itemFor(menu.id, TUE, main)
    const cheapItem = await itemFor(menu.id, TUE, cheap)
    await (
      await builder()
    ).removeItem(school, menu, item.id, manager, { mode: 'switch', targetItemId: cheapItem.id })
    assert.equal((await orderOf(child, TUE))!.items[0].unitPriceCents, 3000)
    const notice = await Notification.findByOrFail('type', 'menu_change')
    assert.isTrue(notice.data.priceLowered as boolean)
    const email = await OutboundEmail.findByOrFail('mail_key', 'menu_change')
    const built = (await buildOutboxMail(email)) as { mail: OrderNoticeMail }
    assert.isTrue(built.mail.content.paragraphs.some((p) => p.includes('30,00')))
  })

  test('L6: the removal is refused when more orders exist than confirmed', async ({
    client,
    assert,
  }) => {
    const { school, manager, menu, main, alt } = await orderSchool()
    const a = await family(school)
    const b = await family(school)
    freezeClock(OPEN)
    for (const f of [a, b]) {
      await (
        await orders()
      ).saveDay(
        f.child.id,
        TUE,
        { subscriptionMealId: main.id, supplements: [] },
        { user: f.parent }
      )
    }
    const item = await itemFor(menu.id, TUE, main)
    const altItem = await itemFor(menu.id, TUE, alt)
    const stale = await client
      .delete(`/admin/menus/2026-11-23/items/${item.id}`)
      .loginAs(manager)
      .withCsrfToken()
      .json({ mode: 'switch', targetItemId: altItem.id, confirmedCount: 1 })
      .redirects(0)
    assert.match(String(stale.flashMessage('error')), /2 commandes/)
    assert.equal((await orderOf(a.child, TUE))!.items[0].mealId, main.id)
    await client
      .delete(`/admin/menus/2026-11-23/items/${item.id}`)
      .loginAs(manager)
      .withCsrfToken()
      .json({ mode: 'switch', targetItemId: altItem.id, confirmedCount: 2 })
      .redirects(0)
    assert.equal((await orderOf(a.child, TUE))!.items[0].mealId, alt.id)
  })

  test('apply-to-all never confirms an allergy', async ({ client, assert }) => {
    const { school, alt } = await orderSchool({ allergy_rule: 'warn_confirm' })
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    const response = await client
      .post(`/orders/days/${TUE}/all`)
      .loginAs(parent)
      .withCsrfToken()
      .json({
        subscriptionMealId: alt.id,
        supplements: [],
        confirmAllergy: true,
        childIds: [child.id],
      })
      .redirects(0)
    assert.match(String(response.flashMessage('error')), /enfant par enfant/)
    assert.isNull(await orderOf(child, TUE))
  })
})

test.group('Re-review N1, N2', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('N1: a holiday on past dates never touches their orders; today is kept', async ({
    assert,
  }) => {
    const { school, manager, main } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    for (const date of [MON, WED, '2026-11-26']) {
      await (
        await orders()
      ).saveDay(child.id, date, { subscriptionMealId: main.id, supplements: [] }, { user: parent })
    }
    freezeClock('2026-11-25T10:00') // Wednesday
    const impact = await app.container.make(HolidayImpactService)
    assert.equal(await impact.countAffectedOrders(school.id, [MON, TUE, WED, '2026-11-26']), 1)
    const holidays = await app.container.make(HolidayService)
    await holidays.createManual(
      school,
      { name: 'Calendar fix', startDate: MON, endDate: '2026-11-26' },
      { confirmImpact: true, confirmedCount: 1, actor: manager }
    )
    assert.equal((await orderOf(child, MON))!.status, 'active')
    assert.equal((await orderOf(child, WED))!.status, 'active')
    assert.equal((await orderOf(child, '2026-11-26'))!.cancelReason, 'holiday')
    assert.lengthOf(await OrderAuditLog.query().where('action', 'holiday_cancel'), 1)
  })

  test('N2: pause then resume a subscription → the parent can re-order the day', async ({
    assert,
  }) => {
    const { school, manager, main, juice } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    const service = await orders()
    const sel = { subscriptionMealId: main.id, supplements: [] }
    await service.saveDay(child.id, WED, sel, { user: parent })
    const subscription = await Subscription.findByOrFail('child_id', child.id)
    const subscriptions = await app.container.make(SubscriptionService)
    const period = { startDate: subscription.startDate, endDate: subscription.endDate, notes: null }
    await subscriptions.update(subscription, { ...period, status: 'paused' }, manager)
    const cancelled = (await orderOf(child, WED))!
    assert.equal(cancelled.cancelReason, 'subscription_ended')
    // While paused, extras are still allowed (D2) — not locked by D24.
    await service.saveDay(
      child.id,
      WED,
      { subscriptionMealId: null, supplements: [{ mealId: juice.id, qty: 1 }] },
      { user: parent }
    )
    assert.equal((await orderOf(child, WED))!.status, 'active')
    await subscriptions.update(subscription, { ...period, status: 'active' }, manager)
    const outcome = await service.saveDay(child.id, WED, sel, { user: parent })
    assert.equal(outcome.action, 'update')
    assert.deepEqual(
      (await orderOf(child, WED))!.items.map((i) => i.mealId),
      [main.id]
    )
  })
})
