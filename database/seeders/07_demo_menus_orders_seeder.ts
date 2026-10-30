import { BaseSeeder } from '@adonisjs/lucid/seeders'
import app from '@adonisjs/core/services/app'
import { DateTime } from 'luxon'
import School from '#models/school'
import User from '#models/user'
import Child from '#models/child'
import Meal from '#models/meal'
import WeeklyMenu from '#models/weekly_menu'
import MenuItem from '#models/menu_item'
import Subscription from '#models/subscription'
import Clock from '#services/clock'
import MenuBuilderService from '#services/menu_builder_service'
import MenuStatusService from '#services/menu_status_service'
import MenuPublicationService from '#services/menu_publication_service'
import MenuCalendar from '#services/menu_calendar'
import OrderService from '#services/order_service'
import OrderDeadlineService from '#services/order_deadline_service'
import OrderRuleException from '#exceptions/order_rule_exception'
import BusinessRuleException from '#exceptions/business_rule_exception'
import { addDays, atLocalTime, isoWeekday, weekStart, type IsoDate } from '#support/dates'
import type { StoredSchoolSettings } from '#types/school_settings'
import { DEMO_ACTIVE_SUPPLEMENTS, DEMO_MEALS } from '#database/seeders/05_demo_catalog_seeder'
import { assertDemoSeeding, atInstant, pick, randomFor, say } from '#database/demo/support'

/**
 * Weekly menus and orders (development/test only), built through the real
 * services with the Clock frozen at the right moments, so menus, orders,
 * price snapshots, audit rows and auto-assigned defaults look exactly like
 * production data:
 *
 * - "current" week = the week of the next school day (today on a weekday):
 *   published (last Thursday), ordered by parents before the deadline, then
 *   the deadline job gives the default meal to subscribed children with no
 *   choice — so the dashboard, kitchen sheets and labels show real numbers;
 * - every week from the start of the previous month to last week: the same,
 *   then closed — the previous month's statement is final;
 * - next week: built and scheduled (publishes on Thursday 10:00 by cron).
 *
 * Emails are switched off while seeding (in-app notifications only), then
 * the school's setting is restored. Idempotent: a week whose menu is
 * already past draft is skipped.
 */
export default class DemoMenusOrdersSeeder extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    assertDemoSeeding()
    const school = await School.findByOrFail('slug', 'britech-school')
    const admin = await User.findByEmail('admin@bfk.test')
    if (!admin) return
    const clock = await app.container.make(Clock)
    const today = clock.today()
    const realNow = clock.now()

    const current = weekStart(nextSchoolDay(today))
    const firstOfPreviousMonth = DateTime.fromISO(today)
      .startOf('month')
      .minus({ months: 1 })
      .toISODate()!
    const past: IsoDate[] = []
    for (let week = weekStart(firstOfPreviousMonth); week < current; week = addDays(week, 7)) {
      past.push(week)
    }

    const saved = school.settings
    await this.setEmails(school, false)
    try {
      let orders = 0
      for (const week of [...past, current]) {
        orders += await this.orderedWeek(school, admin, week, realNow, week !== current)
      }
      await this.scheduledWeek(school, admin, addDays(current, 7), realNow)
      say(`Demo menus: ${past.length} closed week(s), current week ${current}, next week scheduled`)
      say(`Demo orders: ${orders} day order(s) placed by parents`)
    } finally {
      await School.query().where('id', school.id).update({ settings: saved })
    }
  }

  /**
   * Emails on/off for this school (restored after seeding). Allergy checks
   * stay on while seeding (D33): demo orders must stay valid if the allergens
   * module is turned on later.
   */
  protected async setEmails(school: School, enabled: boolean) {
    const settings: StoredSchoolSettings = { ...(school.settings ?? {}) }
    settings.email_notifications = { ...(settings.email_notifications ?? {}), enabled }
    settings.allergens_enabled = true
    await School.query().where('id', school.id).update({ settings })
    await school.refresh()
  }

  protected async existing(school: School, week: IsoDate) {
    return WeeklyMenu.query().where('school_id', school.id).where('week_start', week).first()
  }

  /** Adds the week's dishes (rotating through the catalog) while the menu is a draft. */
  protected async buildWeek(school: School, admin: User, week: IsoDate) {
    const builder = await app.container.make(MenuBuilderService)
    const calendar = await app.container.make(MenuCalendar)
    const open = [...(await calendar.openDates(school, week))].sort()
    if (open.length === 0) return false

    const meals = await Meal.query()
      .whereNull('deleted_at')
      .where('is_active', true)
      .where((query) =>
        query
          .whereIn(
            'name_fr',
            DEMO_MEALS.map((meal) => meal.nameFr)
          )
          .orWhereIn('external_recipe_ref', Object.keys(DEMO_ACTIVE_SUPPLEMENTS))
      )
      .orderBy('id')
    const mains = meals.filter((meal) => meal.type === 'subscription')
    const extras = meals.filter((meal) => meal.type === 'supplement')
    if (mains.length < 3 || extras.length < 4) return false

    const offset = Number(week.replaceAll('-', '')) % 97
    for (const date of open) {
      const index = offset + isoWeekday(date) * 3
      const dayMains = [0, 1, 2].map((k) => mains[(index + k * 4) % mains.length])
      const dayExtras = [0, 1, 2, 3].map((k) => extras[(index + k * 2) % extras.length])
      for (const meal of [...new Set([...dayMains, ...dayExtras])]) {
        try {
          await builder.addItem(school, week, { date, mealId: meal.id }, admin)
        } catch (error) {
          if (!(error instanceof BusinessRuleException)) throw error
        }
      }
    }
    return true
  }

  /**
   * A week that already happened (or is happening): built and scheduled on
   * the Monday before, published Thursday 10:05, ordered Friday evening,
   * deadline processed at deadline + 5 min (when that is past), closed once
   * over. Returns the number of day orders placed by parents.
   */
  protected async orderedWeek(
    school: School,
    admin: User,
    week: IsoDate,
    realNow: DateTime,
    close: boolean
  ) {
    if (await this.existing(school, week)) return 0
    const zone = school.timezone
    const calendar = await app.container.make(MenuCalendar)
    const times = calendar.defaultTimes(school, week)
    if (!times.valid) return 0

    const built = await atInstant(atLocalTime(addDays(week, -7), '09:00', zone), async () => {
      if (!(await this.buildWeek(school, admin, week))) return null
      const menu = (await this.existing(school, week))!
      const status = await app.container.make(MenuStatusService)
      return status.schedule(school, menu, admin)
    })
    if (!built) return 0

    await atInstant(times.publishAt.plus({ minutes: 5 }), async () => {
      const publication = await app.container.make(MenuPublicationService)
      await publication.publish(built.id, { origin: 'job' })
    })

    const placed = await atInstant(atLocalTime(addDays(week, -3), '18:30', zone), () =>
      this.placeOrders(school, built.id, week)
    )

    const afterDeadline = times.orderDeadlineAt.plus({ minutes: 5 })
    if (afterDeadline <= realNow) {
      await atInstant(afterDeadline, async () => {
        const deadline = await app.container.make(OrderDeadlineService)
        await deadline.processMenu(built.id)
      })
    }

    const weekOver = calendar.weekEndsAt(school, week)
    if (close && weekOver <= realNow) {
      await atInstant(weekOver.plus({ hours: 2, minutes: 15 }), async () => {
        const status = await app.container.make(MenuStatusService)
        await status.close(built)
      })
    }
    return placed
  }

  /** Next week: built and scheduled (the cron job publishes it on Thursday). */
  protected async scheduledWeek(school: School, admin: User, week: IsoDate, realNow: DateTime) {
    if (await this.existing(school, week)) return
    if (!(await this.buildWeek(school, admin, week))) return
    const menu = (await this.existing(school, week))!
    const status = await app.container.make(MenuStatusService)
    if (!menu.publishAt || !menu.orderDeadlineAt || menu.orderDeadlineAt <= realNow) return
    if (menu.publishAt <= realNow) {
      // Already past this week's default publish time: publish in an hour.
      const publishAt = realNow.plus({ hours: 1 })
      if (publishAt >= menu.orderDeadlineAt) return
      await status.updateTimes(
        school,
        menu,
        { publishAt, orderDeadlineAt: menu.orderDeadlineAt },
        admin
      )
    }
    await status.schedule(school, menu, admin)
  }

  /**
   * Parents' choices for every open day of the week (deterministic per
   * child and day): most subscribed children get a main meal, some add a
   * supplement, a few are absent, a few choose nothing (the deadline job
   * assigns the default); children without a subscription sometimes order
   * a supplement only (D2). Meals with one of the child's allergens are
   * never chosen (D9 would refuse them anyway).
   */
  protected async placeOrders(school: School, menuId: number, week: IsoDate) {
    const orders = await app.container.make(OrderService)
    const items = await MenuItem.query()
      .where('weekly_menu_id', menuId)
      .whereNull('removed_at')
      .preload('meal')
      .orderBy('date')
      .orderBy('position')
    const children = await Child.query()
      .where('school_id', school.id)
      .where('is_active', true)
      .whereHas('parent', (parent) => parent.where('is_active', true))
      .preload('parent')
      .orderBy('id')
    const periods = await Subscription.query()
      .whereIn(
        'child_id',
        children.map((child) => child.id)
      )
      .where('status', 'active')
      .where('start_date', '<=', addDays(week, 6))
      .where((query) => query.whereNull('end_date').orWhere('end_date', '>=', week))
    const subscribed = new Set(periods.map((period) => period.childId))

    let placed = 0
    const dates = [...new Set(items.map((item) => item.date))]
    for (const child of children) {
      for (const date of dates) {
        const random = randomFor(`${child.id}:${date}`)
        const safe = (item: MenuItem) =>
          !item.meal.allergens.some((code) => child.allergies.includes(code))
        const mains = items.filter(
          (item) => item.date === date && item.mealType === 'subscription' && safe(item)
        )
        const extras = items.filter(
          (item) => item.date === date && item.mealType === 'supplement' && safe(item)
        )
        const actor = { user: child.parent }
        const roll = random()
        try {
          if (subscribed.has(child.id)) {
            if (roll < 0.06) {
              await orders.cancelDay(child.id, date, actor)
              placed++
              continue
            }
            if (roll < 0.15 || mains.length === 0) continue // no choice → default at the deadline
            const main =
              roll < 0.55 ? (mains.find((item) => item.isDefault) ?? mains[0]) : pick(mains, random)
            const supplements =
              extras.length && random() < 0.35
                ? [{ mealId: pick(extras, random).mealId, qty: random() < 0.2 ? 2 : 1 }]
                : []
            await orders.saveDay(
              child.id,
              date,
              { subscriptionMealId: main.mealId, supplements },
              actor
            )
            placed++
          } else if (extras.length && roll < 0.5) {
            await orders.saveDay(
              child.id,
              date,
              {
                subscriptionMealId: null,
                supplements: [{ mealId: pick(extras, random).mealId, qty: 1 }],
              },
              actor
            )
            placed++
          }
        } catch (error) {
          if (!(error instanceof OrderRuleException) && !(error instanceof BusinessRuleException)) {
            throw error
          }
        }
      }
    }
    return placed
  }
}

/** Today when it is a weekday, otherwise the next Monday. */
function nextSchoolDay(today: IsoDate): IsoDate {
  let day = today
  while (isoWeekday(day) > 5) day = addDays(day, 1)
  return day
}
