/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import ace from '@adonisjs/core/services/ace'
import mail from '@adonisjs/mail/services/main'
import db from '@adonisjs/lucid/services/db'
import MenusPublishDue from '#commands/menus_publish_due'
import MenusApplyDeadline from '#commands/menus_apply_deadline'
import MenusClosePast from '#commands/menus_close_past'
import MailDispatch from '#commands/mail_dispatch'
import WeeklyMenu from '#models/weekly_menu'
import MealOrder from '#models/meal_order'
import Notification from '#models/notification'
import OrderAuditLog from '#models/order_audit_log'
import MenuPublishedMail from '#mails/menu_published_mail'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import {
  FRI,
  MON,
  THU,
  TUE,
  WED,
  WEEK,
  setupMenuSchool,
  subscriptionMeal,
  supplementMeal,
} from '#tests/helpers/menus'
import { family, addChild } from '#tests/helpers/orders'
import { asBinary } from '#tests/helpers/reports'

async function run(command: any) {
  const instance = await ace.create(command, [])
  await instance.exec()
  instance.assertSucceeded()
}

/**
 * End-to-end-ish: one whole week through the HTTP routes and the cron
 * commands, with the Clock moving forward — build + schedule → automatic
 * publication (notification + email) → parents order → deadline
 * auto-assign → kitchen production sheet → monthly statement + PDF.
 */
test.group('Hardening | full week cycle', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => {
    restoreClock()
    mail.restore()
  })

  test('publish → order → deadline → kitchen sheet → statement', async ({ client, assert }) => {
    const { mails } = mail.fake()
    const { school, manager } = await setupMenuSchool()
    const kitchen = await (
      await import('#database/factories/user_factory')
    ).UserFactory.apply('kitchen')
      .merge({ schoolId: school.id })
      .create()
    const main = await subscriptionMeal({ priceCents: 4500, allergens: [] })
    const alt = await subscriptionMeal({ priceCents: 5000, allergens: ['nuts'] })
    const juice = await supplementMeal({ allergens: [] })
    juice.priceCents = 1000
    await juice.save()

    // Monday before: the manager builds and schedules the week (HTTP).
    freezeClock('2026-11-16T09:00')
    for (const date of [MON, TUE, WED, THU, FRI]) {
      for (const meal of [main, alt, juice]) {
        const res = await client
          .post(`/admin/menus/${WEEK}/items`)
          .loginAs(manager)
          .json({ date, mealId: meal.id })
          .withCsrfToken()
          .redirects(0)
        res.assertStatus(302)
      }
    }
    const scheduled = await client
      .post(`/admin/menus/${WEEK}/schedule`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    scheduled.assertStatus(302)
    const menu = await WeeklyMenu.query().where('school_id', school.id).firstOrFail()
    assert.equal(menu.status, 'scheduled')

    // Families: A orders by hand, B (subscribed) chooses nothing, C has no
    // subscription and only orders a juice.
    const a = await family(school, { allergies: ['nuts'] })
    const b = await family(school)
    const c = await family(school, { subscribed: false })
    const a2 = await addChild(a.parent)

    // Thursday 10:05: the cron job publishes it and queues the emails.
    freezeClock('2026-11-19T10:05')
    await run(MenusPublishDue)
    await menu.refresh()
    assert.equal(menu.status, 'published')
    const notices = await Notification.query().where('type', 'menu_published')
    assert.sameMembers(
      notices.map((n) => n.userId),
      [a.parent.id, b.parent.id, c.parent.id]
    )
    await run(MailDispatch)
    mails.assertSent(MenuPublishedMail, ({ message }) => message.hasTo(a.parent.email))

    // Friday: parents order through the portal routes.
    freezeClock('2026-11-20T12:00')
    const save = (parent: any, childId: number, date: string, body: object) =>
      client
        .post(`/orders/${childId}/days/${date}`)
        .loginAs(parent)
        .json(body)
        .withCsrfToken()
        .redirects(0)
    for (const date of [MON, TUE, WED]) {
      ;(
        await save(a.parent, a.child.id, date, {
          subscriptionMealId: main.id,
          supplements: date === MON ? [{ mealId: juice.id, qty: 2 }] : [],
        })
      ).assertStatus(302)
    }
    // D9: the allergic child cannot take the nuts dish.
    await save(a.parent, a.child.id, THU, { subscriptionMealId: alt.id, supplements: [] })
    assert.isNull(await MealOrder.query().where('child_id', a.child.id).where('date', THU).first())
    const absent = await client
      .post(`/orders/${a.child.id}/days/${FRI}/absent`)
      .loginAs(a.parent)
      .withCsrfToken()
      .redirects(0)
    absent.assertStatus(302)
    ;(
      await save(a.parent, a2.id, MON, { subscriptionMealId: alt.id, supplements: [] })
    ).assertStatus(302)
    ;(
      await save(c.parent, c.child.id, MON, {
        subscriptionMealId: null,
        supplements: [{ mealId: juice.id, qty: 1 }],
      })
    ).assertStatus(302)
    // Parent isolation: A cannot order for B's child.
    const foreign = await save(a.parent, b.child.id, TUE, {
      subscriptionMealId: main.id,
      supplements: [],
    })
    assert.include([302, 403, 404], foreign.status())
    assert.isNull(await MealOrder.query().where('child_id', b.child.id).where('date', TUE).first())

    // Sunday 20:05: the deadline job gives the default meal to subscribed
    // children with no order row (absent days and C, unsubscribed, are skipped).
    freezeClock('2026-11-22T20:05')
    await run(MenusApplyDeadline)
    const autoB = await MealOrder.query().where('child_id', b.child.id).where('status', 'active')
    assert.lengthOf(autoB, 5)
    const autoA = await OrderAuditLog.query()
      .where('child_id', a.child.id)
      .where('action', 'auto_assign')
    assert.sameMembers(
      autoA.map((row) => row.date),
      [THU]
    )
    assert.isNull(
      await MealOrder.query()
        .where('child_id', c.child.id)
        .where('date', TUE)
        .where('status', 'active')
        .first()
    )

    // Monday: the kitchen sheet counts every active order of the day.
    freezeClock('2026-11-23T08:00')
    const sheet = await client.get(`/kitchen?date=${MON}`).loginAs(kitchen).withInertia()
    sheet.assertStatus(200)
    const lines = (sheet.inertiaProps as any).sheet.lines as {
      mealId: number
      total: number
    }[]
    const qty = (mealId: number) => lines.find((line) => line.mealId === mealId)?.total ?? 0
    assert.equal(qty(main.id), 2) // A's first child + B (auto-assigned default)
    assert.equal(qty(alt.id), 1) // A's second child
    assert.equal(qty(juice.id), 3) // A ×2 + C ×1

    // December: the November statement of family A is final and adds up.
    freezeClock('2026-12-02T09:00')
    await run(MenusClosePast)
    await menu.refresh()
    assert.equal(menu.status, 'closed')
    const page = await client.get('/statements?month=2026-11').loginAs(a.parent).withInertia()
    page.assertStatus(200)
    const expected = await db
      .from('meal_order_items')
      .join('meal_orders', 'meal_orders.id', 'meal_order_items.meal_order_id')
      .join('children', 'children.id', 'meal_orders.child_id')
      .where('children.parent_id', a.parent.id)
      .where('meal_orders.status', 'active')
      .sum('line_total_cents as total')
      .first()
    const statement = (page.inertiaProps as any).statement
    assert.equal(statement.totals.totalCents, Number(expected.total))
    // 4 × 45 (child 1, Mon–Thu) + 2 × 10 juice + 50 (child 2, Mon) + Tue–Fri defaults for child 2
    assert.equal(statement.totals.totalCents, 4 * 4500 + 2 * 1000 + 5000 + 4 * 4500)

    const pdf = await asBinary(client.get('/statements/pdf?month=2026-11').loginAs(a.parent))
    pdf.assertStatus(200)
    assert.equal(pdf.header('content-type'), 'application/pdf')
    assert.equal(Buffer.from(pdf.body()).subarray(0, 5).toString('latin1'), '%PDF-')
  })
})
