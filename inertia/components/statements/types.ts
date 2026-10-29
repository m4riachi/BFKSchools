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
  /** D31: subscription meals are counted (included), never priced. */
  subscription: { count: number }
  supplements: { count: number; amountCents: number; amount: string; lines: StatementLine[] }
  totalCents: number
  total: string
  days: {
    date: string
    totalCents: number
    total: string
    items: { name: string; type: string; quantity: number; amount: string | null }[]
  }[]
}

/** D31: the billed total is the supplements; subscription meals are a count. */
export type Totals = {
  subscriptionCount: number
  supplementCount: number
  totalCents: number
  total: string
}

export type FamilyStatement = {
  month: string
  provisional: boolean
  parent: { id: number; fullName: string }
  children: ChildStatement[]
  totals: Totals
}
