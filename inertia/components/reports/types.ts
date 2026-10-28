/**
 * Props of the Phase 7 report pages (mirrors app/support/report_presenters.ts).
 */
export type AllergenLabel = { code: string; label: string }

export type Breakdown = {
  total: number
  byGrade: Record<string, number>
  byClass: Record<string, number>
}

export type ProductionLineView = Breakdown & {
  mealId: number
  name: string
  mealType: 'subscription' | 'supplement'
  category: string
  allergens: AllergenLabel[]
}

export type ProductionView = {
  date: string
  grades: string[]
  classes: { className: string; grade: string }[]
  lines: ProductionLineView[]
  totals: { subscription: Breakdown; supplement: Breakdown }
  orders: { active: number; absent: number; cancelled: number; withAllergies: number }
}

export type ReportLineView = {
  mealId: number
  name: string
  mealType: 'subscription' | 'supplement'
  quantity: number
  allergens: AllergenLabel[]
  conflicts: AllergenLabel[]
}

export type AllergyRowView = {
  childId: number
  name: string
  grade: string | null
  className: string | null
  allergies: AllergenLabel[]
  dietaryNotes: string | null
  hasConflict: boolean
  lines: ReportLineView[]
}

export type LabelView = {
  orderId: number
  name: string
  grade: string | null
  className: string | null
  allergies: AllergenLabel[]
  hasConflict: boolean
  lines: ReportLineView[]
}

export type DayNav = { date: string; today: string; previous: string; next: string }

export type DayInfo = {
  isSchoolDay: boolean
  holidayNames: string[]
  hasMenu: boolean
  final: boolean
  editableUntil: string | null
}
