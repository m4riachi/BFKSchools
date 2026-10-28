import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import Holiday from '#models/holiday'
import Clock from '#services/clock'
import HolidayCalendar from '#services/holiday_calendar'
import { FrozenClock } from '#tests/helpers/clock'
import { generateHolidays, listedHolidays, setupHolidaySchool } from '#tests/helpers/holidays'

test.group('Holidays | QA edge cases', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('a winter break over generated Christmas/New Year days still has one row per school day', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupHolidaySchool()
    await generateHolidays(school)
    await client
      .post('/admin/holidays')
      .loginAs(manager)
      .json({ name: 'Winter break', startDate: '2026-12-21', endDate: '2027-01-01' })
      .withCsrfToken()
      .redirects(0)
    const rows = await Holiday.query()
      .where('school_id', school.id)
      .where('source', 'manual')
      .orderBy('date')
    assert.lengthOf(rows, 10)
    assert.lengthOf(new Set(rows.map((r) => r.groupId)), 1)
    const groupId = rows[0].groupId!

    // Rename as one group
    await client
      .put(`/admin/holidays/groups/${groupId}`)
      .loginAs(manager)
      .json({ name: 'Vacances d’hiver' })
      .withCsrfToken()
      .redirects(0)
    const renamed = await Holiday.query().where('group_id', groupId)
    assert.isTrue(renamed.every((r) => r.name === 'Vacances d’hiver'))

    // Delete as one group: manual rows are hard deleted, generated Christmas stays
    await client
      .delete(`/admin/holidays/groups/${groupId}`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    assert.lengthOf(
      await Holiday.query().where('group_id', groupId),
      0,
      'hard-deleted, no tombstone'
    )
    const calendar = await app.container.make(HolidayCalendar)
    assert.isTrue(await calendar.isHoliday(school.id, '2026-12-25'))
    assert.isFalse(await calendar.isHoliday(school.id, '2026-12-22'))
  })

  test('a range is clipped to the school year (days outside are not created)', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupHolidaySchool()
    await client
      .post('/admin/holidays')
      .loginAs(manager)
      .json({ name: 'Edge', startDate: '2026-08-27', endDate: '2026-09-02' })
      .withCsrfToken()
      .redirects(0)
    const listed = await listedHolidays(school.id)
    const dates = listed.map((r) => r.date)
    assert.deepEqual(dates, ['2026-09-01', '2026-09-02'])
  })

  test('tombstones do not block (date, name): re-adding a deleted generated holiday by hand works, and the generator still does not re-create it', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupHolidaySchool()
    await generateHolidays(school)
    const labor = await Holiday.findByOrFail('rule_key', 'us_labor_day_2026')
    await client.delete(`/admin/holidays/${labor.id}`).loginAs(manager).withCsrfToken().redirects(0)
    await labor.refresh()
    assert.isNotNull(labor.deletedAt)

    await client
      .post('/admin/holidays')
      .loginAs(manager)
      .json({ name: labor.name, startDate: '2026-09-07' })
      .withCsrfToken()
      .redirects(0)
    const rows = await Holiday.query().where('school_id', school.id).where('date', '2026-09-07')
    assert.lengthOf(rows, 2)
    assert.lengthOf(
      rows.filter((r) => r.deletedAt === null),
      1
    )

    const second = await generateHolidays(school)
    assert.equal(second.created, 0)
    assert.lengthOf(
      await Holiday.query().where('school_id', school.id).where('date', '2026-09-07'),
      2
    )
  })

  test('deleted_at uses the Clock (frozen), and the calendar opens on the Clock month', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupHolidaySchool()
    await generateHolidays(school)
    const clock = new FrozenClock('2026-11-20T09:00:00')
    app.container.swap(Clock, () => clock)
    try {
      const veterans = await Holiday.findByOrFail('rule_key', 'us_veterans_day_2026')
      await client
        .delete(`/admin/holidays/${veterans.id}`)
        .loginAs(manager)
        .withCsrfToken()
        .redirects(0)
      await veterans.refresh()
      assert.equal(veterans.deletedAt?.toISODate(), '2026-11-20')

      const page = await client
        .get('/admin/holidays')
        .loginAs(manager)
        .withInertia()
        .header('X-Inertia', 'true')
      const props = page.body().props ?? page.body()
      assert.equal(props.calendar.month, '2026-11')
    } finally {
      app.container.restore(Clock)
    }
  })

  test('Moroccan generator: switching it on adds auto_ma rows (school days only); off does not create more', async ({
    client,
    assert,
  }) => {
    const { school, admin } = await setupHolidaySchool()
    await generateHolidays(school)
    assert.lengthOf(await Holiday.query().where('source', 'auto_ma'), 0)
    await client
      .put('/admin/holidays/settings')
      .loginAs(admin)
      .json({ generateMoroccanHolidays: true })
      .withCsrfToken()
      .redirects(0)
    await client
      .post('/admin/holidays/generate')
      .loginAs(admin)
      .json({})
      .withCsrfToken()
      .redirects(0)
    const ma = await Holiday.query().where('source', 'auto_ma')
    assert.isAbove(ma.length, 0)
    for (const row of ma) {
      const dow = new Date(`${row.date}T12:00:00Z`).getUTCDay()
      assert.notInclude([0, 6], dow, `${row.date} is a weekend`)
      assert.isTrue(row.date >= school.schoolYearStart && row.date <= school.schoolYearEnd)
      assert.match(row.ruleKey!, /^ma_/)
    }
  })
})
