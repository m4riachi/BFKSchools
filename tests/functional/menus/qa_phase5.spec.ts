/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import router from '@adonisjs/core/services/router'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'
import type { BaseMail } from '@adonisjs/mail'
import Meal from '#models/meal'
import MenuItem from '#models/menu_item'
import Notification from '#models/notification'
import OutboundEmail from '#models/outbound_email'
import WeeklyMenu from '#models/weekly_menu'
import OutboxSender from '#services/outbox_sender'
import OutboxService from '#services/outbox_service'
import MenuPublicationService from '#services/menu_publication_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import { ChildFactory } from '#database/factories/child_factory'
import { UserFactory } from '#database/factories/user_factory'
import {
  MON,
  TUE,
  WEEK,
  addHoliday,
  addItem,
  builder,
  jobs,
  menuOf,
  parentWithChild,
  readyMenu,
  scheduledMenu,
  setupMenuSchool,
  statusService,
  subscriptionMeal,
  supplementMeal,
} from '#tests/helpers/menus'
import { freezeClock, restoreClock } from '#tests/helpers/clock'

const settle = (promises: Promise<unknown>[]) => Promise.allSettled(promises)

test.group('QA Phase 5 | routes with extreme dates', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('far-away Mondays never cause a 500', async ({ client, assert }) => {
    const { manager } = await setupMenuSchool()
    // Every route that takes :week (menus are limited to years 2000–2100).
    const patterns: { method: string; pattern: string }[] = []
    for (const list of Object.values(router.toJSON())) {
      for (const route of list) {
        if (!route.pattern.includes(':week')) continue
        for (const method of route.methods) {
          if (method !== 'HEAD') patterns.push({ method, pattern: route.pattern })
        }
      }
    }
    assert.isAtLeast(patterns.length, 12)

    const failures: string[] = []
    const weeks = ['0001-01-01', '9999-12-27', '0001-01-08', '1999-12-27', '2101-01-03']
    for (const week of [...weeks, '2026-02-30', '2026-13-01']) {
      for (const { method, pattern } of patterns) {
        const url = pattern.replace(':week', week).replace(':id', '1')
        const request = client
          .request(url, method as any)
          .loginAs(manager)
          .redirects(0)
        if (method !== 'GET') {
          request.withCsrfToken().json({
            publishAt: '2026-11-01T10:00',
            orderDeadlineAt: '2026-11-02T10:00',
            date: week,
            mealId: 1,
            templateId: 1,
            name: 'x',
            maxQuantity: 1,
          })
        }
        const response = await request
        if (response.status() !== 404) failures.push(`${method} ${url} -> ${response.status()}`)
      }
    }
    // A non-Monday date outside the window is not redirected to its Monday either.
    const sunday = await client.get('/admin/menus/0001-01-07').loginAs(manager).redirects(0)
    if (sunday.status() !== 404) failures.push(`GET 0001-01-07 -> ${sunday.status()}`)
    const query = await client.get('/admin/menus?week=9999-12-31').loginAs(manager).redirects(0)
    if (query.status() >= 500) failures.push(`GET ?week=9999-12-31 -> ${query.status()}`)
    assert.deepEqual(failures, [], failures.join(' | '))
    assert.lengthOf(await WeeklyMenu.all(), 0)
  })

  test('the first and last Mondays of the window work', async ({ client }) => {
    const { manager } = await setupMenuSchool()
    for (const week of ['2000-01-03', '2100-12-27']) {
      const response = await client.get(`/admin/menus/${week}`).loginAs(manager).withInertia()
      response.assertStatus(200)
    }
  })

  test('an impossible local datetime is a validation error, not a 500', async ({
    client,
    assert,
  }) => {
    const { manager } = await setupMenuSchool()
    const response = await client
      .put(`/admin/menus/${WEEK}/times`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
      .json({ publishAt: '2026-02-30T10:00', orderDeadlineAt: '2026-11-22T20:00' })
    assert.isBelow(response.status(), 500)
  })
})

test.group('QA Phase 5 | default-meal invariant', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  async function defaultsPerDay(menuId: number) {
    const rows = await MenuItem.query().where('weekly_menu_id', menuId).whereNull('removed_at')
    const days = new Map<string, { subs: number; defaults: number }>()
    for (const row of rows) {
      const entry = days.get(row.date) ?? { subs: 0, defaults: 0 }
      if (row.mealType === 'subscription') entry.subs += 1
      if (row.isDefault) entry.defaults += 1
      days.set(row.date, entry)
    }
    return days
  }

  test('parallel adds of subscription meals to one day leave exactly one default', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const meals = await Promise.all([1, 2, 3, 4, 5].map(() => subscriptionMeal()))
    const results = await settle(meals.map((meal) => addItem(school, manager, MON, meal)))
    assert.isTrue(
      results.every((r) => r.status === 'fulfilled'),
      JSON.stringify(results)
    )
    const menu = await menuOf(school)
    const day = (await defaultsPerDay(menu.id)).get(MON)!
    assert.deepEqual(day, { subs: 5, defaults: 1 })
  })

  test('parallel remove of the default and add keep exactly one default', async ({ assert }) => {
    const { school, manager } = await setupMenuSchool()
    const a = await addItem(school, manager, MON, await subscriptionMeal())
    await addItem(school, manager, MON, await subscriptionMeal())
    const menu = await menuOf(school)
    const service = await builder()
    await settle([
      service.removeItem(school, menu, a.id, manager),
      addItem(school, manager, MON, await subscriptionMeal()),
    ])
    const day = (await defaultsPerDay(menu.id)).get(MON)!
    assert.equal(day.defaults, 1)
    assert.equal(day.subs, 2)
  })

  test('copy previous week: the default meal is deactivated -> another one is promoted, one default per day', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const first = await subscriptionMeal()
    const second = await subscriptionMeal()
    const supplement = await supplementMeal()
    const prev = '2026-11-16'
    await addItem(school, manager, prev, first, prev)
    await addItem(school, manager, prev, second, prev)
    await addItem(school, manager, '2026-11-17', first, prev)
    await addItem(school, manager, '2026-11-18', supplement, prev) // supplements only: no default
    await Meal.query().where('id', first.id).update({ is_active: false })

    const report = await (await builder()).copyPreviousWeek(school, WEEK, manager)
    assert.deepEqual(report.newDefaults, [MON])
    const menu = await menuOf(school)
    const days = await defaultsPerDay(menu.id)
    assert.deepEqual(days.get(MON), { subs: 1, defaults: 1 })
    assert.isUndefined(days.get(TUE)) // only inactive meal on that day -> nothing copied
    assert.deepEqual(days.get('2026-11-25'), { subs: 0, defaults: 0 })
    // The result can be scheduled.
    await (await statusService()).schedule(school, menu, manager)
  })

  test('a scheduled menu stays schedulable-valid after removing its default', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const menu = await readyMenu(school, manager)
    await addItem(school, manager, MON, await subscriptionMeal())
    await (await statusService()).schedule(school, menu, manager)
    const defaultItem = await MenuItem.query()
      .where('weekly_menu_id', menu.id)
      .where('is_default', true)
      .firstOrFail()
    await (await builder()).removeItem(school, menu, defaultItem.id, manager)
    assert.deepEqual((await defaultsPerDay(menu.id)).get(MON), { subs: 1, defaults: 1 })
  })
})

test.group('QA Phase 5 | publication edge cases', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('job + two manual publishes in parallel: exactly one publication, one notification per parent', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const parents = [await parentWithChild(school), await parentWithChild(school)]
    const menu = await scheduledMenu(school, manager)
    freezeClock('2026-11-19T10:05')
    const service = await app.container.make(MenuPublicationService)
    const results = await settle([
      service.publish(menu.id, { origin: 'manual', actor: manager }),
      service.publish(menu.id, { origin: 'manual', actor: manager }),
      service.publish(menu.id, { origin: 'job' }),
      jobs().then((j) => j.publishDue()),
    ])
    assert.isTrue(
      results.every((r) => r.status === 'fulfilled'),
      JSON.stringify(results)
    )
    const outcomes = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .flatMap((r) => (Array.isArray(r.value?.result) ? r.value.result : [r.value]))
      .filter((o) => 'published' in o && o.published)
    assert.lengthOf(outcomes, 1)
    assert.lengthOf(await Notification.all(), parents.length)
    assert.lengthOf(await OutboundEmail.all(), parents.length)
  })

  test('recipients are read in several batches (more than 500 parents)', async ({ assert }) => {
    const { school, manager } = await setupMenuSchool()
    const parents = await UserFactory.apply('parent')
      .merge({ schoolId: school.id })
      .createMany(1010)
    const template = await ChildFactory.merge({
      parentId: parents[0].id,
      schoolId: school.id,
    }).make()
    await db.table('children').multiInsert(
      parents.map((parent, index) => ({
        parent_id: parent.id,
        school_id: school.id,
        first_name: `K${index}`,
        last_name: 'Test',
        grade: template.grade,
        class_name: template.className,
        is_active: true,
      }))
    )
    const menu = await scheduledMenu(school, manager)
    freezeClock('2026-11-19T10:05')
    const [first] = await Promise.all([(await jobs()).publishDue()])
    assert.isTrue(first.acquired)
    assert.equal(
      await Notification.query()
        .count('* as t')
        .then((r) => Number(r[0].$extras.t)),
      1010
    )
    assert.equal(
      await OutboundEmail.query()
        .count('* as t')
        .then((r) => Number(r[0].$extras.t)),
      1010
    )
    assert.equal((await WeeklyMenu.findOrFail(menu.id)).status, 'published')
  })

  test('a meal deactivated after scheduling: the job still publishes, manual publish refuses', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const menu = await scheduledMenu(school, manager)
    await parentWithChild(school)
    await db.from('meals').update({ is_active: false })
    freezeClock('2026-11-19T10:05')
    try {
      await (await statusService()).publishNow(menu, manager)
      assert.fail('manual publish must refuse')
    } catch (error) {
      assert.instanceOf(error, BusinessRuleException)
    }
    assert.equal((await WeeklyMenu.findOrFail(menu.id)).status, 'scheduled')
    await (await jobs()).publishDue()
    assert.equal((await WeeklyMenu.findOrFail(menu.id)).status, 'published')
  })

  test('a holiday added after scheduling blocks a manual publish and a new schedule', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const menu = await scheduledMenu(school, manager)
    await addHoliday(school, MON)
    freezeClock('2026-11-19T10:05')
    try {
      await (await statusService()).publishNow(menu, manager)
      assert.fail('manual publish must refuse')
    } catch (error) {
      assert.instanceOf(error, BusinessRuleException)
    }
    // The only open day became a holiday: nothing sensible to publish either.
    await (await jobs()).publishDue()
    assert.equal((await WeeklyMenu.findOrFail(menu.id)).status, 'scheduled')
  })

  test('menu_published email honours the recipient current state at send time', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const parent = await parentWithChild(school)
    await scheduledMenu(school, manager)
    freezeClock('2026-11-19T10:05')
    await (await jobs()).publishDue()
    await db.from('users').where('id', parent.id).update({ is_active: false })
    const { mails } = mail.fake()
    try {
      const outcome = await (await jobs()).dispatchMail()
      if (outcome.acquired) assert.deepEqual([outcome.result.sent, outcome.result.skipped], [0, 1])
      assert.lengthOf(mails.sent(), 0)
    } finally {
      mail.restore()
    }
  })
})

test.group('QA Phase 5 | outbox', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => {
    restoreClock()
    app.container.restore(OutboxSender)
  })

  async function queue(count: number) {
    const { school, manager } = await setupMenuSchool()
    const menu = await scheduledMenu(school, manager)
    await (await statusService()).publishNow(menu, manager)
    await OutboundEmail.query().delete()
    const service = await app.container.make(OutboxService)
    const users = []
    for (let i = 0; i < count; i++) {
      const user = await UserFactory.apply('parent').merge({ schoolId: school.id }).create()
      users.push(user)
      await service.enqueue({
        userId: user.id,
        toEmail: user.email,
        locale: 'en',
        mailKey: 'menu_published',
        payload: { weeklyMenuId: menu.id },
        dedupeKey: `menu_published:${menu.id}:user:${user.id}`,
      })
    }
    return { users, service }
  }

  test('two dispatchers running at the same time send each email once', async ({ assert }) => {
    const { users, service } = await queue(12)
    const { mails } = mail.fake()
    try {
      await Promise.all([service.dispatch(), service.dispatch(), service.dispatch()])
      const sent = mails.sent().map((m) => (m as any).user.email)
      assert.lengthOf(sent, 12)
      assert.sameMembers(
        sent,
        users.map((u) => u.email)
      )
      assert.equal((await OutboundEmail.query().where('status', 'sent')).length, 12)
    } finally {
      mail.restore()
    }
  })

  test('logs and last_error never hold a full address or a body when sending fails', async ({
    assert,
  }) => {
    const { users } = await queue(1)
    const captured: string[] = []
    const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const
    const originals = new Map<string, any>()
    for (const level of levels) {
      originals.set(level, (logger as any)[level])
      ;(logger as any)[level] = (...args: unknown[]) => {
        captured.push(
          JSON.stringify(args, (_k, v) => (v instanceof Error ? { m: v.message, s: v.stack } : v))
        )
      }
    }
    class LeakySender extends OutboxSender {
      async send(_message: BaseMail) {
        throw Object.assign(new Error(`550 <${users[0].email}> rejected body: SECRET-BODY-TEXT`), {
          code: 'EENVELOPE',
          responseCode: 550,
          command: 'RCPT TO',
          response: `to ${users[0].email}`,
        })
      }
    }
    app.container.swap(OutboxSender, () => new LeakySender())
    try {
      const service = await app.container.make(OutboxService)
      await service.dispatch()
    } finally {
      for (const level of levels) (logger as any)[level] = originals.get(level)
    }
    const all = captured.join('\n')
    assert.isAbove(captured.length, 0)
    assert.notInclude(all, users[0].email)
    assert.notInclude(all, 'SECRET-BODY-TEXT')
    const row = (await OutboundEmail.first())!
    assert.notInclude(row.lastError ?? '', users[0].email)
    assert.notInclude(row.lastError ?? '', 'SECRET')
  })

  test('the sender that throws on the 5th attempt leaves exactly one failed row and no duplicate sends', async ({
    assert,
  }) => {
    // Before publish_at: scheduling refuses a publication time in the past.
    freezeClock('2026-11-18T10:00')
    const { service } = await queue(3)
    const { mails } = mail.fake()
    try {
      await service.dispatch()
      assert.lengthOf(mails.sent(), 3)
      // Re-running (even much later) never re-sends sent rows.
      restoreClock()
      freezeClock('2026-12-30T10:00')
      await service.dispatch()
      assert.lengthOf(mails.sent(), 3)
    } finally {
      mail.restore()
    }
  })
})

test.group('QA Phase 5 | settings', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  async function put(client: any, admin: any, settings: Record<string, unknown>, extra: any = {}) {
    return client
      .put('/admin/settings')
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
      .json({
        schoolDays: [1, 2, 3, 4, 5],
        schoolYearStart: '2026-08-24',
        schoolYearEnd: '2027-06-11',
        monthlyFee: '',
        settings: {
          publish_weekday: 4,
          publish_time: '10:00',
          deadline_weekday: 7,
          deadline_time: '20:00',
          reminder_hours_before_deadline: 24,
          allow_parent_edits: true,
          edit_mode: 'until_cutoff',
          edit_cutoff_days_before: 1,
          edit_cutoff_time: '09:00',
          auto_assign_default_meal: true,
          allergy_rule: 'block',
          generate_moroccan_holidays: false,
          email_notifications: {
            enabled: true,
            menu_published: true,
            deadline_reminder: true,
            holiday_cancellation: true,
            order_changed_by_staff: true,
            menu_change: true,
          },
          billing_mode: 'per_meal',
          subscription_required_for_main_meal: true,
          supplement_max_quantity: 2,
          ...settings,
        },
        ...extra,
      })
  }

  test('deadline equal to or before publication, bad times and bad school days are refused', async ({
    client,
    assert,
  }) => {
    const { admin, school } = await setupMenuSchool()
    const cases: [string, Record<string, unknown>, Record<string, unknown>?][] = [
      ['same instant', { deadline_weekday: 4, deadline_time: '10:00' }],
      ['earlier', { deadline_weekday: 4, deadline_time: '09:59' }],
      ['24:00', { deadline_time: '24:00' }],
      ['7 chars', { publish_time: '9:00' }],
      ['weekday 0', { publish_weekday: 0 }],
      ['weekday 8', { deadline_weekday: 8 }],
      ['fee required', { billing_mode: 'monthly_fee' }],
      ['reminder 0', { reminder_hours_before_deadline: 0 }],
      ['supplement 21', { supplement_max_quantity: 21 }],
    ]
    for (const [label, settings] of cases) {
      const response = await put(client, admin, settings)
      assert.notEqual(response.status(), 500, label)
      const reloaded = await db.from('schools').where('id', school.id).first()
      assert.notEqual(reloaded.settings?.supplement_max_quantity, 21, label)
      assert.isFalse(
        reloaded.settings?.reminder_hours_before_deadline === 0 ||
          reloaded.settings?.deadline_time === '24:00',
        label
      )
    }
    for (const body of [
      { schoolDays: [] },
      { schoolDays: [1, 1, 2] },
      { schoolDays: [0, 8] },
      { schoolYearEnd: '2026-08-24' },
      { schoolYearEnd: '2026-02-30' },
      { schoolYearEnd: '2029-01-01' },
      { monthlyFee: '-5' },
      { monthlyFee: '1e3' },
    ]) {
      const response = await put(client, admin, {}, body)
      assert.notEqual(response.status(), 500, JSON.stringify(body))
      const reloaded = await db.from('schools').where('id', school.id).first()
      assert.equal(reloaded.school_year_end?.toString().slice(0, 4) !== '2029', true)
    }
  })

  test('changing the default times only affects weeks created afterwards', async ({
    client,
    assert,
  }) => {
    const { admin, school, manager } = await setupMenuSchool()
    await addItem(school, manager, MON, await subscriptionMeal())
    const before = await menuOf(school)
    const response = await put(client, admin, { publish_weekday: 2, publish_time: '08:00' })
    assert.equal(response.status(), 302, JSON.stringify(response.flashMessages?.()))
    const after = await menuOf(school)
    assert.equal(after.publishAt!.toMillis(), before.publishAt!.toMillis())
    await school.refresh()
    await addItem(school, manager, '2026-11-30', await subscriptionMeal(), '2026-11-30')
    const fresh = await menuOf(school, '2026-11-30')
    assert.equal(fresh.publishAt!.setZone('Africa/Casablanca').toFormat('ccc HH:mm'), 'Tue 08:00')
  })
})

test.group('QA Phase 5 | close-past', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('a published menu closes only after its week is over (Monday 00:00 school time)', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const menu = await scheduledMenu(school, manager)
    await (await statusService()).publishNow(menu, manager)
    const clock = freezeClock('2026-11-30T23:59')
    clock.set('2026-11-29T23:59')
    await (await jobs()).closePast()
    assert.equal((await WeeklyMenu.findOrFail(menu.id)).status, 'published')
    clock.set('2026-11-30T00:01')
    await (await jobs()).closePast()
    assert.equal((await WeeklyMenu.findOrFail(menu.id)).status, 'closed')
    assert.isNotNull((await WeeklyMenu.findOrFail(menu.id)).closedAt)
  })
})
