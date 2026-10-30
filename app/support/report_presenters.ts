import type AdminReportService from '#services/admin_report_service'
import type { Dashboard } from '#services/dashboard_service'
import type {
  AllergyLine,
  AllergyRow,
  LabelRow,
  ProductionSheet,
} from '#services/production_report_service'
import { allergenLabels, mealName } from '#support/meal_display'
import { formatMad } from '#support/money'

type AdminReport = Awaited<ReturnType<AdminReportService['build']>>

/**
 * Inertia presenters of the Phase 7 reports: localized meal names and
 * allergen labels, money formatted from integer centimes. Plain objects
 * only (no model instances, no parent contact data).
 */

function moneyLocale(locale: string) {
  return locale === 'en' ? 'en' : 'fr'
}

export function presentProduction(sheet: ProductionSheet, locale: string) {
  return {
    date: sheet.date,
    grades: sheet.grades,
    classes: sheet.classes,
    lines: sheet.lines.map((line) => ({
      mealId: line.meal.id,
      name: mealName(line.meal, locale),
      mealType: line.mealType,
      category: line.meal.category,
      allergens: allergenLabels(line.meal.allergens, locale),
      total: line.total,
      byGrade: line.byGrade,
      byClass: line.byClass,
    })),
    totals: sheet.totals,
    orders: sheet.orders,
  }
}
export type ProductionView = ReturnType<typeof presentProduction>

function presentLine(line: AllergyLine, locale: string) {
  return {
    mealId: line.mealId,
    name: mealName(line, locale),
    mealType: line.mealType,
    quantity: line.quantity,
    allergens: allergenLabels(line.allergens, locale),
    conflicts: allergenLabels(line.conflicts, locale),
  }
}

export function presentAllergyRows(rows: AllergyRow[], locale: string) {
  return rows.map((row) => ({
    childId: row.childId,
    name: `${row.firstName} ${row.lastName}`,
    grade: row.grade,
    className: row.className,
    allergies: allergenLabels(row.allergies, locale),
    dietaryNotes: row.dietaryNotes,
    hasConflict: row.hasConflict,
    lines: row.lines.map((line) => presentLine(line, locale)),
  }))
}

export function presentLabels(rows: LabelRow[], locale: string) {
  return rows.map((row) => ({
    orderId: row.orderId,
    name: `${row.firstName} ${row.lastName}`,
    grade: row.grade,
    className: row.className,
    allergies: allergenLabels(row.allergies, locale),
    hasConflict: row.hasConflict,
    lines: row.lines.map((line) => presentLine(line, locale)),
  }))
}

export function presentDashboard(dashboard: Dashboard, locale: string) {
  const money = moneyLocale(locale)
  return {
    today: dashboard.today,
    days: dashboard.days.map((day) => ({
      date: day.date,
      kind: day.kind,
      state: day.state,
      holidayNames: day.holidayNames,
      production: presentProduction(day.production, locale),
      missing: day.missing,
    })),
    nextWeek: dashboard.nextWeek,
    holidays: dashboard.holidays,
    monthToDate: dashboard.monthToDate
      ? {
          ...dashboard.monthToDate,
          total: formatMad(dashboard.monthToDate.totalCents, money),
        }
      : null,
  }
}
export type DashboardView = ReturnType<typeof presentDashboard>

/** Back-office reports page (D38). */
export function presentAdminReport(report: AdminReport, locale: string) {
  const money = moneyLocale(locale)
  return {
    from: report.from,
    to: report.to,
    revenue: formatMad(report.totals.totalCents, money),
    subscriptionMeals: report.totals.subscriptionMeals,
    subscriptionAmount: formatMad(report.totals.subscriptionAmountCents, money),
    extras: report.totals.extras,
    extrasAmount: formatMad(report.totals.extrasAmountCents, money),
    activeSubscriptions: report.activeSubscriptions,
    activeChildren: report.activeChildren,
    links: report.links,
    topExtras: report.extras.map((extra: AdminReport['extras'][number]) => ({
      id: extra.id,
      name: locale === 'en' ? extra.nameEn : extra.nameFr,
      quantity: extra.quantity,
      amount: formatMad(extra.amountCents, money),
      // First row = the largest amount (the query sorts by it).
      barPercent: (extra.amountCents * 100) / Math.max(1, report.extras[0].amountCents),
    })),
    chart: {
      byWeek: report.chart.byWeek,
      points: report.chart.points.map((point) => ({
        date: point.date,
        subscriptionMeals: point.subscriptionMeals,
        extras: point.extras,
        subscriptionAmountCents: point.subscriptionAmountCents,
        extrasAmountCents: point.extrasAmountCents,
        subscriptionAmount: formatMad(point.subscriptionAmountCents, money),
        extrasAmount: formatMad(point.extrasAmountCents, money),
        total: formatMad(point.totalCents, money),
        glovo: point.glovo,
        delivery: point.delivery,
      })),
    },
    days: report.days.map((day) => ({
      date: day.date,
      subscriptionMeals: day.subscriptionMeals,
      extras: day.extras,
      total: formatMad(day.totalCents, money),
      glovo: day.glovo,
      delivery: day.delivery,
    })),
  }
}
