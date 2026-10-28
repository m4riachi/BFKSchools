import { randomUUID } from 'node:crypto'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { errors as lucidErrors } from '@adonisjs/lucid'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Holiday from '#models/holiday'
import type School from '#models/school'
import type User from '#models/user'
import Clock from '#services/clock'
import HolidayImpactService from '#services/holiday_impact_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import { datesBetween, diffInDays, isSchoolDay, type IsoDate } from '#support/dates'
import type { HolidayPeriodFilter, HolidaySource, HolidayStatusFilter } from '#enums/holidays'
import { HOLIDAY_RANGE_MAX_DAYS, HOLIDAYS_PER_PAGE } from '#config/holidays'

/** A row about to be inserted (generated, imported or manual). */
export type NewHolidayRow = {
  date: IsoDate
  name: string
  source: HolidaySource
  ruleKey: string | null
  groupId: string | null
  isActive?: boolean
}

export type WriteOptions = {
  /** The admin confirmed the impact on existing orders (or nobody can be asked). */
  confirmImpact?: boolean
  /**
   * Number of affected orders the admin saw when confirming. Inside the
   * write transaction the orders are recounted and the write is refused when
   * more exist now. Without it, a confirmation by a user covers 0 orders and
   * a system run (no actor, e.g. the `holidays:generate` command) any number.
   */
  confirmedCount?: number
  actor?: User | null
}

export type InsertResult = { created: number; skipped: number; newHolidayDates: IsoDate[] }

export type RangeInput = { name: string; startDate: IsoDate; endDate?: IsoDate | null }

export type HolidayListFilters = {
  q?: string
  source?: HolidaySource
  status?: HolidayStatusFilter
  period?: HolidayPeriodFilter
  page?: number
}

/** One line of the list view: a range (group) or a single holiday. */
export type HolidayEntry = {
  key: string
  id: number | null
  groupId: string | null
  name: string
  source: HolidaySource
  startDate: IsoDate
  endDate: IsoDate
  days: number
  isActive: boolean
  generated: boolean
}

const PG_UNIQUE_VIOLATION = '23505'

/** Rows per INSERT statement (8 bind parameters each). */
const INSERT_CHUNK = 1000

function isUniqueViolation(error: unknown) {
  return (error as { code?: string } | null)?.code === PG_UNIQUE_VIOLATION
}

function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

/**
 * Holidays of a school (brief §5.3, docs/ERD.md §holidays): manual days and
 * ranges, enable/disable, rename, delete (tombstone for generated/imported
 * rows, hard delete for manual rows), and the shared insert path used by the
 * generator and the ICS import.
 *
 * Every write that turns days into holidays first asks
 * `HolidayImpactService.countAffectedOrders` and refuses with a
 * `confirmImpact` field error until the admin confirms; the affected orders
 * are then cancelled in the same transaction.
 */
@inject()
export default class HolidayService {
  constructor(
    protected clock: Clock,
    protected impact: HolidayImpactService
  ) {}

  /* ------------------------------------------------------------------ */
  /* Shared insert path                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Inserts rows, skipping any that already exist: same `rule_key` (even a
   * disabled or deleted one — tombstones are never re-created) or same
   * (date, name) among non-deleted rows. Idempotent.
   */
  async insertRows(
    school: School,
    rows: NewHolidayRow[],
    options: WriteOptions = {}
  ): Promise<InsertResult> {
    if (rows.length === 0) return { created: 0, skipped: 0, newHolidayDates: [] }

    const pending = await this.withoutExisting(school.id, rows)
    const newDates = await this.datesBecomingHolidays(
      school.id,
      pending.filter((row) => row.isActive !== false).map((row) => row.date)
    )
    await this.assertImpactConfirmed(school.id, newDates, options)

    return db.transaction(async (trx) => {
      await this.lockSchool(trx, school.id)
      const effectiveBefore = await this.effectiveDates(trx, school.id, [
        ...new Set(pending.map((row) => row.date)),
      ])
      // Chunks of INSERT_CHUNK rows: 8 bind parameters per row must stay far
      // below PostgreSQL's 65,535 limit, whatever the number of rows.
      const inserted: { date: string; is_active: boolean }[] = []
      for (let i = 0; i < pending.length; i += INSERT_CHUNK) {
        const chunk = pending.slice(i, i + INSERT_CHUNK)
        const insertedChunk = (await trx
          .knexQuery()
          .table('holidays')
          .insert(
            chunk.map((row) => ({
              school_id: school.id,
              date: row.date,
              name: row.name,
              source: row.source,
              rule_key: row.ruleKey,
              group_id: row.groupId,
              is_active: row.isActive ?? true,
              created_by: options.actor?.id ?? null,
            }))
          )
          .onConflict()
          .ignore()
          .returning(['date', 'is_active'])) as { date: string; is_active: boolean }[]
        inserted.push(...insertedChunk)
      }

      const cancelled = [
        ...new Set(inserted.filter((row) => row.is_active).map((row) => String(row.date))),
      ]
        .filter((date) => !effectiveBefore.has(date))
        .sort()
      if (cancelled.length) {
        await this.applyImpact(trx, school.id, cancelled, options)
      }
      return {
        created: inserted.length,
        skipped: rows.length - inserted.length,
        newHolidayDates: cancelled,
      }
    })
  }

  /** Rows whose rule_key or (date, name) is not taken yet. */
  async withoutExisting(schoolId: number, rows: NewHolidayRow[]): Promise<NewHolidayRow[]> {
    const keys = rows.map((row) => row.ruleKey).filter((key): key is string => key !== null)
    const takenKeys = new Set<string>()
    for (let i = 0; i < keys.length; i += 500) {
      const found = await db
        .from('holidays')
        .where('school_id', schoolId)
        .whereIn('rule_key', keys.slice(i, i + 500))
        .select('rule_key')
      for (const row of found) takenKeys.add(String(row.rule_key))
    }

    const dates = [...new Set(rows.map((row) => row.date))]
    const takenNames = new Set<string>()
    for (let i = 0; i < dates.length; i += 500) {
      const found = await db
        .from('holidays')
        .where('school_id', schoolId)
        .whereIn('date', dates.slice(i, i + 500))
        .whereNull('deleted_at')
        .select('date', 'name')
      for (const row of found) takenNames.add(`${row.date}|${row.name}`)
    }

    const seen = new Set<string>()
    return rows.filter((row) => {
      if (row.ruleKey && takenKeys.has(row.ruleKey)) return false
      const nameKey = `${row.date}|${row.name}`
      if (takenNames.has(nameKey) || seen.has(nameKey)) return false
      if (row.ruleKey && seen.has(`key:${row.ruleKey}`)) return false
      seen.add(nameKey)
      if (row.ruleKey) seen.add(`key:${row.ruleKey}`)
      return true
    })
  }

  /** The dates (sorted, distinct) that are not an enabled holiday yet. */
  async datesBecomingHolidays(schoolId: number, dates: IsoDate[]): Promise<IsoDate[]> {
    const unique = [...new Set(dates)].sort()
    if (unique.length === 0) return []
    const effective = await this.effectiveDates(db, schoolId, unique)
    return unique.filter((date) => !effective.has(date))
  }

  /**
   * Refuses (field `confirmImpact`) when orders exist on the new holiday
   * dates and the admin has not confirmed yet.
   */
  async assertImpactConfirmed(schoolId: number, dates: IsoDate[], options: WriteOptions) {
    if (dates.length === 0 || options.confirmImpact) return
    const count = await this.impact.countAffectedOrders(schoolId, dates)
    if (count > 0) throw this.confirmationNeeded(count)
  }

  protected confirmationNeeded(count: number) {
    return new BusinessRuleException('holidays.impact.confirm', {
      field: 'confirmImpact',
      values: { count },
      // The count the dialog replays as `confirmedCount`.
      extraFields: { confirmedCount: String(count) },
    })
  }

  /**
   * Inside the write transaction, after `lockSchool`: recounts the orders
   * on the dates that become holidays (orders may have been placed since the
   * admin saw the count — they take the school row FOR SHARE, so none can
   * appear any more) and refuses when there are more than confirmed; then
   * cancels them.
   */
  protected async applyImpact(
    trx: TransactionClientContract,
    schoolId: number,
    dates: IsoDate[],
    options: WriteOptions
  ) {
    const count = await this.impact.countAffectedOrders(schoolId, dates, trx)
    const allowed = options.confirmImpact
      ? (options.confirmedCount ?? (options.actor ? 0 : Number.POSITIVE_INFINITY))
      : 0
    if (count > allowed) throw this.confirmationNeeded(count)
    return this.impact.cancelAffectedOrders(schoolId, dates, { trx, actor: options.actor })
  }

  protected async effectiveDates(
    client: TransactionClientContract | typeof db,
    schoolId: number,
    dates: IsoDate[]
  ): Promise<Set<IsoDate>> {
    const result = new Set<IsoDate>()
    for (let i = 0; i < dates.length; i += 500) {
      const rows = await client
        .from('holidays')
        .where('school_id', schoolId)
        .whereIn('date', dates.slice(i, i + 500))
        .where('is_active', true)
        .whereNull('deleted_at')
        .distinct('date')
      for (const row of rows) result.add(String(row.date))
    }
    return result
  }

  /** Serializes holiday writes of one school (generator, import, admin edits). */
  protected async lockSchool(trx: TransactionClientContract, schoolId: number) {
    await trx.from('schools').where('id', schoolId).forUpdate().select('id')
  }

  /* ------------------------------------------------------------------ */
  /* Manual days and ranges                                              */
  /* ------------------------------------------------------------------ */

  /** School days of the school (weekday + inside the school year) in a range. */
  schoolDaysBetween(school: School, from: IsoDate, to: IsoDate): IsoDate[] {
    const calendar = {
      schoolDays: school.schoolDays,
      schoolYearStart: school.schoolYearStart,
      schoolYearEnd: school.schoolYearEnd,
    }
    return datesBetween(from, to).filter((date) => isSchoolDay(date, calendar))
  }

  protected rangeDates(school: School, input: RangeInput): IsoDate[] {
    const end = input.endDate || input.startDate
    if (end < input.startDate) {
      throw new BusinessRuleException('holidays.errors.end_before_start', { field: 'endDate' })
    }
    if (diffInDays(input.startDate, end) + 1 > HOLIDAY_RANGE_MAX_DAYS) {
      throw new BusinessRuleException('holidays.errors.range_too_long', {
        field: 'endDate',
        values: { max: HOLIDAY_RANGE_MAX_DAYS },
      })
    }
    const dates = this.schoolDaysBetween(school, input.startDate, end)
    if (dates.length === 0) {
      throw new BusinessRuleException('holidays.errors.no_school_day', { field: 'startDate' })
    }
    return dates
  }

  /**
   * A manual holiday: one day, or a range stored as one row per school day
   * (weekends and days outside the school year are skipped) sharing a
   * `group_id`.
   */
  async createManual(school: School, input: RangeInput, options: WriteOptions = {}) {
    const dates = this.rangeDates(school, input)
    const groupId = dates.length > 1 ? randomUUID() : null
    const result = await this.insertRows(
      school,
      dates.map((date) => ({ date, name: input.name, source: 'manual', ruleKey: null, groupId })),
      options
    )
    if (result.created === 0) {
      throw new BusinessRuleException('holidays.errors.duplicate', { field: 'name' })
    }
    return { ...result, groupId }
  }

  /** A listed (not deleted) holiday of the school, or a 404. */
  async findListed(schoolId: number, id: unknown): Promise<Holiday> {
    const holidayId = Number(id)
    const query = Holiday.query()
      .withScopes((scopes) => scopes.listed())
      .where('school_id', schoolId)
    if (!Number.isSafeInteger(holidayId) || holidayId <= 0)
      return query.whereRaw('false').firstOrFail()
    return query.where('id', holidayId).firstOrFail()
  }

  /** The listed rows of a range, or a 404. */
  async findGroup(schoolId: number, groupId: string): Promise<Holiday[]> {
    const rows = await Holiday.query()
      .withScopes((scopes) => scopes.listed())
      .where('school_id', schoolId)
      .where('group_id', groupId)
      .orderBy('date')
    if (rows.length === 0) {
      throw new lucidErrors.E_ROW_NOT_FOUND()
    }
    return rows
  }

  /**
   * Renames one holiday; a manual single day (not part of a range) can also
   * move to another school day. Generated and imported days keep their date
   * (their rule_key is tied to it).
   */
  async updateOne(
    school: School,
    holiday: Holiday,
    input: { name: string; date?: IsoDate | null },
    options: WriteOptions = {}
  ) {
    const movable = holiday.source === 'manual' && holiday.groupId === null
    const date = movable && input.date ? input.date : holiday.date
    if (date !== holiday.date) {
      if (this.schoolDaysBetween(school, date, date).length === 0) {
        throw new BusinessRuleException('holidays.errors.no_school_day', { field: 'date' })
      }
      if (holiday.isActive) {
        const newDates = await this.datesBecomingHolidays(school.id, [date])
        await this.assertImpactConfirmed(school.id, newDates, options)
      }
    }

    await this.saveUnique(async (trx) => {
      await this.lockSchool(trx, school.id)
      const newDates =
        holiday.isActive && date !== holiday.date
          ? [...(await this.datesBecomingHoliday(trx, school.id, [date]))]
          : []
      holiday.useTransaction(trx)
      holiday.merge({ name: input.name, date })
      await holiday.save()
      if (newDates.length) {
        await this.applyImpact(trx, school.id, newDates, options)
      }
    })
    return holiday
  }

  /**
   * Renames a range; a manual range can also change its dates (rows outside
   * the new dates are deleted, missing school days are added with the
   * range's enabled flag).
   */
  async updateGroup(
    school: School,
    groupId: string,
    input: { name: string; startDate?: IsoDate | null; endDate?: IsoDate | null },
    options: WriteOptions = {}
  ) {
    const rows = await this.findGroup(school.id, groupId)
    const manual = rows.every((row) => row.source === 'manual')
    const isActive = rows.some((row) => row.isActive)
    const current = new Set(rows.map((row) => row.date))

    let wanted = current
    if (manual && input.startDate) {
      wanted = new Set(
        this.rangeDates(school, {
          name: input.name,
          startDate: input.startDate,
          endDate: input.endDate,
        })
      )
    }
    const added = [...wanted].filter((date) => !current.has(date)).sort()
    const removed = rows.filter((row) => !wanted.has(row.date))

    if (isActive && added.length) {
      const newDates = await this.datesBecomingHolidays(school.id, added)
      await this.assertImpactConfirmed(school.id, newDates, options)
    }

    await this.saveUnique(async (trx) => {
      await this.lockSchool(trx, school.id)
      const newDates = isActive ? [...(await this.datesBecomingHoliday(trx, school.id, added))] : []
      if (removed.length) {
        await trx
          .from('holidays')
          .whereIn(
            'id',
            removed.map((row) => row.id)
          )
          .delete()
      }
      await trx
        .from('holidays')
        .where('school_id', school.id)
        .where('group_id', groupId)
        .whereNull('deleted_at')
        .update({ name: input.name, updated_at: this.clock.now().toJSDate() })
      if (added.length) {
        await trx.table('holidays').insert(
          added.map((date) => ({
            school_id: school.id,
            date,
            name: input.name,
            source: 'manual',
            rule_key: null,
            group_id: groupId,
            is_active: isActive,
            created_by: options.actor?.id ?? null,
          }))
        )
      }
      if (newDates.length) {
        await this.applyImpact(trx, school.id, newDates, options)
      }
    })
  }

  /** Enables or disables holidays (one row or a whole range). */
  async setActive(school: School, rows: Holiday[], active: boolean, options: WriteOptions = {}) {
    const changing = rows.filter((row) => row.isActive !== active)
    if (changing.length === 0) return
    const dates = changing.map((row) => row.date)
    if (active) {
      const newDates = await this.datesBecomingHolidays(school.id, dates)
      await this.assertImpactConfirmed(school.id, newDates, options)
    }
    await db.transaction(async (trx) => {
      await this.lockSchool(trx, school.id)
      const newDates = active ? [...(await this.datesBecomingHoliday(trx, school.id, dates))] : []
      await trx
        .from('holidays')
        .whereIn(
          'id',
          changing.map((row) => row.id)
        )
        .update({ is_active: active, updated_at: this.clock.now().toJSDate() })
      if (newDates.length) {
        await this.applyImpact(trx, school.id, newDates, options)
      }
    })
  }

  /**
   * Deletes holidays: manual rows are removed, generated/imported rows are
   * tombstoned (`deleted_at`) so the generator/import never re-creates them.
   */
  async remove(rows: Holiday[]) {
    if (rows.length === 0) return
    await db.transaction(async (trx) => {
      const tombstones = rows.filter((row) => row.keepsTombstone).map((row) => row.id)
      const manual = rows.filter((row) => !row.keepsTombstone).map((row) => row.id)
      if (tombstones.length) {
        await trx.from('holidays').whereIn('id', tombstones).update({
          deleted_at: this.clock.now().toJSDate(),
          updated_at: this.clock.now().toJSDate(),
        })
      }
      if (manual.length) await trx.from('holidays').whereIn('id', manual).delete()
    })
  }

  /** Dates (among `dates`) that are not an enabled holiday, read inside a transaction. */
  protected async datesBecomingHoliday(
    trx: TransactionClientContract,
    schoolId: number,
    dates: IsoDate[]
  ) {
    const unique = [...new Set(dates)]
    const effective = await this.effectiveDates(trx, schoolId, unique)
    return new Set(unique.filter((date) => !effective.has(date)))
  }

  /** Runs a write; a (date, name) clash becomes a field error on `name`. */
  protected async saveUnique(work: (trx: TransactionClientContract) => Promise<void>) {
    try {
      await db.transaction(work)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BusinessRuleException('holidays.errors.duplicate', { field: 'name' })
      }
      throw error
    }
  }

  /* ------------------------------------------------------------------ */
  /* Reading for the back-office                                         */
  /* ------------------------------------------------------------------ */

  /** Listed rows (enabled and disabled) between two dates, for the month calendar. */
  async monthRows(schoolId: number, from: IsoDate, to: IsoDate) {
    return Holiday.query()
      .withScopes((scopes) => scopes.listed())
      .where('school_id', schoolId)
      .whereBetween('date', [from, to])
      .orderBy('date')
      .orderBy('name')
  }

  /** Full extent of ranges (some of their days may be outside the shown month). */
  async groupSummaries(schoolId: number, groupIds: string[]) {
    if (groupIds.length === 0) return []
    const rows = await db
      .from('holidays')
      .where('school_id', schoolId)
      .whereIn('group_id', [...new Set(groupIds)])
      .whereNull('deleted_at')
      .groupBy('group_id')
      .select(
        'group_id',
        db.raw('min(date) AS start_date'),
        db.raw('max(date) AS end_date'),
        db.raw('count(*)::int AS days'),
        db.raw('bool_or(is_active) AS is_active')
      )
    return rows.map((row) => ({
      groupId: String(row.group_id),
      startDate: String(row.start_date),
      endDate: String(row.end_date),
      days: Number(row.days),
      isActive: Boolean(row.is_active),
    }))
  }

  /**
   * List view: one entry per range (group) or single holiday, filtered and
   * paginated in SQL.
   */
  async list(school: School, filters: HolidayListFilters, today: IsoDate) {
    const base = db
      .from('holidays')
      .where('school_id', school.id)
      .whereNull('deleted_at')
      .groupByRaw("coalesce(group_id::text, 'h' || id::text), group_id, source")
      .select(
        db.raw("coalesce(group_id::text, 'h' || id::text) AS key"),
        db.raw('CASE WHEN group_id IS NULL THEN min(id) END AS id'),
        'group_id',
        'source',
        db.raw('min(name) AS name'),
        db.raw('min(date) AS start_date'),
        db.raw('max(date) AS end_date'),
        db.raw('count(*)::int AS days'),
        db.raw('bool_or(is_active) AS is_active'),
        db.raw('bool_or(rule_key IS NOT NULL) AS generated')
      )

    if (filters.source) base.where('source', filters.source)
    if (filters.q) base.whereILike('name', likePattern(filters.q))
    if (filters.status === 'active') base.havingRaw('bool_or(is_active)')
    if (filters.status === 'disabled') base.havingRaw('NOT bool_or(is_active)')
    const period = filters.period ?? 'school_year'
    if (period === 'school_year') {
      base.havingRaw('max(date) >= ? AND min(date) <= ?', [
        school.schoolYearStart,
        school.schoolYearEnd,
      ])
    } else if (period === 'upcoming') {
      base.havingRaw('max(date) >= ?', [today])
    }

    const totalRow = await db.from(base.clone().as('entries')).count('* as total').first()
    const total = Number(totalRow?.total ?? 0)
    const perPage = HOLIDAYS_PER_PAGE
    const lastPage = Math.max(1, Math.ceil(total / perPage))
    const currentPage = Math.min(Math.max(1, filters.page ?? 1), lastPage)
    const rows = await base
      .orderBy('start_date')
      .orderBy('name')
      .limit(perPage)
      .offset((currentPage - 1) * perPage)

    const entries: HolidayEntry[] = rows.map((row) => ({
      key: String(row.key),
      id: row.id === null ? null : Number(row.id),
      groupId: row.group_id ?? null,
      name: String(row.name),
      source: row.source as HolidaySource,
      startDate: String(row.start_date),
      endDate: String(row.end_date),
      days: Number(row.days),
      isActive: Boolean(row.is_active),
      generated: Boolean(row.generated),
    }))
    return { entries, meta: { total, perPage, currentPage, lastPage } }
  }
}
