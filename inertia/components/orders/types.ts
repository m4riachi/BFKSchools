/**
 * Shapes of the week view props (app/services/order_week_service.ts).
 * Every state, reason and flag is computed by the server
 * (OrderWindowService); the UI only displays them.
 */
export type Labelled = { code: string; label: string }

export type OptionView = {
  menuItemId: number
  mealId: number
  type: 'subscription' | 'supplement' | string
  isDefault: boolean
  name: string
  description: string | null
  priceCents: number
  price: string
  allergens: Labelled[]
  tags: string[]
  cover: { url: string; thumbUrl: string } | null
  allergyConflicts: Labelled[]
  allergyBlocked: boolean
  needsAllergyConfirm: boolean
  unavailable: boolean
  noSubscription: boolean
  remaining: number | null
  soldOut: boolean
  /** Highest quantity the child can hold now (server-computed). */
  maxQty: number
  /** Quantity in the current active order. */
  quantity: number
}

export type OrderLineView = {
  mealId: number
  type: string
  name: string
  quantity: number
  unitPrice: string
  lineTotalCents: number
  lineTotal: string
}

export type DayView = {
  date: string
  state: 'open' | 'locked' | 'holiday' | 'not_published' | 'no_meals'
  reason: string | null
  editable: boolean
  /** Back-office: staff may change this day (server-computed). */
  staffEditable: boolean
  editableUntil: string | null
  cutoffAt: string
  holidayNames: string[]
  hasSubscription: boolean
  options: OptionView[]
  order: {
    id: number
    status: 'active' | 'cancelled' | string
    cancelReason: string | null
    origin: string
    lines: OrderLineView[]
  } | null
  totalCents: number
  total: string
}

export type WeekMenuView = {
  status: string
  publishAt: string | null
  orderDeadlineAt: string | null
  deadlinePassed: boolean
} | null

export type WeekView = {
  menu: WeekMenuView
  rules: {
    allergyRule: 'block' | 'warn_confirm' | string
    supplementMax: number
    allowParentEdits: boolean
    editMode: 'until_cutoff' | 'same_day_only' | string
    cutoffDaysBefore: number
  }
  allergies: Labelled[]
  days: DayView[]
  total: string
}

export type Selection = {
  subscriptionMealId: number | null
  supplements: { mealId: number; qty: number }[]
}

/** The current selection of a day, read from the server's quantities. */
export function selectionOf(day: DayView): Selection {
  const active = day.order?.status === 'active'
  const main = active
    ? day.options.find((option) => option.type === 'subscription' && option.quantity > 0)
    : undefined
  return {
    subscriptionMealId: main?.mealId ?? null,
    supplements: active
      ? day.options
          .filter((option) => option.type === 'supplement' && option.quantity > 0)
          .map((option) => ({ mealId: option.mealId, qty: option.quantity }))
      : [],
  }
}

export function isEmptySelection(selection: Selection) {
  return selection.subscriptionMealId === null && selection.supplements.length === 0
}
