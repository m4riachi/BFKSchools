import { test } from '@japa/runner'
import {
  addDays,
  atLocalTime,
  datesBetween,
  diffInDays,
  isIsoDate,
  isSchoolDay,
  isoWeekday,
  weekStart,
} from '#support/dates'

test.group('ISO date helpers', () => {
  test('validates ISO dates', ({ assert }) => {
    assert.isTrue(isIsoDate('2027-03-28'))
    assert.isFalse(isIsoDate('2027-02-30'))
    assert.isFalse(isIsoDate('2027-3-28'))
    assert.isFalse(isIsoDate('2027-03-28T00:00'))
    assert.isFalse(isIsoDate(20270328))
  })

  test('weeks start on Monday', ({ assert }) => {
    assert.equal(weekStart('2026-11-02'), '2026-11-02') // Monday
    assert.equal(weekStart('2026-11-08'), '2026-11-02') // Sunday
    assert.equal(weekStart('2027-01-01'), '2026-12-28') // across years
    assert.equal(isoWeekday('2026-11-08'), 7)
  })

  test('adds days without time-zone shifts (Ramadan/DST boundaries)', ({ assert }) => {
    assert.equal(addDays('2027-02-06', 1), '2027-02-07')
    assert.equal(addDays('2027-03-13', 2), '2027-03-15')
    assert.equal(addDays('2027-03-27', 1), '2027-03-28')
    assert.equal(addDays('2026-12-31', 1), '2027-01-01')
    assert.equal(addDays('2026-11-02', -1), '2026-11-01')
    assert.equal(diffInDays('2026-11-02', '2026-11-09'), 7)
  })

  test('lists dates between two days', ({ assert }) => {
    assert.deepEqual(datesBetween('2026-12-30', '2027-01-02'), [
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ])
  })

  test('isSchoolDay checks weekdays and the school year', ({ assert }) => {
    const calendar = {
      schoolDays: [1, 2, 3, 4, 5],
      schoolYearStart: '2026-08-24',
      schoolYearEnd: '2027-06-11',
    }
    assert.isTrue(isSchoolDay('2026-11-02', calendar))
    assert.isFalse(isSchoolDay('2026-11-07', calendar)) // Saturday
    assert.isFalse(isSchoolDay('2026-08-21', calendar)) // before the year
    assert.isFalse(isSchoolDay('2027-06-14', calendar)) // after the year
    assert.isTrue(isSchoolDay('2026-11-07', { schoolDays: [6] }))
  })

  test('atLocalTime keeps the wall-clock time on both sides of an offset change', ({ assert }) => {
    // tzdata 2026c: +01:00 on 2026-06-01, +00:00 after 2026-09-20 (permanent UTC+0)
    for (const day of ['2026-03-01', '2026-06-01', '2026-11-01', '2027-02-20']) {
      const value = atLocalTime(day, '20:00')
      assert.equal(value.toFormat('yyyy-MM-dd HH:mm'), `${day} 20:00`)
      assert.equal(value.zoneName, 'Africa/Casablanca')
    }
  })
})
