import app from '@adonisjs/core/services/app'
import { UserFactory } from '#database/factories/user_factory'
import { ChildFactory } from '#database/factories/child_factory'
import { SubscriptionFactory } from '#database/factories/subscription_factory'
import type Meal from '#models/meal'
import MealOrder from '#models/meal_order'
import MenuItem from '#models/menu_item'
import OrderAuditLog from '#models/order_audit_log'
import type School from '#models/school'
import type User from '#models/user'
import type Child from '#models/child'
import OrderService from '#services/order_service'
import type { AllergenCode } from '#enums/allergens'
import type { IsoDate } from '#support/dates'
import {
  FRI,
  MON,
  THU,
  TUE,
  WED,
  WEEK,
  addItem,
  menuOf,
  setupMenuSchool,
  statusService,
  subscriptionMeal,
  supplementMeal,
} from '#tests/helpers/menus'

export const DAYS = [MON, TUE, WED, THU, FRI]

/**
 * A school with a **published** menu for the week of Mon 23 Nov 2026
 * (deadline Sun 22 Nov 20:00, cutoff the day before 18:00): every day has
 * `main` (default, 45 MAD), `alt` (50 MAD, contains nuts) and the extra
 * `juice` (10 MAD). Call it with the real clock (or one before 19 Nov).
 */
export async function orderSchool(settings: Record<string, unknown> = {}) {
  const ctx = await setupMenuSchool(settings)
  const main = await subscriptionMeal({ priceCents: 4500, allergens: [] })
  const alt = await subscriptionMeal({ priceCents: 5000, allergens: ['nuts'] })
  const juice = await supplementMeal({ allergens: [] })
  // The factory's supplement state sets its own price after merge.
  juice.priceCents = 1000
  await juice.save()
  for (const date of DAYS) {
    await addItem(ctx.school, ctx.manager, date, main)
    await addItem(ctx.school, ctx.manager, date, alt)
    await addItem(ctx.school, ctx.manager, date, juice)
  }
  const status = await statusService()
  const menu = await menuOf(ctx.school)
  await status.schedule(ctx.school, menu, ctx.manager)
  await status.publishNow(menu, ctx.manager)
  return { ...ctx, menu: await menuOf(ctx.school), main, alt, juice }
}

/** A parent with one child (subscribed for the school year unless told otherwise). */
export async function family(
  school: School,
  options: {
    subscribed?: boolean
    allergies?: AllergenCode[]
    parent?: Partial<User>
    child?: Partial<Child>
  } = {}
) {
  const parent = await UserFactory.apply('parent')
    .merge({ schoolId: school.id, ...options.parent } as Partial<User>)
    .create()
  const child = await addChild(parent, options)
  return { parent, child }
}

export async function addChild(
  parent: User,
  options: { subscribed?: boolean; allergies?: AllergenCode[]; child?: Partial<Child> } = {}
) {
  const child = await ChildFactory.merge({
    parentId: parent.id,
    schoolId: parent.schoolId!,
    allergies: options.allergies ?? [],
    ...options.child,
  } as Partial<Child>).create()
  if (options.subscribed !== false) {
    await SubscriptionFactory.merge({ childId: child.id }).create()
  }
  return child
}

export function orders() {
  return app.container.make(OrderService)
}

export async function itemFor(menuId: number, date: IsoDate, meal: Meal) {
  return MenuItem.query()
    .where('weekly_menu_id', menuId)
    .where('date', date)
    .where('meal_id', meal.id)
    .firstOrFail()
}

export async function orderOf(child: Child, date: IsoDate) {
  const order = await MealOrder.query()
    .where('child_id', child.id)
    .where('date', date)
    .preload('items', (q) => q.orderBy('meal_type', 'asc').orderBy('id'))
    .first()
  return order
}

export async function auditOf(child: Child, date?: IsoDate) {
  const query = OrderAuditLog.query().where('child_id', child.id).orderBy('id')
  if (date) query.where('date', date)
  return query
}

/** The rule code of an OrderRuleException (or the error itself). */
export async function ruleOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    const err = error as { rule?: string; code?: string; messageKey?: string }
    return err.rule ?? err.messageKey ?? err.code ?? String(error)
  }
  return 'OK'
}

export { WEEK, MON, TUE, WED, THU, FRI }
