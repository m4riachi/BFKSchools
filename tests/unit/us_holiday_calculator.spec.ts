import { test } from '@japa/runner'
import {
  fixedDate,
  lastWeekdayOfMonth,
  moroccanFixedHolidays,
  moroccanFixedHolidaysBetween,
  nthWeekdayOfMonth,
  observedDate,
  usFederalHolidays,
  usFederalHolidaysBetween,
} from '#services/us_holiday_calculator'

/**
 * Brief §7: assert the computed dates for 2026–2027 and 2027–2028
 * (verified table from the bfk-holidays agent file). School year 1 Sep → 30 Jun.
 */
const EXPECTED: Record<string, Record<string, string>> = {
  '2026-2027': {
    labor_day: '2026-09-07',
    columbus_day: '2026-10-12',
    veterans_day: '2026-11-11',
    thanksgiving: '2026-11-26',
    thanksgiving_friday: '2026-11-27',
    christmas: '2026-12-25',
    new_year: '2027-01-01',
    mlk_day: '2027-01-18',
    presidents_day: '2027-02-15',
    memorial_day: '2027-05-31',
    juneteenth: '2027-06-18', // Sat 2027-06-19 → observed Friday
  },
  '2027-2028': {
    labor_day: '2027-09-06',
    columbus_day: '2027-10-11',
    veterans_day: '2027-11-11',
    thanksgiving: '2027-11-25',
    thanksgiving_friday: '2027-11-26',
    christmas: '2027-12-24', // Sat 2027-12-25 → observed Friday
    new_year: '2027-12-31', // Sat 2028-01-01 → observed Friday 31 Dec 2027
    mlk_day: '2028-01-17',
    presidents_day: '2028-02-21',
    memorial_day: '2028-05-29',
    juneteenth: '2028-06-19',
  },
}

test.group('UsHolidayCalculator | helpers', () => {
  test('nth weekday of a month', ({ assert }) => {
    assert.equal(nthWeekdayOfMonth(2026, 9, 1, 1), '2026-09-07') // 1st Monday of Sept
    assert.equal(nthWeekdayOfMonth(2026, 11, 4, 4), '2026-11-26') // 4th Thursday of Nov
    assert.equal(nthWeekdayOfMonth(2027, 1, 1, 3), '2027-01-18') // 3rd Monday of Jan
    assert.equal(nthWeekdayOfMonth(2026, 10, 4, 1), '2026-10-01') // month starting on that weekday
    assert.throws(() => nthWeekdayOfMonth(2027, 2, 1, 5)) // Feb 2027 has 4 Mondays
  })

  test('last weekday of a month', ({ assert }) => {
    assert.equal(lastWeekdayOfMonth(2027, 5, 1), '2027-05-31') // month ending on Monday
    assert.equal(lastWeekdayOfMonth(2028, 5, 1), '2028-05-29')
    assert.equal(lastWeekdayOfMonth(2028, 2, 2), '2028-02-29') // leap year
  })

  test('fixed dates are validated', ({ assert }) => {
    assert.equal(fixedDate(2027, 6, 19), '2027-06-19')
    assert.throws(() => fixedDate(2027, 2, 29))
  })

  test('observed rule: Saturday → Friday, Sunday → Monday, weekday unchanged', ({ assert }) => {
    assert.equal(observedDate('2027-12-25'), '2027-12-24') // Saturday
    assert.equal(observedDate('2028-01-01'), '2027-12-31') // Saturday across a year
    assert.equal(observedDate('2026-07-05'), '2026-07-06') // Sunday
    assert.equal(observedDate('2026-11-11'), '2026-11-11') // Wednesday
  })
})

test.group('UsHolidayCalculator | school years', () => {
  for (const [label, expected] of Object.entries(EXPECTED)) {
    test('US federal holidays of school year {$self}')
      .with([label])
      .run(({ assert }, schoolYear) => {
        const [start] = schoolYear.split('-')
        const holidays = usFederalHolidaysBetween(`${start}-09-01`, `${Number(start) + 1}-06-30`)
        const computed = Object.fromEntries(holidays.map((h) => [h.code, h.date]))
        assert.deepEqual(computed, expected)
        // Rule keys carry the year of the holiday itself.
        assert.lengthOf(new Set(holidays.map((h) => h.ruleKey)), holidays.length)
      })
  }

  test('observed holidays keep the actual date and their own year in the rule key', ({
    assert,
  }) => {
    const holidays = usFederalHolidaysBetween('2027-09-01', '2028-06-30')
    const newYear = holidays.find((h) => h.code === 'new_year')!
    assert.equal(newYear.ruleKey, 'us_new_year_2028')
    assert.equal(newYear.actualDate, '2028-01-01')
    assert.isTrue(newYear.observed)
    const christmas = holidays.find((h) => h.code === 'christmas')!
    assert.equal(christmas.ruleKey, 'us_christmas_2027')
    assert.isTrue(christmas.observed)
    const labor = holidays.find((h) => h.code === 'labor_day')!
    assert.isFalse(labor.observed)
  })

  test('the range bounds are inclusive and nothing outside them is returned', ({ assert }) => {
    const holidays = usFederalHolidaysBetween('2026-09-07', '2026-09-07')
    assert.deepEqual(
      holidays.map((h) => h.code),
      ['labor_day']
    )
    for (const h of usFederalHolidays(2030)) assert.match(h.date, /^20(29|30|31)-/)
  })
})

test.group('Moroccan fixed-date holidays', () => {
  test('11 fixed dates from 2026, no observed rule', ({ assert }) => {
    const list = moroccanFixedHolidays(2026)
    assert.deepEqual(
      list.map((h) => h.date),
      [
        '2026-01-01',
        '2026-01-11',
        '2026-01-14',
        '2026-05-01',
        '2026-07-30',
        '2026-08-14',
        '2026-08-20',
        '2026-08-21',
        '2026-10-31', // Saturday: kept as is (no observed rule in Morocco)
        '2026-11-06',
        '2026-11-18',
      ]
    )
    assert.isTrue(list.every((h) => !h.observed && h.ruleKey.startsWith('ma_')))
  })

  test('Fête de l’Unité only exists from 2026', ({ assert }) => {
    assert.notInclude(
      moroccanFixedHolidays(2025).map((h) => h.code),
      'unity_day'
    )
    assert.include(
      moroccanFixedHolidaysBetween('2027-09-01', '2028-06-30').map((h) => h.ruleKey),
      'ma_unity_day_2027'
    )
  })
})
