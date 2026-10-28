import type { Dashboard } from '#services/dashboard_service'
import type {
  AllergyLine,
  AllergyRow,
  LabelRow,
  ProductionSheet,
} from '#services/production_report_service'
import { allergenLabels, mealName } from '#support/meal_display'
import { formatMad } from '#support/money'

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
          subscription: formatMad(dashboard.monthToDate.subscriptionCents, money),
          supplement: formatMad(dashboard.monthToDate.supplementCents, money),
          total: formatMad(dashboard.monthToDate.totalCents, money),
        }
      : null,
  }
}
export type DashboardView = ReturnType<typeof presentDashboard>
