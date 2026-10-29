import db from '@adonisjs/lucid/services/db'
import type { RawQueryBindings } from '@adonisjs/lucid/types/querybuilder'
import type { AllergenCode } from '#enums/allergens'
import type { MealCategory, MealType } from '#enums/meals'
import { isIsoDate, type IsoDate } from '#support/dates'

/**
 * Phase 7 read models (brief §5.7, §5.8). Every number comes from SQL
 * aggregations over **active** orders only (`meal_orders.status = 'active'`
 * — cancelled rows, whatever their reason, never count), scoped to one
 * school, with a fixed number of queries per call (no N+1: lines, meals and
 * children are fetched with joins / `whereIn`, never per row).
 *
 * Holidays: no special case is needed — the holiday impact service cancels
 * the orders of a day that becomes a holiday, so a holiday has no active
 * order and its sheet is empty. Today's orders are kept when today becomes
 * a holiday (the kitchen is already cooking) and still show here.
 *
 * Meals are read through plain joins (no `deleted_at` filter): a meal
 * deleted after being ordered still appears with its name.
 *
 * Indexes used (EXPLAIN in docs/STACK_NOTES.md, Phase 7): `meal_orders
 * (school_id, date)`, `meal_order_items (meal_order_id, menu_item_id)`
 * unique, `children` pk, `subscriptions (child_id, start_date)`,
 * `menu_items (date)`.
 */

/** Grade / class used as group keys ('' when the child has none). */
export type GroupKey = string

export type MealRef = {
  id: number
  nameFr: string
  nameEn: string
  type: MealType
  category: MealCategory
  allergens: AllergenCode[]
}

export type QuantityBreakdown = {
  total: number
  byGrade: Record<GroupKey, number>
  byClass: Record<GroupKey, number>
}

export type ProductionLine = QuantityBreakdown & {
  meal: MealRef
  /** Snapshot type of the order line (a meal's type never changes, but the line is the truth). */
  mealType: MealType
}

export type ProductionSheet = {
  date: IsoDate
  /** Grades and classes present in the day's active orders, sorted. */
  grades: GroupKey[]
  classes: { className: GroupKey; grade: GroupKey }[]
  /** Subscription meals first (most ordered first), then supplements. */
  lines: ProductionLine[]
  totals: { subscription: QuantityBreakdown; supplement: QuantityBreakdown }
  orders: {
    /** Children with an active order. */
    active: number
    /** "No meal this day" chosen by the parent (cancelled, reason `absent`). */
    absent: number
    /** Other cancellations (holiday, staff, menu change, …). */
    cancelled: number
    /** Children with allergies among the active orders. */
    withAllergies: number
  }
}

export type MissingSelection = {
  /** Active subscribed children (active parent) for that date. */
  eligible: number
  /** Of those, children with no order row at all (a cancelled `absent` row is a choice). */
  missing: number
  /** The first missing children (sorted by class, name) — staff can chase them. */
  children: { id: number; firstName: string; lastName: string; className: string | null }[]
}

/** Billed amounts of a period (D31: supplements only; subscription meals are counted, never priced). */
export type Amounts = {
  /** Subscription meals served (included in the subscription, no amount). */
  subscriptionMeals: number
  /** Supplement portions. */
  supplementCount: number
  /** What is billed: the supplements' snapshot amounts. */
  totalCents: number
  /** Active orders in the period. */
  orders: number
}

export type AllergyLine = {
  mealId: number
  nameFr: string
  nameEn: string
  mealType: MealType
  quantity: number
  allergens: AllergenCode[]
  /** The child's allergens found in this meal (should be empty with D9 "block"). */
  conflicts: AllergenCode[]
}

export type AllergyRow = {
  childId: number
  firstName: string
  lastName: string
  grade: string | null
  className: string | null
  allergies: AllergenCode[]
  dietaryNotes: string | null
  lines: AllergyLine[]
  /** True when one of the day's meals contains one of the child's allergens. */
  hasConflict: boolean
}

export type LabelRow = {
  orderId: number
  date: IsoDate
  firstName: string
  lastName: string
  grade: string | null
  className: string | null
  allergies: AllergenCode[]
  lines: AllergyLine[]
  hasConflict: boolean
}

export type ExportFilters = {
  from: IsoDate
  to: IsoDate
  className?: string | null
  mealType?: MealType | null
}

export type ExportDetailRow = {
  date: IsoDate
  grade: string | null
  className: string | null
  lastName: string
  firstName: string
  allergies: AllergenCode[]
  mealType: MealType
  mealCategory: MealCategory
  nameFr: string
  nameEn: string
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
}

export type ExportSummaryRow = {
  date: IsoDate
  grade: string | null
  className: string | null
  mealType: MealType
  mealCategory: MealCategory
  nameFr: string
  nameEn: string
  quantity: number
  amountCents: number
}

export type DayMenuState = {
  date: IsoDate
  /** A published (or closed) menu has current items on that date. */
  hasMenu: boolean
}

/** Pre-kindergarten / kindergarten grades first, then by number ("G2" < "G10"). */
export function compareGrades(a: string, b: string): number {
  const rank = (grade: string) => {
    if (!grade) return 3
    if (/^(pk|pre|ps|ms|gs|nursery)/i.test(grade)) return 0
    if (/^(kg|k\b|k\d|kinder)/i.test(grade)) return 1
    return 2
  }
  return rank(a) - rank(b) || a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
}

function compareClasses(a: string, b: string): number {
  if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1)
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
}

function toInt(value: unknown): number {
  const number = Number(value ?? 0)
  if (!Number.isSafeInteger(number)) throw new TypeError(`Unsafe integer from SQL: ${value}`)
  return number
}

function emptyBreakdown(): QuantityBreakdown {
  return { total: 0, byGrade: {}, byClass: {} }
}

function add(target: QuantityBreakdown, grade: GroupKey, className: GroupKey, quantity: number) {
  target.total += quantity
  target.byGrade[grade] = (target.byGrade[grade] ?? 0) + quantity
  target.byClass[className] = (target.byClass[className] ?? 0) + quantity
}

function assertDate(...dates: IsoDate[]) {
  for (const date of dates) if (!isIsoDate(date)) throw new TypeError(`Invalid ISO date "${date}"`)
}

type RawLine = {
  meal_id: number
  meal_type: MealType
  quantity: number
  name_fr: string
  name_en: string
  allergens: AllergenCode[] | null
  conflicts: AllergenCode[] | null
}

function toAllergyLine(row: RawLine): AllergyLine {
  return {
    mealId: Number(row.meal_id),
    nameFr: row.name_fr,
    nameEn: row.name_en,
    mealType: row.meal_type,
    quantity: Number(row.quantity),
    allergens: [...(row.allergens ?? [])],
    conflicts: [...(row.conflicts ?? [])],
  }
}

/** Lines of the day's active orders, with the child, the meal and the allergen overlap. */
const ORDER_LINES_SQL = `
  SELECT mo.id AS order_id, mo.date, c.id AS child_id, c.first_name, c.last_name, c.grade,
         c.class_name, c.allergies, c.dietary_notes,
         moi.meal_id, moi.meal_type, moi.quantity, m.name_fr, m.name_en, m.allergens,
         ARRAY(SELECT unnest(c.allergies) INTERSECT SELECT unnest(m.allergens)) AS conflicts
    FROM meal_orders mo
    JOIN children c ON c.id = mo.child_id
    JOIN meal_order_items moi ON moi.meal_order_id = mo.id
    JOIN meals m ON m.id = moi.meal_id
   WHERE mo.school_id = ? AND mo.date = ? AND mo.status = 'active'`

export default class ProductionReportService {
  /* ---------------------------------------------------------------------- */
  /* Production sheet (quantities per meal, by grade and class)             */
  /* ---------------------------------------------------------------------- */

  /** Three queries: quantities, meals, order counts. */
  async production(schoolId: number, date: IsoDate): Promise<ProductionSheet> {
    assertDate(date)
    const cells = await db.rawQuery(
      `SELECT moi.meal_id, moi.meal_type, COALESCE(c.grade, '') AS grade,
              COALESCE(c.class_name, '') AS class_name, SUM(moi.quantity)::int AS quantity
         FROM meal_orders mo
         JOIN meal_order_items moi ON moi.meal_order_id = mo.id
         JOIN children c ON c.id = mo.child_id
        WHERE mo.school_id = ? AND mo.date = ? AND mo.status = 'active'
        GROUP BY moi.meal_id, moi.meal_type, COALESCE(c.grade, ''), COALESCE(c.class_name, '')`,
      [schoolId, date]
    )
    const rows = cells.rows as {
      meal_id: number
      meal_type: MealType
      grade: string
      class_name: string
      quantity: number
    }[]
    const meals = await this.meals(rows.map((row) => Number(row.meal_id)))

    const lines = new Map<string, ProductionLine>()
    const totals = { subscription: emptyBreakdown(), supplement: emptyBreakdown() }
    const grades = new Set<string>()
    const classes = new Map<string, string>()
    for (const row of rows) {
      const meal = meals.get(Number(row.meal_id))!
      const key = `${row.meal_type}:${meal.id}`
      let line = lines.get(key)
      if (!line) {
        line = { meal, mealType: row.meal_type, ...emptyBreakdown() }
        lines.set(key, line)
      }
      const quantity = toInt(row.quantity)
      add(line, row.grade, row.class_name, quantity)
      add(totals[row.meal_type], row.grade, row.class_name, quantity)
      grades.add(row.grade)
      if (!classes.has(row.class_name)) classes.set(row.class_name, row.grade)
    }

    const counts = await db.rawQuery(
      `SELECT count(*) FILTER (WHERE mo.status = 'active')::int AS active,
              count(*) FILTER (WHERE mo.cancel_reason = 'absent')::int AS absent,
              count(*) FILTER (WHERE mo.status = 'cancelled' AND mo.cancel_reason <> 'absent')::int AS cancelled,
              count(*) FILTER (WHERE mo.status = 'active' AND cardinality(c.allergies) > 0)::int AS with_allergies
         FROM meal_orders mo
         JOIN children c ON c.id = mo.child_id
        WHERE mo.school_id = ? AND mo.date = ?`,
      [schoolId, date]
    )
    const count = counts.rows[0] ?? {}

    return {
      date,
      grades: [...grades].sort(compareGrades),
      classes: [...classes.entries()]
        .map(([className, grade]) => ({ className, grade }))
        .sort(
          (a, b) => compareGrades(a.grade, b.grade) || compareClasses(a.className, b.className)
        ),
      lines: [...lines.values()].sort(
        (a, b) =>
          (a.mealType === b.mealType ? 0 : a.mealType === 'subscription' ? -1 : 1) ||
          b.total - a.total ||
          a.meal.nameFr.localeCompare(b.meal.nameFr, 'fr')
      ),
      totals,
      orders: {
        active: toInt(count.active),
        absent: toInt(count.absent),
        cancelled: toInt(count.cancelled),
        withAllergies: toInt(count.with_allergies),
      },
    }
  }

  /** Meals by id, deleted ones included (history). One query. */
  protected async meals(ids: number[]): Promise<Map<number, MealRef>> {
    const unique = [...new Set(ids)]
    if (!unique.length) return new Map()
    const rows = await db
      .from('meals')
      .whereIn('id', unique)
      .select('id', 'name_fr', 'name_en', 'type', 'category', 'allergens')
    return new Map(
      rows.map((row) => [
        Number(row.id),
        {
          id: Number(row.id),
          nameFr: row.name_fr,
          nameEn: row.name_en,
          type: row.type,
          category: row.category,
          allergens: [...(row.allergens ?? [])],
        },
      ])
    )
  }

  /* ---------------------------------------------------------------------- */
  /* Children without a selection                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * Active children of an active parent, with an active subscription
   * covering `date`, and **no order row** on that date (Phase 6 semantics:
   * a cancelled `absent` row is a choice, not "no selection"). Callers only
   * ask for open school days. Two queries.
   */
  async missingSelections(schoolId: number, date: IsoDate, limit = 20): Promise<MissingSelection> {
    assertDate(date)
    const base = `
      FROM children c
      JOIN users u ON u.id = c.parent_id
     WHERE c.school_id = ? AND c.is_active AND u.is_active
       AND EXISTS (
         SELECT 1 FROM subscriptions s
          WHERE s.child_id = c.id AND s.status = 'active'
            AND s.start_date <= ? AND (s.end_date IS NULL OR s.end_date >= ?))`
    const noRow = `NOT EXISTS (SELECT 1 FROM meal_orders o WHERE o.child_id = c.id AND o.date = ?)`
    const counts = await db.rawQuery(
      `SELECT count(*)::int AS eligible, count(*) FILTER (WHERE ${noRow})::int AS missing ${base}`,
      [date, schoolId, date, date]
    )
    const first = await db.rawQuery(
      `SELECT c.id, c.first_name, c.last_name, c.class_name ${base} AND ${noRow}
        ORDER BY c.class_name NULLS LAST, c.last_name, c.first_name, c.id
        LIMIT ?`,
      [schoolId, date, date, date, limit]
    )
    return {
      eligible: toInt(counts.rows[0]?.eligible),
      missing: toInt(counts.rows[0]?.missing),
      children: first.rows.map(
        (row: {
          id: number
          first_name: string
          last_name: string
          class_name: string | null
        }) => ({
          id: Number(row.id),
          firstName: row.first_name,
          lastName: row.last_name,
          className: row.class_name,
        })
      ),
    }
  }

  /**
   * Selection progress of a week: among the children eligible on at least
   * one of `dates` (open days with meals), how many have an order row on
   * **every** date they are eligible for (`complete`) or on at least one
   * (`started`). One query.
   */
  async weekSelection(schoolId: number, dates: IsoDate[]) {
    assertDate(...dates)
    if (!dates.length) return { children: 0, complete: 0, started: 0 }
    const result = await db.rawQuery(
      `WITH days AS (SELECT unnest(?::date[]) AS day),
            eligible AS (
              SELECT c.id AS child_id, d.day
                FROM children c
                JOIN users u ON u.id = c.parent_id
               CROSS JOIN days d
               WHERE c.school_id = ? AND c.is_active AND u.is_active
                 AND EXISTS (
                   SELECT 1 FROM subscriptions s
                    WHERE s.child_id = c.id AND s.status = 'active'
                      AND s.start_date <= d.day AND (s.end_date IS NULL OR s.end_date >= d.day))),
            per_child AS (
              SELECT e.child_id, bool_and(o.id IS NOT NULL) AS complete,
                     bool_or(o.id IS NOT NULL) AS started
                FROM eligible e
                LEFT JOIN meal_orders o ON o.child_id = e.child_id AND o.date = e.day
               GROUP BY e.child_id)
       SELECT count(*)::int AS children,
              count(*) FILTER (WHERE complete)::int AS complete,
              count(*) FILTER (WHERE started)::int AS started
         FROM per_child`,
      [dates, schoolId] as RawQueryBindings
    )
    const row = result.rows[0] ?? {}
    return {
      children: toInt(row.children),
      complete: toInt(row.complete),
      started: toInt(row.started),
    }
  }

  /**
   * Which of `dates` have a published (or closed) menu with current items.
   * One query.
   */
  async menuDays(schoolId: number, dates: IsoDate[]): Promise<Set<IsoDate>> {
    assertDate(...dates)
    if (!dates.length) return new Set()
    const rows = await db
      .from('menu_items as mi')
      .join('weekly_menus as wm', 'wm.id', 'mi.weekly_menu_id')
      .where('wm.school_id', schoolId)
      .whereIn('wm.status', ['published', 'closed'])
      .whereIn('mi.date', dates)
      .whereNull('mi.removed_at')
      .distinct('mi.date')
    return new Set(rows.map((row) => String(row.date)))
  }

  /* ---------------------------------------------------------------------- */
  /* Amounts                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Billed amounts of a period (both dates included). D31: only supplements
   * are billed (sum of their snapshot `line_total_cents` on active orders);
   * subscription meals are only counted. One query, integer centimes.
   */
  async amounts(schoolId: number, from: IsoDate, to: IsoDate): Promise<Amounts> {
    assertDate(from, to)
    const result = await db.rawQuery(
      `SELECT COALESCE(SUM(moi.quantity) FILTER (WHERE moi.meal_type = 'subscription'), 0)::bigint AS subscription_meals,
              COALESCE(SUM(moi.quantity) FILTER (WHERE moi.meal_type = 'supplement'), 0)::bigint AS supplement_count,
              COALESCE(SUM(moi.line_total_cents) FILTER (WHERE moi.meal_type = 'supplement'), 0)::bigint AS supplement,
              count(DISTINCT mo.id)::int AS orders
         FROM meal_orders mo
         JOIN meal_order_items moi ON moi.meal_order_id = mo.id
        WHERE mo.school_id = ? AND mo.status = 'active' AND mo.date BETWEEN ? AND ?`,
      [schoolId, from, to]
    )
    const row = result.rows[0] ?? {}
    return {
      subscriptionMeals: toInt(row.subscription_meals),
      supplementCount: toInt(row.supplement_count),
      totalCents: toInt(row.supplement),
      orders: toInt(row.orders),
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Allergy sheet and labels                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Children with allergies or dietary notes who eat that day (active
   * order), with their meals and the allergens of each meal that overlap
   * theirs (`child.allergies && meal.allergens`). With D9 "block" a
   * conflict can only come from a staff override, an allergy added after
   * ordering, or a meal's allergens edited later — those rows come first.
   * One query.
   */
  async allergySheet(schoolId: number, date: IsoDate): Promise<AllergyRow[]> {
    assertDate(date)
    const result = await db.rawQuery(
      `${ORDER_LINES_SQL}
         AND (cardinality(c.allergies) > 0 OR NULLIF(btrim(c.dietary_notes), '') IS NOT NULL)
       ORDER BY c.class_name NULLS LAST, c.last_name, c.first_name, c.id,
                moi.meal_type ASC, moi.id`,
      [schoolId, date]
    )
    const rows = new Map<number, AllergyRow>()
    for (const raw of result.rows) {
      const childId = Number(raw.child_id)
      let row = rows.get(childId)
      if (!row) {
        row = {
          childId,
          firstName: raw.first_name,
          lastName: raw.last_name,
          grade: raw.grade,
          className: raw.class_name,
          allergies: [...(raw.allergies ?? [])],
          dietaryNotes: raw.dietary_notes?.trim() || null,
          lines: [],
          hasConflict: false,
        }
        rows.set(childId, row)
      }
      const line = toAllergyLine(raw)
      row.lines.push(line)
      if (line.conflicts.length) row.hasConflict = true
    }
    // Stable: conflicts first, then the SQL order (class, name).
    const list = [...rows.values()]
    return [...list.filter((row) => row.hasConflict), ...list.filter((row) => !row.hasConflict)]
  }

  /** Active orders of the day (for the label count / cap). One query. */
  async countLabels(schoolId: number, date: IsoDate, className?: string | null): Promise<number> {
    assertDate(date)
    const query = db
      .from('meal_orders as mo')
      .join('children as c', 'c.id', 'mo.child_id')
      .where('mo.school_id', schoolId)
      .where('mo.date', date)
      .where('mo.status', 'active')
    if (className) query.where('c.class_name', className)
    const row = await query.count('* as total').first()
    return toInt(row?.total)
  }

  /**
   * One label per active order of the day, sorted by class, then last and
   * first name. `limit` bounds memory (the controller checks the count
   * first). One query.
   */
  async labels(
    schoolId: number,
    date: IsoDate,
    options: { className?: string | null; limit: number }
  ): Promise<LabelRow[]> {
    assertDate(date)
    const bindings: (string | number)[] = [schoolId, date]
    let filter = ''
    if (options.className) {
      filter = ' AND c.class_name = ?'
      bindings.push(options.className)
    }
    bindings.push(options.limit)
    const result = await db.rawQuery(
      `WITH picked AS (
         SELECT mo.id FROM meal_orders mo JOIN children c ON c.id = mo.child_id
          WHERE mo.school_id = ? AND mo.date = ? AND mo.status = 'active'${filter}
          ORDER BY c.class_name NULLS LAST, c.last_name, c.first_name, mo.id
          LIMIT ?)
       SELECT mo.id AS order_id, mo.date, c.first_name, c.last_name, c.grade, c.class_name,
              c.allergies, moi.meal_id, moi.meal_type, moi.quantity, m.name_fr, m.name_en,
              m.allergens,
              ARRAY(SELECT unnest(c.allergies) INTERSECT SELECT unnest(m.allergens)) AS conflicts
         FROM picked p
         JOIN meal_orders mo ON mo.id = p.id
         JOIN children c ON c.id = mo.child_id
         JOIN meal_order_items moi ON moi.meal_order_id = mo.id
         JOIN meals m ON m.id = moi.meal_id
        ORDER BY c.class_name NULLS LAST, c.last_name, c.first_name, mo.id,
                 moi.meal_type ASC, moi.id`,
      bindings
    )
    const labels = new Map<number, LabelRow>()
    for (const raw of result.rows) {
      const orderId = Number(raw.order_id)
      let label = labels.get(orderId)
      if (!label) {
        label = {
          orderId,
          date: String(raw.date),
          firstName: raw.first_name,
          lastName: raw.last_name,
          grade: raw.grade,
          className: raw.class_name,
          allergies: [...(raw.allergies ?? [])],
          lines: [],
          hasConflict: false,
        }
        labels.set(orderId, label)
      }
      const line = toAllergyLine(raw)
      label.lines.push(line)
      if (line.conflicts.length) label.hasConflict = true
    }
    return [...labels.values()]
  }

  /** Distinct class names of the school's children (filters). One query. */
  async classNames(schoolId: number): Promise<string[]> {
    const rows = await db
      .from('children')
      .where('school_id', schoolId)
      .whereNotNull('class_name')
      .distinct('class_name')
      .orderBy('class_name')
      .limit(500)
    return rows.map((row) => String(row.class_name))
  }

  /* ---------------------------------------------------------------------- */
  /* Exports                                                                */
  /* ---------------------------------------------------------------------- */

  protected exportBase(schoolId: number, filters: ExportFilters) {
    assertDate(filters.from, filters.to)
    const query = db
      .from('meal_orders as mo')
      .join('meal_order_items as moi', 'moi.meal_order_id', 'mo.id')
      .join('children as c', 'c.id', 'mo.child_id')
      .join('meals as m', 'm.id', 'moi.meal_id')
      .where('mo.school_id', schoolId)
      .where('mo.status', 'active')
      .whereBetween('mo.date', [filters.from, filters.to])
    if (filters.className) query.where('c.class_name', filters.className)
    if (filters.mealType) query.where('moi.meal_type', filters.mealType)
    return query
  }

  /** Number of rows an export would produce (checked against the cap first). */
  async countExportRows(
    schoolId: number,
    filters: ExportFilters,
    kind: 'detail' | 'summary'
  ): Promise<number> {
    const base = this.exportBase(schoolId, filters)
    if (kind === 'detail') {
      const row = await base.count('* as total').first()
      return toInt(row?.total)
    }
    const row = await db
      .from(
        base
          .groupBy('mo.date', 'moi.meal_type', 'moi.meal_id', 'c.grade', 'c.class_name')
          .select(db.raw('1'))
          .as('g')
      )
      .count('* as total')
      .first()
    return toInt(row?.total)
  }

  /**
   * One row per order line (date, class, child, meal, quantity, snapshot
   * price), in pages of `pageSize` (stable order, last key = item id).
   */
  async *exportDetail(
    schoolId: number,
    filters: ExportFilters,
    pageSize = 2000
  ): AsyncGenerator<ExportDetailRow[]> {
    for (let offset = 0; ; offset += pageSize) {
      const rows = await this.exportBase(schoolId, filters)
        .orderBy('mo.date')
        .orderByRaw('c.class_name ASC NULLS LAST')
        .orderBy('c.last_name')
        .orderBy('c.first_name')
        .orderBy('mo.id')
        .orderBy('moi.meal_type', 'asc')
        .orderBy('moi.id')
        .limit(pageSize)
        .offset(offset)
        .select(
          'mo.date',
          'c.grade',
          'c.class_name',
          'c.last_name',
          'c.first_name',
          'c.allergies',
          'moi.meal_type',
          'm.category',
          'm.name_fr',
          'm.name_en',
          'moi.quantity',
          'moi.unit_price_cents',
          'moi.line_total_cents'
        )
      if (!rows.length) return
      yield rows.map((row) => ({
        date: String(row.date),
        grade: row.grade,
        className: row.class_name,
        lastName: row.last_name,
        firstName: row.first_name,
        allergies: [...(row.allergies ?? [])],
        mealType: row.meal_type,
        mealCategory: row.category,
        nameFr: row.name_fr,
        nameEn: row.name_en,
        quantity: toInt(row.quantity),
        unitPriceCents: toInt(row.unit_price_cents),
        lineTotalCents: toInt(row.line_total_cents),
      }))
      if (rows.length < pageSize) return
    }
  }

  /** Quantities per date × meal × grade/class (production planning), in pages. */
  async *exportSummary(
    schoolId: number,
    filters: ExportFilters,
    pageSize = 2000
  ): AsyncGenerator<ExportSummaryRow[]> {
    for (let offset = 0; ; offset += pageSize) {
      const rows = await this.exportBase(schoolId, filters)
        .groupBy(
          'mo.date',
          'moi.meal_type',
          'moi.meal_id',
          'm.category',
          'm.name_fr',
          'm.name_en',
          'c.grade',
          'c.class_name'
        )
        .orderBy('mo.date')
        .orderBy('moi.meal_type', 'asc')
        .orderBy('m.name_fr')
        .orderBy('moi.meal_id')
        .orderByRaw('c.grade ASC NULLS LAST')
        .orderByRaw('c.class_name ASC NULLS LAST')
        .limit(pageSize)
        .offset(offset)
        .select(
          'mo.date',
          'moi.meal_type',
          'm.category',
          'm.name_fr',
          'm.name_en',
          'c.grade',
          'c.class_name',
          db.raw('SUM(moi.quantity)::int AS quantity'),
          db.raw('SUM(moi.line_total_cents)::bigint AS amount')
        )
      if (!rows.length) return
      yield rows.map((row) => ({
        date: String(row.date),
        grade: row.grade,
        className: row.class_name,
        mealType: row.meal_type,
        mealCategory: row.category,
        nameFr: row.name_fr,
        nameEn: row.name_en,
        quantity: toInt(row.quantity),
        amountCents: toInt(row.amount),
      }))
      if (rows.length < pageSize) return
    }
  }
}
