import type {
  FamilyStatement,
  SchoolStatement,
  StatementLine,
  StatementTotals,
} from '#services/statement_service'
import { formatMad } from '#support/money'
import { mealName } from '#support/meal_display'
import {
  addMonths,
  maxStatementMonth,
  monthChoices,
  monthLabel,
  STATEMENT_MIN_MONTH,
  type StatementMonth,
} from '#support/statement_month'
import type { IsoDate } from '#support/dates'

/**
 * Statement → Inertia props. Amounts are formatted on the server
 * (`formatMad`, integer centimes); the raw centimes are kept for tests and
 * sorting. Names are plain strings (Vue escapes them).
 */
type Locale = 'fr' | 'en'

function loc(locale: string): Locale {
  return locale === 'en' ? 'en' : 'fr'
}

function line(entry: StatementLine, locale: Locale) {
  return {
    name:
      entry.nameFr !== null && entry.nameEn !== null
        ? mealName({ nameFr: entry.nameFr, nameEn: entry.nameEn }, locale)
        : null,
    quantity: entry.quantity,
    unitPriceCents: entry.unitPriceCents,
    unitPrice: formatMad(entry.unitPriceCents, locale),
    amountCents: entry.amountCents,
    amount: formatMad(entry.amountCents, locale),
  }
}

function totals(entry: StatementTotals, locale: Locale) {
  return { ...entry, total: formatMad(entry.totalCents, locale) }
}

/** Month navigation shared by the parent and back-office pages. */
export function presentMonthNav(month: StatementMonth, today: IsoDate, locale: string) {
  const max = maxStatementMonth(today)
  return {
    value: month,
    label: monthLabel(month, loc(locale)),
    previous: month > STATEMENT_MIN_MONTH ? addMonths(month, -1) : null,
    next: month < max ? addMonths(month, 1) : null,
    choices: [...new Set([...monthChoices(today), month])]
      .sort()
      .reverse()
      .map((value) => ({ value, label: monthLabel(value, loc(locale)) })),
  }
}

export function presentFamilyStatement(statement: FamilyStatement, locale: string) {
  const l = loc(locale)
  return {
    month: statement.month,
    provisional: statement.provisional,
    parent: { id: statement.parent.id, fullName: statement.parent.fullName },
    children: statement.children.map((child) => ({
      childId: child.childId,
      firstName: child.firstName,
      lastName: child.lastName,
      grade: child.grade,
      className: child.className,
      isActive: child.isActive,
      // D31: subscription meals are counted ("included"), never priced.
      subscription: { count: child.subscription.count },
      supplements: {
        count: child.supplements.count,
        amountCents: child.supplements.amountCents,
        amount: formatMad(child.supplements.amountCents, l),
        lines: child.supplements.lines.map((entry) => line(entry, l)),
      },
      totalCents: child.totalCents,
      total: formatMad(child.totalCents, l),
      days: child.days.map((day) => ({
        date: day.date,
        totalCents: day.totalCents,
        total: formatMad(day.totalCents, l),
        items: day.items.map((item) => ({
          name: mealName(item, l),
          type: item.mealType,
          quantity: item.quantity,
          amount: item.mealType === 'supplement' ? formatMad(item.lineTotalCents, l) : null,
        })),
      })),
    })),
    totals: totals(statement.totals, l),
  }
}

export function presentSchoolFamilies(families: SchoolStatement['families'], locale: string) {
  const l = loc(locale)
  return families.map((family) => ({
    parentId: family.parentId,
    parentName: family.parentName,
    parentEmail: family.parentEmail,
    children: family.children.map((child) => ({
      childId: child.childId,
      name: `${child.firstName} ${child.lastName}`,
      className: child.className,
      totals: totals(child.totals, l),
    })),
    totals: totals(family.totals, l),
  }))
}

export function presentSchoolTotals(statement: SchoolStatement, locale: string) {
  return {
    ...totals(statement.totals, loc(locale)),
    families: statement.totals.families,
    children: statement.totals.children,
  }
}
