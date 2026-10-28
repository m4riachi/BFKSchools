import { test } from '@japa/runner'
import { readFile } from 'node:fs/promises'
import ical from 'node-ical'
import {
  IcsInvalidError,
  checkParsedRecurrences,
  hashUid,
  isSafeRrule,
  sanitizeParseResult,
  parseIcs,
  sanitizeSummary,
} from '#services/ics_parser'
import { ICS_IMPORT } from '#config/holidays'

const fixture = () =>
  readFile(new URL('../fixtures/holidays/school_calendar.ics', import.meta.url), 'utf8')

function calendar(events: string[]) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...events, 'END:VCALENDAR'].join(
    '\r\n'
  )
}

function allDay(uid: string, start: string, end?: string, summary = 'Break') {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260801T120000Z',
    `DTSTART;VALUE=DATE:${start}`,
    ...(end ? [`DTEND;VALUE=DATE:${end}`] : []),
    `SUMMARY:${summary}`,
    'END:VEVENT',
  ].join('\r\n')
}

test.group('ICS parser | fixture', () => {
  test('all-day events become ranges (DTEND exclusive), inside the period only', async ({
    assert,
  }) => {
    const result = parseIcs(await fixture(), '2026-08-24', '2027-06-11')
    const ranges = result.ranges.map((r) => [r.summary, r.startDate, r.endDate, r.recurring])
    assert.deepEqual(ranges, [
      ['Professional Development Day', '2026-10-02', '2026-10-02', true],
      ['Teacher Work Day <script>alert(1)</script>', '2026-10-09', '2026-10-09', false],
      ['Professional Development Day', '2026-12-02', '2026-12-02', true], // 2026-11-02 is an EXDATE
      ['Winter Break', '2026-12-21', '2027-01-01', false],
      ['Spring Break', '2027-04-05', '2027-04-09', false],
    ])
    assert.isFalse(result.truncated)
    const ignored = Object.fromEntries(result.ignored.map((i) => [i.summary, i.reason]))
    assert.equal(ignored['Parent-Teacher Conference'], 'timed')
    assert.equal(ignored['Summer camp'], 'outside_period')
    assert.equal(ignored['Cancelled day off'], 'cancelled')
  })

  test('keys are stable across parses and do not expose the UID', async ({ assert }) => {
    const first = parseIcs(await fixture(), '2026-08-24', '2027-06-11')
    const second = parseIcs(await fixture(), '2026-08-24', '2027-06-11')
    assert.deepEqual(
      first.ranges.map((r) => r.key),
      second.ranges.map((r) => r.key)
    )
    const winter = first.ranges.find((r) => r.summary === 'Winter Break')!
    assert.equal(winter.key, `${hashUid('winter-break-2026@britech.example')}:2026-12-21`)
    assert.notInclude(winter.key, 'britech')
  })
})

test.group('ICS parser | untrusted input', () => {
  test('rejects content that is not a calendar', ({ assert }) => {
    assert.throws(() => parseIcs('hello,world\n1,2', '2026-08-24', '2027-06-11'), IcsInvalidError)
    try {
      parseIcs('<html></html>', '2026-08-24', '2027-06-11')
    } catch (error) {
      assert.equal((error as IcsInvalidError).reason, 'not_ics')
    }
  })

  test('rejects files above the size limit and too many events', ({ assert }) => {
    const big = calendar([`X-PAD:${'a'.repeat(ICS_IMPORT.maxBytes)}`])
    assert.throws(() => parseIcs(big, '2026-08-24', '2027-06-11'), /too_large/)
    const many = calendar(
      Array.from({ length: ICS_IMPORT.maxEvents + 1 }, (_, i) => allDay(`e${i}`, '20261005'))
    )
    assert.throws(() => parseIcs(many, '2026-08-24', '2027-06-11'), /too_many_events/)
  })

  test('accepts a BOM and a missing or empty DTEND (one day)', ({ assert }) => {
    const content = `${String.fromCodePoint(0xfeff)}${calendar([
      allDay('one', '20261005'),
      allDay('two', '20261006', '20261006'),
    ])}`
    const result = parseIcs(content, '2026-08-24', '2027-06-11')
    assert.deepEqual(
      result.ranges.map((r) => [r.startDate, r.endDate]),
      [
        ['2026-10-05', '2026-10-05'],
        ['2026-10-06', '2026-10-06'],
      ]
    )
  })

  test('ignores absurdly long events and caps recurring expansions', ({ assert }) => {
    const long = allDay('long', '20260901', '20270601')
    const daily = [
      'BEGIN:VEVENT',
      'UID:daily',
      'DTSTAMP:20260801T120000Z',
      'DTSTART;VALUE=DATE:20260901',
      'RRULE:FREQ=DAILY',
      'SUMMARY:Every day',
      'END:VEVENT',
    ].join('\r\n')
    const result = parseIcs(calendar([long, daily]), '2026-08-24', '2027-12-31')
    assert.deepEqual(result.ignored, [{ summary: 'Break', reason: 'too_long' }])
    assert.lengthOf(result.ranges, ICS_IMPORT.maxOccurrencesPerEvent)
    assert.isTrue(result.truncated)
  })

  test('names are cleaned: control and bidi characters removed, length capped', ({ assert }) => {
    const [bell, rlo, zwsp] = [0x07, 0x202e, 0x200b].map((code) => String.fromCodePoint(code))
    assert.equal(sanitizeSummary(`  Winter${bell} ${rlo}break${zwsp}  `), 'Winter break')
    assert.equal(sanitizeSummary({ val: 'From params', params: {} }), 'From params')
    assert.lengthOf(sanitizeSummary('x'.repeat(500)), 120)
    assert.equal(sanitizeSummary(undefined), '')
  })
})

test.group('ICS parser | process time zone', () => {
  /** Edge events of a 2026-09-01 → 2027-06-30 school year. */
  const edges = calendar([
    allDay('first-day', '20260901', undefined, 'First day off'),
    allDay('day-before', '20260831', undefined, 'Before the year'),
    allDay('last-day', '20270630', '20270701', 'Last day off'),
    allDay('day-after', '20270701', undefined, 'After the year'),
    allDay('cross-start', '20260828', '20260903', 'Crosses the start'),
    allDay('dst-us', '20261102', undefined, 'US DST end week'),
    [
      'BEGIN:VEVENT',
      'UID:weekly',
      'DTSTAMP:20260801T120000Z',
      'DTSTART;VALUE=DATE:20260825',
      'RRULE:FREQ=WEEKLY;UNTIL=20270706',
      'EXDATE;VALUE=DATE:20261103',
      'SUMMARY:Weekly Tuesday',
      'END:VEVENT',
    ].join('\r\n'),
    ...[
      ['daily-start', '20260829', 'Daily around the start'],
      ['daily-end', '20270628', 'Daily around the end'],
    ].map(([uid, start, summary]) =>
      [
        'BEGIN:VEVENT',
        `UID:${uid}`,
        'DTSTAMP:20260801T120000Z',
        `DTSTART;VALUE=DATE:${start}`,
        'RRULE:FREQ=DAILY;COUNT=6',
        `SUMMARY:${summary}`,
        'END:VEVENT',
      ].join('\r\n')
    ),
    [
      'BEGIN:VEVENT',
      'UID:yearly-edges',
      'DTSTAMP:20260801T120000Z',
      'DTSTART;VALUE=DATE:20250901',
      'RRULE:FREQ=YEARLY;COUNT=4',
      'SUMMARY:Anniversary',
      'END:VEVENT',
    ].join('\r\n'),
  ])

  const parseIn = (zone: string) => {
    const previous = process.env.TZ
    process.env.TZ = zone
    try {
      const offset = new Date('2026-12-01T12:00:00Z').getTimezoneOffset()
      const result = parseIcs(edges, '2026-09-01', '2027-06-30')
      return {
        offset,
        ranges: result.ranges.map((r) => [r.summary, r.startDate, r.endDate]),
        ignored: result.ignored.map((i) => [i.summary, i.reason]).sort(),
      }
    } finally {
      process.env.TZ = previous
    }
  }

  test('all-day and recurring events keep their calendar dates whatever the process TZ', ({
    assert,
  }) => {
    const reference = parseIn('Africa/Casablanca')
    const ranges = reference.ranges
    // Single events on the year edges.
    assert.deepInclude(ranges, ['First day off', '2026-09-01', '2026-09-01'])
    assert.deepInclude(ranges, ['Last day off', '2027-06-30', '2027-06-30'])
    assert.deepInclude(ranges, ['Crosses the start', '2026-08-28', '2026-09-02'])
    assert.deepInclude(ranges, ['US DST end week', '2026-11-02', '2026-11-02'])
    // Weekly Tuesdays: first in-year one is 1 Sep, last is 29 Jun; EXDATE removed.
    const weekly = ranges.filter((r) => r[0] === 'Weekly Tuesday').map((r) => r[1])
    assert.equal(weekly[0], '2026-09-01')
    assert.equal(weekly.at(-1), '2027-06-29')
    assert.notInclude(weekly, '2026-11-03')
    assert.notInclude(weekly, '2026-08-25')
    assert.lengthOf(weekly, 43)
    // Daily series crossing both edges: exactly the in-year days, no day more or less.
    assert.deepEqual(
      ranges.filter((r) => r[0] === 'Daily around the start').map((r) => r[1]),
      ['2026-09-01', '2026-09-02', '2026-09-03']
    )
    assert.deepEqual(
      ranges.filter((r) => r[0] === 'Daily around the end').map((r) => r[1]),
      ['2027-06-28', '2027-06-29', '2027-06-30']
    )
    // Yearly on 1 Sep: only 2026 is inside the year.
    assert.deepEqual(
      ranges.filter((r) => r[0] === 'Anniversary').map((r) => r[1]),
      ['2026-09-01']
    )
    assert.deepInclude(reference.ignored, ['Before the year', 'outside_period'])
    assert.deepInclude(reference.ignored, ['After the year', 'outside_period'])

    for (const zone of ['Pacific/Kiritimati', 'America/Los_Angeles', 'Pacific/Pago_Pago', 'UTC']) {
      const other = parseIn(zone)
      if (zone !== 'UTC') {
        assert.notEqual(other.offset, reference.offset, `TZ switch to ${zone} took effect`)
      }
      assert.deepEqual(other.ranges, reference.ranges, zone)
      assert.deepEqual(other.ignored, reference.ignored, zone)
    }
  })
})

test.group('ICS parser | hostile recurrences (DoS)', () => {
  const HOURS = Array.from({ length: 24 }, (_, i) => i).join(',')
  const MINUTES = Array.from({ length: 60 }, (_, i) => i).join(',')

  function recurring(uid: string, rule: string, start = '20260901', extra: string[] = []) {
    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      'DTSTAMP:20260801T120000Z',
      `DTSTART;VALUE=DATE:${start}`,
      `RRULE:${rule}`,
      ...extra,
      `SUMMARY:${uid}`,
      'END:VEVENT',
    ].join('\r\n')
  }

  function timed<T>(work: () => T): { value: T; ms: number } {
    const started = performance.now()
    const value = work()
    return { value, ms: performance.now() - started }
  }

  test('isSafeRrule', ({ assert }) => {
    for (const rule of [
      'FREQ=DAILY',
      'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20270630',
      'FREQ=MONTHLY;BYMONTHDAY=1,15;COUNT=20',
      'FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=25;INTERVAL=1;WKST=MO',
    ]) {
      assert.isTrue(isSafeRrule(rule), rule)
    }
    for (const rule of [
      `FREQ=DAILY;BYHOUR=${HOURS};BYMINUTE=${MINUTES}`,
      'FREQ=YEARLY;BYMONTHDAY=1;BYSECOND=1',
      'FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1',
      'FREQ=HOURLY',
      'FREQ=MINUTELY',
      'FREQ=SECONDLY',
      'FREQ=DAILY;COUNT=100000',
      'FREQ=DAILY;COUNT=0',
      'FREQ=DAILY;INTERVAL=0',
      'FREQ=DAILY;X-FOO=1',
      'FREQ=DAILY;FREQ=DAILY',
      'COUNT=3',
      `FREQ=YEARLY;BYYEARDAY=${Array.from({ length: 100 }, (_, i) => i + 1).join(',')}`,
    ]) {
      assert.isFalse(isSafeRrule(rule), rule)
    }
  })

  test('each pathological rule is ignored as invalid, fast', ({ assert }) => {
    const hostile = [
      recurring('byhour-byminute', `FREQ=DAILY;BYHOUR=${HOURS};BYMINUTE=${MINUTES}`),
      recurring(
        'yearly-bysecond',
        `FREQ=YEARLY;BYMONTHDAY=1,2,3,4,5,6,7,8,9,10;BYHOUR=${HOURS};BYMINUTE=${MINUTES};BYSECOND=${MINUTES}`
      ),
      recurring('setpos', 'FREQ=MONTHLY;BYDAY=MO,TU,WE;BYSETPOS=1,2'),
      recurring('minutely', 'FREQ=MINUTELY'),
      recurring('huge-count', 'FREQ=DAILY;COUNT=999999'),
      recurring('exrule', 'FREQ=DAILY', '20260901', ['EXRULE:FREQ=WEEKLY']),
      recurring('two-rrules', 'FREQ=DAILY', '20260901', ['RRULE:FREQ=WEEKLY']),
      recurring('ancient', 'FREQ=DAILY', '19000101'),
      // Folding cannot hide a forbidden part.
      [
        'BEGIN:VEVENT',
        'UID:folded',
        'DTSTAMP:20260801T120000Z',
        'DTSTART;VALUE=DATE:20260901',
        `RRULE:FREQ=DAILY;BYHO\r\n UR=${HOURS};BYMINUTE=${MINUTES}`,
        'SUMMARY:folded',
        'END:VEVENT',
      ].join('\r\n'),
    ]
    const { value, ms } = timed(() => parseIcs(calendar(hostile), '2026-08-24', '2027-06-11'))
    assert.isBelow(ms, 500)
    assert.lengthOf(value.ranges, 0)
    assert.sameMembers(
      value.ignored.map((i) => i.summary),
      [
        'byhour-byminute',
        'yearly-bysecond',
        'setpos',
        'minutely',
        'huge-count',
        'exrule',
        'two-rrules',
        'ancient',
        'folded',
      ]
    )
    assert.isTrue(value.ignored.every((i) => i.reason === 'invalid'))
  })

  test('a file full of pathological events stays bounded', ({ assert }) => {
    const events = Array.from({ length: ICS_IMPORT.maxEvents }, (_, i) =>
      recurring(`p${i}`, `FREQ=DAILY;BYHOUR=${HOURS};BYMINUTE=${MINUTES}`)
    )
    const { value, ms } = timed(() => parseIcs(calendar(events), '2026-08-24', '2027-06-11'))
    assert.isBelow(ms, 500)
    assert.lengthOf(value.ignored, ICS_IMPORT.maxEvents)
  })

  test('safe but numerous recurrences hit the calendar-wide budget', ({ assert }) => {
    const events = Array.from({ length: 1000 }, (_, i) => recurring(`d${i}`, 'FREQ=DAILY'))
    const started = performance.now()
    assert.throws(
      () => parseIcs(calendar(events), '2026-08-24', '2027-06-11'),
      /too_many_occurrences/
    )
    assert.isBelow(performance.now() - started, 1000)
  })

  test('recurrences producing nothing in the year are capped in number', ({ assert }) => {
    // Iterating from an old DTSTART without ever yielding in-year dates.
    const events = Array.from({ length: 1000 }, (_, i) =>
      recurring(`j${i}`, 'FREQ=DAILY;BYMONTH=7', '20220101')
    )
    const { value, ms } = timed(() => parseIcs(calendar(events), '2026-08-24', '2027-06-11'))
    assert.isBelow(ms, 1500)
    assert.lengthOf(value.ignored, 1000 - ICS_IMPORT.maxRecurringEvents)
  })

  test('expansion stops at the per-event cap', ({ assert }) => {
    const { value, ms } = timed(() =>
      parseIcs(calendar([recurring('daily', 'FREQ=DAILY')]), '2026-01-01', '2028-12-31')
    )
    assert.lengthOf(value.ranges, ICS_IMPORT.maxOccurrencesPerEvent)
    assert.isTrue(value.truncated)
    assert.isBelow(ms, 500)
  })

  test('line folding cannot hide events from the count', ({ assert }) => {
    const folded = Array.from({ length: ICS_IMPORT.maxEvents + 1 }, (_, i) =>
      [
        'BEGIN:VEV\r\n ENT',
        `UID:f${i}`,
        'DTSTAMP:20260801T120000Z',
        'DTSTART;VALUE=DATE:20261005',
        'SUMMARY:x',
        'END:VEVENT',
      ].join('\r\n')
    )
    assert.throws(() => parseIcs(calendar(folded), '2026-08-24', '2027-06-11'), /too_many_events/)
    // A folded BEGIN line is still a real event for node-ical.
    const one = parseIcs(calendar([folded[0]]), '2026-08-24', '2027-06-11')
    assert.lengthOf(one.ranges, 1)
  })
})

test.group('ICS parser | reader divergences (re-review bypasses)', () => {
  const HOURS = Array.from({ length: 24 }, (_, i) => i).join(',')
  const MINUTES = Array.from({ length: 60 }, (_, i) => i).join(',')
  const BAD = `FREQ=DAILY;BYHOUR=${HOURS};BYMINUTE=${MINUTES}`

  const event = (begin: string, rule: string, end = 'END:VEVENT', uid = 'u') =>
    [begin, `UID:${uid}`, 'SUMMARY:s', 'DTSTART;VALUE=DATE:20260901', rule, end].join('\r\n')

  for (const [label, body] of [
    ['X-RRULE (node-ical strips X-)', event('BEGIN:VEVENT', `X-rrule:${BAD}`)],
    ['BEGIN with parameters', event('BEGIN;X=1:VEVENT', `RRULE:${BAD}`)],
    ['BEGIN and END with parameters', event('BEGIN;X=1:VEVENT', `RRULE:${BAD}`, 'END;X=1:VEVENT')],
    ['lower-case component names', event('begin:vevent', `rrule:${BAD}`, 'end:vevent')],
    [
      'quoted parameter holding a second FREQ',
      event('BEGIN:VEVENT', `RRULE;A="${BAD}":freq=daily`),
    ],
    ['RRULE with parameters', event('BEGIN:VEVENT', 'RRULE;A=x:freq=daily;WKST=MO')],
    ['two FREQ in one value', event('BEGIN:VEVENT', 'RRULE:FREQ=DAILY;X=FREQ=DAILY')],
    ['X-EXRULE', event('BEGIN:VEVENT', 'RRULE:FREQ=DAILY\r\nX-EXRULE:FREQ=DAILY')],
  ] as const) {
    test(`${label}: the event is ignored and parsing stays fast`, ({ assert }) => {
      const started = performance.now()
      const result = parseIcs(
        calendar([body, body.replace('UID:u', 'UID:v')]),
        '2026-09-01',
        '2027-06-30'
      )
      assert.isBelow(performance.now() - started, 300)
      assert.lengthOf(result.ranges, 0)
      assert.deepEqual(
        result.ignored.map((i) => i.reason),
        ['invalid', 'invalid']
      )
    })
  }

  test('a VEVENT nested in a VEVENT, or left open, refuses the file', ({ assert }) => {
    const nested = [
      'BEGIN:VEVENT',
      'UID:outer',
      'BEGIN:VEVENT',
      'UID:inner',
      'END:VEVENT',
      'DTSTART;VALUE=DATE:20260901',
      `RRULE:${BAD}`,
      'END:VEVENT',
    ].join('\r\n')
    assert.throws(() => parseIcs(calendar([nested]), '2026-09-01', '2027-06-30'), /unreadable/)
    const open = ['BEGIN:VEVENT', 'UID:o', 'DTSTART;VALUE=DATE:20260901', `RRULE:${BAD}`].join(
      '\r\n'
    )
    assert.throws(() => parseIcs(calendar([open]), '2026-09-01', '2027-06-30'), /unreadable/)
  })

  test('events with parameters on BEGIN are counted', ({ assert }) => {
    for (const begin of ['BEGIN;X=1:VEVENT', 'begin:vevent', 'BEGIN:VEV\r\n ENT']) {
      const many = Array.from({ length: ICS_IMPORT.maxEvents + 1 }, (_, i) =>
        [begin, `UID:e${i}`, 'DTSTART;VALUE=DATE:20261001', 'END:VEVENT'].join('\r\n')
      )
      assert.throws(
        () => parseIcs(calendar(many), '2026-09-01', '2027-06-30'),
        /too_many_events/,
        begin
      )
    }
  })

  test("node-ical's parsed rules are the authority", ({ assert }) => {
    const parsed = ical.sync.parseICS(
      calendar([
        event('BEGIN:VEVENT', `RRULE:${BAD}`, 'END:VEVENT', 'bad'),
        event('BEGIN:VEVENT', 'RRULE:FREQ=WEEKLY', 'END:VEVENT', 'good'),
      ])
    ) as Record<string, unknown>
    const ignored: { summary: string; reason: 'invalid' }[] = []
    // The screener (pretend) saw both: the unsafe one is dropped, the safe one kept.
    checkParsedRecurrences(
      parsed,
      { text: '', events: 2, recurringUids: new Set(['bad', 'good']), ignored: [] },
      '2026-09-01',
      ignored
    )
    assert.deepEqual(
      Object.values(parsed)
        .filter((e: any) => e.type === 'VEVENT')
        .map((e: any) => e.uid),
      ['good']
    )
    assert.lengthOf(ignored, 1)

    // node-ical sees a recurring event the screener did not: refused.
    const diverging = ical.sync.parseICS(
      calendar([event('BEGIN:VEVENT', 'RRULE:FREQ=WEEKLY', 'END:VEVENT', 'sneaky')])
    ) as Record<string, unknown>
    assert.throws(
      () =>
        checkParsedRecurrences(
          diverging,
          { text: '', events: 1, recurringUids: new Set(), ignored: [] },
          '2026-09-01',
          []
        ),
      /too_complex/
    )
  })

  test('stored or worker results are re-validated (max event days included)', ({ assert }) => {
    const range = {
      key: 'ab:2026-09-01',
      uidHash: 'ab',
      summary: 'x',
      startDate: '2026-09-01',
      endDate: '2026-09-02',
      recurring: false,
    }
    assert.isNotNull(sanitizeParseResult({ ranges: [range], ignored: [], truncated: false }))
    for (const bad of [
      { ...range, endDate: '2027-06-30' }, // longer than maxEventDays
      { ...range, endDate: '2026-08-31' }, // ends before it starts
      { ...range, key: 'ab:2026-09-02' }, // key not matching
      { ...range, uidHash: 'XYZ', key: 'XYZ:2026-09-01' },
      { ...range, startDate: "2026-09-01'--", key: "ab:2026-09-01'--" },
    ]) {
      assert.isNull(sanitizeParseResult({ ranges: [bad], ignored: [], truncated: false }))
    }
    assert.isNull(sanitizeParseResult(null))
    assert.isNull(sanitizeParseResult({ ranges: 'x', ignored: [] }))
  })
})
