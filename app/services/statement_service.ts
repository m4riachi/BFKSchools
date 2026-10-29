import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type School from '#models/school'
import SchoolSettingsService from '#services/school_settings_service'
import type { BillingMode } from '#types/school_settings'
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
 * Billing mode (D1, school setting `billing_mode`):
 * - `per_meal` (default): every subscription meal at its snapshot price;
 * - `monthly_fee`: for a child with an **active subscription covering at
 *   least one day of the month** (status `active`, `start_date <= last day`,
 *   `end_date` null or `>= first day`), the subscription meals of the month
 *   are replaced by one fixed `monthly_fee_cents` line — **not prorated**
 *   (a subscription starting on the 20th pays the full fee). The meals are
 *   still counted (shown as included). A child without such a subscription
 *   (pay-per-meal schools, D2 switch) keeps per-meal amounts. Supplements
 *   are always billed per item. An unset fee counts as 0 and is flagged.
 *
 * Authorization is the caller's job: the family statement receives the
 * children the user may see (`Child.visibleTo`), the school overview a
 * school the staff member belongs to.
 */

export type StatementLine = {
  /** Supplement lines: the meal. Subscription lines: null (grouped by price). */
  mealId: number | null
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
  unitPriceCents: number
  lineTotalCents: number
}

export type StatementDay = { date: IsoDate; items: StatementDayItem[]; totalCents: number }

export type SubscriptionPart = {
  /** Number of subscription meals eaten (active orders) this month. */
  count: number
  /** Snapshot amounts of those meals (what `per_meal` bills). */
  mealsCents: number
  /** One line per snapshot unit price (a mid-month price change gives two). */
  lines: StatementLine[]
  /** How this child's subscription meals are billed this month. */
  billedAs: BillingMode
  /** `monthly_fee` only: the fee (0 when the setting is unset). */
  feeCents: number | null
  /** What is billed for subscription meals (snapshot sum, or the fee). */
  amountCents: number
}

export type ChildStatement = {
  childId: number
  firstName: string
  lastName: string
  grade: string | null
  className: string | null
  isActive: boolean
  subscribed: boolean
  subscription: SubscriptionPart
  supplements: { count: number; amountCents: number; lines: StatementLine[] }
  totalCents: number
  days: StatementDay[]
}

export type StatementTotals = {
  subscriptionCount: number
  subscriptionCents: number
  supplementCount: number
  supplementCents: number
  totalCents: number
}

export type FamilyStatement = {
  month: StatementMonth
  from: IsoDate
  to: IsoDate
  provisional: boolean
  billingMode: BillingMode
  feeMissing: boolean
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
    billedAs: BillingMode
    totals: StatementTotals
  }>
  totals: StatementTotals
}

export type SchoolStatement = {
  month: StatementMonth
  from: IsoDate
  to: IsoDate
  provisional: boolean
  billingMode: BillingMode
  feeMissing: boolean
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
  return {
    subscriptionCount: 0,
    subscriptionCents: 0,
    supplementCount: 0,
    supplementCents: 0,
    totalCents: 0,
  }
}

function addTotals(target: StatementTotals, part: StatementTotals) {
  target.subscriptionCount = sum([target.subscriptionCount, part.subscriptionCount])
  target.subscriptionCents = sum([target.subscriptionCents, part.subscriptionCents])
  target.supplementCount = sum([target.supplementCount, part.supplementCount])
  target.supplementCents = sum([target.supplementCents, part.supplementCents])
  target.totalCents = sum([target.totalCents, part.totalCents])
}

/** Active subscription overlapping [from, to] (same rule as "covers a date", widened to a range). */
const SUBSCRIBED_SQL = `EXISTS (
  SELECT 1 FROM subscriptions s
   WHERE s.child_id = c.id AND s.status = 'active'
     AND s.start_date <= ?::date AND (s.end_date IS NULL OR s.end_date >= ?::date))`

@inject()
export default class StatementService {
  constructor(protected settings: SchoolSettingsService) {}

  protected billing(school: Pick<School, 'settings'>) {
    const settings = this.settings.get(school)
    const mode: BillingMode = settings.billing_mode === 'monthly_fee' ? 'monthly_fee' : 'per_meal'
    const fee = settings.monthly_fee_cents
    const feeCents = Number.isSafeInteger(fee) && (fee as number) >= 0 ? (fee as number) : null
    return { mode, feeCents }
  }

  /** Subscription part of a child once the billing mode is applied. */
  protected subscriptionPart(
    count: number,
    mealsCents: number,
    lines: StatementLine[],
    subscribed: boolean,
    billing: { mode: BillingMode; feeCents: number | null }
  ): SubscriptionPart {
    if (billing.mode === 'monthly_fee' && subscribed) {
      const feeCents = billing.feeCents ?? 0
      return { count, mealsCents, lines, billedAs: 'monthly_fee', feeCents, amountCents: feeCents }
    }
    return {
      count,
      mealsCents,
      lines,
      billedAs: 'per_meal',
      feeCents: null,
      amountCents: mealsCents,
    }
  }

  /**
   * Statement of one family for a month: one section per child (children
   * given by the caller, already authorized), with the subscription meals
   * (count + amount, one line per snapshot price), one line per supplement
   * item (meal × snapshot price) and the daily detail. Inactive children
   * appear only when something is billed.
   */
  async family(input: {
    school: Pick<School, 'settings'>
    parent: { id: number; fullName: string; email: string }
    children: StatementChildInput[]
    month: StatementMonth
    today: IsoDate
  }): Promise<FamilyStatement> {
    const { from, to } = monthRange(input.month)
    const billing = this.billing(input.school)
    const ids = input.children.map((child) => child.id)

    const [grouped, detail, subscribed] = ids.length
      ? await Promise.all([
          db.rawQuery(
            `SELECT mo.child_id, moi.meal_type,
                    CASE WHEN moi.meal_type = 'supplement' THEN moi.meal_id END AS meal_id,
                    moi.unit_price_cents,
                    SUM(moi.quantity)::bigint AS quantity,
                    SUM(moi.line_total_cents)::bigint AS amount
               FROM meal_orders mo
               JOIN meal_order_items moi ON moi.meal_order_id = mo.id
              WHERE mo.child_id = ANY(?::int[]) AND mo.status = 'active'
                AND mo.date BETWEEN ?::date AND ?::date
              GROUP BY mo.child_id, moi.meal_type,
                       CASE WHEN moi.meal_type = 'supplement' THEN moi.meal_id END,
                       moi.unit_price_cents
              ORDER BY mo.child_id, moi.meal_type ASC, moi.unit_price_cents`,
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
      const lineTotalCents = cents(row.line_total_cents)
      day.items.push({
        mealId,
        mealType: row.meal_type === 'supplement' ? 'supplement' : 'subscription',
        nameFr: String(row.name_fr),
        nameEn: String(row.name_en),
        quantity: cents(row.quantity),
        unitPriceCents: cents(row.unit_price_cents),
        lineTotalCents,
      })
      day.totalCents = sum([day.totalCents, lineTotalCents])
      daysByChild.set(childId, days)
    }

    const linesByChild = new Map<
      number,
      { subscription: StatementLine[]; supplements: StatementLine[] }
    >()
    for (const row of grouped.rows) {
      const childId = Number(row.child_id)
      const entry = linesByChild.get(childId) ?? { subscription: [], supplements: [] }
      const mealId = row.meal_id === null ? null : Number(row.meal_id)
      const name = mealId !== null ? names.get(mealId) : undefined
      const line: StatementLine = {
        mealId,
        nameFr: name?.nameFr ?? null,
        nameEn: name?.nameEn ?? null,
        unitPriceCents: cents(row.unit_price_cents),
        quantity: cents(row.quantity),
        amountCents: cents(row.amount),
      }
      if (row.meal_type === 'supplement') entry.supplements.push(line)
      else entry.subscription.push(line)
      linesByChild.set(childId, entry)
    }

    const children: ChildStatement[] = []
    const totals = emptyTotals()
    for (const child of input.children) {
      const lines = linesByChild.get(child.id) ?? { subscription: [], supplements: [] }
      const isSubscribed = subscribedIds.has(child.id)
      const subscription = this.subscriptionPart(
        sum(lines.subscription.map((line) => line.quantity)),
        sum(lines.subscription.map((line) => line.amountCents)),
        lines.subscription,
        isSubscribed,
        billing
      )
      // Supplements: by name in the reader's order is done at display; here by meal id.
      const supplementLines = [...lines.supplements].sort(
        (a, b) =>
          (a.nameFr ?? '').localeCompare(b.nameFr ?? '') || a.unitPriceCents - b.unitPriceCents
      )
      const supplements = {
        count: sum(supplementLines.map((line) => line.quantity)),
        amountCents: sum(supplementLines.map((line) => line.amountCents)),
        lines: supplementLines,
      }
      const totalCents = sum([subscription.amountCents, supplements.amountCents])
      const billed = totalCents > 0 || subscription.count > 0 || supplements.count > 0
      if (!child.isActive && !billed) continue
      children.push({
        childId: child.id,
        firstName: child.firstName,
        lastName: child.lastName,
        grade: child.grade,
        className: child.className,
        isActive: child.isActive,
        subscribed: isSubscribed,
        subscription,
        supplements,
        totalCents,
        days: daysByChild.get(child.id) ?? [],
      })
      addTotals(totals, {
        subscriptionCount: subscription.count,
        subscriptionCents: subscription.amountCents,
        supplementCount: supplements.count,
        supplementCents: supplements.amountCents,
        totalCents,
      })
    }

    return {
      month: input.month,
      from,
      to,
      provisional: isProvisional(input.month, input.today),
      billingMode: billing.mode,
      feeMissing: billing.mode === 'monthly_fee' && billing.feeCents === null,
      parent: input.parent,
      children,
      totals,
    }
  }

  /**
   * Every family of the school with something billed this month (and, in
   * `monthly_fee` mode, every subscribed child even without meals): one
   * aggregate query, families sorted by parent name.
   */
  async school(school: School, month: StatementMonth, today: IsoDate): Promise<SchoolStatement> {
    const { from, to } = monthRange(month)
    const billing = this.billing(school)
    const result = await db.rawQuery(
      `WITH amounts AS (
         SELECT mo.child_id,
                COALESCE(SUM(moi.quantity) FILTER (WHERE moi.meal_type = 'subscription'), 0)::bigint AS sub_count,
                COALESCE(SUM(moi.line_total_cents) FILTER (WHERE moi.meal_type = 'subscription'), 0)::bigint AS sub_cents,
                COALESCE(SUM(moi.quantity) FILTER (WHERE moi.meal_type = 'supplement'), 0)::bigint AS sup_count,
                COALESCE(SUM(moi.line_total_cents) FILTER (WHERE moi.meal_type = 'supplement'), 0)::bigint AS sup_cents
           FROM meal_orders mo
           JOIN meal_order_items moi ON moi.meal_order_id = mo.id
          WHERE mo.school_id = ? AND mo.status = 'active' AND mo.date BETWEEN ?::date AND ?::date
          GROUP BY mo.child_id)
       SELECT c.id AS child_id, c.first_name, c.last_name, c.grade, c.class_name,
              u.id AS parent_id, u.full_name, u.email,
              a.sub_count, a.sub_cents, a.sup_count, a.sup_cents,
              ${SUBSCRIBED_SQL} AS subscribed
         FROM children c
         JOIN users u ON u.id = c.parent_id
         LEFT JOIN amounts a ON a.child_id = c.id
        WHERE (a.child_id IS NOT NULL OR (?::boolean AND c.school_id = ? AND ${SUBSCRIBED_SQL}))
        ORDER BY lower(u.full_name), u.id, lower(c.first_name), c.id
        LIMIT ?`,
      [
        school.id,
        from,
        to,
        to,
        from,
        billing.mode === 'monthly_fee',
        school.id,
        to,
        from,
        MAX_SCHOOL_STATEMENT_CHILDREN + 1,
      ]
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
      const subscribed = Boolean(row.subscribed)
      const supplementCents = cents(row.sup_cents)
      const subscription = this.subscriptionPart(
        cents(row.sub_count),
        cents(row.sub_cents),
        [],
        subscribed,
        billing
      )
      const childTotals: StatementTotals = {
        subscriptionCount: subscription.count,
        subscriptionCents: subscription.amountCents,
        supplementCount: cents(row.sup_count),
        supplementCents,
        totalCents: sum([subscription.amountCents, supplementCents]),
      }
      family.children.push({
        childId: Number(row.child_id),
        firstName: String(row.first_name),
        lastName: String(row.last_name),
        grade: row.grade ?? null,
        className: row.class_name ?? null,
        subscribed,
        billedAs: subscription.billedAs,
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
      billingMode: billing.mode,
      feeMissing: billing.mode === 'monthly_fee' && billing.feeCents === null,
      families,
      totals,
    }
  }
}
