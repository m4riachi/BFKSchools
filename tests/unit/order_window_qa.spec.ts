import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { evaluate, cutoffFor, type WindowInput } from '#services/order_window_service'

/**
 * QA (independent) table for the ordering window, written from brief §5.6 + D5.
 * Instants are given in UTC literals (oracle) so the zone handling is checked
 * against facts, not against the code's own helper.
 */
const Z = 'Africa/Casablanca'
const utc = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' })
const L = (wall: string) => DateTime.fromISO(wall, { zone: Z })
type S = WindowInput['settings']
const D5: S = {
  allow_parent_edits: true,
  edit_mode: 'until_cutoff',
  edit_cutoff_days_before: 1,
  edit_cutoff_time: '18:00',
}
function run(o: Partial<Omit<WindowInput, 'settings'>> & { settings?: Partial<S> }) {
  return evaluate({
    date: '2026-12-01', // Tuesday, offset +01
    now: L('2026-11-25T11:00'),
    zone: Z,
    menu: { status: 'published', orderDeadlineAt: L('2026-11-29T20:00') }, // Sun 20:00 local
    hasMeals: true,
    isHoliday: false,
    isSchoolDay: true,
    child: { isActive: true },
    parent: { isActive: true },
    ...o,
    settings: { ...D5, ...o.settings },
  })
}

type Row = {
  t: string
  now: string | DateTime
  ok: boolean
  reason?: string
  date?: string
  s?: Partial<S>
  deadline?: string
}
// Deadline Sun 2026-11-29 20:00 local = 19:00Z. Cutoff for Tue 12-01 (D5) = Mon 11-30 18:00 local = 17:00Z.
const rows: Row[] = [
  { t: 'free before deadline', now: L('2026-11-25T11:00'), ok: true },
  { t: 'deadline -1min', now: L('2026-11-29T19:59'), ok: true },
  { t: 'deadline exactly, until_cutoff, still open', now: L('2026-11-29T20:00'), ok: true },
  { t: 'deadline +1min, until_cutoff', now: L('2026-11-29T20:01'), ok: true },
  { t: 'cutoff -1min', now: L('2026-11-30T17:59'), ok: true },
  { t: 'cutoff exact', now: L('2026-11-30T18:00'), ok: false, reason: 'AFTER_CUTOFF' },
  { t: 'cutoff +1min', now: L('2026-11-30T18:01'), ok: false, reason: 'AFTER_CUTOFF' },
  // 23:59 / 00:00 local (zone +01 => 22:59Z / 23:00Z)
  { t: 'day before 23:59 local', now: L('2026-11-30T23:59'), ok: false, reason: 'AFTER_CUTOFF' },
  { t: 'day itself 00:00 local', now: L('2026-12-01T00:00'), ok: false, reason: 'AFTER_CUTOFF' },
  // past day: now = Wed 12-02 00:00 local
  { t: 'past day 00:00 local', now: L('2026-12-02T00:00'), ok: false, reason: 'PAST_DAY' },
  {
    t: 'today 23:59 local, not past',
    now: L('2026-12-01T23:59'),
    ok: false,
    reason: 'AFTER_CUTOFF',
  },
  // edits disabled
  {
    t: 'edits off, before deadline',
    now: L('2026-11-25T11:00'),
    ok: true,
    s: { allow_parent_edits: false },
  },
  {
    t: 'edits off, after deadline',
    now: L('2026-11-29T20:01'),
    ok: false,
    reason: 'EDITS_DISABLED',
    s: { allow_parent_edits: false },
  },
  // days_before 0, cutoff 09:00 same day (Tue 12-01 09:00 local = 08:00Z)
  {
    t: 'd0 -1min',
    now: L('2026-12-01T08:59'),
    ok: true,
    s: { edit_cutoff_days_before: 0, edit_cutoff_time: '09:00' },
  },
  {
    t: 'd0 exact',
    now: L('2026-12-01T09:00'),
    ok: false,
    reason: 'AFTER_CUTOFF',
    s: { edit_cutoff_days_before: 0, edit_cutoff_time: '09:00' },
  },
  {
    t: 'd0 +1min',
    now: L('2026-12-01T09:01'),
    ok: false,
    reason: 'AFTER_CUTOFF',
    s: { edit_cutoff_days_before: 0, edit_cutoff_time: '09:00' },
  },
  // same_day_only, days_before 0
  {
    t: 'sdo: future day after deadline',
    now: L('2026-11-30T11:00'),
    ok: false,
    reason: 'SAME_DAY_ONLY',
    s: { edit_mode: 'same_day_only', edit_cutoff_days_before: 0, edit_cutoff_time: '09:00' },
  },
  {
    t: 'sdo: today -1min',
    now: L('2026-12-01T08:59'),
    ok: true,
    s: { edit_mode: 'same_day_only', edit_cutoff_days_before: 0, edit_cutoff_time: '09:00' },
  },
  {
    t: 'sdo: today at cutoff',
    now: L('2026-12-01T09:00'),
    ok: false,
    s: { edit_mode: 'same_day_only', edit_cutoff_days_before: 0, edit_cutoff_time: '09:00' },
  },
  // same_day_only, days_before 0, BEFORE the deadline: other day open
  {
    t: 'sdo: before deadline, other day open',
    now: L('2026-11-25T11:00'),
    ok: true,
    s: { edit_mode: 'same_day_only', edit_cutoff_days_before: 0, edit_cutoff_time: '09:00' },
  },
]
for (const r of rows) {
  test(`window: ${r.t}`, ({ assert }) => {
    const d = run({
      now: typeof r.now === 'string' ? utc(r.now) : r.now,
      ...(r.date ? { date: r.date } : {}),
      settings: r.s,
    })
    assert.equal(d.allowed, r.ok, `${r.t}: got ${d.reason}`)
    if (r.reason) assert.equal(d.reason, r.reason)
  })
}

test('window: locked-day reasons beat everything', ({ assert }) => {
  assert.equal(run({ isHoliday: true }).reason, 'HOLIDAY')
  assert.equal(run({ menu: null }).reason, 'NOT_PUBLISHED')
  for (const status of ['draft', 'scheduled', 'closed'] as const) {
    assert.equal(
      run({ menu: { status, orderDeadlineAt: L('2026-11-29T20:00') } }).reason,
      'NOT_PUBLISHED'
    )
  }
  assert.equal(run({ child: { isActive: false } }).reason, 'INACTIVE')
  assert.equal(run({ parent: { isActive: false } }).reason, 'INACTIVE')
  assert.equal(run({ hasMeals: false }).reason, 'NO_MEALS')
})

test('window: cutoff follows the IANA zone across Morocco offset changes', ({ assert }) => {
  // 2026-03-22 05:00Z: +00 -> +01. Date Mon 2026-03-23, days_before 2 => Sat 03-21 18:00 at +00 = 18:00Z
  assert.equal(
    cutoffFor('2026-03-23', { ...D5, edit_cutoff_days_before: 2 }, Z)
      .toUTC()
      .toISO(),
    '2026-03-21T18:00:00.000Z'
  )
  // Date Mon 2026-03-23 days_before 1 => Sun 03-22 18:00 at +01 = 17:00Z
  assert.equal(cutoffFor('2026-03-23', D5, Z).toUTC().toISO(), '2026-03-22T17:00:00.000Z')
  // Ramadan (+00): 2026-02-25 day before 18:00 = 18:00Z ; outside  2026-01-21 => 17:00Z
  assert.equal(cutoffFor('2026-02-26', D5, Z).toUTC().toISO(), '2026-02-25T18:00:00.000Z')
  assert.equal(cutoffFor('2026-01-21', D5, Z).toUTC().toISO(), '2026-01-20T17:00:00.000Z')
  // Sep 2026: +01 -> +00 at 2026-09-20 05:00Z. date 09-21, days_before 2 => 09-19 18:00 at +01 = 17:00Z
  assert.equal(
    cutoffFor('2026-09-21', { ...D5, edit_cutoff_days_before: 2 }, Z)
      .toUTC()
      .toISO(),
    '2026-09-19T17:00:00.000Z'
  )
  // evaluate boundary in a +00 period
  const base = {
    date: '2026-02-26',
    menu: { status: 'published' as const, orderDeadlineAt: utc('2026-02-20T19:00:00Z') },
  }
  assert.isTrue(run({ ...base, now: utc('2026-02-25T17:59:00Z') }).allowed)
  assert.isFalse(run({ ...base, now: utc('2026-02-25T18:00:00Z') }).allowed)
})

test('window: today is computed in the school zone, not UTC', ({ assert }) => {
  // 2026-12-01 23:30Z = Wed 12-02 00:30 local : Tuesday is past.
  assert.equal(run({ now: L('2026-12-02T00:30') }).reason, 'PAST_DAY')
})

test('BRIEF 5.6: before the deadline a day is free even after its cutoff', ({ assert }) => {
  // Deadline Wed 12-02 20:00 local, Monday 12-07... : Tue 12-01 cutoff Mon 11-30 18:00 passes BEFORE the deadline.
  const d = run({
    now: L('2026-11-30T18:30'),
    menu: { status: 'published', orderDeadlineAt: L('2026-12-02T20:00') },
  })
  // Brief §5.6: free before the deadline (except locked days).
  assert.isTrue(d.allowed)
  assert.isNull(d.reason)
})

test('BRIEF 5.6: same_day_only ignores edit_cutoff_days_before (today before the time)', ({
  assert,
}) => {
  const d = run({
    now: L('2026-12-01T08:00'), // today 08:00 local, deadline passed
    settings: { edit_mode: 'same_day_only', edit_cutoff_days_before: 1, edit_cutoff_time: '09:00' },
  })
  assert.isTrue(d.allowed)
  assert.isNull(d.reason)
})
