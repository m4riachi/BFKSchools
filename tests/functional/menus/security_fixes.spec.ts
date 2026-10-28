/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'
import OutboundEmail from '#models/outbound_email'
import MenuTemplate from '#models/menu_template'
import WeeklyMenu from '#models/weekly_menu'
import OutboxService from '#services/outbox_service'
import { safeJobError } from '#services/menu_jobs'
import { OUTBOX } from '#config/outbox'
import { UserFactory } from '#database/factories/user_factory'
import { APP_TIMEZONE } from '#support/time'
import { WEEK, readyMenu, setupMenuSchool, statusService } from '#tests/helpers/menus'
import { freezeClock, restoreClock } from '#tests/helpers/clock'

const wall = (menu: WeeklyMenu) =>
  menu.publishAt?.setZone(APP_TIMEZONE).toFormat('yyyy-LL-dd HH:mm')

async function queueRows(count: number) {
  const { school } = await setupMenuSchool()
  const service = await app.container.make(OutboxService)
  const users = []
  for (let index = 0; index < count; index++) {
    const user = await UserFactory.apply('parent').merge({ schoolId: school.id }).create()
    users.push(user)
    await service.enqueue({
      userId: user.id,
      toEmail: user.email,
      locale: 'fr',
      mailKey: 'unknown_key_for_test',
      payload: {},
    })
  }
  return { service, users }
}

test.group('Security fixes | outbox (M1)', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => {
    restoreClock()
    mail.restore()
  })

  test('a stale sending row that used every attempt ends failed, not retried', async ({
    assert,
  }) => {
    const clock = freezeClock('2026-11-19T10:00')
    const { service } = await queueRows(2)
    const [spent, fresh] = await OutboundEmail.query().orderBy('id')
    await db
      .from('outbound_emails')
      .where('id', spent.id)
      .update({ status: 'sending', attempts: OUTBOX.maxAttempts, updated_at: clock.now().toISO()! })
    await db
      .from('outbound_emails')
      .where('id', fresh.id)
      .update({ status: 'sending', attempts: 1, updated_at: clock.now().toISO()! })
    clock.travel({ minutes: OUTBOX.staleSendingMinutes + 1 })
    mail.fake()
    await service.dispatch()
    const [a, b] = await OutboundEmail.query().orderBy('id')
    assert.deepEqual(
      [a.status, a.lastError, a.attempts],
      ['failed', 'stale_sending', OUTBOX.maxAttempts]
    )
    // The other stale row was reclaimed and processed (unknown key → skipped).
    assert.equal(b.status, 'failed')
    assert.equal(b.lastError, 'skipped: unknown_mail_key')
    assert.equal(b.attempts, 2)
  })

  test('a row at the attempts CHECK limit cannot break the dispatch of other rows', async ({
    assert,
  }) => {
    const { service } = await queueRows(3)
    const [odd] = await OutboundEmail.query().orderBy('id')
    await db.from('outbound_emails').where('id', odd.id).update({ attempts: 100 })
    mail.fake()
    const result = await service.dispatch()
    assert.equal(result.skipped, 3)
    const rows = await OutboundEmail.query().orderBy('id')
    assert.deepEqual(
      rows.map((row) => row.attempts),
      [100, 1, 1]
    )
    assert.isTrue(rows.every((row) => row.status === 'failed'))
  })
})

test.group('Security fixes | menu times (L1, L5, L6)', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  const put = (client: any, user: any, publishAt: string, orderDeadlineAt = '2026-11-22T20:00') =>
    client
      .put(`/admin/menus/${WEEK}/times`)
      .loginAs(user)
      .withCsrfToken()
      .json({ publishAt, orderDeadlineAt })
      .redirects(0)

  test('a publication time in the past is refused for draft and scheduled menus', async ({
    client,
    assert,
  }) => {
    freezeClock('2026-11-18T12:00')
    const { school, manager } = await setupMenuSchool()
    const menu = await readyMenu(school, manager)
    const response = await put(client, manager, '2026-11-18T11:59')
    assert.property(response.flashMessage('inputErrorsBag'), 'publishAt')
    assert.equal(wall(await WeeklyMenu.findOrFail(menu.id)), '2026-11-19 10:00')

    await (await statusService()).schedule(school, menu, manager)
    const scheduled = await put(client, manager, '2026-11-18T08:00')
    assert.match(String(scheduled.flashMessage('inputErrorsBag')?.publishAt), /dans le futur/)
    const ok = await put(client, manager, '2026-11-18T12:30')
    ok.assertStatus(302)
    assert.equal(wall(await WeeklyMenu.findOrFail(menu.id)), '2026-11-18 12:30')
  })

  test('scheduling refuses a menu whose (pre-filled) publication time has passed', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const menu = await readyMenu(school, manager)
    freezeClock('2026-11-20T09:00') // after the default Thu 19 Nov 10:00
    try {
      await (await statusService()).schedule(school, menu, manager)
      assert.fail('should be refused')
    } catch (error) {
      assert.equal((error as any).messageKey, 'menus.errors.publish_in_past')
    }
    assert.equal((await WeeklyMenu.findOrFail(menu.id)).status, 'draft')
  })

  test('publication more than 8 weeks before the week, or in another year, is refused', async ({
    client,
    assert,
  }) => {
    freezeClock('2026-09-01T08:00')
    const { manager } = await setupMenuSchool()
    for (const publishAt of ['2026-09-27T10:00', '9999-01-01T10:00', '2026-11-30T10:00']) {
      const response = await put(client, manager, publishAt)
      const errors = response.flashMessage('inputErrorsBag') ?? {}
      assert.isTrue('publishAt' in errors || 'orderDeadlineAt' in errors, publishAt)
    }
    // 28 Sep 2026 00:00 is exactly 8 weeks before 23 Nov: accepted.
    const ok = await put(client, manager, '2026-09-28T00:00')
    ok.assertStatus(302)
    assert.isUndefined(ok.flashMessage('inputErrorsBag'))
  })

  test('refused times never leave an empty draft behind', async ({ client, assert }) => {
    freezeClock('2026-11-10T08:00')
    const { manager } = await setupMenuSchool()
    await put(client, manager, '2026-11-19T10:00', '2026-11-19T09:00')
    await put(client, manager, '2026-11-01T10:00')
    assert.lengthOf(await WeeklyMenu.all(), 0)
    // A valid one creates the draft with the given times.
    await put(client, manager, '2026-11-18T10:00')
    const menus = await WeeklyMenu.all()
    assert.lengthOf(menus, 1)
    assert.equal(wall(menus[0]), '2026-11-18 10:00')
  })
})

test.group('Security fixes | misc (L7, L9)', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('deleting a template without a valid week goes to the menus index, not the Referer', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const template = await MenuTemplate.create({ schoolId: school.id, name: 'T', createdBy: null })
    const response = await client
      .delete(`/admin/menu-templates/${template.id}`)
      .loginAs(manager)
      .withCsrfToken()
      .header('referer', 'https://evil.example/phish')
      .json({ week: 'nope' })
      .redirects(0)
    response.assertStatus(302)
    response.assertHeader('location', '/admin/menus')
    assert.isNull(await MenuTemplate.find(template.id))
  })

  test('job errors are logged without message or bindings', ({ assert }) => {
    const error = Object.assign(new Error('insert ... values (parent@example.test)'), {
      code: '23505',
      constraint: 'notifications_user_dedupe_unique',
    })
    const safe = safeJobError(error)
    assert.deepEqual(safe, {
      name: 'Error',
      code: '23505',
      constraint: 'notifications_user_dedupe_unique',
    })
    assert.notInclude(JSON.stringify(safe), '@')
  })
})
