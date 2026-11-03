import { inject } from '@adonisjs/core'
import encryption from '@adonisjs/core/services/encryption'
import Child from '#models/child'
import Clock from '#services/clock'
import SchoolSettingsService from '#services/school_settings_service'
import type School from '#models/school'
import EscPosTicketService from '#services/escpos_ticket_service'
import OrderService from '#services/order_service'
import ProductionReportService from '#services/production_report_service'
import OrderWeekService from '#services/order_week_service'
import SchoolBoardService from '#services/school_board_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import { atLocalTime, weekStart, type IsoDate } from '#support/dates'
import { MEAL_PHOTO_PATH } from '#support/meal_display'
import { schoolZone } from '#support/menu_display'

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
  /** D58: the dish cutoff has passed — the dish is fixed, only supplements can be added. */
  extrasOnly: boolean
  /** The already-chosen dish shown locked when extrasOnly (null if none / full). */
  fixedDishName: string | null
  /** What is already ordered for the day (shown so the child knows). */
  ordered: { name: string; quantity: number }[]
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
 * picks today's dish or special on one screen, may take other supplements,
 * and confirms — today only, until the board's own cutoff (D52). The order is saved
 * through OrderService on behalf of the parent (same rules, prices and
 * audit as the parent portal; origin `kiosk`). The session is a signed,
 * short-lived token: the code is typed once.
 */
@inject()
export default class KioskService {
  constructor(
    protected clock: Clock,
    protected settings: SchoolSettingsService,
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
    const { date, day, extrasOnly } = await this.openDay(school, child, locale)
    const token = encryption.encrypt({ childId: child.id, date }, SESSION_TTL, TOKEN_PURPOSE)
    const lines = day.order?.status === 'active' ? day.order.lines : []
    const fixedDishName = extrasOnly
      ? (lines.find((line) => line.type === 'subscription')?.name ?? null)
      : null
    return {
      token,
      childName: child.firstName,
      date,
      extrasOnly,
      fixedDishName,
      ordered: lines.map((line) => ({ name: line.name, quantity: line.quantity })),
      ...this.present(day, slug, extrasOnly),
    }
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
    const { date, day, extrasOnly } = await this.openDay(school, child, locale)
    if (date !== payload.date) throw new BusinessRuleException('board.kiosk.expired')
    const offer = this.present(day, slugOf(day), extrasOnly)
    const existingDish =
      (day.order?.status === 'active' ? day.order.lines : []).find(
        (line) => line.type === 'subscription'
      )?.mealId ?? null
    // D58: after the dish cutoff the dish is fixed — keep what was ordered.
    const subscriptionMealId = extrasOnly ? existingDish : selection.subscriptionMealId
    const dish = offer.dishes.find((option) => option.mealId === subscriptionMealId)
    if (!extrasOnly && selection.subscriptionMealId !== null && !dish) {
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
      { subscriptionMealId, supplements: [...kept, ...chosen] },
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

  /**
   * D52: the board orders for today only, while its own window is open
   * (`kiosk_cutoff_time`, whatever the parents' rule says — OrderWindowService
   * decides with the `kiosk` channel, and OrderService checks it again).
   */
  protected async openDay(school: School, child: Child, locale: string) {
    const date = this.clock.today()
    const view = await this.weeks.week(child, weekStart(date), locale, { channel: 'kiosk' })
    const day = view.days.find((candidate) => candidate.date === date)
    if (!day || day.state !== 'open' || !day.editable) {
      throw new BusinessRuleException('board.kiosk.closed', {
        values: { time: this.settings.get(school).kiosk_extras_cutoff_time },
      })
    }
    // D58: the dish is fixed — only supplements can be added — after the dish
    // cutoff, or once a dish is already chosen (by the parent or earlier here).
    const settings = this.settings.get(school)
    const dishCutoff = atLocalTime(date, settings.kiosk_cutoff_time, schoolZone(school))
    const hasDish =
      day.order?.status === 'active' &&
      day.order.lines.some((line) => line.type === 'subscription')
    const extrasOnly = this.clock.now() >= dishCutoff || hasDish
    return { date, day, extrasOnly }
  }

  protected present(day: DayView, slug: string, extrasOnly = false) {
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
      dishes: extrasOnly
        ? []
        : day.options
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
