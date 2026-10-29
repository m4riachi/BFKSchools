import db from '@adonisjs/lucid/services/db'
import type { IsoDate } from '#support/dates'
import { isProvisional, monthRange, type StatementMonth } from '#support/statement_month'

/**
 * Monthly statements (brief §5.5, docs/PLAN.md Phase 8). Derived data — no
 * table: everything comes from the **price snapshots** of
 * `meal_order_items` (`unit_price_cents`, generated `line_total_cents`) of
 * **active** orders dated inside the month. Cancelled days (absent,
 * holiday, menu change, staff, inactive child, subscription ended) and
 * days without an order contribute nothing. Amounts are integer centimes
 * summed by PostgreSQL; the few additions done here are on safe integers.
 *
 * D31 (supersedes D1): subscription meals are free — they are **counted**
 * (shown as "included in the subscription") but never priced, whatever
 * their historical snapshot. Only supplements are billed, per item at
 * their snapshot price. The old `billing_mode` / `monthly_fee` settings
 * are gone (D29 obsolete).
 *
 * Authorization is the caller's job: the family statement receives the
 * children the user may see (`Child.visibleTo`), the school overview a
 * school the staff member belongs to.
 */

/** One billed supplement line: a meal at one snapshot price. */
export type StatementLine = {
  mealId: number
  nameFr: string | null
  nameEn: string | null
  unitPriceCents: number
  quantity: number
  amountCents: number
}

export type StatementDayItem = {
  mealId: number
  mealType: 'subscription' | 'supplement'
  nameFr: string
  nameEn: string
  quantity: number
  /** Supplements: snapshot price. Subscription meals: 0 (included). */
  unitPriceCents: number
  /** Supplements: snapshot line total. Subscription meals: 0 (included). */
  lineTotalCents: number
}

export type StatementDay = { date: IsoDate; items: StatementDayItem[]; totalCents: number }

export type ChildStatement = {
  childId: number
  firstName: string
  lastName: string
  grade: string | null
  className: string | null
  isActive: boolean
  subscribed: boolean
  /** Subscription meals eaten this month (active orders) — included, no amount. */
  subscription: { count: number }
  supplements: { count: number; amountCents: number; lines: StatementLine[] }
  /** What is billed: the supplements. */
  totalCents: number
  days: StatementDay[]
}

export type StatementTotals = {
  /** Subscription meals (included, never billed). */
  subscriptionCount: number
  supplementCount: number
  /** Billed amount = supplements only (D31). */
  totalCents: number
}

export type FamilyStatement = {
  month: StatementMonth
  from: IsoDate
  to: IsoDate
  provisional: boolean
  parent: { id: number; fullName: string; email: string }
  children: ChildStatement[]
  totals: StatementTotals
}

export type StatementChildInput = {
  id: number
  firstName: string
  lastName: string
  grade: string | null
  className: string | null
  isActive: boolean
}

/** One family of the school overview (no daily detail). */
export type FamilySummary = {
  parentId: number
  parentName: string
  parentEmail: string
  children: Array<{
    childId: number
    firstName: string
    lastName: string
    grade: string | null
    className: string | null
    subscribed: boolean
    totals: StatementTotals
  }>
  totals: StatementTotals
}

export type SchoolStatement = {
  month: StatementMonth
  from: IsoDate
  to: IsoDate
  provisional: boolean
  families: FamilySummary[]
  totals: StatementTotals & { families: number; children: number }
}

/** Rows of the school overview at most (≈ one per child of the school). */
export const MAX_SCHOOL_STATEMENT_CHILDREN = 20_000

function cents(value: unknown): number {
  const number = Number(value ?? 0)
  if (!Number.isSafeInteger(number)) throw new TypeError(`Unsafe integer from SQL: ${value}`)
  return number
}

function sum(values: number[]): number {
  const total = values.reduce((acc, value) => acc + value, 0)
  if (!Number.isSafeInteger(total)) throw new RangeError('Amount overflow')
  return total
}

function emptyTotals(): StatementTotals {
  return { subscriptionCount: 0, supplementCount: 0, totalCents: 0 }
}

function addTotals(target: StatementTotals, part: StatementTotals) {
  target.subscriptionCount = sum([target.subscriptionCount, part.subscriptionCount])
  target.supplementCount = sum([target.supplementCount, part.supplementCount])
  target.totalCents = sum([target.totalCents, part.totalCents])
}

/** Active subscription overlapping [from, to] (same rule as "covers a date", widened to a range). */
const SUBSCRIBED_SQL = `EXISTS (
  SELECT 1 FROM subscriptions s
   WHERE s.child_id = c.id AND s.status = 'active'
     AND s.start_date <= ?::date AND (s.end_date IS NULL OR s.end_date >= ?::date))`

export default class StatementService {
  /**
   * Statement of one family for a month: one section per child (children
   * given by the caller, already authorized), with the number of
   * subscription meals (included), one line per supplement item (meal ×
   * snapshot price) and the daily detail. Inactive children appear only
   * when they ate something that month.
   */
  async family(input: {
    parent: { id: number; fullName: string; email: string }
    children: StatementChildInput[]
    month: StatementMonth
    today: IsoDate
  }): Promise<FamilyStatement> {
    const { from, to } = monthRange(input.month)
    const ids = input.children.map((child) => child.id)

    const [grouped, detail, subscribed] = ids.length
      ? await Promise.all([
          db.rawQuery(
            `SELECT mo.child_id, moi.meal_type,
                    CASE WHEN moi.meal_type = 'supplement' THEN moi.meal_id END AS meal_id,
                    CASE WHEN moi.meal_type = 'supplement' THEN moi.unit_price_cents ELSE 0 END AS unit_price_cents,
                    SUM(moi.quantity)::bigint AS quantity,
                    SUM(CASE WHEN moi.meal_type = 'supplement' THEN moi.line_total_cents ELSE 0 END)::bigint AS amount
               FROM meal_orders mo
               JOIN meal_order_items moi ON moi.meal_order_id = mo.id
              WHERE mo.child_id = ANY(?::int[]) AND mo.status = 'active'
                AND mo.date BETWEEN ?::date AND ?::date
              GROUP BY 1, 2, 3, 4
              ORDER BY mo.child_id, moi.meal_type ASC, 4`,
            [ids, from, to]
          ),
          db.rawQuery(
            `SELECT mo.child_id, mo.date, moi.meal_id, moi.meal_type, moi.quantity,
                    moi.unit_price_cents, moi.line_total_cents, m.name_fr, m.name_en
               FROM meal_orders mo
               JOIN meal_order_items moi ON moi.meal_order_id = mo.id
               JOIN meals m ON m.id = moi.meal_id
              WHERE mo.child_id = ANY(?::int[]) AND mo.status = 'active'
                AND mo.date BETWEEN ?::date AND ?::date
              ORDER BY mo.child_id, mo.date, moi.meal_type ASC, moi.id`,
            [ids, from, to]
          ),
          db.rawQuery(
            `SELECT c.id FROM children c WHERE c.id = ANY(?::int[]) AND ${SUBSCRIBED_SQL}`,
            [ids, to, from]
          ),
        ])
      : [{ rows: [] }, { rows: [] }, { rows: [] }]

    const subscribedIds = new Set<number>(
      subscribed.rows.map((row: { id: number }) => Number(row.id))
    )

    // Supplement names come from the detail rows (same meals).
    const names = new Map<number, { nameFr: string; nameEn: string }>()
    const daysByChild = new Map<number, StatementDay[]>()
    for (const row of detail.rows) {
      const childId = Number(row.child_id)
      const mealId = Number(row.meal_id)
      names.set(mealId, { nameFr: String(row.name_fr), nameEn: String(row.name_en) })
      const days = daysByChild.get(childId) ?? []
      let day = days[days.length - 1]
      if (!day || day.date !== String(row.date)) {
        day = { date: String(row.date), items: [], totalCents: 0 }
        days.push(day)
      }
      const billed = row.meal_type === 'supplement'
      const lineTotalCents = billed ? cents(row.line_total_cents) : 0
      day.items.push({
        mealId,
        mealType: billed ? 'supplement' : 'subscription',
        nameFr: String(row.name_fr),
        nameEn: String(row.name_en),
        quantity: cents(row.quantity),
        unitPriceCents: billed ? cents(row.unit_price_cents) : 0,
        lineTotalCents,
      })
      day.totalCents = sum([day.totalCents, lineTotalCents])
      daysByChild.set(childId, days)
    }

    const partsByChild = new Map<number, { subscriptionCount: number; lines: StatementLine[] }>()
    for (const row of grouped.rows) {
      const childId = Number(row.child_id)
      const entry = partsByChild.get(childId) ?? { subscriptionCount: 0, lines: [] }
      if (row.meal_type === 'supplement') {
        const mealId = Number(row.meal_id)
        const name = names.get(mealId)
        entry.lines.push({
          mealId,
          nameFr: name?.nameFr ?? null,
          nameEn: name?.nameEn ?? null,
          unitPriceCents: cents(row.unit_price_cents),
          quantity: cents(row.quantity),
          amountCents: cents(row.amount),
        })
      } else {
        entry.subscriptionCount = sum([entry.subscriptionCount, cents(row.quantity)])
      }
      partsByChild.set(childId, entry)
    }

    const children: ChildStatement[] = []
    const totals = emptyTotals()
    for (const child of input.children) {
      const part = partsByChild.get(child.id) ?? { subscriptionCount: 0, lines: [] }
      // Supplements: by name in the reader's order is done at display; here by French name.
      const supplementLines = [...part.lines].sort(
        (a, b) =>
          (a.nameFr ?? '').localeCompare(b.nameFr ?? '') || a.unitPriceCents - b.unitPriceCents
      )
      const supplements = {
        count: sum(supplementLines.map((line) => line.quantity)),
        amountCents: sum(supplementLines.map((line) => line.amountCents)),
        lines: supplementLines,
      }
      const totalCents = supplements.amountCents
      const ate = part.subscriptionCount > 0 || supplements.count > 0
      if (!child.isActive && !ate) continue
      children.push({
        childId: child.id,
        firstName: child.firstName,
        lastName: child.lastName,
        grade: child.grade,
        className: child.className,
        isActive: child.isActive,
        subscribed: subscribedIds.has(child.id),
        subscription: { count: part.subscriptionCount },
        supplements,
        totalCents,
        days: daysByChild.get(child.id) ?? [],
      })
      addTotals(totals, {
        subscriptionCount: part.subscriptionCount,
        supplementCount: supplements.count,
        totalCents,
      })
    }

    return {
      month: input.month,
      from,
      to,
      provisional: isProvisional(input.month, input.today),
      parent: input.parent,
      children,
      totals,
    }
  }

  /**
   * Every family of the school with at least one meal this month (active
   * orders): one aggregate query, families sorted by parent name.
   */
  async school(
    school: { id: number },
    month: StatementMonth,
    today: IsoDate
  ): Promise<SchoolStatement> {
    const { from, to } = monthRange(month)
    const result = await db.rawQuery(
      `WITH amounts AS (
         SELECT mo.child_id,
                COALESCE(SUM(moi.quantity) FILTER (WHERE moi.meal_type = 'subscription'), 0)::bigint AS sub_count,
                COALESCE(SUM(moi.quantity) FILTER (WHERE moi.meal_type = 'supplement'), 0)::bigint AS sup_count,
                COALESCE(SUM(moi.line_total_cents) FILTER (WHERE moi.meal_type = 'supplement'), 0)::bigint AS sup_cents
           FROM meal_orders mo
           JOIN meal_order_items moi ON moi.meal_order_id = mo.id
          WHERE mo.school_id = ? AND mo.status = 'active' AND mo.date BETWEEN ?::date AND ?::date
          GROUP BY mo.child_id)
       SELECT c.id AS child_id, c.first_name, c.last_name, c.grade, c.class_name,
              u.id AS parent_id, u.full_name, u.email,
              a.sub_count, a.sup_count, a.sup_cents,
              ${SUBSCRIBED_SQL} AS subscribed
         FROM amounts a
         JOIN children c ON c.id = a.child_id
         JOIN users u ON u.id = c.parent_id
        ORDER BY lower(u.full_name), u.id, lower(c.first_name), c.id
        LIMIT ?`,
      [school.id, from, to, to, from, MAX_SCHOOL_STATEMENT_CHILDREN + 1]
    )
    if (result.rows.length > MAX_SCHOOL_STATEMENT_CHILDREN) {
      throw new RangeError('Too many children for one statement overview')
    }

    const families: FamilySummary[] = []
    const totals = { ...emptyTotals(), families: 0, children: 0 }
    for (const row of result.rows) {
      const parentId = Number(row.parent_id)
      let family = families[families.length - 1]
      if (!family || family.parentId !== parentId) {
        family = {
          parentId,
          parentName: String(row.full_name),
          parentEmail: String(row.email),
          children: [],
          totals: emptyTotals(),
        }
        families.push(family)
      }
      const childTotals: StatementTotals = {
        subscriptionCount: cents(row.sub_count),
        supplementCount: cents(row.sup_count),
        totalCents: cents(row.sup_cents),
      }
      family.children.push({
        childId: Number(row.child_id),
        firstName: String(row.first_name),
        lastName: String(row.last_name),
        grade: row.grade ?? null,
        className: row.class_name ?? null,
        subscribed: Boolean(row.subscribed),
        totals: childTotals,
      })
      addTotals(family.totals, childTotals)
      addTotals(totals, childTotals)
      totals.children += 1
    }
    totals.families = families.length

    return {
      month,
      from,
      to,
      provisional: isProvisional(month, today),
      families,
      totals,
    }
  }
}
