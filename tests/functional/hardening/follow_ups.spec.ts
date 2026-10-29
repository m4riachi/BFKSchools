import { test } from '@japa/runner'
import { rm, readdir } from 'node:fs/promises'
import testUtils from '@adonisjs/core/services/test_utils'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import limiter from '@adonisjs/limiter/services/main'
import { DateTime } from 'luxon'
import { UserFactory } from '#database/factories/user_factory'
import { SchoolFactory } from '#database/factories/school_factory'
import User from '#models/user'
import Holiday from '#models/holiday'
import UserToken from '#models/user_token'
import AccountLinkService from '#services/account_link_service'
import ImportStore, { MAX_PENDING_IMPORTS_PER_USER } from '#services/import_store'
import HolidayImportStore from '#services/holiday_import_store'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import OutboxService from '#services/outbox_service'
import HolidayService from '#services/holiday_service'
import NotificationCenterService from '#services/notification_center_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import { mealPhotoUploadLimiter, holidayImportLimiter, uploadKeys } from '#start/limiter'
import { createChild, createParent, setupSchool } from '#tests/helpers/families'
import { setupHolidaySchool } from '#tests/helpers/holidays'
import { createMeal, pngBuffer } from '#tests/helpers/meals'

test.group('Hardening | sessions (auth_cv)', (group) => {
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    return testUtils.db().truncate()
  })

  test('a session without the credentials version is logged out', async ({ client, assert }) => {
    const user = await UserFactory.apply('parent').create()
    const response = await client.get('/').withSession({ auth_web: user.id }).redirects(0)
    assert.equal(response.header('location'), '/login')
  })

  test('a remember-me login adopts the version; logout forgets it', async ({ client, assert }) => {
    const user = await UserFactory.apply('parent').create()
    const login = await client
      .post('/login')
      .form({ email: user.email, password: 'secret-password', remember: 'on' })
      .withCsrfToken()
      .redirects(0)
    const remember = login.cookie('remember_web')
    assert.isDefined(remember)

    // A new browser session restored from the remember-me cookie only.
    const restored = await client
      .get('/')
      .withEncryptedCookie('remember_web', remember!.value)
      .redirects(0)
    restored.assertStatus(200)
    assert.equal(restored.session().auth_cv, 0)

    const logout = await client.post('/logout').loginAs(user).withCsrfToken().redirects(0)
    assert.equal(logout.header('location'), '/login')
    assert.notProperty(logout.session(), 'auth_cv')
  })
})

test.group('Hardening | invitations and links', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => mail.restore())

  test('invite() re-checks the parent on the locked row', async ({ assert }) => {
    mail.fake()
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id, { password: null })
    const stale = await User.findOrFail(parent.id)
    // Meanwhile the parent accepted an earlier invitation.
    await db.from('users').where('id', parent.id).update({ password: 'hashed-elsewhere' })

    const service = await app.container.make(AccountLinkService)
    try {
      await service.invite(stale, manager)
      assert.fail('expected a refusal')
    } catch (error) {
      assert.instanceOf(error, BusinessRuleException)
      assert.equal(
        (error as BusinessRuleException).messageKey,
        'families.errors.already_has_access'
      )
    }
    assert.lengthOf(await UserToken.query().where('user_id', parent.id), 0)
  })
})

test.group('Hardening | data integrity', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('a child always belongs to its parent school (composite FK)', async ({ assert }) => {
    const { school } = await setupSchool()
    const other = await SchoolFactory.create()
    const parent = await createParent(school.id)
    await createChild(parent)
    await assert.rejects(() =>
      db.table('children').insert({
        parent_id: parent.id,
        school_id: other.id,
        first_name: 'Wrong',
        last_name: 'School',
      })
    )
    // Moving the parent while they have children is refused too.
    await assert.rejects(() =>
      db.from('users').where('id', parent.id).update({ school_id: other.id })
    )
  })

  test('holiday writes decide on rows re-read inside the lock', async ({ assert }) => {
    const { school, admin } = await setupHolidaySchool()
    const service = await app.container.make(HolidayService)
    const { groupId } = await service.createManual(
      school,
      { name: 'Break', startDate: '2026-12-21', endDate: '2026-12-25' },
      { confirmImpact: true, actor: admin }
    )
    const stale = await service.findGroup(school.id, groupId!)
    // Another tab deletes one day meanwhile.
    await Holiday.query().where('id', stale[0].id).delete()

    // updateGroup reads the range, then locks: simulate the change landing
    // in between by handing it the rows read before the delete.
    const racing = Object.assign(Object.create(service), {
      findGroup: async () => stale,
    }) as HolidayService
    await assert.rejects(
      () => racing.updateGroup(school, groupId!, { name: 'Renamed' }, { actor: admin }),
      BusinessRuleException as any
    )
    assert.lengthOf(await Holiday.query().where('name', 'Renamed'), 0)
    // setActive only touches rows that still exist and still need the change.
    await service.setActive(school, stale, false, { actor: admin })
    const rows = await Holiday.query().where('group_id', groupId!)
    assert.lengthOf(rows, stale.length - 1)
    assert.isTrue(rows.every((row) => row.isActive === false))
  })
})

test.group('Hardening | outbox hourly cap', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('failed SMTP attempts count; skipped rows do not', async ({ assert }) => {
    const user = await UserFactory.apply('parent').create()
    const now = DateTime.now().toISO()!
    const row = (extra: Record<string, unknown>) => ({
      user_id: user.id,
      to_email: user.email,
      locale: 'fr',
      mail_key: 'menu_published',
      payload: {},
      updated_at: now,
      ...extra,
    })
    await db
      .table('outbound_emails')
      .multiInsert([
        row({ status: 'sent', attempts: 1, sent_at: now }),
        row({ status: 'pending', attempts: 1, last_error: 'ECONNECTION' }),
        row({ status: 'failed', attempts: 5, last_error: 'EENVELOPE 550 RCPT' }),
        row({ status: 'failed', attempts: 1, last_error: 'skipped: recipient_inactive' }),
        row({ status: 'failed', attempts: 1, last_error: 'build_error' }),
        row({ status: 'pending', attempts: 0 }),
      ])
    const outbox = await app.container.make(OutboxService)
    assert.equal(await outbox.sentInLastHour(), 3)
  })
})

test.group('Hardening | uploads and imports', (group) => {
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    return testUtils.db().truncate()
  })

  test('pending CSV previews are capped per user', async ({ assert }) => {
    const store = await app.container.make(ImportStore)
    const directory = app.tmpPath('imports')
    const ids: string[] = []
    for (let i = 0; i < MAX_PENDING_IMPORTS_PER_USER + 2; i++) {
      ids.push(await store.put(424242, 1, `file ${i}`))
    }
    const mine = []
    for (const id of ids) {
      if ((await store.get(id, 424242, 1)) !== null) mine.push(id)
    }
    assert.deepEqual(mine, ids.slice(-MAX_PENDING_IMPORTS_PER_USER))
    for (const id of ids) await store.delete(id)
    assert.notIncludeMembers(
      await readdir(directory),
      ids.map((id) => `${id}.json`)
    )
    await rm(directory, { recursive: true, force: true })
  })

  test('ICS previews: same-instant uploads keep the newest (inherited tie-break)', async ({
    assert,
  }) => {
    freezeClock('2026-11-05T10:00')
    try {
      const store = await app.container.make(HolidayImportStore)
      const ids: string[] = []
      for (let i = 0; i < MAX_PENDING_IMPORTS_PER_USER + 3; i++) {
        ids.push(await store.put(616161, 1, `calendar ${i}`))
      }
      const kept: string[] = []
      for (const id of ids) if ((await store.get(id, 616161, 1)) !== null) kept.push(id)
      assert.deepEqual(kept, ids.slice(-MAX_PENDING_IMPORTS_PER_USER))
      for (const id of ids) await store.delete(id)
    } finally {
      restoreClock()
      await rm(app.tmpPath('imports', 'holidays'), { recursive: true, force: true })
    }
  })

  test('photo uploads and holiday imports are rate-limited per user', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupSchool()
    const meal = await createMeal()
    for (let i = 0; i < 20; i++) {
      await mealPhotoUploadLimiter().consume(uploadKeys.mealPhotos(manager.id))
    }
    const upload = await client
      .post(`/admin/meals/${meal.id}/photos`)
      .loginAs(manager)
      .file('photos', await pngBuffer(), { filename: 'a.png' })
      .withCsrfToken()
      .redirects(0)
    assert.notEqual(upload.status(), 200)
    assert.lengthOf(await db.from('meal_photos').where('meal_id', meal.id), 0)

    const admin = await UserFactory.apply('admin').merge({ schoolId: school.id }).create()
    for (let i = 0; i < 10; i++) {
      await holidayImportLimiter().consume(uploadKeys.holidayImport(admin.id))
    }
    const ics = await client
      .post('/admin/holidays/import/url')
      .loginAs(admin)
      .form({ url: 'https://calendar.example.com/school.ics' })
      .withCsrfToken()
      .redirects(0)
    assert.include([302, 429], ics.status())
    if (ics.status() === 302)
      assert.notMatch(String(ics.header('location')), /import\/[0-9a-f-]{36}/)
  })
})

test.group('Hardening | resilience', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => app.container.restore(NotificationCenterService))

  test('a failing unread-count query does not break parent pages', async ({ client, assert }) => {
    const { school } = await setupSchool()
    const parent = await createParent(school.id)
    class Broken extends NotificationCenterService {
      async unreadCount(): Promise<number> {
        throw new Error('database down')
      }
    }
    app.container.swap(NotificationCenterService, () => app.container.make(Broken))
    const page = await client.get('/statements').loginAs(parent).withInertia()
    page.assertStatus(200)
    assert.isNull((page.inertiaProps as any).unreadNotifications)
  })
})
