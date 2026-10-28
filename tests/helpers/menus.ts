import app from '@adonisjs/core/services/app'
import { SchoolFactory } from '#database/factories/school_factory'
import { UserFactory } from '#database/factories/user_factory'
import { ChildFactory } from '#database/factories/child_factory'
import { MealFactory } from '#database/factories/meal_factory'
import Holiday from '#models/holiday'
import type Meal from '#models/meal'
import MenuItem from '#models/menu_item'
import type School from '#models/school'
import type User from '#models/user'
import WeeklyMenu from '#models/weekly_menu'
import MenuBuilderService from '#services/menu_builder_service'
import MenuStatusService from '#services/menu_status_service'
import MenuJobs from '#services/menu_jobs'
import OutboxService from '#services/outbox_service'
import type { IsoDate } from '#support/dates'

/**
 * Week of Monday 23 Nov 2026 (Thanksgiving Thu 26 + Fri 27 in the US
 * calendar). Defaults: publish Thu 19 Nov 10:00, deadline Sun 22 Nov 20:00.
 */
export const WEEK = '2026-11-23'
export const MON = '2026-11-23'
export const TUE = '2026-11-24'
export const WED = '2026-11-25'
export const THU = '2026-11-26'
export const FRI = '2026-11-27'
export const SAT = '2026-11-28'

/** A school (year 2026-08-24 → 2027-06-11, Mon–Fri) with a manager and an admin. */
export async function setupMenuSchool(settings: Record<string, unknown> = {}) {
  const school = await SchoolFactory.merge({ settings }).create()
  const manager = await UserFactory.apply('manager').merge({ schoolId: school.id }).create()
  const admin = await UserFactory.apply('admin').merge({ schoolId: school.id }).create()
  return { school, manager, admin }
}

export function subscriptionMeal(overrides: Partial<Meal> = {}) {
  return MealFactory.merge(overrides).create()
}

export function supplementMeal(overrides: Partial<Meal> = {}) {
  return MealFactory.apply('supplement').merge(overrides).create()
}

export function addHoliday(school: School, date: IsoDate, name = 'Holiday') {
  return Holiday.create({
    schoolId: school.id,
    date,
    name,
    source: 'manual',
    ruleKey: null,
    groupId: null,
    isActive: true,
    deletedAt: null,
  })
}

export function builder() {
  return app.container.make(MenuBuilderService)
}

export function statusService() {
  return app.container.make(MenuStatusService)
}

export function jobs() {
  return app.container.make(MenuJobs)
}

export function outbox() {
  return app.container.make(OutboxService)
}

export async function addItem(school: School, actor: User, date: IsoDate, meal: Meal, week = WEEK) {
  const service = await builder()
  return service.addItem(school, week, { date, mealId: meal.id }, actor)
}

export async function menuOf(school: School, week = WEEK) {
  return WeeklyMenu.query().where('school_id', school.id).where('week_start', week).firstOrFail()
}

export async function itemsOf(menuId: number) {
  return MenuItem.query()
    .where('weekly_menu_id', menuId)
    .whereNull('removed_at')
    .orderBy('date')
    .orderBy('position')
    .orderBy('id')
}

/** A ready menu (one default main on Monday) for `week`, still a draft. */
export async function readyMenu(school: School, actor: User, week = WEEK) {
  const meal = await subscriptionMeal()
  await addItem(school, actor, week, meal, week)
  return menuOf(school, week)
}

/** A ready menu moved to `scheduled`. */
export async function scheduledMenu(school: School, actor: User, week = WEEK) {
  const menu = await readyMenu(school, actor, week)
  const service = await statusService()
  return service.schedule(school, menu, actor)
}

/** An active parent of the school with one child (active unless told otherwise). */
export async function parentWithChild(
  school: School,
  overrides: Partial<User> = {},
  child: { isActive?: boolean } = {}
) {
  const parent = await UserFactory.apply('parent')
    .merge({ schoolId: school.id, ...overrides } as Partial<User>)
    .create()
  await ChildFactory.merge({
    parentId: parent.id,
    schoolId: school.id,
    isActive: child.isActive ?? true,
  }).create()
  return parent
}
