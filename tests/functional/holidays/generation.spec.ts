import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import ace from '@adonisjs/core/services/ace'
import testUtils from '@adonisjs/core/services/test_utils'
import Holiday from '#models/holiday'
import HolidayGeneratorService from '#services/holiday_generator_service'
import HolidayCalendar from '#services/holiday_calendar'
import HolidaysGenerate from '#commands/holidays_generate'
import { setupHolidaySchool, listedHolidays, generateHolidays } from '#tests/helpers/holidays'

const US_2026_2027 = [
  '2026-09-07',
  '2026-10-12',
  '2026-11-11',
  '2026-11-26',
  '2026-11-27',
  '2026-12-25',
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-05-31',
  '2027-06-18',
]

const US_2027_2028 = [
  '2027-09-06',
  '2027-10-11',
  '2027-11-11',
  '2027-11-25',
  '2027-11-26',
  '2027-12-24',
  '2027-12-31',
  '2028-01-17',
  '2028-02-21',
  '2028-05-29',
  '2028-06-19',
]

test.group('Holidays | generation', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  for (const [label, start, end, expected] of [
    ['2026–2027', '2026-09-01', '2027-06-30', US_2026_2027],
    ['2027–2028', '2027-09-01', '2028-06-30', US_2027_2028],
  ] as const) {
    test(`generates the US federal holidays of ${label} as auto_us rows`, async ({ assert }) => {
      const { school } = await setupHolidaySchool({ start, end })
      const generator = await app.container.make(HolidayGeneratorService)
      const result = await generator.generate(school)
      const rows = await listedHolidays(school.id)
      assert.deepEqual(
        rows.map((row) => row.date),
        [...expected]
      )
      assert.equal(result.created, expected.length)
      assert.isTrue(rows.every((row) => row.source === 'auto_us' && row.ruleKey?.startsWith('us_')))
      assert.isTrue(rows.every((row) => row.isActive && row.groupId === null))
    })
  }

  test('observed holidays are named as such', async ({ assert }) => {
    const { school } = await setupHolidaySchool({ start: '2027-09-01', end: '2028-06-30' })
    await generateHolidays(school)
    const christmas = await Holiday.findByOrFail('rule_key', 'us_christmas_2027')
    assert.equal(christmas.date, '2027-12-24')
    assert.equal(christmas.name, 'Noël (observé)')
    const thanksgivingFriday = await Holiday.findByOrFail('rule_key', 'us_thanksgiving_friday_2027')
    assert.equal(thanksgivingFriday.name, 'Lendemain de Thanksgiving')
  })

  test('only school days inside the school year are generated', async ({ assert }) => {
    // Seeded-like year: ends 11 June → no Juneteenth; Mon–Thu school → no Thanksgiving Friday.
    const { school } = await setupHolidaySchool({ start: '2026-08-24', end: '2027-06-11' })
    school.schoolDays = [1, 2, 3, 4]
    await school.save()
    await generateHolidays(school)
    const listed = await listedHolidays(school.id)
    const dates = listed.map((row) => row.date)
    assert.notInclude(dates, '2027-06-18')
    assert.notInclude(dates, '2026-11-27') // Friday
    assert.notInclude(dates, '2026-12-25') // Friday
    assert.notInclude(dates, '2027-01-01') // Friday
    assert.include(dates, '2026-11-26')
    assert.isTrue(dates.every((date) => date >= '2026-08-24' && date <= '2027-06-11'))
  })

  test('generating twice creates no duplicates', async ({ assert }) => {
    const { school } = await setupHolidaySchool()
    const generator = await app.container.make(HolidayGeneratorService)
    await generator.generate(school)
    const second = await generator.generate(school)
    assert.equal(second.created, 0)
    assert.equal(second.skipped, US_2026_2027.length)
    assert.lengthOf(await Holiday.query().where('school_id', school.id), US_2026_2027.length)
  })

  test('a disabled or deleted generated holiday is not re-created', async ({ assert, client }) => {
    const { school, manager } = await setupHolidaySchool()
    const generator = await app.container.make(HolidayGeneratorService)
    await generator.generate(school)

    const veterans = await Holiday.findByOrFail('rule_key', 'us_veterans_day_2026')
    const labor = await Holiday.findByOrFail('rule_key', 'us_labor_day_2026')
    await client
      .post(`/admin/holidays/${veterans.id}/toggle`)
      .loginAs(manager)
      .json({ active: false })
      .withCsrfToken()
      .redirects(0)
    await client.delete(`/admin/holidays/${labor.id}`).loginAs(manager).withCsrfToken().redirects(0)

    const result = await generator.generate(school)
    assert.equal(result.created, 0)
    await veterans.refresh()
    assert.isFalse(veterans.isActive)
    await labor.refresh()
    assert.isNotNull(labor.deletedAt, 'tombstone kept')
    assert.lengthOf(
      await Holiday.query().where('school_id', school.id).where('date', '2026-09-07'),
      1
    )
    const calendar = await app.container.make(HolidayCalendar)
    assert.isFalse(await calendar.isHoliday(school.id, '2026-09-07'))
    assert.isFalse(await calendar.isHoliday(school.id, '2026-11-11'))
  })

  test('Moroccan holidays: none while the setting is off, fixed dates when on', async ({
    assert,
  }) => {
    const { school } = await setupHolidaySchool()
    const generator = await app.container.make(HolidayGeneratorService)
    await generator.generate(school)
    assert.lengthOf(await Holiday.query().where('source', 'auto_ma'), 0)

    school.settings = { generate_moroccan_holidays: true }
    await school.save()
    const result = await generator.generate(school)
    assert.isTrue(result.moroccan)
    const moroccan = await Holiday.query().where('source', 'auto_ma').orderBy('date')
    // School days only: 31 Oct 2026 and 1 May 2027 are Saturdays.
    assert.deepEqual(
      moroccan.map((row) => row.date),
      ['2026-11-06', '2026-11-18', '2027-01-01', '2027-01-11', '2027-01-14']
    )
    assert.equal(moroccan[0].ruleKey, 'ma_green_march_2026')
    // 1 Jan 2027 carries both the US and the Moroccan row (different names, one closed day).
    assert.lengthOf(await Holiday.query().where('date', '2027-01-01'), 2)
  })

  test('holidays:generate command runs every school, idempotently', async ({ assert }) => {
    const { school } = await setupHolidaySchool()
    const other = await setupHolidaySchool({ start: '2027-09-01', end: '2028-06-30' })

    const command = await ace.create(HolidaysGenerate, [])
    await command.exec()
    command.assertSucceeded()
    assert.lengthOf(await listedHolidays(school.id), US_2026_2027.length)
    assert.lengthOf(await listedHolidays(other.school.id), US_2027_2028.length)

    const again = await ace.create(HolidaysGenerate, [`--school=${school.id}`])
    await again.exec()
    again.assertSucceeded()
    assert.lengthOf(await Holiday.query().where('school_id', school.id), US_2026_2027.length)
  })

  test('read API: isHoliday and holidaysBetween only see enabled, not deleted rows', async ({
    assert,
  }) => {
    const { school } = await setupHolidaySchool()
    const other = await setupHolidaySchool()
    await generateHolidays(school)
    const calendar = await app.container.make(HolidayCalendar)

    assert.isTrue(await calendar.isHoliday(school.id, '2026-11-26'))
    assert.isFalse(await calendar.isHoliday(school.id, '2026-11-25'))
    assert.isFalse(await calendar.isHoliday(other.school.id, '2026-11-26'), 'per school')

    const november = await calendar.holidaysBetween(school.id, '2026-11-01', '2026-11-30')
    assert.deepEqual(
      november.map((h) => [h.date, h.name]),
      [
        ['2026-11-11', 'Veterans Day'],
        ['2026-11-26', 'Thanksgiving'],
        ['2026-11-27', 'Lendemain de Thanksgiving'],
      ]
    )
    assert.deepEqual(await calendar.holidaysBetween(school.id, '2026-11-30', '2026-11-01'), [])
    await assert.rejects(() => calendar.isHoliday(school.id, '2026-13-01'))
  })
})
