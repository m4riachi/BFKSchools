/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'
import type { BaseMail } from '@adonisjs/mail'
import OutboundEmail from '#models/outbound_email'
import OutboxSender from '#services/outbox_sender'
import OutboxService, { safeMailError } from '#services/outbox_service'
import { OUTBOX } from '#config/outbox'
import { UserFactory } from '#database/factories/user_factory'
import { WEEK, scheduledMenu, setupMenuSchool, statusService } from '#tests/helpers/menus'
import { freezeClock, restoreClock } from '#tests/helpers/clock'

/** A published menu and `count` queued `menu_published` emails for new parents. */
async function seedQueue(count: number) {
  const { school, manager } = await setupMenuSchool()
  const menu = await scheduledMenu(school, manager, WEEK)
  await (await statusService()).publishNow(menu, manager)
  await OutboundEmail.query().delete()
  const service = await app.container.make(OutboxService)
  const users = []
  for (let index = 0; index < count; index++) {
    const user = await UserFactory.apply('parent').merge({ schoolId: school.id }).create()
    users.push(user)
    await service.enqueue({
      userId: user.id,
      toEmail: user.email,
      locale: 'fr',
      mailKey: 'menu_published',
      payload: { weeklyMenuId: menu.id },
      dedupeKey: `menu_published:${menu.id}:user:${user.id}`,
    })
  }
  return { school, menu, users, service }
}

class FailingSender extends OutboxSender {
  calls = 0
  async send(_message: BaseMail) {
    this.calls += 1
    throw Object.assign(new Error('550 mailbox unavailable for parent@example.test'), {
      code: 'EENVELOPE',
      responseCode: 550,
      command: 'RCPT TO',
    })
  }
}

test.group('Outbox | enqueue', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('a dedupe key queues an email only once; unsafe addresses are not queued', async ({
    assert,
  }) => {
    const { users, service, menu } = await seedQueue(1)
    const again = await service.enqueue({
      userId: users[0].id,
      toEmail: users[0].email,
      locale: 'fr',
      mailKey: 'menu_published',
      payload: { weeklyMenuId: menu.id },
      dedupeKey: `menu_published:${menu.id}:user:${users[0].id}`,
    })
    assert.isFalse(again)
    const bad = await service.enqueueMany([
      { userId: null, toEmail: '"evil"@example.test', locale: 'fr', mailKey: 'menu_published' },
      { userId: null, toEmail: 'a@b.test, c@d.test', locale: 'fr', mailKey: 'menu_published' },
    ])
    assert.deepEqual(bad, { created: 0, invalid: 2 })
    assert.lengthOf(await OutboundEmail.all(), 1)
  })

  test('error descriptions never contain the address or the message', ({ assert }) => {
    const text = safeMailError(
      Object.assign(new Error('rejected <parent@example.test>'), {
        code: 'EENVELOPE',
        responseCode: 550,
        command: 'RCPT TO:<parent@example.test>',
      })
    )
    assert.equal(text, 'EENVELOPE 550 RCPT TO')
    assert.notInclude(text, '@')
  })
})

test.group('Outbox | dispatch', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => {
    restoreClock()
    app.container.restore(OutboxSender)
    mail.restore()
  })

  test('sends due emails and marks them sent', async ({ assert }) => {
    const { service } = await seedQueue(2)
    const { mails } = mail.fake()
    const result = await service.dispatch()
    assert.equal(result.sent, 2)
    assert.lengthOf(mails.sent(), 2)
    const rows = await OutboundEmail.all()
    assert.isTrue(rows.every((row) => row.status === 'sent' && row.sentAt && row.attempts === 1))
  })

  test('respects the per-run cap and the rolling hourly cap', async ({ assert }) => {
    const clock = freezeClock('2026-11-18T10:00') // before publish_at (schedule refuses a past one)
    const { service } = await seedQueue(5)
    const { mails } = mail.fake()

    const first = await service.dispatch({ maxPerRun: 2, maxPerHour: 3 })
    assert.equal(first.sent, 2)
    const second = await service.dispatch({ maxPerRun: 2, maxPerHour: 3 })
    assert.deepEqual([second.budget, second.sent], [1, 1])
    const third = await service.dispatch({ maxPerRun: 2, maxPerHour: 3 })
    assert.deepEqual([third.budget, third.sent], [0, 0])
    assert.lengthOf(mails.sent(), 3)

    clock.travel({ minutes: 61 })
    const later = await service.dispatch({ maxPerRun: 2, maxPerHour: 3 })
    assert.equal(later.sent, 2)
    assert.lengthOf(await OutboundEmail.query().where('status', 'pending'), 0)
  })

  test('a failure is retried with backoff and ends as failed after 5 attempts', async ({
    assert,
  }) => {
    const clock = freezeClock('2026-11-18T10:00') // before publish_at (schedule refuses a past one)
    await seedQueue(1)
    const sender = new FailingSender()
    app.container.swap(OutboxSender, () => sender)
    const service = await app.container.make(OutboxService)

    const first = await service.dispatch()
    assert.equal(first.retried, 1)
    let row = (await OutboundEmail.first())!
    assert.equal(row.status, 'pending')
    assert.equal(row.attempts, 1)
    assert.equal(row.lastError, 'EENVELOPE 550 RCPT TO')
    assert.equal(row.sendAfter.toMillis(), clock.now().plus({ minutes: 1 }).toMillis())

    // Not due yet: nothing is attempted.
    await service.dispatch()
    assert.equal(sender.calls, 1)

    for (const minutes of OUTBOX.backoffMinutes) {
      clock.travel({ minutes })
      await service.dispatch()
    }
    row = (await OutboundEmail.first())!
    assert.equal(sender.calls, OUTBOX.maxAttempts)
    assert.equal(row.attempts, OUTBOX.maxAttempts)
    assert.equal(row.status, 'failed')
    assert.notInclude(row.lastError ?? '', '@')

    clock.travel({ days: 1 })
    await service.dispatch()
    assert.equal(sender.calls, OUTBOX.maxAttempts)
  })

  test('emails of deactivated parents and unknown mail keys are skipped, never sent', async ({
    assert,
  }) => {
    const { service, users } = await seedQueue(2)
    users[0].isActive = false
    await users[0].save()
    await service.enqueue({
      userId: null,
      toEmail: 'x@example.test',
      locale: 'en',
      mailKey: 'nope',
    })
    const { mails } = mail.fake()
    const result = await service.dispatch()
    assert.deepEqual([result.sent, result.skipped], [1, 2])
    assert.lengthOf(mails.sent(), 1)
    const skipped = await OutboundEmail.query().where('status', 'failed').orderBy('id')
    assert.deepEqual(
      skipped.map((row) => row.lastError),
      ['skipped: recipient_inactive', 'skipped: unknown_mail_key']
    )
  })

  test('rows stuck in sending (crashed run) are retried after a while', async ({ assert }) => {
    const clock = freezeClock('2026-11-18T10:00') // before publish_at (schedule refuses a past one)
    const { service } = await seedQueue(1)
    await db
      .from('outbound_emails')
      .update({ status: 'sending', attempts: 1, updated_at: clock.now().toISO()! })
    const { mails } = mail.fake()
    await service.dispatch()
    assert.lengthOf(mails.sent(), 0)
    clock.travel({ minutes: OUTBOX.staleSendingMinutes + 1 })
    await service.dispatch()
    assert.lengthOf(mails.sent(), 1)
    assert.equal((await OutboundEmail.first())!.status, 'sent')
  })
})
