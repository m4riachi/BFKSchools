import { test } from '@japa/runner'
import { readFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import Holiday from '#models/holiday'
import School from '#models/school'
import HolidayCalendar from '#services/holiday_calendar'
import SafeHttpFetcher, { type Transport } from '#services/safe_http_fetcher'
import { Readable } from 'node:stream'
import {
  fakeImpact,
  listedHolidays,
  setupHolidaySchool,
  generateHolidays,
} from '#tests/helpers/holidays'

const fixture = () =>
  readFile(new URL('../../fixtures/holidays/school_calendar.ics', import.meta.url))

function inputErrors(response: { flashMessage: (key: string) => unknown }) {
  return (response.flashMessage('inputErrorsBag') ?? {}) as Record<string, string[] | string>
}

test.group('Holidays | manual days and ranges', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('a range creates one row per school day (no weekends) sharing a group id', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupHolidaySchool()
    const response = await client
      .post('/admin/holidays')
      .loginAs(manager)
      .json({ name: 'Winter break', startDate: '2026-12-21', endDate: '2027-01-01' })
      .withCsrfToken()
      .redirects(0)
    response.assertStatus(302)

    const rows = await listedHolidays(school.id)
    assert.deepEqual(
      rows.map((row) => row.date),
      [
        '2026-12-21',
        '2026-12-22',
        '2026-12-23',
        '2026-12-24',
        '2026-12-25',
        '2026-12-28',
        '2026-12-29',
        '2026-12-30',
        '2026-12-31',
        '2027-01-01',
      ]
    )
    assert.lengthOf(new Set(rows.map((row) => row.groupId)), 1)
    assert.isString(rows[0].groupId)
    assert.isTrue(rows.every((row) => row.source === 'manual' && row.ruleKey === null))
    assert.isTrue(rows.every((row) => row.createdBy === manager.id))
  })

  test('a single day has no group; a weekend-only range is refused', async ({ client, assert }) => {
    const { school, manager } = await setupHolidaySchool()
    await client
      .post('/admin/holidays')
      .loginAs(manager)
      .json({ name: 'Teacher day', startDate: '2026-10-09' })
      .withCsrfToken()
      .redirects(0)
    const [row] = await listedHolidays(school.id)
    assert.isNull(row.groupId)

    const weekend = await client
      .post('/admin/holidays')
      .loginAs(manager)
      .json({ name: 'Weekend', startDate: '2026-10-10', endDate: '2026-10-11' })
      .withCsrfToken()
      .redirects(0)
    weekend.assertStatus(302)
    assert.property(inputErrors(weekend), 'startDate')

    const backwards = await client
      .post('/admin/holidays')
      .loginAs(manager)
      .json({ name: 'Backwards', startDate: '2026-10-20', endDate: '2026-10-19' })
      .withCsrfToken()
      .redirects(0)
    assert.property(inputErrors(backwards), 'endDate')

    const outside = await client
      .post('/admin/holidays')
      .loginAs(manager)
      .json({ name: 'Summer', startDate: '2027-07-05' })
      .withCsrfToken()
      .redirects(0)
    assert.property(inputErrors(outside), 'startDate')
    assert.lengthOf(await listedHolidays(school.id), 1)
  })

  test('a range is renamed, resized and deleted as one group', async ({ client, assert }) => {
    const { school, manager } = await setupHolidaySchool()
    await client
      .post('/admin/holidays')
      .loginAs(manager)
      .json({ name: 'Spring break', startDate: '2027-04-05', endDate: '2027-04-09' })
      .withCsrfToken()
    const [first] = await listedHolidays(school.id)
    const groupId = first.groupId!

    await client
      .put(`/admin/holidays/groups/${groupId}`)
      .loginAs(manager)
      .json({ name: 'Spring holidays', startDate: '2027-04-07', endDate: '2027-04-13' })
      .withCsrfToken()
      .redirects(0)
    let rows = await listedHolidays(school.id)
    assert.deepEqual(
      rows.map((row) => [row.date, row.name, row.groupId]),
      [
        ['2027-04-07', 'Spring holidays', groupId],
        ['2027-04-08', 'Spring holidays', groupId],
        ['2027-04-09', 'Spring holidays', groupId],
        ['2027-04-12', 'Spring holidays', groupId],
        ['2027-04-13', 'Spring holidays', groupId],
      ]
    )

    await client
      .post(`/admin/holidays/groups/${groupId}/toggle`)
      .loginAs(manager)
      .json({ active: false })
      .withCsrfToken()
    rows = await listedHolidays(school.id)
    assert.isTrue(rows.every((row) => !row.isActive))

    await client
      .delete(`/admin/holidays/groups/${groupId}`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    assert.lengthOf(
      await Holiday.query().where('school_id', school.id),
      0,
      'manual rows hard-deleted'
    )
  })

  test('rename, move, disable and enable a single holiday', async ({ client, assert }) => {
    const { school, manager } = await setupHolidaySchool()
    await generateHolidays(school)
    await client
      .post('/admin/holidays')
      .loginAs(manager)
      .json({ name: 'Teacher day', startDate: '2026-10-09' })
      .withCsrfToken()
    const manual = await Holiday.findByOrFail('name', 'Teacher day')
    const generated = await Holiday.findByOrFail('rule_key', 'us_columbus_day_2026')

    await client
      .put(`/admin/holidays/${manual.id}`)
      .loginAs(manager)
      .json({ name: 'Staff day', date: '2026-10-16' })
      .withCsrfToken()
    await manual.refresh()
    assert.equal(manual.name, 'Staff day')
    assert.equal(manual.date, '2026-10-16')

    // A generated day can be renamed, never moved.
    await client
      .put(`/admin/holidays/${generated.id}`)
      .loginAs(manager)
      .json({ name: "Indigenous Peoples' Day", date: '2026-10-13' })
      .withCsrfToken()
    await generated.refresh()
    assert.equal(generated.name, "Indigenous Peoples' Day")
    assert.equal(generated.date, '2026-10-12')

    const calendar = await app.container.make(HolidayCalendar)
    await client
      .post(`/admin/holidays/${generated.id}/toggle`)
      .loginAs(manager)
      .json({ active: false })
      .withCsrfToken()
    assert.isFalse(await calendar.isHoliday(school.id, '2026-10-12'))
    await client
      .post(`/admin/holidays/${generated.id}/toggle`)
      .loginAs(manager)
      .json({ active: true })
      .withCsrfToken()
    assert.isTrue(await calendar.isHoliday(school.id, '2026-10-12'))
  })

  test('a duplicate name on the same date is refused', async ({ client, assert }) => {
    const { school, manager } = await setupHolidaySchool()
    for (let i = 0; i < 2; i++) {
      const response = await client
        .post('/admin/holidays')
        .loginAs(manager)
        .json({ name: 'Teacher day', startDate: '2026-10-09' })
        .withCsrfToken()
        .redirects(0)
      if (i === 1) assert.property(inputErrors(response), 'name')
    }
    assert.lengthOf(await listedHolidays(school.id), 1)
  })

  test('the generate button creates the year holidays and is idempotent', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupHolidaySchool()
    for (let i = 0; i < 2; i++) {
      const response = await client
        .post('/admin/holidays/generate')
        .loginAs(manager)
        .json({})
        .withCsrfToken()
        .redirects(0)
      response.assertStatus(302)
    }
    assert.lengthOf(await Holiday.query().where('school_id', school.id), 11)
  })

  test('index renders the calendar and the list', async ({ client, assert }) => {
    const { school, manager } = await setupHolidaySchool()
    await generateHolidays(school)

    const calendar = await client
      .get('/admin/holidays?view=calendar&month=2026-11')
      .loginAs(manager)
      .withInertia()
    calendar.assertStatus(200)
    calendar.assertInertiaComponent('admin/holidays/index')
    const props = calendar.inertiaProps as any
    assert.deepEqual(
      props.calendar.rows.map((row: any) => row.date),
      ['2026-11-11', '2026-11-26', '2026-11-27']
    )
    assert.equal(props.school.schoolYearLabel, '2026–2027')
    assert.isFalse(props.settings.canConfigure, 'manager cannot switch the Moroccan generator')

    const list = await client
      .get('/admin/holidays?view=list&source=auto_us&q=thanks')
      .loginAs(manager)
      .withInertia()
    const listProps = list.inertiaProps as any
    assert.deepEqual(
      listProps.list.entries.map((entry: any) => entry.name),
      ['Thanksgiving', 'Lendemain de Thanksgiving']
    )
    assert.equal(listProps.list.meta.total, 2)

    // Invalid query values fall back to defaults instead of failing.
    const invalid = await client
      .get('/admin/holidays?view=nope&month=2026-13&page=-1')
      .loginAs(manager)
      .withInertia()
    invalid.assertStatus(200)
  })

  test('only an admin switches the Moroccan generator', async ({ client, assert }) => {
    const { school, manager, admin } = await setupHolidaySchool()
    await client
      .put('/admin/holidays/settings')
      .loginAs(manager)
      .json({ generateMoroccanHolidays: true })
      .withCsrfToken()
      .redirects(0)
    await school.refresh()
    assert.notProperty(school.settings, 'generate_moroccan_holidays')

    await client
      .put('/admin/holidays/settings')
      .loginAs(admin)
      .json({ generateMoroccanHolidays: true })
      .withCsrfToken()
      .redirects(0)
    await school.refresh()
    assert.isTrue(school.settings.generate_moroccan_holidays)
  })
})

test.group('Holidays | impact on existing orders', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('without orders on the dates nothing asks for confirmation', async ({ client, assert }) => {
    const { school, manager } = await setupHolidaySchool()
    const response = await client
      .post('/admin/holidays')
      .loginAs(manager)
      .json({ name: 'Teacher day', startDate: '2026-10-09' })
      .withCsrfToken()
      .redirects(0)
    assert.notProperty(inputErrors(response), 'confirmImpact')
    assert.lengthOf(await listedHolidays(school.id), 1)
  })

  test('with affected orders, nothing is saved until confirmed; then they are cancelled', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupHolidaySchool()
    const impact = fakeImpact(3)
    try {
      const refused = await client
        .post('/admin/holidays')
        .loginAs(manager)
        .json({ name: 'Snow day', startDate: '2027-02-03', endDate: '2027-02-04' })
        .withCsrfToken()
        .redirects(0)
      const errors = inputErrors(refused)
      assert.property(errors, 'confirmImpact')
      assert.include(String(errors.confirmImpact), '3')
      // The count the dialog replays as confirmedCount.
      assert.equal(String(errors.confirmedCount), '3')
      assert.lengthOf(await listedHolidays(school.id), 0)
      assert.lengthOf(impact.cancelled, 0)

      await client
        .post('/admin/holidays')
        .loginAs(manager)
        .json({
          name: 'Snow day',
          startDate: '2027-02-03',
          endDate: '2027-02-04',
          confirmImpact: true,
          confirmedCount: 3,
        })
        .withCsrfToken()
        .redirects(0)
      assert.lengthOf(await listedHolidays(school.id), 2)
      assert.deepEqual(impact.cancelled, [['2027-02-03', '2027-02-04']])

      // Re-enabling a disabled day also asks first.
      const [row] = await listedHolidays(school.id)
      row.isActive = false
      await row.save()
      const toggle = await client
        .post(`/admin/holidays/${row.id}/toggle`)
        .loginAs(manager)
        .json({ active: true })
        .withCsrfToken()
        .redirects(0)
      assert.property(inputErrors(toggle), 'confirmImpact')
      await row.refresh()
      assert.isFalse(row.isActive)

      // Generation asks too.
      const generate = await client
        .post('/admin/holidays/generate')
        .loginAs(manager)
        .json({})
        .withCsrfToken()
        .redirects(0)
      assert.property(inputErrors(generate), 'confirmImpact')
      assert.lengthOf(await Holiday.query().where('source', 'auto_us'), 0)
    } finally {
      impact.restore()
    }
  })

  test('a date already closed by another holiday is not counted again', async ({ assert }) => {
    const { school } = await setupHolidaySchool()
    await generateHolidays(school)
    const impact = fakeImpact(5)
    try {
      const { default: HolidayService } = await import('#services/holiday_service')
      const service = await app.container.make(HolidayService)
      const result = await service
        .createManual(school, {
          name: 'Thanksgiving break',
          startDate: '2026-11-25',
          endDate: '2026-11-27',
        })
        .catch((error) => error)
      // Only 25 Nov is newly closed (26–27 are generated holidays): still needs confirmation.
      assert.equal(result.messageKey, 'holidays.impact.confirm')
      await service.createManual(
        school,
        { name: 'Thanksgiving break', startDate: '2026-11-25', endDate: '2026-11-27' },
        { confirmImpact: true }
      )
      assert.deepEqual(impact.cancelled, [['2026-11-25']])
    } finally {
      impact.restore()
    }
  })
})

test.group('Holidays | ICS import', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    return async () => {
      app.container.restore(SafeHttpFetcher)
      await truncate()
    }
  })

  async function uploadFixture(client: any, user: any) {
    const response = await client
      .post('/admin/holidays/import')
      .loginAs(user)
      .withCsrfToken()
      .file('calendar', await fixture(), { filename: 'school.ics' })
      .redirects(0)
    response.assertStatus(302)
    const location = response.header('location') as string
    return location.split('/').pop()!
  }

  test('preview shows all-day events as ranges, then imports only checked rows', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupHolidaySchool({ start: '2026-08-24', end: '2027-06-11' })
    await generateHolidays(school)
    const importId = await uploadFixture(client, manager)

    const preview = await client
      .get(`/admin/holidays/import/${importId}`)
      .loginAs(manager)
      .withInertia()
    preview.assertInertiaComponent('admin/holidays/import')
    const ranges = (preview.inertiaProps as any).preview.ranges as any[]
    assert.deepEqual(
      ranges.map((r) => [r.name, r.startDate, r.endDate, r.schoolDays, r.status]),
      [
        ['Professional Development Day', '2026-10-02', '2026-10-02', 1, 'new'],
        ['Teacher Work Day <script>alert(1)</script>', '2026-10-09', '2026-10-09', 1, 'new'],
        ['Professional Development Day', '2026-12-02', '2026-12-02', 1, 'new'],
        // Overlaps the generated Christmas and New Year's Day → flagged and unticked.
        ['Winter Break', '2026-12-21', '2027-01-01', 10, 'overlap'],
        ['Spring Break', '2027-04-05', '2027-04-09', 5, 'new'],
      ]
    )
    const winter = ranges.find((r) => r.name === 'Winter Break')
    assert.deepEqual(winter.overlaps, ["Jour de l'An", 'Noël'])
    assert.isFalse(winter.selected)
    assert.lengthOf(await Holiday.query().where('source', 'import'), 0, 'preview saves nothing')

    const spring = ranges.find((r) => r.name === 'Spring Break')
    const confirm = await client
      .post(`/admin/holidays/import/${importId}/confirm`)
      .loginAs(manager)
      .json({ ranges: [spring.key, winter.key] })
      .withCsrfToken()
      .redirects(0)
    confirm.assertStatus(302)
    const imported = await Holiday.query().where('source', 'import').orderBy('date')
    assert.lengthOf(imported, 15)
    assert.isTrue(imported.every((row) => row.ruleKey!.startsWith('ics:')))
    assert.lengthOf(new Set(imported.map((row) => row.groupId)), 2)
    assert.notInclude(
      imported.map((row) => row.name),
      'Professional Development Day'
    )
  })

  test('re-importing the same file creates nothing; deleted imports stay deleted', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupHolidaySchool({ start: '2026-08-24', end: '2027-06-11' })
    const first = await uploadFixture(client, manager)
    const preview = await client
      .get(`/admin/holidays/import/${first}`)
      .loginAs(manager)
      .withInertia()
    const keys = ((preview.inertiaProps as any).preview.ranges as any[]).map((r) => r.key)
    await client
      .post(`/admin/holidays/import/${first}/confirm`)
      .loginAs(manager)
      .json({ ranges: keys })
      .withCsrfToken()
    const saved = await Holiday.query().where('school_id', school.id)
    const count = saved.length
    assert.equal(count, 1 + 1 + 1 + 10 + 5)

    // Delete the spring break group (tombstones).
    const spring = await Holiday.query().where('name', 'Spring Break').firstOrFail()
    await client.delete(`/admin/holidays/groups/${spring.groupId}`).loginAs(manager).withCsrfToken()

    const second = await uploadFixture(client, manager)
    const again = await client
      .get(`/admin/holidays/import/${second}`)
      .loginAs(manager)
      .withInertia()
    const ranges = (again.inertiaProps as any).preview.ranges as any[]
    assert.isTrue(ranges.every((r) => r.status === 'imported' && !r.selected))
    await client
      .post(`/admin/holidays/import/${second}/confirm`)
      .loginAs(manager)
      .json({ ranges: ranges.map((r) => r.key) })
      .withCsrfToken()
    assert.lengthOf(await Holiday.query().where('school_id', school.id), count)
    assert.lengthOf(await listedHolidays(school.id), count - 5)
  })

  test('a file that is not a calendar is refused before being stored', async ({
    client,
    assert,
  }) => {
    const { manager } = await setupHolidaySchool()
    for (const body of ['name,date\nx,y', 'Hello, this is not a calendar.']) {
      const response = await client
        .post('/admin/holidays/import')
        .loginAs(manager)
        .withCsrfToken()
        .file('calendar', Buffer.from(body), { filename: 'fake.ics' })
        .redirects(0)
      response.assertStatus(302)
      assert.notMatch(String(response.header('location')), /import\/[0-9a-f-]{36}/)
      assert.property(inputErrors(response), 'calendar')
    }
  })

  test('an import id is bound to its uploader', async ({ client }) => {
    const { manager, admin } = await setupHolidaySchool()
    const importId = await uploadFixture(client, manager)
    const response = await client
      .get(`/admin/holidays/import/${importId}`)
      .loginAs(admin)
      .redirects(0)
    response.assertStatus(302)
    response.assertHeader('location', '/admin/holidays/import')
  })

  test('URL import goes through the SSRF guard', async ({ client, assert }) => {
    const { manager } = await setupHolidaySchool({ start: '2026-08-24', end: '2027-06-11' })
    const calls: string[] = []
    const transport: Transport = async (url) => {
      calls.push(url.toString())
      return { status: 200, headers: {}, body: Readable.from([await fixture()]) }
    }
    app.container.swap(
      SafeHttpFetcher,
      () =>
        new SafeHttpFetcher(async (host) => {
          if (host === 'calendar.example.org') return [{ address: '93.184.215.14', family: 4 }]
          return [{ address: '10.0.0.8', family: 4 }]
        }, transport)
    )

    for (const url of [
      'http://calendar.example.org/a.ics',
      'https://127.0.0.1/a.ics',
      'https://169.254.169.254/latest/meta-data/',
      'https://intranet.example.org/a.ics',
    ]) {
      const refused = await client
        .post('/admin/holidays/import/url')
        .loginAs(manager)
        .json({ url })
        .withCsrfToken()
        .redirects(0)
      refused.assertStatus(302)
      assert.property(inputErrors(refused), 'url', url)
    }
    assert.lengthOf(calls, 0)

    const ok = await client
      .post('/admin/holidays/import/url')
      .loginAs(manager)
      .json({ url: 'https://calendar.example.org/school.ics' })
      .withCsrfToken()
      .redirects(0)
    assert.match(String(ok.header('location')), /^\/admin\/holidays\/import\/[0-9a-f-]{36}$/)
    assert.deepEqual(calls, ['https://calendar.example.org/school.ics'])
    assert.isNotNull(await School.query().first())
  })
})
