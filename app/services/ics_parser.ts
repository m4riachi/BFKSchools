import { createHash } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import ical, { type VEvent } from 'node-ical'
import { DateTime } from 'luxon'
import { addDays, diffInDays, isIsoDate, type IsoDate } from '#support/dates'
import { HOLIDAY_NAME_MAX_LENGTH, ICS_IMPORT } from '#config/holidays'
import { APP_TIMEZONE } from '#support/time'

/** An all-day range read from a calendar (end included). */
export type IcsRange = {
  /** Stable key of this occurrence: `<uid hash>:<start date>`. */
  key: string
  uidHash: string
  summary: string
  startDate: IsoDate
  endDate: IsoDate
  recurring: boolean
}

export type IcsIgnoredReason = 'timed' | 'too_long' | 'invalid' | 'outside_period' | 'cancelled'

export type IcsParseResult = {
  ranges: IcsRange[]
  ignored: { summary: string; reason: IcsIgnoredReason }[]
  /** More events/occurrences than the caps: the extra ones were dropped. */
  truncated: boolean
}

export type IcsInvalidReason =
  | 'too_large'
  | 'not_ics'
  | 'unreadable'
  | 'too_many_events'
  | 'too_many_occurrences'
  | 'too_complex'
  | 'busy'

export class IcsInvalidError extends Error {
  constructor(readonly reason: IcsInvalidReason) {
    super(`Invalid ICS file: ${reason}`)
  }
}

/** Control, zero-width and bidi-override code points (never kept in a name). */
function isUnsafeCodePoint(code: number) {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  )
}

/** Cleans a SUMMARY: plain text, no control/bidi characters, length-capped. */
export function sanitizeSummary(value: unknown): string {
  let text = ''
  if (typeof value === 'string') text = value
  else if (value && typeof value === 'object' && 'val' in value)
    text = String((value as { val: unknown }).val ?? '')
  return text
    .replace(/[^]/gu, (char) => (isUnsafeCodePoint(char.codePointAt(0)!) ? ' ' : char))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, HOLIDAY_NAME_MAX_LENGTH)
}

/**
 * node-ical returns all-day (VALUE=DATE) values as a Date at **local**
 * midnight of the process time zone: read them with local getters, so the
 * calendar date never shifts whatever the offset.
 */
function localIsoDate(value: Date): IsoDate | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null
  const iso = `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  return isIsoDate(iso) ? iso : null
}

/**
 * Instants handed to node-ical's recurrence expansion. node-ical places
 * all-day occurrences at local midnight of the **process** time zone, which
 * may be anything (UTC on a host, +14 in a test), so no single zone gives
 * exact bounds. The window is computed in the business zone (never the
 * process zone) and padded by two days on each side — more than any UTC
 * offset (−12…+14) — and the caller keeps only occurrences whose calendar
 * date string is inside [periodStart, periodEnd].
 */
export function expansionWindow(periodStart: IsoDate, periodEnd: IsoDate) {
  return {
    from: DateTime.fromISO(periodStart, { zone: APP_TIMEZONE })
      .startOf('day')
      .minus({ days: 2 })
      .toJSDate(),
    to: DateTime.fromISO(periodEnd, { zone: APP_TIMEZONE })
      .endOf('day')
      .plus({ days: 2 })
      .toJSDate(),
  }
}

export function hashUid(uid: unknown): string {
  return createHash('sha256')
    .update(String(uid ?? ''))
    .digest('hex')
    .slice(0, 24)
}

/** RFC 5545 line unfolding: CRLF/LF followed by one space or tab. */
export function unfoldIcs(content: string): string {
  return content.replace(/\r?\n[ \t]/g, '')
}

const RRULE_FREQS = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'])
const RRULE_LIST_PARTS = new Set(['BYDAY', 'BYMONTHDAY', 'BYYEARDAY', 'BYWEEKNO', 'BYMONTH'])
const RRULE_ALLOWED_PARTS = new Set([
  'FREQ',
  'UNTIL',
  'COUNT',
  'INTERVAL',
  'WKST',
  ...RRULE_LIST_PARTS,
])

/**
 * Whether an RRULE value can only produce a bounded number of all-day
 * occurrences (one per date at most). Refused: sub-daily frequencies and
 * BYHOUR/BYMINUTE/BYSECOND/BYSETPOS (hundreds of thousands of instances per
 * event in node-ical/rrule), unknown parts, huge COUNT/INTERVAL/BY* lists.
 */
export function isSafeRrule(value: string): boolean {
  if (value.length > 300) return false
  const parts = new Map<string, string>()
  for (const part of value.split(';')) {
    const [rawKey, rawValue, ...rest] = part.split('=')
    const key = rawKey?.trim().toUpperCase()
    if (!key || rawValue === undefined || rest.length > 0 || parts.has(key)) return false
    if (!RRULE_ALLOWED_PARTS.has(key)) return false
    parts.set(key, rawValue.trim().toUpperCase())
  }
  if (!RRULE_FREQS.has(parts.get('FREQ') ?? '')) return false
  const count = parts.get('COUNT')
  if (count !== undefined && !/^\d{1,4}$/.test(count)) return false
  if (count !== undefined && (Number(count) < 1 || Number(count) > ICS_IMPORT.maxRruleCount))
    return false
  const interval = parts.get('INTERVAL')
  if (interval !== undefined && !/^[1-9]\d{0,2}$/.test(interval)) return false
  let listItems = 0
  for (const key of RRULE_LIST_PARTS) {
    const list = parts.get(key)
    if (list === undefined) continue
    if (!/^[+\-0-9A-Z,]+$/.test(list)) return false
    listItems += list.split(',').length
  }
  return listItems <= ICS_IMPORT.maxRruleListItems
}

export type ScreenedCalendar = {
  text: string
  events: number
  /** UIDs of the kept VEVENTs that carry a recurrence rule. */
  recurringUids: Set<string>
  ignored: { summary: string; reason: IcsIgnoredReason }[]
}

/** node-ical's content-line grammar (ical.js), so both sides split lines alike. */
const CONTENT_LINE = /^([\w-]+)((?:;[\w-]+=(?:"[^"]*"|[^":;]+))*):(.*)$/

type ContentLine = { name: string; params: string; value: string }

/** A parsed content line; `name` lower-cased with node-ical's `X-` stripping. */
function contentLine(line: string): ContentLine | null {
  const match = CONTENT_LINE.exec(line)
  if (!match) return null
  return {
    name: match[1].toLowerCase().replace(/^x-/, ''),
    params: match[2],
    value: match[3],
  }
}

/** The calendar date (YYYYMMDD) a DTSTART value starts with, or ''. */
const dateDigits = (value: string) => /^(\d{8})/.exec(value.trim())?.[1] ?? ''

function oldestRecurrenceStart(periodStart: IsoDate) {
  return `${Number(periodStart.slice(0, 4)) - ICS_IMPORT.maxRruleYearsBack}${periodStart.slice(5, 7)}${periodStart.slice(8, 10)}`
}

/**
 * Line-level screening of the unfolded calendar **before** node-ical sees it,
 * using node-ical's own line grammar (parameters on BEGIN/END, any case,
 * `X-RRULE` = RRULE): counts VEVENTs, refuses a VEVENT opened inside
 * another one, and drops every VEVENT whose recurrence could explode
 * (unsafe RRULE, RRULE with parameters or several `FREQ=`, several RRULEs,
 * EXRULE, a start more than `maxRruleYearsBack` years before the period, or
 * more than `maxRecurringEvents` recurring events). node-ical's parsed
 * result is checked again afterwards (`checkParsedRecurrences`).
 */
function screenCalendar(unfolded: string, periodStart: IsoDate): ScreenedCalendar {
  const lines = unfolded.split(/\r?\n/)
  const kept: string[] = []
  const ignored: ScreenedCalendar['ignored'] = []
  const recurringUids = new Set<string>()
  const oldestStart = oldestRecurrenceStart(periodStart)
  let events = 0
  let recurring = 0
  let block: { line: string; parsed: ContentLine | null }[] | null = null

  const isComponent = (parsed: ContentLine | null, keyword: 'begin' | 'end') =>
    parsed !== null && parsed.name === keyword && parsed.value.trim().toUpperCase() === 'VEVENT'

  for (const line of lines) {
    const parsed = contentLine(line)
    if (block === null) {
      if (isComponent(parsed, 'begin')) {
        events += 1
        if (events > ICS_IMPORT.maxEvents) throw new IcsInvalidError('too_many_events')
        block = [{ line, parsed }]
      } else {
        kept.push(line)
      }
      continue
    }
    if (isComponent(parsed, 'begin')) throw new IcsInvalidError('unreadable') // nested VEVENT
    block.push({ line, parsed })
    if (!isComponent(parsed, 'end')) continue

    const props = block.map((entry) => entry.parsed).filter((p): p is ContentLine => p !== null)
    const rrules = props.filter((p) => p.name === 'rrule')
    const dtstart = props.find((p) => p.name === 'dtstart')
    const startDigits = dtstart ? dateDigits(dtstart.value) : ''
    const isRecurring = rrules.length > 0
    if (isRecurring) recurring += 1
    const unsafe =
      props.some((p) => p.name === 'exrule') ||
      // A raw line mentioning RRULE that node-ical's grammar can't split is
      // refused too (no divergence between the two readers).
      block.some((entry) => entry.parsed === null && /rrule/i.test(entry.line)) ||
      (isRecurring &&
        (recurring > ICS_IMPORT.maxRecurringEvents ||
          rrules.length > 1 ||
          rrules[0].params !== '' ||
          (rrules[0].value.match(/freq=/gi) ?? []).length !== 1 ||
          !isSafeRrule(rrules[0].value) ||
          !startDigits ||
          startDigits < oldestStart))
    if (unsafe) {
      const summary = props.find((p) => p.name === 'summary')
      ignored.push({ summary: sanitizeSummary(summary?.value ?? ''), reason: 'invalid' })
    } else {
      kept.push(...block.map((entry) => entry.line))
      if (isRecurring) recurringUids.add(props.find((p) => p.name === 'uid')?.value.trim() ?? '')
    }
    block = null
  }
  if (block !== null) {
    // Unterminated VEVENT: never handed to node-ical.
    throw new IcsInvalidError('unreadable')
  }
  return { text: kept.join('\r\n'), events, recurringUids, ignored }
}

/** The RRULE value node-ical will expand (from its own serialization). */
function parsedRuleValue(rrule: unknown): string | null {
  try {
    const text = String((rrule as { toString(): string }).toString())
    const line = text.split(/\r?\n/).find((l) => l.toUpperCase().startsWith('RRULE:'))
    return line ? line.slice('RRULE:'.length) : null
  } catch {
    return null
  }
}

const UNSAFE_RRULE_OPTIONS = [
  'byHour',
  'byMinute',
  'bySecond',
  'bySetPos',
  'byhour',
  'byminute',
  'bysecond',
  'bysetpos',
]

/**
 * node-ical's parsed result is the authority: the set of recurring VEVENTs
 * must match what the screener let through (any divergence = a reader
 * mismatch → the file is refused), and every rule node-ical will actually
 * expand is re-validated (canonical rule text and options, start age,
 * recurring-event cap). Unsafe events are removed from `data`.
 */
export function checkParsedRecurrences(
  data: Record<string, unknown>,
  screened: ScreenedCalendar,
  periodStart: IsoDate,
  ignored: IcsParseResult['ignored']
) {
  const oldestStart = oldestRecurrenceStart(periodStart)
  const parsedUids = new Set<string>()
  let recurring = 0
  for (const [key, item] of Object.entries(data)) {
    if ((item as { type?: unknown } | null)?.type !== 'VEVENT') continue
    const event = item as VEvent
    for (const override of new Set(Object.values(event.recurrences ?? {}))) {
      if ((override as VEvent).rrule) parsedUids.add(String(event.uid ?? '').trim())
    }
    if (!event.rrule) continue
    parsedUids.add(String(event.uid ?? '').trim())
    recurring += 1
    const rule = parsedRuleValue(event.rrule)
    const options = ((event.rrule as { options?: Record<string, unknown> }).options ??
      {}) as Record<string, unknown>
    const hasUnsafeOption = UNSAFE_RRULE_OPTIONS.some((name) => {
      const value = options[name]
      return value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)
    })
    const start = event.start instanceof Date ? localIsoDate(event.start) : null
    const startDigits = start ? start.replaceAll('-', '') : ''
    if (
      recurring > ICS_IMPORT.maxRecurringEvents ||
      rule === null ||
      !isSafeRrule(rule) ||
      hasUnsafeOption ||
      !startDigits ||
      startDigits < oldestStart
    ) {
      ignored.push({ summary: sanitizeSummary(event.summary), reason: 'invalid' })
      delete data[key]
    }
  }
  const same =
    parsedUids.size === screened.recurringUids.size &&
    [...parsedUids].every((uid) => screened.recurringUids.has(uid))
  if (!same) throw new IcsInvalidError('too_complex')
}

/** First and last day of each month overlapping [from, to] (both included). */
function monthChunks(from: IsoDate, to: IsoDate): [IsoDate, IsoDate][] {
  const chunks: [IsoDate, IsoDate][] = []
  let cursor = DateTime.fromISO(from, { zone: 'utc' })
  const end = DateTime.fromISO(to, { zone: 'utc' })
  while (cursor <= end) {
    const monthEnd = cursor.endOf('month')
    const last = monthEnd < end ? monthEnd : end
    chunks.push([cursor.toISODate()!, last.toISODate()!])
    cursor = monthEnd.plus({ days: 1 }).startOf('day')
  }
  return chunks
}

/**
 * Reads the all-day events of an ICS calendar as date ranges, limited to
 * [periodStart, periodEnd]. The content is untrusted: size and event counts
 * are capped, only VEVENTs are read, timed events are reported and ignored,
 * recurring all-day events are expanded inside the period (EXDATE and
 * RECURRENCE-ID overrides applied by node-ical), DTEND is exclusive.
 * Recurrences are screened before parsing (`screenCalendar`) and expanded
 * month by month under a per-event cap and a calendar-wide budget, so a
 * hostile RRULE cannot burn CPU or memory.
 */
export function parseIcs(
  content: string,
  periodStart: IsoDate,
  periodEnd: IsoDate
): IcsParseResult {
  if (Buffer.byteLength(content, 'utf8') > ICS_IMPORT.maxBytes)
    throw new IcsInvalidError('too_large')
  const unfolded = unfoldIcs(content.charCodeAt(0) === 0xfeff ? content.slice(1) : content)
  if (!/^\s*BEGIN:VCALENDAR/i.test(unfolded)) throw new IcsInvalidError('not_ics')
  const screened = screenCalendar(unfolded, periodStart)

  let data: Record<string, unknown>
  try {
    data = ical.sync.parseICS(screened.text) as Record<string, unknown>
  } catch {
    throw new IcsInvalidError('unreadable')
  }
  // Second count, on what node-ical actually built (overrides included).
  let parsedEvents = 0
  for (const item of Object.values(data)) {
    if ((item as { type?: unknown } | null)?.type !== 'VEVENT') continue
    parsedEvents += 1 + new Set(Object.values((item as VEvent).recurrences ?? {})).size
  }
  if (parsedEvents > ICS_IMPORT.maxEvents) throw new IcsInvalidError('too_many_events')

  const result: IcsParseResult = { ranges: [], ignored: [...screened.ignored], truncated: false }
  checkParsedRecurrences(data, screened, periodStart, result.ignored)
  let budget = ICS_IMPORT.maxOccurrencesTotal
  const deadline = performance.now() + ICS_IMPORT.maxExpansionMs
  const seen = new Set<string>()

  const pushRange = (event: VEvent, start: Date, end: Date | undefined, recurring: boolean) => {
    const summary = sanitizeSummary(event.summary)
    const startDate = localIsoDate(start)
    if (!startDate) return result.ignored.push({ summary, reason: 'invalid' })
    // DTEND is exclusive for all-day events; a missing/empty DTEND means one day.
    const endExclusive = end ? localIsoDate(end) : null
    const endDate = endExclusive && endExclusive > startDate ? addDays(endExclusive, -1) : startDate
    if (diffInDays(startDate, endDate) + 1 > ICS_IMPORT.maxEventDays) {
      return result.ignored.push({ summary, reason: 'too_long' })
    }
    if (endDate < periodStart || startDate > periodEnd) {
      return result.ignored.push({ summary, reason: 'outside_period' })
    }
    const uidHash = hashUid(event.uid)
    const key = `${uidHash}:${startDate}`
    if (seen.has(key)) return
    if (result.ranges.length >= ICS_IMPORT.maxPreviewRanges) {
      result.truncated = true
      return
    }
    seen.add(key)
    result.ranges.push({ key, uidHash, summary, startDate, endDate, recurring })
  }

  for (const item of Object.values(data)) {
    if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'VEVENT')
      continue
    const event = item as VEvent
    const summary = sanitizeSummary(event.summary)
    if (String(event.status ?? '').toUpperCase() === 'CANCELLED') {
      result.ignored.push({ summary, reason: 'cancelled' })
      continue
    }
    if (!(event.start instanceof Date)) {
      result.ignored.push({ summary, reason: 'invalid' })
      continue
    }
    if (event.datetype !== 'date') {
      result.ignored.push({ summary, reason: 'timed' })
      continue
    }

    if (event.rrule) {
      // Expanded month by month, stopping at the per-event cap; every
      // instance node-ical builds counts against the calendar-wide budget.
      let kept = 0
      for (const [chunkStart, chunkEnd] of monthChunks(periodStart, periodEnd)) {
        if (performance.now() > deadline) throw new IcsInvalidError('too_complex')
        let instances: ReturnType<typeof ical.expandRecurringEvent>
        try {
          instances = ical.expandRecurringEvent(event, expansionWindow(chunkStart, chunkEnd))
        } catch {
          // rrule-temporal hit its own iteration limits: a hostile rule got
          // this far, so the whole file is refused.
          throw new IcsInvalidError('too_complex')
        }
        budget -= instances.length
        if (budget < 0) throw new IcsInvalidError('too_many_occurrences')
        if (performance.now() > deadline) throw new IcsInvalidError('too_complex')
        for (const instance of instances) {
          if (!instance.isFullDay) continue
          // The window is padded: keep exactly the occurrences whose calendar
          // date (read from node-ical's local-midnight Date) is in this chunk.
          const date = localIsoDate(instance.start)
          if (date === null || date < chunkStart || date > chunkEnd) continue
          if (kept >= ICS_IMPORT.maxOccurrencesPerEvent) {
            result.truncated = true
            break
          }
          kept += 1
          pushRange(instance.event ?? event, instance.start, instance.end, true)
        }
        if (kept >= ICS_IMPORT.maxOccurrencesPerEvent) break
      }
      continue
    }
    pushRange(event, event.start, event.end, false)
  }

  result.ranges.sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.summary.localeCompare(b.summary)
  )
  return result
}

const IGNORED_REASONS = new Set<IcsIgnoredReason>([
  'timed',
  'too_long',
  'invalid',
  'outside_period',
  'cancelled',
])

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max

/**
 * Re-validates a parse result that crossed a trust boundary (worker message,
 * file in the import store): every field typed and bounded, ranges inside
 * the caps. Returns null when anything is off.
 */
export function sanitizeParseResult(raw: unknown): IcsParseResult | null {
  const value = raw as Partial<IcsParseResult> | null
  if (
    !value ||
    !Array.isArray(value.ranges) ||
    !Array.isArray(value.ignored) ||
    value.ranges.length > ICS_IMPORT.maxPreviewRanges ||
    value.ignored.length > ICS_IMPORT.maxEvents
  ) {
    return null
  }
  const ranges: IcsRange[] = []
  for (const r of value.ranges as Partial<IcsRange>[]) {
    if (
      !isText(r?.key, 100) ||
      !isText(r.uidHash, 64) ||
      !/^[0-9a-f]+$/.test(r.uidHash) ||
      r.key !== `${r.uidHash}:${r.startDate}` ||
      !isText(r.summary, HOLIDAY_NAME_MAX_LENGTH) ||
      !isIsoDate(r.startDate) ||
      !isIsoDate(r.endDate) ||
      r.startDate > r.endDate ||
      diffInDays(r.startDate, r.endDate) + 1 > ICS_IMPORT.maxEventDays ||
      typeof r.recurring !== 'boolean'
    ) {
      return null
    }
    ranges.push({
      key: r.key,
      uidHash: r.uidHash,
      summary: r.summary,
      startDate: r.startDate,
      endDate: r.endDate,
      recurring: r.recurring,
    })
  }
  const ignored = (value.ignored as { summary?: unknown; reason?: unknown }[])
    .filter(
      (i) =>
        isText(i?.summary, HOLIDAY_NAME_MAX_LENGTH) &&
        IGNORED_REASONS.has(i.reason as IcsIgnoredReason)
    )
    .map((i) => ({ summary: i.summary as string, reason: i.reason as IcsIgnoredReason }))
  return { ranges, ignored, truncated: value.truncated === true }
}

export type IcsParserOptions = {
  timeoutMs: number
  resourceLimits: {
    maxOldGenerationSizeMb: number
    maxYoungGenerationSizeMb: number
    stackSizeMb: number
  }
}

/** Parses running now, all IcsParser instances together. */
let running = 0

/**
 * Container-resolvable entry point. Every parse runs `parseIcs` in a fresh
 * worker thread (app/workers/ics_parse_worker) with a heap limit and a hard
 * timeout (`terminate()`), at most `ICS_IMPORT.maxConcurrentParses` at a
 * time; whatever goes wrong inside becomes an IcsInvalidError
 * (`too_complex`, `busy`, …), and the worker's answer is re-validated here.
 * Tests swap this class to prove previews never re-parse.
 */
export default class IcsParser {
  protected options: IcsParserOptions

  constructor(options: Partial<IcsParserOptions> = {}) {
    this.options = {
      timeoutMs: options.timeoutMs ?? ICS_IMPORT.workerTimeoutMs,
      resourceLimits: options.resourceLimits ?? {
        maxOldGenerationSizeMb: ICS_IMPORT.workerMaxOldGenerationMb,
        maxYoungGenerationSizeMb: ICS_IMPORT.workerMaxYoungGenerationMb,
        stackSizeMb: 4,
      },
    }
  }

  /** The worker entry: TypeScript source under ts-exec (dev, tests), JS in the build. */
  protected workerTarget(): { url: URL; execArgv: string[] } {
    const fromSource = import.meta.url.endsWith('.ts')
    const url = new URL(`../workers/ics_parse_worker.${fromSource ? 'ts' : 'js'}`, import.meta.url)
    const inherited = process.execArgv.filter((arg) => !arg.startsWith('--inspect'))
    const execArgv = fromSource
      ? [...inherited, `--import=${import.meta.resolve('@poppinss/ts-exec')}`]
      : inherited
    return { url, execArgv }
  }

  async parse(content: string, periodStart: IsoDate, periodEnd: IsoDate): Promise<IcsParseResult> {
    if (Buffer.byteLength(content, 'utf8') > ICS_IMPORT.maxBytes) {
      throw new IcsInvalidError('too_large')
    }
    if (running >= ICS_IMPORT.maxConcurrentParses) throw new IcsInvalidError('busy')
    running += 1
    try {
      const raw = await this.runWorker({ content, periodStart, periodEnd })
      const result = sanitizeParseResult(raw)
      if (!result) throw new IcsInvalidError('unreadable')
      return result
    } finally {
      running -= 1
    }
  }

  protected runWorker(data: { content: string; periodStart: string; periodEnd: string }) {
    const { url, execArgv } = this.workerTarget()
    return new Promise<unknown>((resolve, reject) => {
      let settled = false
      const worker = new Worker(url, {
        workerData: data,
        execArgv,
        resourceLimits: this.options.resourceLimits,
        stdout: true,
        stderr: true,
      })
      const finish = (error: IcsInvalidError | null, value?: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        void worker.terminate()
        if (error) reject(error)
        else resolve(value)
      }
      const timer = setTimeout(
        () => finish(new IcsInvalidError('too_complex')),
        this.options.timeoutMs
      )
      worker.once('message', (message: { ok?: boolean; result?: unknown; reason?: unknown }) => {
        if (message?.ok === true) return finish(null, message.result)
        const reason = WORKER_REASONS.has(message?.reason as IcsInvalidReason)
          ? (message.reason as IcsInvalidReason)
          : 'unreadable'
        finish(new IcsInvalidError(reason))
      })
      // Out of memory (ERR_WORKER_OUT_OF_MEMORY), crash or early exit.
      worker.once('error', () => finish(new IcsInvalidError('too_complex')))
      worker.once('exit', () => finish(new IcsInvalidError('too_complex')))
    })
  }
}

const WORKER_REASONS = new Set<IcsInvalidReason>([
  'too_large',
  'not_ics',
  'unreadable',
  'too_many_events',
  'too_many_occurrences',
  'too_complex',
])
