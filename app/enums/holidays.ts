/**
 * Mirrors the CHECK constraint on `holidays.source` (docs/ERD.md §holidays).
 * Labels: resources/lang/<locale>/holidays.json (`holidays.sources.<code>`).
 */
export const HOLIDAY_SOURCES = ['auto_us', 'auto_ma', 'import', 'manual'] as const
export type HolidaySource = (typeof HOLIDAY_SOURCES)[number]

/** Sources produced by the generator (always carry a rule_key). */
export const GENERATED_HOLIDAY_SOURCES = ['auto_us', 'auto_ma'] as const satisfies HolidaySource[]

/** List filter on the enabled flag (tombstoned rows are never listed). */
export const HOLIDAY_STATUS_FILTERS = ['all', 'active', 'disabled'] as const
export type HolidayStatusFilter = (typeof HOLIDAY_STATUS_FILTERS)[number]

/** List filter on the period. */
export const HOLIDAY_PERIOD_FILTERS = ['school_year', 'upcoming', 'all'] as const
export type HolidayPeriodFilter = (typeof HOLIDAY_PERIOD_FILTERS)[number]
