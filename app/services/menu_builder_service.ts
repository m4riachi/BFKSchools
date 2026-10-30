import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { RawQueryBindings } from '@adonisjs/lucid/types/querybuilder'
import type School from '#models/school'
import type User from '#models/user'
import Meal from '#models/meal'
import MenuItem from '#models/menu_item'
import MenuTemplate from '#models/menu_template'
import MenuTemplateItem from '#models/menu_template_item'
import WeeklyMenu from '#models/weekly_menu'
import Clock from '#services/clock'
import MenuCalendar from '#services/menu_calendar'
import MenuChangeService, { type RemovalResolution } from '#services/menu_change_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import { addDays, diffInDays, isoWeekday, type IsoDate } from '#support/dates'
import type { WeeklyMenuStatus } from '#enums/menus'

const PG_UNIQUE_VIOLATION = '23505'
/** Old menus offered for copying (about six months). */
const PAST_WEEKS_LISTED = 26

function isUniqueViolation(error: unknown) {
  return (error as { code?: string } | null)?.code === PG_UNIQUE_VIOLATION
}

export type AddItemInput = { date: IsoDate; mealId: number; maxQuantity?: number | null }

/** One item to (re)create when copying a week or applying a template. */
type PlannedItem = {
  date: IsoDate
  mealId: number
  isDefault: boolean
  maxQuantity: number | null
  position: number
}

/** What "copy previous week" / "apply template" left out, shown to the admin. */
export type CopyReport = {
  added: number
  skippedDays: { date: IsoDate; reason: 'holiday' | 'not_school_day'; names: string[] }[]
  skippedMeals: { date: IsoDate | null; mealId: number; nameFr: string; nameEn: string }[]
  /** Days whose default meal was skipped: the first remaining one became the default. */
  newDefaults: IsoDate[]
}

/**
 * The week builder (brief §5.4, docs/ERD.md §menu_items): items per day,
 * the default meal of each day, max quantities, copy previous week and
 * templates.
 *
 * Invariants kept on every write:
 * - only open days (school weekday inside the school year, not a holiday)
 *   receive items; only offerable meals (active, not deleted) are added;
 * - every day that has subscription meals has exactly one default: the
 *   first subscription meal added becomes the default, and removing the
 *   default promotes the next one;
 * - on a **published** menu (D18): adding is allowed; changing a day's
 *   default only until the order deadline (parents concerned are told);
 *   `max_quantity` never below the portions already ordered; removing an
 *   item resolves its orders first (switch or cancel, MenuChangeService);
 *   closed menus are read-only.
 *
 * Locks (one transaction per write): the school row `FOR SHARE` (holiday
 * writes take it `FOR UPDATE`, so a day can't become a holiday while an item
 * is added to it), then the menu row `FOR UPDATE`, then each meal row
 * `FOR SHARE` (MealService.update takes it `FOR UPDATE` before changing a
 * meal's type or deactivating it, so the two can't interleave).
 */
@inject()
export default class MenuBuilderService {
  constructor(
    protected clock: Clock,
    protected calendar: MenuCalendar,
    protected changes: MenuChangeService
  ) {}

  async findWeek(schoolId: number, weekStart: IsoDate) {
    return WeeklyMenu.query().where('school_id', schoolId).where('week_start', weekStart).first()
  }

  /**
   * Runs `work` with the week's menu locked, creating the draft (with the
   * default publish/deadline times) when it does not exist yet.
   */
  async withMenu<T>(
    school: School,
    weekStart: IsoDate,
    actor: User | null,
    work: (trx: TransactionClientContract, menu: WeeklyMenu) => Promise<T>
  ): Promise<T> {
    return db.transaction(async (trx) => {
      await trx.from('schools').where('id', school.id).forShare().select('id')
      const menu = await this.lockOrCreate(trx, school, weekStart, actor)
      const result = await work(trx, menu)
      if (actor) {
        menu.useTransaction(trx)
        menu.updatedBy = actor.id
        await menu.save()
      }
      return result
    })
  }

  protected async lockOrCreate(
    trx: TransactionClientContract,
    school: School,
    weekStart: IsoDate,
    actor: User | null
  ) {
    const defaults = this.calendar.defaultTimes(school, weekStart)
    const now = this.clock.now().toISO()!
    await trx.rawQuery(
      `INSERT INTO weekly_menus
         (school_id, week_start, status, publish_at, order_deadline_at, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?)
       ON CONFLICT (school_id, week_start) DO NOTHING`,
      [
        school.id,
        weekStart,
        defaults.valid ? defaults.publishAt.toISO() : null,
        defaults.valid ? defaults.orderDeadlineAt.toISO() : null,
        actor?.id ?? null,
        actor?.id ?? null,
        now,
        now,
      ] as RawQueryBindings
    )
    return WeeklyMenu.query({ client: trx })
      .where('school_id', school.id)
      .where('week_start', weekStart)
      .forUpdate()
      .firstOrFail()
  }

  protected assertEditable(menu: WeeklyMenu) {
    if (menu.status === 'closed') throw new BusinessRuleException('menus.errors.closed')
  }

  /** Locks and returns an offerable meal (active, not deleted), or refuses. */
  protected async lockOfferableMeal(trx: TransactionClientContract, mealId: number) {
    const meal = await Meal.query({ client: trx })
      .withScopes((scopes) => scopes.offerable())
      .where('id', mealId)
      .forShare()
      .first()
    if (!meal) throw new BusinessRuleException('menus.errors.meal_unavailable')
    return meal
  }

  protected async currentItems(trx: TransactionClientContract, menuId: number, date?: IsoDate) {
    const query = MenuItem.query({ client: trx })
      .withScopes((scopes) => scopes.current())
      .where('weekly_menu_id', menuId)
      .orderBy('date')
      .orderBy('position')
      .orderBy('id')
    if (date) query.where('date', date)
    return query
  }

  /* ------------------------------------------------------------------ */
  /* Items                                                               */
  /* ------------------------------------------------------------------ */

  async addItem(school: School, weekStart: IsoDate, input: AddItemInput, actor: User) {
    return this.withMenu(school, weekStart, actor, async (trx, menu) => {
      this.assertEditable(menu)
      if (input.date < weekStart || input.date > addDays(weekStart, 6)) {
        throw new BusinessRuleException('menus.errors.date_outside_week', { field: 'date' })
      }
      const weekDays = await this.calendar.days(school, weekStart, trx)
      const day = weekDays.find((candidate) => candidate.date === input.date)
      if (!day || day.state === 'not_school_day') {
        throw new BusinessRuleException('menus.errors.not_school_day', { field: 'date' })
      }
      if (day.state === 'holiday') {
        throw new BusinessRuleException('menus.errors.holiday', {
          field: 'date',
          values: { name: day.holidayNames.join(', ') },
        })
      }

      const meal = await this.lockOfferableMeal(trx, input.mealId)
      const sameDay = await this.currentItems(trx, menu.id, input.date)
      if (sameDay.some((item) => item.mealId === meal.id)) {
        throw new BusinessRuleException('menus.errors.duplicate')
      }
      const sameType = sameDay.filter((item) => item.mealType === meal.type)
      const isDefault = meal.type === 'subscription' && !sameDay.some((item) => item.isDefault)

      try {
        return await MenuItem.create(
          {
            weeklyMenuId: menu.id,
            date: input.date,
            mealId: meal.id,
            mealType: meal.type,
            position: sameType.length ? Math.max(...sameType.map((i) => i.position)) + 1 : 0,
            isDefault,
            maxQuantity: input.maxQuantity ?? null,
            removedAt: null,
          },
          { client: trx }
        )
      } catch (error) {
        if (isUniqueViolation(error)) throw new BusinessRuleException('menus.errors.duplicate')
        throw error
      }
    })
  }

  protected async lockedItem(trx: TransactionClientContract, menu: WeeklyMenu, itemId: number) {
    return MenuItem.query({ client: trx })
      .withScopes((scopes) => scopes.current())
      .where('weekly_menu_id', menu.id)
      .where('id', itemId)
      .forUpdate()
      .firstOrFail()
  }

  /**
   * Removes an item. Draft and scheduled menus have no orders: the row is
   * deleted. On a published menu the item's active orders must be resolved
   * (`resolution`: switch to another meal of the day, or cancel the lines —
   * see MenuChangeService and the impact page); the item is then deleted,
   * or kept with `removed_at` when order lines still reference it.
   */
  async removeItem(
    school: School,
    menu: WeeklyMenu,
    itemId: number,
    actor: User,
    resolution: RemovalResolution | null = null
  ) {
    return this.withMenu(school, menu.weekStart, actor, async (trx, locked) => {
      this.assertEditable(locked)
      const item = await this.lockedItem(trx, locked, itemId)
      let outcome = null
      if (locked.status === 'published') {
        outcome = await this.changes.removeItem(trx, school, locked, item, actor, resolution)
      } else {
        await item.useTransaction(trx).delete()
      }
      if (item.isDefault) {
        if (locked.status !== 'published') {
          await this.ensureDefault(trx, locked.id, item.date)
        } else if (locked.orderDeadlineAt && locked.orderDeadlineAt > this.clock.now()) {
          // D18: a published day's default changes only before the deadline,
          // and the parents concerned are told.
          const promoted = await this.ensureDefault(trx, locked.id, item.date)
          if (promoted) await this.changes.notifyDefaultChange(trx, school, locked, promoted)
        }
        // After the deadline the day keeps no default: auto-assign (already
        // run or not) skips it and reports it.
      }
      return { item, outcome }
    })
  }

  /**
   * Makes a subscription item the default of its day (the previous one is
   * unset). On a published menu (D18) only before the order deadline, and
   * the parents whose children would get the default are notified.
   */
  async setDefault(school: School, menu: WeeklyMenu, itemId: number, actor: User) {
    return this.withMenu(school, menu.weekStart, actor, async (trx, locked) => {
      this.assertEditable(locked)
      const item = await this.lockedItem(trx, locked, itemId)
      if (item.mealType !== 'subscription') {
        throw new BusinessRuleException('menus.errors.default_supplement')
      }
      if (item.isDefault) return item
      const published = locked.status === 'published'
      if (published && (!locked.orderDeadlineAt || locked.orderDeadlineAt <= this.clock.now())) {
        throw new BusinessRuleException('menus.errors.default_after_deadline')
      }
      await trx
        .from('menu_items')
        .where('weekly_menu_id', locked.id)
        .where('date', item.date)
        .where('is_default', true)
        .update({ is_default: false, updated_at: this.clock.now().toISO()! })
      item.isDefault = true
      await item.useTransaction(trx).save()
      if (published) await this.changes.notifyDefaultChange(trx, school, locked, item)
      return item
    })
  }

  /** Changes an item's cap; never below the portions already ordered (D18). */
  async updateItem(
    school: School,
    menu: WeeklyMenu,
    itemId: number,
    input: { maxQuantity: number | null },
    actor: User
  ) {
    return this.withMenu(school, menu.weekStart, actor, async (trx, locked) => {
      this.assertEditable(locked)
      const item = await this.lockedItem(trx, locked, itemId)
      await this.changes.assertMaxQuantity(trx, item.id, input.maxQuantity)
      item.maxQuantity = input.maxQuantity
      await item.useTransaction(trx).save()
      return item
    })
  }

  /**
   * Gives a day a default when it has subscription meals but none is the
   * default. Returns the promoted item (null when nothing changed).
   */
  protected async ensureDefault(
    trx: TransactionClientContract,
    menuId: number,
    date: IsoDate
  ): Promise<MenuItem | null> {
    const items = await this.currentItems(trx, menuId, date)
    const subscriptions = items.filter((item) => item.mealType === 'subscription')
    if (!subscriptions.length || subscriptions.some((item) => item.isDefault)) return null
    subscriptions[0].isDefault = true
    await subscriptions[0].useTransaction(trx).save()
    return subscriptions[0]
  }

  /* ------------------------------------------------------------------ */
  /* Copy previous week / templates                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Replaces the items of a **draft** week with those of the previous week
   * (same weekdays). Holiday days, days outside the school year and meals
   * that are inactive or deleted are skipped and reported.
   */
  async copyPreviousWeek(school: School, weekStart: IsoDate, actor: User): Promise<CopyReport> {
    return this.copyWeek(
      school,
      weekStart,
      addDays(weekStart, -7),
      actor,
      'menus.errors.no_previous_week'
    )
  }

  /** Earlier weeks of the school that have a menu to copy, the most recent first. */
  async pastWeeks(schoolId: number, before: IsoDate) {
    const rows = await db
      .from('weekly_menus as wm')
      .join('menu_items as mi', 'mi.weekly_menu_id', 'wm.id')
      .where('wm.school_id', schoolId)
      .where('wm.week_start', '<', before)
      .whereNull('mi.removed_at')
      .groupBy('wm.id')
      .orderBy('wm.week_start', 'desc')
      .limit(PAST_WEEKS_LISTED)
      .select('wm.status', db.raw('wm.week_start::text AS week_start'))
      .select(db.raw('count(*)::int AS items'))
    return rows.map((row) => ({
      weekStart: row.week_start as IsoDate,
      status: row.status as WeeklyMenuStatus,
      items: Number(row.items),
    }))
  }

  /**
   * Same as copyPreviousWeek, from any earlier week of the school (D40). Each
   * meal lands on the same weekday; the source week is not changed.
   */
  async copyWeek(
    school: School,
    weekStart: IsoDate,
    sourceWeek: IsoDate,
    actor: User,
    emptyError = 'menus.errors.no_source_week'
  ): Promise<CopyReport> {
    const source = sourceWeek < weekStart ? await this.findWeek(school.id, sourceWeek) : null
    const sourceItems = source
      ? await MenuItem.query()
          .withScopes((scopes) => scopes.current())
          .where('weekly_menu_id', source.id)
      : []
    if (!sourceItems.length) throw new BusinessRuleException(emptyError)

    const shift = diffInDays(sourceWeek, weekStart)
    return this.withMenu(school, weekStart, actor, async (trx, menu) => {
      return this.replaceItems(
        trx,
        school,
        menu,
        sourceItems.map((item) => ({
          date: addDays(item.date, shift),
          mealId: item.mealId,
          isDefault: item.isDefault,
          maxQuantity: item.maxQuantity,
          position: item.position,
        }))
      )
    })
  }

  /** Replaces the items of a draft week with a template (by weekday). */
  async applyTemplate(
    school: School,
    weekStart: IsoDate,
    template: MenuTemplate,
    actor: User
  ): Promise<CopyReport> {
    const items = await MenuTemplateItem.query().where('menu_template_id', template.id)
    if (!items.length) throw new BusinessRuleException('menus.errors.template_empty')
    return this.withMenu(school, weekStart, actor, async (trx, menu) => {
      return this.replaceItems(
        trx,
        school,
        menu,
        items.map((item) => ({
          date: addDays(weekStart, item.weekday - 1),
          mealId: item.mealId,
          isDefault: item.isDefault,
          maxQuantity: item.maxQuantity,
          position: item.position,
        }))
      )
    })
  }

  protected async replaceItems(
    trx: TransactionClientContract,
    school: School,
    menu: WeeklyMenu,
    planned: PlannedItem[]
  ): Promise<CopyReport> {
    if (menu.status !== 'draft') throw new BusinessRuleException('menus.errors.not_draft')

    const report: CopyReport = { added: 0, skippedDays: [], skippedMeals: [], newDefaults: [] }
    const weekDays = await this.calendar.days(school, menu.weekStart, trx)
    const days = new Map(weekDays.map((day) => [day.date, day]))
    const mealIds = [...new Set(planned.map((item) => item.mealId))]
    const lockedMeals = await Meal.query({ client: trx })
      .whereIn('id', mealIds)
      .orderBy('id')
      .forShare()
    const meals = new Map(lockedMeals.map((meal) => [meal.id, meal]))

    await trx.from('menu_items').where('weekly_menu_id', menu.id).whereNull('removed_at').delete()

    const sorted = [...planned].sort(
      (a, b) => a.date.localeCompare(b.date) || a.position - b.position || a.mealId - b.mealId
    )
    const reportedDays = new Set<IsoDate>()
    const reportedMeals = new Set<number>()
    const touched = new Set<IsoDate>()
    const defaultDays = new Set<IsoDate>()
    const lostDefault = new Set<IsoDate>()
    const positions = new Map<string, number>()

    for (const item of sorted) {
      const day = days.get(item.date)
      if (!day || day.state !== 'open') {
        if (!reportedDays.has(item.date)) {
          reportedDays.add(item.date)
          report.skippedDays.push({
            date: item.date,
            reason: day?.state === 'holiday' ? 'holiday' : 'not_school_day',
            names: day?.holidayNames ?? [],
          })
        }
        continue
      }
      const meal = meals.get(item.mealId)
      if (!meal || !meal.isActive || meal.deletedAt) {
        if (item.isDefault) lostDefault.add(item.date)
        if (meal && !reportedMeals.has(meal.id)) {
          reportedMeals.add(meal.id)
          report.skippedMeals.push({
            date: item.date,
            mealId: meal.id,
            nameFr: meal.nameFr,
            nameEn: meal.nameEn,
          })
        }
        continue
      }
      const positionKey = `${item.date}:${meal.type}`
      const position = positions.get(positionKey) ?? 0
      positions.set(positionKey, position + 1)
      const isDefault =
        meal.type === 'subscription' && item.isDefault && !defaultDays.has(item.date)
      if (isDefault) defaultDays.add(item.date)
      await MenuItem.create(
        {
          weeklyMenuId: menu.id,
          date: item.date,
          mealId: meal.id,
          mealType: meal.type,
          position,
          isDefault,
          maxQuantity: item.maxQuantity,
          removedAt: null,
        },
        { client: trx }
      )
      report.added += 1
      touched.add(item.date)
    }

    for (const date of [...touched].sort()) {
      const promoted = await this.ensureDefault(trx, menu.id, date)
      if (promoted && lostDefault.has(date)) report.newDefaults.push(date)
    }
    return report
  }

  /**
   * Saves the current items of a week as a template (by weekday). Inactive
   * or deleted meals are left out and reported. Names are unique per school
   * (case-insensitive).
   */
  async saveAsTemplate(
    school: School,
    menu: WeeklyMenu,
    input: { name: string; description?: string | null },
    actor: User
  ) {
    return db.transaction(async (trx) => {
      const items = await MenuItem.query({ client: trx })
        .withScopes((scopes) => scopes.current())
        .where('weekly_menu_id', menu.id)
        .preload('meal')
        .orderBy('date')
        .orderBy('position')
        .orderBy('id')
      if (!items.length) throw new BusinessRuleException('menus.errors.empty_week')
      // Same lock as addItem: a meal's type can't change while it is copied.
      await trx
        .from('meals')
        .whereIn('id', [...new Set(items.map((item) => item.mealId))])
        .orderBy('id')
        .forShare()
        .select('id')

      let template: MenuTemplate
      try {
        template = await MenuTemplate.create(
          {
            schoolId: school.id,
            name: input.name,
            description: input.description || null,
            createdBy: actor.id,
          },
          { client: trx }
        )
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new BusinessRuleException('menus.errors.template_name_taken', { field: 'name' })
        }
        throw error
      }

      const skippedMeals: CopyReport['skippedMeals'] = []
      let added = 0
      for (const item of items) {
        if (!item.meal.isActive || item.meal.deletedAt) {
          if (!skippedMeals.some((meal) => meal.mealId === item.mealId)) {
            skippedMeals.push({
              date: item.date,
              mealId: item.mealId,
              nameFr: item.meal.nameFr,
              nameEn: item.meal.nameEn,
            })
          }
          continue
        }
        await MenuTemplateItem.create(
          {
            menuTemplateId: template.id,
            weekday: isoWeekday(item.date),
            mealId: item.mealId,
            mealType: item.mealType,
            position: item.position,
            isDefault: item.isDefault,
            maxQuantity: item.maxQuantity,
          },
          { client: trx }
        )
        added += 1
      }
      if (!added) throw new BusinessRuleException('menus.errors.empty_week')
      return { template, added, skippedMeals }
    })
  }

  async deleteTemplate(template: MenuTemplate) {
    await template.delete()
  }
}
