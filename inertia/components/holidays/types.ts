export type HolidaySource = 'auto_us' | 'auto_ma' | 'import' | 'manual'

/** One holiday row (one school day), as sent to the calendar. */
export type HolidayRow = {
  id: number
  date: string
  name: string
  source: HolidaySource
  isActive: boolean
  groupId: string | null
  generated: boolean
}

export type GroupSummary = {
  groupId: string
  startDate: string
  endDate: string
  days: number
  isActive: boolean
}

/** One line of the list view: a range or a single holiday. */
export type HolidayEntry = {
  key: string
  id: number | null
  groupId: string | null
  name: string
  source: HolidaySource
  startDate: string
  endDate: string
  days: number
  isActive: boolean
  generated: boolean
}

export type HolidayFilters = {
  q: string
  source: string
  status: string
  period: string
  page: number
}

export type SchoolCalendarInfo = {
  schoolDays: number[]
  schoolYearStart: string
  schoolYearEnd: string
  schoolYearLabel: string
}

/** What the editor modal works on. */
export type EditorTarget =
  | { kind: 'create'; startDate: string }
  | {
      kind: 'single'
      id: number
      name: string
      date: string
      source: HolidaySource
      isActive: boolean
      generated: boolean
    }
  | {
      kind: 'group'
      groupId: string
      name: string
      startDate: string
      endDate: string
      days: number
      source: HolidaySource
      isActive: boolean
      generated: boolean
    }

/** Colour of each source (legend, chips, badges). Disabled rows are greyed. */
export const SOURCE_STYLES: Record<HolidaySource, { chip: string; dot: string }> = {
  auto_us: { chip: 'bg-info-soft text-info border-info-line', dot: 'bg-info' },
  auto_ma: { chip: 'bg-warning-soft text-warning border-[#f5dcb8]', dot: 'bg-warning' },
  import: { chip: 'bg-violet-soft text-violet border-violet-line', dot: 'bg-violet' },
  manual: { chip: 'bg-brand-soft text-brand-strong border-brand-tint', dot: 'bg-brand' },
}

export const DISABLED_CHIP = 'bg-subtle text-ink-4 border-line line-through'

export const SOURCES: HolidaySource[] = ['auto_us', 'auto_ma', 'import', 'manual']
