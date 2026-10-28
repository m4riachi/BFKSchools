import { test } from '@japa/runner'
import { readFile } from 'node:fs/promises'
import IcsParser, { IcsInvalidError, parseIcs } from '#services/ics_parser'
import { ICS_IMPORT } from '#config/holidays'

async function fixture() {
  const buffer = await readFile(
    new URL('../fixtures/holidays/school_calendar.ics', import.meta.url)
  )
  return buffer.toString('utf8')
}

function calendar(events: string[]) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n')
}

function recurring(i: number, rule: string, begin = 'BEGIN:VEVENT') {
  return [
    begin,
    `UID:u${i}`,
    'DTSTAMP:20260801T120000Z',
    'DTSTART;VALUE=DATE:20260901',
    `RRULE:${rule}`,
    `SUMMARY:s${i}`,
    'END:VEVENT',
  ].join('\r\n')
}

async function reason(promise: Promise<unknown>) {
  try {
    await promise
    return 'ok'
  } catch (error) {
    if (error instanceof IcsInvalidError) return error.reason
    throw error
  }
}

const HOURS = Array.from({ length: 24 }, (_, i) => i).join(',')
const MINUTES = Array.from({ length: 60 }, (_, i) => i).join(',')
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1).join(',')

test.group('ICS parser | worker thread', () => {
  test('the worker returns the same result as an in-process parse', async ({ assert }) => {
    const content = await fixture()
    const viaWorker = await new IcsParser().parse(content, '2026-08-24', '2027-06-11')
    assert.deepEqual(viaWorker, parseIcs(content, '2026-08-24', '2027-06-11'))
  })

  test('a file of many fail.ts-style events is handled quickly', async ({ assert }) => {
    const rules = [
      `FREQ=DAILY;BYHOUR=${HOURS};BYMINUTE=${MINUTES};BYSECOND=${MINUTES}`,
      `FREQ=YEARLY;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12;BYMONTHDAY=${MONTH_DAYS};BYHOUR=${HOURS};BYMINUTE=${MINUTES};BYSECOND=${MINUTES}`,
      'FREQ=SECONDLY',
      `FREQ=MINUTELY;BYSECOND=${MINUTES}`,
    ]
    const events = Array.from({ length: 300 }, (_, i) =>
      recurring(i, rules[i % rules.length], 'BEGIN;X=1:VEVENT')
    )
    const content = calendar(events)
    assert.isBelow(Buffer.byteLength(content), ICS_IMPORT.maxBytes)
    const started = performance.now()
    const result = await new IcsParser().parse(content, '2026-09-01', '2027-06-30')
    assert.isBelow(performance.now() - started, 3000)
    assert.lengthOf(result.ranges, 0)
    assert.lengthOf(result.ignored, 300)
  })

  test('the timeout terminates the worker and refuses the file as too complex', async ({
    assert,
  }) => {
    const started = performance.now()
    assert.equal(
      await reason(
        new IcsParser({ timeoutMs: 5 }).parse(await fixture(), '2026-08-24', '2027-06-11')
      ),
      'too_complex'
    )
    assert.isBelow(performance.now() - started, 1000)
  })

  test('the memory limit kills the worker and refuses the file as too complex', async ({
    assert,
  }) => {
    // ~1 MB of events with long properties under a tiny heap.
    const filler = 'x'.repeat(900)
    const events: string[] = []
    while (events.join('').length < ICS_IMPORT.maxBytes - 4000) {
      const i = events.length
      events.push(
        [
          'BEGIN:VEVENT',
          `UID:m${i}`,
          'DTSTART;VALUE=DATE:20261001',
          `DESCRIPTION:${filler}`,
          'END:VEVENT',
        ].join('\r\n')
      )
    }
    const parser = new IcsParser({
      timeoutMs: 10_000,
      resourceLimits: { maxOldGenerationSizeMb: 4, maxYoungGenerationSizeMb: 1, stackSizeMb: 1 },
    })
    assert.equal(
      await reason(parser.parse(calendar(events), '2026-09-01', '2027-06-30')),
      'too_complex'
    )
  })

  test('the main thread stays responsive while a calendar is parsed', async ({ assert }) => {
    // 1,000 plain DAILY events: ~200 ms of expansion before hitting the budget.
    const content = calendar(Array.from({ length: 1000 }, (_, i) => recurring(i, 'FREQ=DAILY')))
    let ticks = 0
    const interval = setInterval(() => (ticks += 1), 5)
    const outcome = await reason(new IcsParser().parse(content, '2026-08-24', '2027-06-11'))
    clearInterval(interval)
    assert.equal(outcome, 'too_many_occurrences')
    assert.isAtLeast(ticks, 5, 'the event loop kept turning during the parse')
  })

  test('concurrent parses are limited ("busy, retry")', async ({ assert }) => {
    const content = await fixture()
    const parser = new IcsParser()
    const outcomes = await Promise.all(
      Array.from({ length: ICS_IMPORT.maxConcurrentParses + 2 }, () =>
        reason(parser.parse(content, '2026-08-24', '2027-06-11'))
      )
    )
    assert.equal(outcomes.filter((o) => o === 'ok').length, ICS_IMPORT.maxConcurrentParses)
    assert.isTrue(outcomes.filter((o) => o !== 'ok').every((o) => o === 'busy'))
    // Slots are released afterwards.
    assert.equal(await reason(parser.parse(content, '2026-08-24', '2027-06-11')), 'ok')
  })
})
