import { inject } from '@adonisjs/core'
import encryption from '@adonisjs/core/services/encryption'
import Child from '#models/child'
import type School from '#models/school'
import EscPosTicketService from '#services/escpos_ticket_service'
import OrderService from '#services/order_service'
import ProductionReportService from '#services/production_report_service'
import OrderWeekService from '#services/order_week_service'
import SchoolBoardService from '#services/school_board_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import { weekStart, type IsoDate } from '#support/dates'
import { MEAL_PHOTO_PATH } from '#support/meal_display'

/** How long a child has to finish an order after typing the code. */
const SESSION_TTL = '10 mins'
const TOKEN_PURPOSE = 'board-kiosk'

type DayView = Awaited<ReturnType<OrderWeekService['week']>>['days'][number]
type Option = DayView['options'][number]

export type KioskOption = {
  mealId: number
  name: string
  description: string | null
  price: string | null
  photoUrl: string | null
}

export type KioskSession = {
  token: string
  childName: string
  date: IsoDate
  dishes: KioskOption[]
  /** The day's specials (supplements tagged D47), one portion each. */
  specials: KioskOption[]
  /** The other supplements of the day, one portion each. */
  extras: KioskOption[]
  current: { subscriptionMealId: number | null; specialMealIds: number[]; extraMealIds: number[] }
}

export type KioskSelection = {
  subscriptionMealId: number | null
  specialMealIds: number[]
  extraMealIds: number[]
}

/**
 * D51: ordering kiosk on the school board. A child types their 4-digit code,
 * picks a dish for the first open day of the board (today, or the next
 * school day) and the day's special on the same screen, may take one of the
 * other supplements, and confirms. The order is saved
 * through OrderService on behalf of the parent (same rules, prices and
 * audit as the parent portal; origin `kiosk`). The session is a signed,
 * short-lived token: the code is typed once.
 */
@inject()
export default class KioskService {
  constructor(
    protected weeks: OrderWeekService,
    protected orders: OrderService,
    protected board: SchoolBoardService,
    protected reports: ProductionReportService,
    protected escpos: EscPosTicketService
  ) {}

  async start(school: School, pin: string, slug: string, locale: string): Promise<KioskSession> {
    const child = await Child.query()
      .where('school_id', school.id)
      .where('pin', pin)
      .where('is_active', true)
      .preload('parent')
      .first()
    if (!child || !child.parent.isActive) {
      throw new BusinessRuleException('board.kiosk.unknown_pin')
    }
    const { date, day } = await this.openDay(school, child, locale)
    const token = encryption.encrypt({ childId: child.id, date }, SESSION_TTL, TOKEN_PURPOSE)
    return { token, childName: child.firstName, date, ...this.present(day, slug) }
  }

  async order(school: School, token: string, selection: KioskSelection, locale: string) {
    const payload = encryption.decrypt<{ childId: number; date: IsoDate }>(token, TOKEN_PURPOSE)
    if (!payload) throw new BusinessRuleException('board.kiosk.expired')
    const child = await Child.query()
      .where('id', payload.childId)
      .where('school_id', school.id)
      .where('is_active', true)
      .preload('parent')
      .firstOrFail()
    const { date, day } = await this.openDay(school, child, locale)
    if (date !== payload.date) throw new BusinessRuleException('board.kiosk.expired')
    const offer = this.present(day, slugOf(day))
    const dish = offer.dishes.find((option) => option.mealId === selection.subscriptionMealId)
    if (selection.subscriptionMealId !== null && !dish) {
      throw new BusinessRuleException('board.kiosk.unknown_dish')
    }
    const chosen = [
      ...offer.specials.filter((option) => selection.specialMealIds.includes(option.mealId)),
      ...offer.extras.filter((option) => selection.extraMealIds.includes(option.mealId)),
    ].map((option) => ({ mealId: option.mealId, qty: 1 }))
    // Supplements the kiosk does not offer (e.g. sold out now) stay as the parent ordered them.
    const offered = new Set([...offer.specials, ...offer.extras].map((option) => option.mealId))
    const kept = (day.order?.status === 'active' ? day.order.lines : [])
      .filter((line) => line.type === 'supplement' && !offered.has(line.mealId))
      .map((line) => ({ mealId: line.mealId, qty: line.quantity }))
    const outcome = await this.orders.saveDay(
      child.id,
      date,
      { subscriptionMealId: selection.subscriptionMealId, supplements: [...kept, ...chosen] },
      { user: child.parent },
      { origin: 'kiosk' }
    )
    // The child's ticket, for the printer plugged into the board (same ESC/POS as the kitchen's).
    const rows = await this.reports.tickets(school.id, date, {
      orderId: outcome.order.id,
      limit: 1,
    })
    const ticket = rows.length
      ? this.escpos.render(rows, { locale, withAmounts: true }).toString('base64')
      : null
    return { childName: child.firstName, date, action: outcome.action, ticket }
  }

  /** The first day of the board (today, then the next school day) still open for this child. */
  protected async openDay(school: School, child: Child, locale: string) {
    const dates = this.board.displayedDays(school)
    const days = new Map<IsoDate, DayView>()
    for (const start of [...new Set(dates.map((date) => weekStart(date)))]) {
      const view = await this.weeks.week(child, start, locale)
      for (const day of view.days) days.set(day.date, day)
    }
    for (const date of dates) {
      const day = days.get(date)
      if (day && day.state === 'open' && day.editable) return { date, day }
    }
    throw new BusinessRuleException('board.kiosk.closed')
  }

  protected present(day: DayView, slug: string) {
    const usable = (option: Option) =>
      !option.unavailable && !option.allergyBlocked && option.maxQty > 0
    const toOption = (option: Option): KioskOption => ({
      mealId: option.mealId,
      name: option.name,
      description: option.description,
      price: option.price,
      photoUrl: option.cover
        ? option.cover.url.replace(MEAL_PHOTO_PATH, `/board/${slug}/photos`)
        : null,
    })
    const lines = day.order?.status === 'active' ? day.order.lines : []
    const specialIds = new Set(
      day.options.filter((o) => o.type === 'supplement' && o.isSpecial).map((o) => o.mealId)
    )
    return {
      dishes: day.options
        .filter((o) => o.type === 'subscription' && usable(o) && !o.noSubscription)
        .map(toOption),
      specials: day.options
        .filter((o) => o.type === 'supplement' && o.isSpecial && usable(o))
        .map(toOption),
      extras: day.options
        .filter((o) => o.type === 'supplement' && !o.isSpecial && usable(o))
        .map(toOption),
      current: {
        subscriptionMealId: lines.find((line) => line.type === 'subscription')?.mealId ?? null,
        specialMealIds: lines
          .filter((line) => line.type === 'supplement' && specialIds.has(line.mealId))
          .map((line) => line.mealId),
        extraMealIds: lines
          .filter((line) => line.type === 'supplement' && !specialIds.has(line.mealId))
          .map((line) => line.mealId),
      },
    }
  }
}

/** The order step needs no photo URLs: any slug gives the same ids. */
function slugOf(_day: DayView) {
  return 'kiosk'
}
