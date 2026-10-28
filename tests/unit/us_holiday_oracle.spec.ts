import { test } from '@japa/runner'
import { usFederalHolidays, usFederalHolidaysBetween } from '#services/us_holiday_calculator'
// @ts-expect-error TS6305: inertia/ is a separate tsconfig project (not built for the server project)
import { useImpactConfirm } from '../../inertia/composables/use_impact_confirm.js'

/**
 * QA oracle: US federal holidays recomputed with a different algorithm
 * (day counting from Jan 1 with Date.UTC, no shared helpers) for 2026-2035,
 * compared with UsHolidayCalculator.
 */
const iso = (d: Date) => d.toISOString().slice(0, 10)
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000)

/** Nth (1-based) given JS weekday (0=Sun) of a month. */
function nth(y: number, m: number, dow: number, n: number) {
  let count = 0
  for (let day = 1; day <= 31; day++) {
    const d = utc(y, m, day)
    if (d.getUTCMonth() !== m - 1) break
    if (d.getUTCDay() === dow && ++count === n) return d
  }
  throw new Error('no such day')
}
function lastOf(y: number, m: number, dow: number) {
  for (let day = 31; day >= 1; day--) {
    const d = utc(y, m, day)
    if (d.getUTCMonth() === m - 1 && d.getUTCDay() === dow) return d
  }
  throw new Error('no such day')
}
const observed = (d: Date) =>
  d.getUTCDay() === 6 ? addDays(d, -1) : d.getUTCDay() === 0 ? addDays(d, 1) : d

function oracle(y: number): Record<string, string> {
  const tg = nth(y, 11, 4, 4)
  return {
    new_year: iso(observed(utc(y, 1, 1))),
    mlk_day: iso(nth(y, 1, 1, 3)),
    presidents_day: iso(nth(y, 2, 1, 3)),
    memorial_day: iso(lastOf(y, 5, 1)),
    juneteenth: iso(observed(utc(y, 6, 19))),
    labor_day: iso(nth(y, 9, 1, 1)),
    columbus_day: iso(nth(y, 10, 1, 2)),
    veterans_day: iso(observed(utc(y, 11, 11))),
    thanksgiving: iso(tg),
    thanksgiving_friday: iso(addDays(tg, 1)),
    christmas: iso(observed(utc(y, 12, 25))),
  }
}

test.group('UsHolidayCalculator | independent oracle', () => {
  for (let year = 2026; year <= 2035; year++) {
    test(`calendar year ${year} matches an independent computation`, ({ assert }) => {
      const expected = oracle(year)
      const actual = Object.fromEntries(
        usFederalHolidays(year)
          // New Year observed on 31 Dec of year-1 is returned for the previous-year query only
          .map((h) => [h.code, h.date])
      )
      assert.deepEqual(actual, expected)
    })
  }

  test('explicit independent tables for 2026-2027 and 2027-2028 (hand computed)', ({ assert }) => {
    const codes = (from: string, to: string) =>
      usFederalHolidaysBetween(from, to).map((h) => `${h.date} ${h.code}`)
    assert.deepEqual(codes('2026-09-01', '2027-06-30'), [
      '2026-09-07 labor_day',
      '2026-10-12 columbus_day',
      '2026-11-11 veterans_day',
      '2026-11-26 thanksgiving',
      '2026-11-27 thanksgiving_friday',
      '2026-12-25 christmas',
      '2027-01-01 new_year',
      '2027-01-18 mlk_day',
      '2027-02-15 presidents_day',
      '2027-05-31 memorial_day',
      '2027-06-18 juneteenth',
    ])
    assert.deepEqual(codes('2027-09-01', '2028-06-30'), [
      '2027-09-06 labor_day',
      '2027-10-11 columbus_day',
      '2027-11-11 veterans_day',
      '2027-11-25 thanksgiving',
      '2027-11-26 thanksgiving_friday',
      '2027-12-24 christmas',
      '2027-12-31 new_year',
      '2028-01-17 mlk_day',
      '2028-02-21 presidents_day',
      '2028-05-29 memorial_day',
      '2028-06-19 juneteenth',
    ])
  })
})

test.group('useImpactConfirm | confirmation step (mocked server answer)', () => {
  test('opens the confirmation only when the server returned a confirmImpact error', ({
    assert,
  }) => {
    const c = useImpactConfirm()
    let replays = 0
    assert.isFalse(c.handle({ name: 'Required' }, () => replays++))
    assert.isFalse(c.open.value)

    assert.isTrue(c.handle({ confirmImpact: '3 commandes seront annulées' }, () => replays++))
    assert.isTrue(c.open.value)
    assert.equal(c.message.value, '3 commandes seront annulées')
    assert.equal(replays, 0, 'nothing replayed before the admin confirms')

    c.confirm()
    assert.isFalse(c.open.value)
    assert.equal(replays, 1)
    c.confirm()
    assert.equal(replays, 1, 'a second confirm does not replay again')
  })
})
