/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import app from '@adonisjs/core/services/app'
import mail from '@adonisjs/mail/services/main'
import MealOrder from '#models/meal_order'
import MenuItem from '#models/menu_item'
import Notification from '#models/notification'
import OutboundEmail from '#models/outbound_email'
import OrderAuditLog from '#models/order_audit_log'
import WeeklyMenu from '#models/weekly_menu'
import HolidayService from '#services/holiday_service'
import OrderNoticeMail from '#mails/order_notice_mail'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import {
  addHoliday,
  builder,
  jobs,
  outbox,
  scheduledMenu,
  setupMenuSchool,
  statusService,
} from '#tests/helpers/menus'
import {
  DAYS,
  MON,
  TUE,
  WED,
  addChild,
  family,
  itemFor,
  orderOf,
  orderSchool,
  orders,
  ruleOf,
} from '#tests/helpers/orders'

const OPEN = '2026-11-20T12:00'

async function emailsOf(userId: number, mailKey: string) {
  return OutboundEmail.query().where('user_id', userId).where('mail_key', mailKey)
}

test.group('Orders jobs | deadline reminders', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('24 h before the deadline, once, only parents with a missing day', async ({ assert }) => {
    const { school, main } = await orderSchool()
    const missing = await family(school)
    const complete = await family(school)
    const optedOut = await family(school, {
      parent: { notificationPrefs: { deadline_reminder: false } },
    })
    freezeClock(OPEN)
    const service = await orders()
    for (const date of DAYS) {
      if (date === WED) {
        await service.cancelDay(complete.child.id, date, { user: complete.parent })
      } else {
        await service.saveDay(
          complete.child.id,
          date,
          { subscriptionMealId: main.id, supplements: [] },
          { user: complete.parent }
        )
      }
    }

    freezeClock('2026-11-21T19:59')
    let run = await (await jobs()).sendReminders()
    assert.isTrue(run.acquired)
    if (run.acquired) assert.lengthOf(run.result, 0)

    freezeClock('2026-11-21T20:00')
    run = await (await jobs()).sendReminders()
    if (run.acquired)
      assert.deepEqual(
        run.result.map((r) => r.parents),
        [2]
      )
    const notified = (await Notification.query().where('type', 'deadline_reminder'))
      .map((n) => n.userId)
      .sort()
    assert.deepEqual(notified, [missing.parent.id, optedOut.parent.id].sort())
    assert.lengthOf(await emailsOf(missing.parent.id, 'deadline_reminder'), 1)
    assert.lengthOf(await emailsOf(optedOut.parent.id, 'deadline_reminder'), 0)
    assert.lengthOf(await emailsOf(complete.parent.id, 'deadline_reminder'), 0)
    const menu = await WeeklyMenu.query().where('school_id', school.id).firstOrFail()
    assert.isNotNull(menu.reminderSentAt)

    // Once per menu.
    freezeClock('2026-11-22T10:00')
    run = await (await jobs()).sendReminders()
    if (run.acquired) assert.lengthOf(run.result, 0)
    assert.lengthOf(await Notification.query().where('type', 'deadline_reminder'), 2)

    // The queued email renders (fake mailer).
    const { mails } = mail.fake()
    try {
      await (await outbox()).dispatch()
      const sent = mails.sent().filter((m) => m instanceof OrderNoticeMail) as OrderNoticeMail[]
      assert.lengthOf(sent, 1)
      assert.match(sent[0].content.subject, /Rappel/)
    } finally {
      mail.restore()
    }
  })
})

test.group('Orders jobs | deadline auto-assign (D10)', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('once, only subscribed children without an order row, skipping holidays', async ({
    assert,
  }) => {
    const { school, main } = await orderSchool()
    const subscribed = await family(school)
    const absentTue = await family(school)
    const unsubscribed = await family(school, { subscribed: false })
    const allergicToDefault = await family(school)
    allergicToDefault.child.allergies = []
    await addHoliday(school, WED, 'Closed')
    freezeClock(OPEN)
    await (await orders()).cancelDay(absentTue.child.id, TUE, { user: absentTue.parent })

    freezeClock('2026-11-22T19:59')
    let run = await (await jobs()).applyDeadline()
    if (run.acquired) assert.lengthOf(run.result, 0)

    freezeClock('2026-11-22T20:00')
    run = await (await jobs()).applyDeadline()
    if (run.acquired) {
      assert.lengthOf(run.result, 1)
      assert.isTrue(run.result[0].autoAssign)
    }
    const subscribedOrders = await MealOrder.query()
      .where('child_id', subscribed.child.id)
      .orderBy('date')
      .preload('items')
    assert.deepEqual(
      subscribedOrders.map((o) => o.date),
      DAYS.filter((d) => d !== WED)
    )
    for (const order of subscribedOrders) {
      assert.equal(order.origin, 'system')
      assert.deepEqual(
        order.items.map((i) => [i.mealId, i.unitPriceCents]),
        [[main.id, 0]] // D31: the default (subscription) meal is free
      )
    }
    const audit = await OrderAuditLog.query().where('child_id', subscribed.child.id).firstOrFail()
    assert.equal(audit.action, 'auto_assign')
    assert.equal(audit.actorRole, 'system')
    assert.isNull(audit.actorId)
    // The "absent" Tuesday is a choice: untouched.
    assert.equal((await orderOf(absentTue.child, TUE))!.cancelReason, 'absent')
    assert.lengthOf(await MealOrder.query().where('child_id', absentTue.child.id), 4)
    assert.lengthOf(await MealOrder.query().where('child_id', unsubscribed.child.id), 0)
    assert.isNotNull(
      await Notification.query()
        .where('user_id', subscribed.parent.id)
        .where('type', 'auto_assigned')
        .first()
    )

    // Once.
    const count = (await MealOrder.all()).length
    run = await (await jobs()).applyDeadline()
    if (run.acquired) assert.lengthOf(run.result, 0)
    assert.lengthOf(await MealOrder.all(), count)
  })

  test('sold-out and allergen defaults are skipped and reported; setting off does nothing', async ({
    assert,
  }) => {
    const { school, menu, main } = await orderSchool()
    const a = await family(school)
    const b = await family(school)
    const tueDefault = await itemFor(menu.id, TUE, main)
    await MenuItem.query().where('id', tueDefault.id).update({ max_quantity: 1 })
    main.allergens = ['eggs']
    await main.save()
    const allergic = await family(school, { allergies: ['eggs'] })
    freezeClock('2026-11-22T20:00')
    const run = await (await jobs()).applyDeadline()
    if (!run.acquired) return assert.fail('lock')
    const tue = run.result[0].days.find((d) => d.date === TUE)!
    assert.equal(tue.assigned, 1)
    assert.equal(tue.skipped.soldOut, 1)
    assert.equal(tue.skipped.allergy, 1)
    assert.lengthOf(await MealOrder.query().where('child_id', allergic.child.id), 0)
    assert.lengthOf(await MealOrder.query().where('date', TUE), 1)
    void a
    void b
  })

  test('with auto-assign off nothing is created, the menu is still processed', async ({
    assert,
  }) => {
    const off = await orderSchool({ auto_assign_default_meal: false })
    await family(off.school)
    freezeClock('2026-11-22T20:00')
    const second = await (await jobs()).applyDeadline()
    if (second.acquired) assert.isFalse(second.result[0].autoAssign)
    assert.lengthOf(await MealOrder.query().where('school_id', off.school.id), 0)
    assert.isNotNull((await WeeklyMenu.findOrFail(off.menu.id)).deadlineProcessedAt)
  })
})

test.group('Orders jobs | holiday cancellations', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('a new holiday cancels the orders, audits as system and notifies the parents', async ({
    client,
    assert,
  }) => {
    const { school, manager, main } = await orderSchool()
    const a = await family(school)
    const b = await family(school)
    const sibling = await addChild(a.parent)
    freezeClock(OPEN)
    const service = await orders()
    for (const [parent, child] of [
      [a.parent, a.child],
      [a.parent, sibling],
      [b.parent, b.child],
    ] as const) {
      await service.saveDay(
        child.id,
        TUE,
        { subscriptionMealId: main.id, supplements: [] },
        { user: parent }
      )
    }

    // The admin is asked first, with the count.
    const ask = await client
      .post('/admin/holidays')
      .loginAs(manager)
      .withCsrfToken()
      .json({ name: 'Strike', startDate: TUE })
      .redirects(0)
    const errors = ask.flashMessage('inputErrorsBag') as Record<string, unknown>
    assert.include(String(errors.confirmImpact), '3')
    assert.equal(String(errors.confirmedCount), '3')

    // Confirmed for 2 while 3 exist now → refused again (recount in the transaction).
    const stale = await client
      .post('/admin/holidays')
      .loginAs(manager)
      .withCsrfToken()
      .json({ name: 'Strike', startDate: TUE, confirmImpact: true, confirmedCount: 2 })
      .redirects(0)
    assert.property(stale.flashMessage('inputErrorsBag') ?? {}, 'confirmImpact')
    assert.equal((await orderOf(a.child, TUE))!.status, 'active')

    const ok = await client
      .post('/admin/holidays')
      .loginAs(manager)
      .withCsrfToken()
      .json({ name: 'Strike', startDate: TUE, confirmImpact: true, confirmedCount: 3 })
      .redirects(0)
    ok.assertStatus(302)
    for (const child of [a.child, sibling, b.child]) {
      const order = (await orderOf(child, TUE))!
      assert.equal(order.status, 'cancelled')
      assert.equal(order.cancelReason, 'holiday')
    }
    const audits = await OrderAuditLog.query().where('action', 'holiday_cancel')
    assert.lengthOf(audits, 3)
    // Audited as the manager who confirmed, reason "holiday".
    assert.isTrue(
      audits.every(
        (row) =>
          row.actorRole === 'manager' && row.actorId === manager.id && row.reason === 'holiday'
      )
    )
    // One notice + one email per parent (a has two children).
    assert.lengthOf(await Notification.query().where('type', 'holiday_cancellation'), 2)
    const emailA = await emailsOf(a.parent.id, 'holiday_cancellation')
    assert.lengthOf(emailA, 1)
    assert.lengthOf((emailA[0].payload.orderIds as number[]) ?? [], 2)

    const { mails } = mail.fake()
    try {
      await (await outbox()).dispatch()
      const sent = mails.sent().filter((m) => m instanceof OrderNoticeMail) as OrderNoticeMail[]
      assert.lengthOf(sent, 2)
      assert.isTrue(sent.every((m) => /férié/.test(m.content.subject)))
      // Phase 8 layout: intro paragraph, the days as a list, the "not charged" note.
      assert.isTrue(
        sent.some((m) => m.content.items?.length === 2 && m.content.notes?.length === 1)
      )
    } finally {
      mail.restore()
    }
  })

  test('the command-style generator path (no actor) cancels without a count', async ({
    assert,
  }) => {
    const { school, main } = await orderSchool()
    const a = await family(school)
    freezeClock(OPEN)
    await (
      await orders()
    ).saveDay(a.child.id, MON, { subscriptionMealId: main.id, supplements: [] }, { user: a.parent })
    const holidays = await app.container.make(HolidayService)
    await holidays.createManual(
      school,
      { name: 'Closed', startDate: MON },
      { confirmImpact: true, actor: null }
    )
    assert.equal((await orderOf(a.child, MON))!.cancelReason, 'holiday')
    const audit = await OrderAuditLog.query().where('action', 'holiday_cancel').firstOrFail()
    assert.equal(audit.actorRole, 'system')
    assert.isNull(audit.actorId)
    assert.equal(audit.reason, 'holiday')
  })
})

test.group('Orders jobs | published menu changes (D18)', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('removing an ordered meal: impact page, then switch (allergic child loses it)', async ({
    client,
    assert,
  }) => {
    const { school, manager, menu, main, alt } = await orderSchool()
    const a = await family(school)
    const allergic = await family(school, { allergies: ['nuts'] })
    freezeClock(OPEN)
    const service = await orders()
    for (const f of [a, allergic]) {
      await service.saveDay(
        f.child.id,
        TUE,
        { subscriptionMealId: main.id, supplements: [] },
        { user: f.parent }
      )
    }
    const item = await itemFor(menu.id, TUE, main)
    const altItem = await itemFor(menu.id, TUE, alt)

    const impact = await client
      .get(`/admin/menus/2026-11-23/items/${item.id}/remove`)
      .loginAs(manager)
      .withInertia()
    impact.assertInertiaComponent('admin/menus/remove_item')
    const props = impact.inertiaProps as Record<string, any>
    assert.lengthOf(props.affected, 2)
    assert.deepEqual(
      props.alternatives.map((o: any) => [o.id, o.allergicChildren]),
      [[altItem.id, 1]]
    )

    const refused = await client
      .delete(`/admin/menus/2026-11-23/items/${item.id}`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    assert.match(String(refused.flashMessage('error')), /2 commandes/)
    assert.isNull((await MenuItem.findOrFail(item.id)).removedAt)

    await client
      .delete(`/admin/menus/2026-11-23/items/${item.id}`)
      .loginAs(manager)
      .withCsrfToken()
      .json({ mode: 'switch', targetItemId: altItem.id, confirmedCount: 2 })
      .redirects(0)
    const switched = (await orderOf(a.child, TUE))!
    assert.equal(switched.status, 'active')
    // D31: subscription meals are free — the switched line stays at 0.
    assert.deepEqual(
      switched.items.map((i) => [i.menuItemId, i.unitPriceCents]),
      [[altItem.id, 0]]
    )
    const switchAudit = await OrderAuditLog.query()
      .where('child_id', a.child.id)
      .where('action', 'menu_change_switch')
      .firstOrFail()
    assert.equal(switchAudit.before!.items[0].unitPriceCents, 0)
    assert.deepEqual(
      switchAudit.after!.items.map((i) => [i.menuItemId, i.unitPriceCents]),
      [[altItem.id, 0]]
    )
    const lost = (await orderOf(allergic.child, TUE))!
    assert.equal(lost.status, 'cancelled')
    assert.equal(lost.cancelReason, 'menu_change')
    // No order line references it any more: the row is deleted.
    assert.isNull(await MenuItem.find(item.id))
    // The day keeps a default.
    assert.isTrue((await MenuItem.findOrFail(altItem.id)).isDefault)
    assert.deepEqual(
      (
        await OrderAuditLog.query()
          .where('date', TUE)
          .where('actor_id', manager.id)
          .orderBy('child_id')
      )
        .map((r) => r.action)
        .sort(),
      ['menu_change_cancel', 'menu_change_switch']
    )
    assert.lengthOf(await Notification.query().where('type', 'menu_change'), 2)
    const changeEmails = await OutboundEmail.query().where('mail_key', 'menu_change')
    assert.lengthOf(changeEmails, 2)
    // The removed item is deleted: the email still renders (meal ids in the payload).
    const { buildOutboxMail } = await import('#mails/outbox_registry')
    for (const email of changeEmails) {
      const built = await buildOutboxMail(email)
      assert.property(built, 'mail', JSON.stringify(built))
    }
  })

  test('cancel mode removes an extra; empty orders are cancelled', async ({ assert }) => {
    const { school, manager, menu, main, juice } = await orderSchool()
    const a = await family(school)
    const onlyJuice = await family(school, { subscribed: false })
    freezeClock(OPEN)
    const service = await orders()
    await service.saveDay(
      a.child.id,
      WED,
      { subscriptionMealId: main.id, supplements: [{ mealId: juice.id, qty: 2 }] },
      { user: a.parent }
    )
    await service.saveDay(
      onlyJuice.child.id,
      WED,
      { subscriptionMealId: null, supplements: [{ mealId: juice.id, qty: 1 }] },
      { user: onlyJuice.parent }
    )
    const item = await itemFor(menu.id, WED, juice)
    const result = await (
      await builder()
    ).removeItem(school, menu, item.id, manager, { mode: 'cancel' })
    assert.deepEqual(result.outcome, {
      orders: 2,
      switched: 0,
      cancelledOrders: 1,
      removedLines: 2,
      notifiedParents: 2,
    })
    const kept = (await orderOf(a.child, WED))!
    assert.equal(kept.status, 'active')
    assert.deepEqual(
      kept.items.map((i) => i.mealId),
      [main.id]
    )
    assert.equal((await orderOf(onlyJuice.child, WED))!.cancelReason, 'menu_change')
  })

  test('max_quantity never below what is ordered; default only until the deadline', async ({
    assert,
  }) => {
    const { school, manager, menu, main, alt } = await orderSchool()
    const a = await family(school)
    const b = await family(school)
    const idle = await family(school)
    freezeClock(OPEN)
    const service = await orders()
    for (const f of [a, b]) {
      await service.saveDay(
        f.child.id,
        TUE,
        { subscriptionMealId: main.id, supplements: [] },
        { user: f.parent }
      )
    }
    const item = await itemFor(menu.id, TUE, main)
    const menus = await builder()
    assert.equal(
      await ruleOf(menus.updateItem(school, menu, item.id, { maxQuantity: 1 }, manager)),
      'menus.errors.max_below_ordered'
    )
    await menus.updateItem(school, menu, item.id, { maxQuantity: 2 }, manager)

    // Default change before the deadline notifies parents whose children would get it.
    const altItem = await itemFor(menu.id, TUE, alt)
    await menus.setDefault(school, menu, altItem.id, manager)
    const notified = (await Notification.query().where('type', 'menu_change')).map((n) => n.userId)
    assert.deepEqual(notified, [idle.parent.id])
    assert.lengthOf(await OutboundEmail.query().where('mail_key', 'menu_change'), 1)

    freezeClock('2026-11-22T20:00')
    assert.equal(
      await ruleOf((await builder()).setDefault(school, menu, item.id, manager)),
      'menus.errors.default_after_deadline'
    )
  })
})

test.group('Menus | late publication (D19)', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('publish now is refused after the deadline; the job leaves it scheduled and warns once', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const menu = await scheduledMenu(school, manager)
    freezeClock('2026-11-22T20:00')
    assert.equal(
      await ruleOf((await statusService()).publishNow(menu, manager)),
      'menus.errors.deadline_passed'
    )
    const first = await (await jobs()).publishDue()
    if (first.acquired) {
      assert.deepEqual(
        first.result.map((o) => [
          o.published,
          !o.published && o.reason,
          !o.published && o.firstWarning,
        ]),
        [[false, 'deadline_passed', true]]
      )
    }
    let fresh = await WeeklyMenu.findOrFail(menu.id)
    assert.equal(fresh.status, 'scheduled')
    assert.isNotNull(fresh.latePublishWarnedAt)
    const second = await (await jobs()).publishDue()
    if (second.acquired)
      assert.isFalse(!second.result[0].published && second.result[0].firstWarning)
    fresh = await WeeklyMenu.findOrFail(menu.id)
    assert.equal(fresh.status, 'scheduled')
  })
})
