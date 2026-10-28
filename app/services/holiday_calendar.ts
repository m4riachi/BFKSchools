import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import db from '@adonisjs/lucid/services/db'
import { isIsoDate, type IsoDate } from '#support/dates'

export type EffectiveHoliday = { id: number; date: IsoDate; name: string; source: string }

/**
 * Read API for later phases (menus, ordering, reports, statements):
 * a day is a holiday when an **enabled, not deleted** row exists for it.
 * Uses the partial index `holidays_effective_index`. Several holidays may
 * share a date; `holidaysBetween` returns them all (sorted by date, name).
 */
export default class HolidayCalendar {
  async isHoliday(schoolId: number, date: IsoDate, client?: QueryClientContract): Promise<boolean> {
    if (!isIsoDate(date)) throw new TypeError(`Invalid ISO date "${date}"`)
    const row = await (client ?? db)
      .from('holidays')
      .where('school_id', schoolId)
      .where('date', date)
      .where('is_active', true)
      .whereNull('deleted_at')
      .select('id')
      .first()
    return Boolean(row)
  }

  /** Enabled holidays from `from` to `to` (both included). */
  async holidaysBetween(
    schoolId: number,
    from: IsoDate,
    to: IsoDate,
    client?: QueryClientContract
  ): Promise<EffectiveHoliday[]> {
    if (!isIsoDate(from) || !isIsoDate(to)) throw new TypeError('Invalid ISO date range')
    if (to < from) return []
    const rows = await (client ?? db)
      .from('holidays')
      .where('school_id', schoolId)
      .whereBetween('date', [from, to])
      .where('is_active', true)
      .whereNull('deleted_at')
      .orderBy('date')
      .orderBy('name')
      .select('id', 'date', 'name', 'source')
    return rows.map((row) => ({
      id: Number(row.id),
      date: String(row.date),
      name: String(row.name),
      source: String(row.source),
    }))
  }

  /** Distinct holiday dates in a range (convenient for "skip holidays" loops). */
  async holidayDatesBetween(
    schoolId: number,
    from: IsoDate,
    to: IsoDate,
    client?: QueryClientContract
  ): Promise<Set<IsoDate>> {
    const rows = await this.holidaysBetween(schoolId, from, to, client)
    return new Set(rows.map((row) => row.date))
  }
}
