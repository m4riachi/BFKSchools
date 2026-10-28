import { randomUUID } from 'node:crypto'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type School from '#models/school'
import HolidayService, { type NewHolidayRow, type WriteOptions } from '#services/holiday_service'
import IcsParser, {
  sanitizeParseResult,
  type IcsIgnoredReason,
  type IcsParseResult,
  type IcsRange,
} from '#services/ics_parser'
import BusinessRuleException from '#exceptions/business_rule_exception'
import type { IsoDate } from '#support/dates'
import { ICS_IMPORT } from '#config/holidays'

export type ImportRangeStatus = 'new' | 'overlap' | 'imported' | 'no_school_day'

export type ImportPreviewRange = {
  key: string
  name: string
  startDate: IsoDate
  endDate: IsoDate
  recurring: boolean
  /** School days of the range inside the school year (rows that would be written). */
  schoolDays: number
  /** School days not imported before (no rule_key yet, deleted ones included). */
  newDays: number
  status: ImportRangeStatus
  /** Names of existing holidays on the same days (duplicate detection). */
  overlaps: string[]
  /** Suggested checkbox state. */
  selected: boolean
}

export type ImportPreview = {
  ranges: ImportPreviewRange[]
  ignored: { summary: string; reason: IcsIgnoredReason }[]
  truncated: boolean
}

/** Idempotency key of one imported day. */
export function icsRuleKey(range: Pick<IcsRange, 'uidHash'>, date: IsoDate) {
  return `ics:${range.uidHash}:${date}`
}

/**
 * ICS import of school breaks (brief §5.3): all-day events become date
 * ranges (one row per school day, one `group_id` per range), previewed with
 * duplicate detection, then only the checked ranges are imported with
 * `source = 'import'`. Re-importing the same file creates nothing (rule_key
 * `ics:<uid hash>:<date>`), and an imported day the admin deleted is never
 * brought back (tombstone).
 */
/** What the import store keeps between preview and confirm (never the raw file). */
type StoredParse = { v: 1; periodStart: IsoDate; periodEnd: IsoDate; result: IcsParseResult }

@inject()
export default class HolidayImportService {
  constructor(
    protected holidays: HolidayService,
    protected parser: IcsParser
  ) {}

  /**
   * Parses an uploaded/downloaded calendar **once** for the school year
   * (throws IcsInvalidError). The result — not the raw file — is what the
   * import store keeps: show and confirm never parse again.
   */
  parse(school: School, content: string): Promise<IcsParseResult> {
    return this.parser.parse(content, school.schoolYearStart, school.schoolYearEnd)
  }

  serialize(school: School, result: IcsParseResult): string {
    const stored: StoredParse = {
      v: 1,
      periodStart: school.schoolYearStart,
      periodEnd: school.schoolYearEnd,
      result,
    }
    return JSON.stringify(stored)
  }

  /**
   * The stored parse, re-checked field by field (it lives on disk), or null
   * when unreadable or made for another school year (then: "expired").
   */
  deserialize(school: School, text: string): IcsParseResult | null {
    let stored: StoredParse
    try {
      stored = JSON.parse(text) as StoredParse
    } catch {
      return null
    }
    if (
      stored?.v !== 1 ||
      stored.periodStart !== school.schoolYearStart ||
      stored.periodEnd !== school.schoolYearEnd
    ) {
      return null
    }
    // Same checks as for the worker's answer (types, bounds, ≤ maxEventDays).
    return sanitizeParseResult(stored.result)
  }

  async preview(school: School, parsed: IcsParseResult, untitled: string): Promise<ImportPreview> {
    const perRange = parsed.ranges.map((range) => ({
      range,
      dates: this.holidays.schoolDaysBetween(school, range.startDate, range.endDate),
    }))

    const allKeys = perRange.flatMap(({ range, dates }) =>
      dates.map((date) => icsRuleKey(range, date))
    )
    const allDates = [...new Set(perRange.flatMap(({ dates }) => dates))]
    const takenKeys = new Set<string>()
    for (let i = 0; i < allKeys.length; i += 500) {
      const rows = await db
        .from('holidays')
        .where('school_id', school.id)
        .whereIn('rule_key', allKeys.slice(i, i + 500))
        .select('rule_key')
      for (const row of rows) takenKeys.add(String(row.rule_key))
    }
    const existingByDate = new Map<string, { name: string; ruleKey: string | null }[]>()
    for (let i = 0; i < allDates.length; i += 500) {
      const rows = await db
        .from('holidays')
        .where('school_id', school.id)
        .whereIn('date', allDates.slice(i, i + 500))
        .whereNull('deleted_at')
        .select('date', 'name', 'rule_key')
      for (const row of rows) {
        const list = existingByDate.get(String(row.date)) ?? []
        list.push({ name: String(row.name), ruleKey: row.rule_key ?? null })
        existingByDate.set(String(row.date), list)
      }
    }

    const ranges = perRange.map(({ range, dates }): ImportPreviewRange => {
      const newDays = dates.filter((date) => !takenKeys.has(icsRuleKey(range, date))).length
      // Rows imported from this same event are not duplicates of it.
      const ownPrefix = `ics:${range.uidHash}:`
      const overlaps = [
        ...new Set(
          dates.flatMap((date) =>
            (existingByDate.get(date) ?? [])
              .filter((row) => !row.ruleKey?.startsWith(ownPrefix))
              .map((row) => row.name)
          )
        ),
      ].sort()
      let status: ImportRangeStatus = 'new'
      if (dates.length === 0) status = 'no_school_day'
      else if (newDays === 0) status = 'imported'
      else if (overlaps.length > 0) status = 'overlap'
      return {
        key: range.key,
        name: range.summary || untitled,
        startDate: range.startDate,
        endDate: range.endDate,
        recurring: range.recurring,
        schoolDays: dates.length,
        newDays,
        status,
        overlaps,
        selected: status === 'new',
      }
    })
    return { ranges, ignored: parsed.ignored, truncated: parsed.truncated }
  }

  /** Imports the checked ranges (keys from the preview). */
  async apply(
    school: School,
    parsed: IcsParseResult,
    selectedKeys: string[],
    untitled: string,
    options: WriteOptions = {}
  ) {
    const selected = new Set(selectedKeys)
    const rows: NewHolidayRow[] = []
    let ranges = 0
    for (const range of parsed.ranges) {
      if (!selected.has(range.key)) continue
      const dates = this.holidays.schoolDaysBetween(school, range.startDate, range.endDate)
      if (dates.length === 0) continue
      ranges += 1
      const groupId = dates.length > 1 ? randomUUID() : null
      for (const date of dates) {
        rows.push({
          date,
          name: range.summary || untitled,
          source: 'import',
          ruleKey: icsRuleKey(range, date),
          groupId,
        })
      }
    }
    if (rows.length > ICS_IMPORT.maxImportDays) {
      throw new BusinessRuleException('holidays.import.too_many_days', {
        field: 'ranges',
        values: { max: ICS_IMPORT.maxImportDays },
      })
    }
    const result = await this.holidays.insertRows(school, rows, options)
    return { ranges, created: result.created, skipped: result.skipped }
  }
}
