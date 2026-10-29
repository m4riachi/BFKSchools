/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import MenuPublicationService from '#services/menu_publication_service'
import ace from '@adonisjs/core/services/ace'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'
import Notification from '#models/notification'
import OutboundEmail from '#models/outbound_email'
import WeeklyMenu from '#models/weekly_menu'
import MenuPublishedMail from '#mails/menu_published_mail'
import MenusPublishDue from '#commands/menus_publish_due'
import MenusSendReminders from '#commands/menus_send_reminders'
import MenusApplyDeadline from '#commands/menus_apply_deadline'
import { UserFactory } from '#database/factories/user_factory'
import { addDays } from '#support/dates'
import { APP_TIMEZONE } from '#support/time'
import {
  WEEK,
  builder,
  itemsOf,
  jobs,
  parentWithChild,
  scheduledMenu,
  setupMenuSchool,
  statusService,
} from '#tests/helpers/menus'
import { freezeClock, restoreClock } from '#tests/helpers/clock'

const NEXT = addDays(WEEK, 7)

/**
 * A school with two scheduled menus (this week: publish Thu 19 Nov 10:00;
 * next week: Thu 26 Nov 10:00) and parents in every situation.
 */
async function seed(settings: Record<string, unknown> = {}) {
  const ctx = await setupMenuSchool(settings)
  const { school, manager } = ctx
  const due = await scheduledMenu(school, manager, WEEK)
  const later = await scheduledMenu(school, manager, NEXT)

  const fr = await parentWithChild(school, { locale: 'fr' })
  const en = await parentWithChild(school, { locale: 'en' })
  const optedOut = await parentWithChild(school, { notificationPrefs: { menu_published: false } })
  const inactiveParent = await parentWithChild(school, { isActive: false })
  const onlyInactiveChild = await parentWithChild(school, {}, { isActive: false })
  const childless = await UserFactory.apply('parent').merge({ schoolId: school.id }).create()
  const other = await setupMenuSchool()
  const otherSchoolParent = await parentWithChild(other.school)

  return {
    ...ctx,
    due,
    later,
    parents: { fr, en, optedOut, inactiveParent, onlyInactiveChild, childless, otherSchoolParent },
  }
}

async function notifiedUserIds() {
  const rows = await Notification.query().orderBy('user_id')
  return rows.map((row) => row.userId)
}

async function queued() {
  return OutboundEmail.query().orderBy('user_id')
}

test.group('Menus | publish-due job', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('before publish_at nothing happens', async ({ assert }) => {
    const { due } = await seed()
    freezeClock('2026-11-19T09:59')
    const outcome = await (await jobs()).publishDue()
    assert.isTrue(outcome.acquired)
    assert.equal((await WeeklyMenu.findOrFail(due.id)).status, 'scheduled')
    assert.lengthOf(await Notification.all(), 0)
    assert.lengthOf(await OutboundEmail.all(), 0)
  })

  test('publishes only the due menu, once, and notifies + emails the right parents', async ({
    assert,
  }) => {
    const { due, later, parents } = await seed()
    const clock = freezeClock('2026-11-19T10:01')

    const first = await (await jobs()).publishDue()
    assert.isTrue(first.acquired)
    const published = await WeeklyMenu.findOrFail(due.id)
    assert.equal(published.status, 'published')
    assert.equal(
      published.publishedAt!.setZone(APP_TIMEZONE).toFormat('yyyy-LL-dd HH:mm'),
      '2026-11-19 10:01'
    )
    assert.equal((await WeeklyMenu.findOrFail(later.id)).status, 'scheduled')

    // Notifications: every active parent of the school with an active child.
    assert.deepEqual(
      await notifiedUserIds(),
      [parents.fr.id, parents.en.id, parents.optedOut.id].sort((a, b) => a - b)
    )
    const notification = await Notification.findByOrFail('user_id', parents.fr.id)
    assert.equal(notification.type, 'menu_published')
    assert.deepEqual(notification.data, { weeklyMenuId: due.id, weekStart: WEEK })
    assert.equal(notification.dedupeKey, `menu_published:${due.id}`)

    // Emails: same parents minus the one who opted out, in their language.
    const emails = await queued()
    assert.deepEqual(
      emails.map((row) => [row.userId, row.toEmail, row.locale, row.mailKey, row.status]),
      [
        [parents.fr.id, parents.fr.email, 'fr', 'menu_published', 'pending'],
        [parents.en.id, parents.en.email, 'en', 'menu_published', 'pending'],
      ]
    )
    assert.deepEqual(emails[0].payload, { weeklyMenuId: due.id })

    // Second run (and a run later the same day): nothing new.
    await (await jobs()).publishDue()
    clock.travel({ hours: 3 })
    await (await jobs()).publishDue()
    assert.lengthOf(await Notification.all(), 3)
    assert.lengthOf(await OutboundEmail.all(), 2)
    assert.equal(
      (await WeeklyMenu.findOrFail(due.id)).publishedAt!.toMillis(),
      published.publishedAt!.toMillis()
    )

    // mail:dispatch sends exactly those emails (fake mailer).
    const { mails } = mail.fake()
    try {
      const sent = await (await jobs()).dispatchMail()
      assert.isTrue(sent.acquired)
      if (sent.acquired) assert.equal(sent.result.sent, 2)
      const recipients = mails
        .sent()
        .map((message) => (message as MenuPublishedMail).user.email)
        .sort()
      assert.deepEqual(recipients, [parents.fr.email, parents.en.email].sort())
      mails.assertSent(MenuPublishedMail, (message) => {
        return (
          message.user.email === parents.en.email &&
          message.message.toJSON().message.subject!.includes('November 23')
        )
      })
      const again = await (await jobs()).dispatchMail()
      if (again.acquired) assert.equal(again.result.sent, 0)
      assert.lengthOf(mails.sent(), 2)
    } finally {
      mail.restore()
    }
  })

  test('catches up a missed run: several due menus are published by one run', async ({
    assert,
  }) => {
    const { due, later } = await seed()
    // Missed runs from Thu 19 to Fri 27: next week's menu is published;
    // this week's deadline (Sun 22 20:00) has passed, so D19 keeps it
    // scheduled instead of announcing it late.
    freezeClock('2026-11-27T06:00')
    const outcome = await (await jobs()).publishDue()
    assert.isTrue(outcome.acquired)
    if (outcome.acquired) {
      assert.deepEqual(
        outcome.result.map((entry) => [entry.menuId, entry.published]),
        [
          [due.id, false],
          [later.id, true],
        ]
      )
    }
    assert.equal((await WeeklyMenu.findOrFail(due.id)).status, 'scheduled')
    assert.equal((await WeeklyMenu.findOrFail(later.id)).status, 'published')
    assert.lengthOf(await Notification.all(), 3)
  })

  test('with email notifications off, notifications are created but no emails', async ({
    assert,
  }) => {
    await seed({ email_notifications: { enabled: false } })
    freezeClock('2026-11-19T10:00')
    await (await jobs()).publishDue()
    assert.lengthOf(await Notification.all(), 3)
    assert.lengthOf(await OutboundEmail.all(), 0)
  })

  test('with only the menu_published email type off, no emails either', async ({ assert }) => {
    await seed({ email_notifications: { menu_published: false } })
    freezeClock('2026-11-19T10:00')
    await (await jobs()).publishDue()
    assert.lengthOf(await Notification.all(), 3)
    assert.lengthOf(await OutboundEmail.all(), 0)
  })

  test('a menu emptied after scheduling is left scheduled (not published)', async ({ assert }) => {
    const { school, manager, due } = await seed()
    const service = await builder()
    for (const item of await itemsOf(due.id))
      await service.removeItem(school, due, item.id, manager)
    freezeClock('2026-11-19T10:05')
    await (await jobs()).publishDue()
    assert.equal((await WeeklyMenu.findOrFail(due.id)).status, 'scheduled')
    assert.lengthOf(await Notification.all(), 0)
  })

  test('two overlapping runs do not both execute (advisory lock)', async ({ assert }) => {
    const { due } = await seed()
    freezeClock('2026-11-19T10:01')
    const holder = await db.transaction()
    try {
      await holder.rawQuery('SELECT pg_advisory_xact_lock(hashtext(?))', ['menus:publish-due'])
      const blocked = await (await jobs()).publishDue()
      assert.isFalse(blocked.acquired)
      assert.equal((await WeeklyMenu.findOrFail(due.id)).status, 'scheduled')
    } finally {
      await holder.rollback()
    }
    const ran = await (await jobs()).publishDue()
    assert.isTrue(ran.acquired)
    assert.equal((await WeeklyMenu.findOrFail(due.id)).status, 'published')
  })

  test('the Ace command runs the job', async ({ assert }) => {
    const { due } = await seed()
    freezeClock('2026-11-19T10:01')
    const command = await ace.create(MenusPublishDue, [])
    await command.exec()
    command.assertSucceeded()
    assert.equal((await WeeklyMenu.findOrFail(due.id)).status, 'published')
  })

  test('manual publish now notifies the same parents', async ({ client, assert }) => {
    const { manager, due, parents } = await seed()
    freezeClock('2026-11-17T15:00')
    const response = await client
      .post(`/admin/menus/${WEEK}/publish`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    response.assertStatus(302)
    assert.match(String(response.flashMessage('success')), /3 familles prévenues/)
    assert.equal((await WeeklyMenu.findOrFail(due.id)).status, 'published')
    assert.deepEqual(
      await notifiedUserIds(),
      [parents.fr.id, parents.en.id, parents.optedOut.id].sort((a, b) => a - b)
    )
    // The job later finds nothing to do.
    freezeClock('2026-11-19T10:01')
    await (await jobs()).publishDue()
    assert.lengthOf(await Notification.all(), 3)
    assert.lengthOf(await OutboundEmail.all(), 2)
  })
})

test.group('Menus | close-past and Phase 6 stubs', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('close-past closes published menus once their week is over', async ({ assert }) => {
    const { school, manager } = await setupMenuSchool()
    const menu = await scheduledMenu(school, manager)
    await (await statusService()).publishNow(menu, manager)
    const draft = await (await builder()).withMenu(school, NEXT, manager, async (_t, m) => m)

    freezeClock('2026-11-29T23:59')
    let outcome = await (await jobs()).closePast()
    if (outcome.acquired) assert.equal(outcome.result.closed, 0)
    assert.equal((await WeeklyMenu.findOrFail(menu.id)).status, 'published')

    freezeClock('2026-11-30T00:00')
    outcome = await (await jobs()).closePast()
    if (outcome.acquired) assert.equal(outcome.result.closed, 1)
    const closed = await WeeklyMenu.findOrFail(menu.id)
    assert.equal(closed.status, 'closed')
    assert.isNotNull(closed.closedAt)
    outcome = await (await jobs()).closePast()
    if (outcome.acquired) assert.equal(outcome.result.closed, 0)
    assert.equal((await WeeklyMenu.findOrFail(draft.id)).status, 'draft')
  })

  test('send-reminders and apply-deadline commands run (implemented in Phase 6)', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    await parentWithChild(school)
    const menu = await scheduledMenu(school, manager)
    await (await statusService()).publishNow(menu, manager)

    freezeClock('2026-11-22T00:00')
    for (const Command of [MenusSendReminders, MenusApplyDeadline]) {
      const command = await ace.create(Command, [])
      await command.exec()
      command.assertSucceeded()
    }
    let fresh = await WeeklyMenu.findOrFail(menu.id)
    assert.isNotNull(fresh.reminderSentAt)
    assert.isNull(fresh.deadlineProcessedAt)

    freezeClock('2026-11-23T08:00')
    const deadline = await (await jobs()).applyDeadline()
    assert.isTrue(deadline.acquired)
    fresh = await WeeklyMenu.findOrFail(menu.id)
    assert.isNotNull(fresh.deadlineProcessedAt)
  })
})

test.group('Menus | menu published email', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('renders in FR and EN with HTML and text parts, the week and the deadline', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const menu = await scheduledMenu(school, manager)
    const user = { email: 'parent@example.test', fullName: 'Salma Idrissi' }
    const expected = {
      fr: ['Le menu de la semaine du 23 au 27 novembre 2026 est en ligne', 'dimanche 22 novembre'],
      en: ['The menu for November 23 – 27, 2026 is online', 'Sunday, November 22'],
    } as const
    for (const locale of ['fr', 'en'] as const) {
      const message = new MenuPublishedMail(user, locale, menu, school)
      await message.buildWithContents()
      const json = message.message.toJSON().message
      assert.equal(json.subject, expected[locale][0])
      assert.include(String(json.html), expected[locale][1])
      assert.include(String(json.text), expected[locale][1])
      assert.include(String(json.html), 'Salma Idrissi')
      assert.include(String(json.text), 'http')
    }
  })
})

test.group('Menus | late publication', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('the job never publishes a week that is over; close-past moves it back to draft', async ({
    assert,
  }) => {
    const { due, later } = await seed()
    // Week of 23 Nov ends Mon 30 Nov 00:00 (school zone); next week is still running.
    freezeClock('2026-11-30T00:00')
    const outcome = await (await jobs()).publishDue()
    assert.isTrue(outcome.acquired)
    if (outcome.acquired) {
      // Next week's deadline (Sun 29 20:00) has passed too (D19).
      assert.deepEqual(
        outcome.result.map((entry) => [entry.menuId, entry.published]),
        [[later.id, false]]
      )
    }
    assert.equal((await WeeklyMenu.findOrFail(due.id)).status, 'scheduled')
    const notified = await Notification.query().where(
      'data',
      '@>',
      JSON.stringify({ weeklyMenuId: due.id })
    )
    assert.lengthOf(notified, 0)

    // The publication service itself also refuses it (defence in depth).
    const service = await app.container.make(MenuPublicationService)
    const direct = await service.publish(due.id, { origin: 'job' })
    assert.deepEqual(direct, { published: false, menuId: due.id, reason: 'week_over' })

    const closed = await (await jobs()).closePast()
    if (closed.acquired) assert.deepEqual(closed.result, { closed: 0, unscheduled: 1 })
    assert.equal((await WeeklyMenu.findOrFail(due.id)).status, 'draft')
    assert.equal((await WeeklyMenu.findOrFail(later.id)).status, 'scheduled')
    const again = await (await jobs()).closePast()
    if (again.acquired) assert.deepEqual(again.result, { closed: 0, unscheduled: 0 })
  })

  test('D19: after its order deadline a menu is not published, even before the week ends', async ({
    assert,
  }) => {
    const { due } = await seed()
    freezeClock('2026-11-29T23:59')
    await (await jobs()).publishDue()
    const menu = await WeeklyMenu.findOrFail(due.id)
    assert.equal(menu.status, 'scheduled')
    assert.isNotNull(menu.latePublishWarnedAt)
    assert.lengthOf(
      await Notification.query().where('data', '@>', JSON.stringify({ weeklyMenuId: due.id })),
      0
    )
  })

  test('publish now and schedule are refused for a week that is over', async ({
    client,
    assert,
  }) => {
    const { school, manager, due } = await seed()
    freezeClock('2026-12-01T09:00')
    const publish = await client
      .post(`/admin/menus/${WEEK}/publish`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    assert.equal(
      publish.flashMessage('error'),
      'Cette semaine est terminée : son menu ne peut plus être programmé ni publié.'
    )
    assert.equal((await WeeklyMenu.findOrFail(due.id)).status, 'scheduled')
    assert.lengthOf(await Notification.all(), 0)

    const status = await statusService()
    const draft = await status.unschedule(due, manager)
    try {
      await status.schedule(school, draft, manager)
      assert.fail('schedule should be refused')
    } catch (error) {
      assert.equal((error as any).messageKey, 'menus.errors.week_over')
    }
  })
})
