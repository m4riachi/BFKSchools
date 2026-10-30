import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import LinkClick from '#models/link_click'
import type School from '#models/school'
import type User from '#models/user'
import Clock from '#services/clock'
import RevenueService from '#services/revenue_service'
import { addDays, atLocalTime, weekStart, type IsoDate } from '#support/dates'

/** The buttons of the parent portal whose clicks are counted (D38). */
export const TRACKED_LINKS = ['glovo', 'delivery'] as const
export type TrackedLink = (typeof TRACKED_LINKS)[number]

const TOP_EXTRAS = 10
/** Longer periods are charted per week: daily columns would be too thin to read. */
const CHART_MAX_DAILY_POINTS = 62

type ChartDay = {
  date: IsoDate
  subscriptionMeals: number
  subscriptionAmountCents: number
  extras: number
  extrasAmountCents: number
  totalCents: number
  glovo: number
  delivery: number
}

/**
 * Back-office reports page (D38): revenue, extras, subscriptions and clicks
 * of a period. Integer centimes, active orders only, one school per query.
 */
@inject()
export default class AdminReportService {
  constructor(
    protected clock: Clock,
    protected revenue: RevenueService
  ) {}

  recordClick(user: User, link: TrackedLink) {
    return LinkClick.create({
      schoolId: user.schoolId!,
      userId: user.id,
      link,
      clickedAt: this.clock.now(),
    })
  }

  /** The asked period when valid, otherwise this month so far. */
  period(from?: IsoDate, to?: IsoDate) {
    const asked = from || to ? this.revenue.period({ from, to }) : null
    if (asked && !('error' in asked)) return asked
    const today = this.clock.today()
    return { from: `${today.slice(0, 7)}-01`, to: today }
  }

  async build(school: School, from: IsoDate, to: IsoDate) {
    const [revenue, extras, population, clicks] = await Promise.all([
      this.revenue.daily(school, from, to),
      this.topExtras(school.id, from, to),
      this.population(school.id),
      this.clicks(school, from, to),
    ])
    const allDays = revenue.days.map((day) => ({
      ...day,
      glovo: clicks.perDay.get(`${day.date}:glovo`) ?? 0,
      delivery: clicks.perDay.get(`${day.date}:delivery`) ?? 0,
    }))
    const days = allDays
      .filter((day) => day.subscriptionMeals || day.extras || day.glovo || day.delivery)
      .reverse()
    return {
      from,
      to,
      totals: revenue.totals,
      ...population,
      links: clicks.totals,
      extras,
      days,
      chart: this.chart(allDays),
    }
  }

  /** Every date of the period, or every week when the period is long. */
  protected chart(days: ChartDay[]) {
    const byWeek = days.length > CHART_MAX_DAILY_POINTS
    const points = new Map<IsoDate, ChartDay>()
    for (const day of days) {
      const date = byWeek ? weekStart(day.date) : day.date
      const point = points.get(date)
      points.set(
        date,
        point
          ? {
              date,
              subscriptionMeals: point.subscriptionMeals + day.subscriptionMeals,
              subscriptionAmountCents: point.subscriptionAmountCents + day.subscriptionAmountCents,
              extras: point.extras + day.extras,
              extrasAmountCents: point.extrasAmountCents + day.extrasAmountCents,
              totalCents: point.totalCents + day.totalCents,
              glovo: point.glovo + day.glovo,
              delivery: point.delivery + day.delivery,
            }
          : { ...day, date }
      )
    }
    return { byWeek, points: [...points.values()] }
  }

  protected async topExtras(schoolId: number, from: IsoDate, to: IsoDate) {
    const result = await db.rawQuery(
      `SELECT m.id, m.name_fr, m.name_en,
              SUM(moi.quantity)::bigint AS quantity,
              SUM(moi.line_total_cents)::bigint AS amount_cents
         FROM meal_orders mo
         JOIN meal_order_items moi ON moi.meal_order_id = mo.id
         JOIN meals m ON m.id = moi.meal_id
        WHERE mo.school_id = ? AND mo.status = 'active' AND mo.date BETWEEN ? AND ?
          AND moi.meal_type = 'supplement'
        GROUP BY m.id
        ORDER BY amount_cents DESC, m.id
        LIMIT ?`,
      [schoolId, from, to, TOP_EXTRAS]
    )
    return result.rows.map((row: Record<string, unknown>) => ({
      id: Number(row.id),
      nameFr: String(row.name_fr),
      nameEn: String(row.name_en),
      quantity: Number(row.quantity),
      amountCents: Number(row.amount_cents),
    }))
  }

  /** Today's numbers, whatever the period: children and running subscriptions. */
  protected async population(schoolId: number) {
    const today = this.clock.today()
    const result = await db.rawQuery(
      `SELECT count(*)::int AS children,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM subscriptions s
                 WHERE s.child_id = c.id AND s.status = 'active' AND s.start_date <= ?
                   AND (s.end_date IS NULL OR s.end_date >= ?)
              ))::int AS subscriptions
         FROM children c
        WHERE c.school_id = ? AND c.is_active`,
      [today, today, schoolId]
    )
    return {
      activeChildren: Number(result.rows[0].children),
      activeSubscriptions: Number(result.rows[0].subscriptions),
    }
  }

  /** Days are cut at midnight in the school's time zone. */
  protected async clicks(school: School, from: IsoDate, to: IsoDate) {
    const start = atLocalTime(from, '00:00', school.timezone).toISO()
    const end = atLocalTime(addDays(to, 1), '00:00', school.timezone).toISO()
    const result = await db.rawQuery(
      `SELECT (clicked_at AT TIME ZONE ?)::date::text AS date, link, count(*)::int AS clicks
         FROM link_clicks
        WHERE school_id = ? AND clicked_at >= ? AND clicked_at < ?
        GROUP BY 1, 2`,
      [school.timezone, school.id, start, end]
    )
    const parents = await db.rawQuery(
      `SELECT link, count(DISTINCT user_id)::int AS parents
         FROM link_clicks
        WHERE school_id = ? AND clicked_at >= ? AND clicked_at < ?
        GROUP BY link`,
      [school.id, start, end]
    )
    const perDay = new Map<string, number>()
    const totals = {
      glovo: { clicks: 0, parents: 0 },
      delivery: { clicks: 0, parents: 0 },
    }
    for (const row of result.rows) {
      perDay.set(`${row.date}:${row.link}`, row.clicks)
      totals[row.link as TrackedLink].clicks += row.clicks
    }
    for (const row of parents.rows) totals[row.link as TrackedLink].parents = row.parents
    return { perDay, totals }
  }
}
