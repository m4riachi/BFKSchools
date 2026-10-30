import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { APP_TIMEZONE, zoneOffsets } from '#support/time'

test.group('Casablanca time', () => {
  test('Morocco is on UTC since 20 Sep 2026 (needs up-to-date time zone data)', ({ assert }) => {
    const at = (iso: string) => DateTime.fromISO(iso, { zone: APP_TIMEZONE }).offset
    assert.equal(at('2026-06-15T12:00:00Z'), 60)
    assert.equal(at('2026-10-30T12:00:00Z'), 0)
    assert.equal(at('2027-06-15T12:00:00Z'), 0)
    assert.equal(
      DateTime.fromISO('2026-11-01T20:00', { zone: APP_TIMEZONE }).toUTC().toISO(),
      '2026-11-01T20:00:00.000Z'
    )
  })

  test('the table for the browser has the exact moment of each change', ({ assert }) => {
    const table = zoneOffsets()
    const last = table[table.length - 1]
    assert.equal(last.fromMs, Date.UTC(2026, 8, 20, 1, 0))
    assert.equal(last.offsetMinutes, 0)
    assert.equal(table[table.length - 2].offsetMinutes, 60)
    for (const entry of table) {
      assert.equal(
        DateTime.fromMillis(entry.fromMs, { zone: APP_TIMEZONE }).offset,
        entry.offsetMinutes
      )
    }
  })
})
