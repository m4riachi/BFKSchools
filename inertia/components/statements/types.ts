/** Props shapes produced by app/support/statement_presenters.ts. */

export type MonthNav = {
  value: string
  label: string
  previous: string | null
  next: string | null
  choices: { value: string; label: string }[]
}

export type StatementLine = {
  name: string | null
  quantity: number
  unitPriceCents: number
  unitPrice: string
  amountCents: number
  amount: string
}

export type ChildStatement = {
  childId: number
  firstName: string
  lastName: string
  grade: string | null
  className: string | null
  isActive: boolean
  subscription: {
    count: number
    billedAs: 'per_meal' | 'monthly_fee'
    amountCents: number
    amount: string
    lines: StatementLine[]
  }
  supplements: { count: number; amountCents: number; amount: string; lines: StatementLine[] }
  totalCents: number
  total: string
  days: {
    date: string
    totalCents: number
    total: string
    items: { name: string; type: string; quantity: number; amount: string }[]
  }[]
}

export type Totals = {
  subscriptionCount: number
  subscriptionCents: number
  supplementCount: number
  supplementCents: number
  totalCents: number
  subscription: string
  supplement: string
  total: string
}

export type FamilyStatement = {
  month: string
  provisional: boolean
  billingMode: 'per_meal' | 'monthly_fee'
  feeMissing: boolean
  parent: { id: number; fullName: string }
  children: ChildStatement[]
  totals: Totals
}
