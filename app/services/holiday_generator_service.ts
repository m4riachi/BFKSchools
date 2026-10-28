import { inject } from '@adonisjs/core'
import type School from '#models/school'
import HolidayService, { type NewHolidayRow, type WriteOptions } from '#services/holiday_service'
import SchoolSettingsService from '#services/school_settings_service'
import {
  moroccanFixedHolidaysBetween,
  usFederalHolidaysBetween,
  type ComputedHoliday,
} from '#services/us_holiday_calculator'
import { isSchoolDay } from '#support/dates'
import { OBSERVED_SUFFIX_FR } from '#config/holidays'

export type GenerationResult = {
  schoolYearStart: string
  schoolYearEnd: string
  /** Candidates on school days inside the school year. */
  candidates: number
  created: number
  /** Already present, disabled or deleted (tombstone): left untouched. */
  skipped: number
  moroccan: boolean
}

/**
 * "Generate holidays for school year YYYY–YYYY" (brief §5.3): US federal
 * holidays by rule, plus Moroccan fixed-date holidays when the school setting
 * `generate_moroccan_holidays` is on (D6). Only dates that are school days
 * inside the school's year are kept. Idempotent: rows are keyed by
 * `rule_key` and inserted with ON CONFLICT DO NOTHING, so a re-run creates
 * nothing new and never re-creates a disabled or deleted holiday.
 */
@inject()
export default class HolidayGeneratorService {
  constructor(
    protected holidays: HolidayService,
    protected settings: SchoolSettingsService
  ) {}

  /** The rows a generation would write (before the "already exists" filter). */
  candidates(school: School): NewHolidayRow[] {
    const from = school.schoolYearStart
    const to = school.schoolYearEnd
    const calendar = { schoolDays: school.schoolDays, schoolYearStart: from, schoolYearEnd: to }
    const toRow =
      (source: 'auto_us' | 'auto_ma') =>
      (holiday: ComputedHoliday): NewHolidayRow => ({
        date: holiday.date,
        name: holiday.observed ? `${holiday.nameFr} ${OBSERVED_SUFFIX_FR}` : holiday.nameFr,
        source,
        ruleKey: holiday.ruleKey,
        groupId: null,
      })

    const rows = usFederalHolidaysBetween(from, to).map(toRow('auto_us'))
    if (this.settings.get(school).generate_moroccan_holidays) {
      rows.push(...moroccanFixedHolidaysBetween(from, to).map(toRow('auto_ma')))
    }
    return rows
      .filter((row) => isSchoolDay(row.date, calendar))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  async generate(school: School, options: WriteOptions = {}): Promise<GenerationResult> {
    const rows = this.candidates(school)
    const result = await this.holidays.insertRows(school, rows, options)
    return {
      schoolYearStart: school.schoolYearStart,
      schoolYearEnd: school.schoolYearEnd,
      candidates: rows.length,
      created: result.created,
      skipped: result.skipped,
      moroccan: this.settings.get(school).generate_moroccan_holidays,
    }
  }
}
