import type { SchoolSettings, StoredSchoolSettings } from '#types/school_settings'
import db from '@adonisjs/lucid/services/db'
import School from '#models/school'
import BusinessRuleException from '#exceptions/business_rule_exception'
import {
  schoolSettingsValidator,
  type schoolSettingsFormValidator,
} from '#validators/school_settings'
import { diffInDays, isIsoDate } from '#support/dates'
import type { Infer } from '@vinejs/vine/types'

export type SchoolSettingsForm = Infer<typeof schoolSettingsFormValidator>

/** Longest accepted school year (days): a year plus a margin. */
const MAX_SCHOOL_YEAR_DAYS = 400

/**
 * Code defaults for every settings key (docs/ERD.md, docs/DECISIONS.md).
 * Adding a key here never needs a data migration. Keys removed from here
 * (e.g. `billing_mode` / `monthly_fee_cents`, D31) are ignored when read
 * and dropped on the next save (`deepMerge` keeps known keys only).
 */
export const DEFAULT_SCHOOL_SETTINGS: Readonly<SchoolSettings> = Object.freeze({
  publish_weekday: 4, // D3 Thursday of the week before
  publish_time: '10:00',
  deadline_weekday: 7, // D4 Sunday of the week before
  deadline_time: '20:00',
  reminder_hours_before_deadline: 24, // D12
  allow_parent_edits: true, // D5
  edit_mode: 'until_cutoff',
  edit_cutoff_days_before: 1,
  edit_cutoff_time: '18:00',
  auto_assign_default_meal: true, // D10
  allergens_enabled: false, // D33
  allergy_rule: 'block', // D9
  labels_enabled: false, // D33
  grade_enabled: false, // D33
  class_enabled: false, // D33
  generate_moroccan_holidays: false, // D6
  ics_calendar_url: null, // D7
  support_whatsapp: null, // D34
  email_notifications: {
    enabled: true,
    menu_published: true,
    deadline_reminder: true,
    holiday_cancellation: true,
    order_changed_by_staff: true,
    menu_change: true,
  },
  subscription_required_for_main_meal: true, // D2
  supplement_max_quantity: 5, // D14
  label_grid: { cols: 3, rows: 8 },
})

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Recursively merges `override` over `base`. Only keys known in `base` are
 * kept, so stale keys in the database never leak into the app.
 */
function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : override) as T
  }
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(base)) {
    const baseValue = base[key]
    const overrideValue = override[key]
    if (overrideValue === undefined) {
      result[key] = structuredClone(baseValue)
    } else if (isPlainObject(baseValue)) {
      result[key] = deepMerge(baseValue, overrideValue)
    } else {
      result[key] = overrideValue
    }
  }
  return result as T
}

export default class SchoolSettingsService {
  /**
   * Full settings of a school: stored JSON deep-merged over the defaults.
   */
  get(school: Pick<School, 'settings'>): SchoolSettings {
    return deepMerge(DEFAULT_SCHOOL_SETTINGS as SchoolSettings, school.settings ?? {})
  }

  /** D33: optional modules of the school (server checks + shared Inertia prop). */
  features(school: Pick<School, 'settings'>) {
    const settings = this.get(school)
    return {
      allergens: settings.allergens_enabled,
      labels: settings.labels_enabled,
      grade: settings.grade_enabled,
      className: settings.class_enabled,
    }
  }

  /**
   * Validates a partial update, merges it over the stored settings and saves.
   * Throws a VineJS validation error on invalid input.
   */
  async update(school: School, input: unknown): Promise<SchoolSettings> {
    const changes = await schoolSettingsValidator.validate(input)
    const current = this.get(school)
    const next = deepMerge(current, changes)
    school.settings = next as StoredSchoolSettings
    await school.save()
    return next
  }

  /**
   * The admin settings screen (brief §6): school days and school year
   * (columns) plus every settings key, in one transaction with the school
   * row locked. Cross-field rules: the year ends after it starts (≤ 400
   * days), the default deadline comes after the default publication in the
   * week before.
   * Changing the default times only affects weeks created afterwards.
   */
  async updateFromForm(school: School, input: SchoolSettingsForm): Promise<SchoolSettings> {
    if (!isIsoDate(input.schoolYearStart)) {
      throw new BusinessRuleException('settings.errors.invalid_date', { field: 'schoolYearStart' })
    }
    if (!isIsoDate(input.schoolYearEnd)) {
      throw new BusinessRuleException('settings.errors.invalid_date', { field: 'schoolYearEnd' })
    }
    const length = diffInDays(input.schoolYearStart, input.schoolYearEnd)
    if (length <= 0 || length > MAX_SCHOOL_YEAR_DAYS) {
      throw new BusinessRuleException('settings.errors.school_year_range', {
        field: 'schoolYearEnd',
      })
    }

    const values = input.settings
    const publishKey = `${values.publish_weekday}-${values.publish_time}`
    const deadlineKey = `${values.deadline_weekday}-${values.deadline_time}`
    if (deadlineKey <= publishKey) {
      throw new BusinessRuleException('settings.errors.deadline_before_publish', {
        field: 'settings.deadline_time',
      })
    }

    return db.transaction(async (trx) => {
      const locked = await School.query({ client: trx })
        .where('id', school.id)
        .forUpdate()
        .firstOrFail()
      locked.merge({
        schoolDays: [...new Set(input.schoolDays)].sort((a, b) => a - b),
        schoolYearStart: input.schoolYearStart,
        schoolYearEnd: input.schoolYearEnd,
      })
      const changes = await schoolSettingsValidator.validate(values)
      const next = deepMerge(this.get(locked), changes)
      locked.settings = next as StoredSchoolSettings
      await locked.save()
      school.merge({
        schoolDays: locked.schoolDays,
        schoolYearStart: locked.schoolYearStart,
        schoolYearEnd: locked.schoolYearEnd,
        settings: locked.settings,
      })
      return next
    })
  }
}
