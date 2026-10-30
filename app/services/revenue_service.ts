import { inject } from '@adonisjs/core'
import type School from '#models/school'
import Clock from '#services/clock'
import ProductionReportService from '#services/production_report_service'
import SchoolSettingsService from '#services/school_settings_service'
import { datesBetween, diffInDays, type IsoDate } from '#support/dates'
import { centsToInput } from '#support/money'

/** Longest period of one API call (days, both dates included). */
export const REVENUE_MAX_DAYS = 366

type PeriodQuery = { date?: IsoDate; from?: IsoDate; to?: IsoDate }

type Amounts = {
  subscriptionMeals: number
  subscriptionAmountCents: number
  extras: number
  extrasAmountCents: number
  totalCents: number
  /** Total in MAD, "125.50". */
  total: string
}

function amounts(meals: number, unitCents: number, extras: number, extrasCents: number): Amounts {
  const subscriptionAmountCents = meals * unitCents
  const totalCents = subscriptionAmountCents + extrasCents
  return {
    subscriptionMeals: meals,
    subscriptionAmountCents,
    extras,
    extrasAmountCents: extrasCents,
    totalCents,
    total: centsToInput(totalCents, 'en'),
  }
}

/**
 * Revenue per day for the external API (D36): subscription meals × the amount
 * in the settings, plus the extras' snapshot amounts, on active orders only.
 * Statements are not concerned: subscription meals stay unbilled (D31).
 */
@inject()
export default class RevenueService {
  constructor(
    protected reports: ProductionReportService,
    protected settings: SchoolSettingsService,
    protected clock: Clock
  ) {}

  /** `date`, or `from` + `to`, or today. Returns an error message when invalid. */
  period(query: PeriodQuery): { from: IsoDate; to: IsoDate } | { error: string } {
    const { date, from, to } = query
    if (date && (from || to)) return { error: 'Send either date, or from and to.' }
    if (Boolean(from) !== Boolean(to)) return { error: 'from and to must be sent together.' }
    if (from && to) {
      if (to < from) return { error: 'to must not be before from.' }
      if (diffInDays(from, to) >= REVENUE_MAX_DAYS) {
        return { error: `The period cannot exceed ${REVENUE_MAX_DAYS} days.` }
      }
      return { from, to }
    }
    const day = date ?? this.clock.today()
    return { from: day, to: day }
  }

  async daily(school: School, from: IsoDate, to: IsoDate) {
    const unitPrice = this.settings.get(school).subscription_meal_price_cents
    const unitCents = unitPrice ?? 0
    const rows = await this.reports.dailyQuantities(school.id, from, to)
    const today = this.clock.today()

    let meals = 0
    let extras = 0
    let extrasCents = 0
    const days = datesBetween(from, to).map((date) => {
      const row = rows.get(date)
      meals += row?.subscriptionMeals ?? 0
      extras += row?.extras ?? 0
      extrasCents += row?.extrasCents ?? 0
      return {
        date,
        // Today and later can still change.
        provisional: date >= today,
        ...amounts(row?.subscriptionMeals ?? 0, unitCents, row?.extras ?? 0, row?.extrasCents ?? 0),
      }
    })

    return {
      currency: 'MAD',
      from,
      to,
      // Null: the amount is not set, so totals only hold the extras.
      subscriptionMealPriceCents: unitPrice,
      days,
      totals: amounts(meals, unitCents, extras, extrasCents),
    }
  }
}
