import { inject } from '@adonisjs/core'
import vine from '@vinejs/vine'
import db from '@adonisjs/lucid/services/db'
import School from '#models/school'
import MealPhoto from '#models/meal_photo'
import MenuItem from '#models/menu_item'
import WeeklyMenu from '#models/weekly_menu'
import Clock from '#services/clock'
import HolidayCalendar from '#services/holiday_calendar'
import SchoolSettingsService from '#services/school_settings_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import type { MealType } from '#enums/meals'
import type { StoredSchoolSettings } from '#types/school_settings'
import { addDays, focusDay, weekStart, type IsoDate } from '#support/dates'
import {
  coverPhoto,
  MEAL_PHOTO_PATH,
  mealDescription,
  mealName,
  mealPhotoUrl,
} from '#support/meal_display'

/** Lowercase words separated by single hyphens, 3 to 80 characters. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const boardSlugValidator = vine.create({
  board_slug: vine.string().trim().toLowerCase().minLength(3).maxLength(80).regex(SLUG_PATTERN),
})

/** "bfk-british-academy-school-marrakech" for the school of that name. */
export function suggestBoardSlug(schoolName: string): string {
  const words = schoolName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `bfk-${words || 'school'}`.slice(0, 80).replace(/-+$/, '')
}

export type BoardMeal = {
  mealId: number
  name: string
  description: string | null
  mealType: MealType
  /** D47: supplement tagged "special of the day", shown with the main dishes. */
  isSpecial: boolean
  /** Full-size cover photo through the board's own photo route, or null. */
  photoUrl: string | null
}

export type BoardDay = {
  date: IsoDate
  holiday: string | null
  /** The day's main dishes, then its special supplements (D47), in menu order. */
  dishes: BoardMeal[]
  supplements: BoardMeal[]
}

export type BoardWeek = {
  /** Week of the first day on the board (the page resets its slides when it changes). */
  weekStart: IsoDate
  today: IsoDate
  /** The calendar day after today (for the "Tomorrow" label; the second day may be later). */
  tomorrow: IsoDate
  /** False when no day on the board has a published menu (days are then empty). */
  published: boolean
  /** Today (or the next school day) and the school day after it. */
  days: BoardDay[]
}

/**
 * School display board (D46): a screen at the school opens `/board/<slug>`
 * without logging in and sees the published menu of today and the next
 * school day: the main dishes and the supplements, with photos. The address is
 * public (the admin chooses it, e.g. `bfk-british-academy-school-marrakech`)
 * because the page shows nothing parents do not already see: the menu only,
 * never orders or children. The admin can move it or turn it off.
 */
@inject()
export default class SchoolBoardService {
  constructor(
    protected clock: Clock,
    protected holidays: HolidayCalendar,
    protected settings: SchoolSettingsService
  ) {}

  /** The school whose board address is `slug`, or null. */
  async findSchool(slug: string): Promise<School | null> {
    if (!SLUG_PATTERN.test(slug)) return null
    const school = await School.query().whereRaw(`settings->>'board_slug' = ?`, [slug]).first()
    return school && this.settings.get(school).board_slug === slug ? school : null
  }

  /** Turns the board on at `/board/<slug>` (or moves it). Slugs are unique across schools. */
  async enable(school: School, slug: string): Promise<void> {
    const taken = await School.query()
      .whereRaw(`settings->>'board_slug' = ?`, [slug])
      .whereNot('id', school.id)
      .select('id')
      .first()
    if (taken) {
      throw new BusinessRuleException('settings.errors.board_slug_taken', { field: 'board_slug' })
    }
    await this.store(school, slug)
  }

  async disable(school: School): Promise<void> {
    await this.store(school, null)
  }

  /** D51: shows or hides the board's 🖨 "connect the printer" button. */
  async setPrinterButton(school: School, enabled: boolean): Promise<void> {
    await db.transaction(async (trx) => {
      const locked = await School.query({ client: trx })
        .where('id', school.id)
        .forUpdate()
        .firstOrFail()
      const next = { ...this.settings.get(locked), board_printer_button: enabled }
      locked.settings = next as StoredSchoolSettings
      await locked.save()
      school.settings = locked.settings
    })
  }

  protected async store(school: School, slug: string | null): Promise<void> {
    await db.transaction(async (trx) => {
      const locked = await School.query({ client: trx })
        .where('id', school.id)
        .forUpdate()
        .firstOrFail()
      const next = { ...this.settings.get(locked), board_slug: slug }
      locked.settings = next as StoredSchoolSettings
      await locked.save()
      school.settings = locked.settings
    })
  }

  /**
   * The days on the board: today — or the next school day, on a weekend —
   * and the school day after it (Friday shows Friday and Monday).
   */
  displayedDays(school: School): IsoDate[] {
    const first = focusDay(this.clock.today(), school.schoolDays)
    return [first, focusDay(addDays(first, 1), school.schoolDays)]
  }

  /** The published (or closed) menus covering `dates`, by week start. */
  protected async visibleMenus(
    school: School,
    dates: IsoDate[]
  ): Promise<Map<IsoDate, WeeklyMenu>> {
    const weeks = [...new Set(dates.map((date) => weekStart(date)))]
    const menus = await WeeklyMenu.query()
      .where('school_id', school.id)
      .whereIn('week_start', weeks)
      .whereIn('status', ['published', 'closed'])
    return new Map(menus.map((menu) => [menu.weekStart, menu]))
  }

  /** The menu of the displayed days, day by day. */
  async week(school: School, slug: string, locale: string): Promise<BoardWeek> {
    const dates = this.displayedDays(school)
    const menus = await this.visibleMenus(school, dates)
    const items = menus.size
      ? await MenuItem.query()
          .withScopes((scopes) => scopes.current())
          .whereIn(
            'weekly_menu_id',
            [...menus.values()].map((menu) => menu.id)
          )
          .whereIn('date', dates)
          .preload('meal', (meal) => meal.preload('photos'))
          .orderBy('date')
          .orderBy('position')
          .orderBy('id')
      : []

    const holidayNames = new Map<IsoDate, string[]>()
    for (const holiday of await this.holidays.holidaysBetween(school.id, dates[0], dates[1])) {
      holidayNames.set(holiday.date, [...(holidayNames.get(holiday.date) ?? []), holiday.name])
    }

    const present = (item: MenuItem): BoardMeal => {
      const cover = coverPhoto(item.meal.photos)
      return {
        mealId: item.meal.id,
        name: mealName(item.meal, locale),
        description: mealDescription(item.meal, locale),
        mealType: item.mealType,
        isSpecial: item.isSpecial,
        photoUrl: cover
          ? mealPhotoUrl(cover, 'full').replace(MEAL_PHOTO_PATH, `/board/${slug}/photos`)
          : null,
      }
    }

    const today = this.clock.today()
    return {
      weekStart: weekStart(dates[0]),
      today,
      tomorrow: addDays(today, 1),
      published: menus.size > 0,
      days: dates.map((date) => {
        const ofDay = items.filter((item) => item.date === date)
        return {
          date,
          holiday: holidayNames.get(date)?.join(' · ') ?? null,
          // The main dishes first, then the specials of the day (D47).
          dishes: [
            ...ofDay.filter((item) => item.mealType === 'subscription'),
            ...ofDay.filter((item) => item.mealType === 'supplement' && item.isSpecial),
          ].map(present),
          supplements: ofDay
            .filter((item) => item.mealType === 'supplement' && !item.isSpecial)
            .map(present),
        }
      }),
    }
  }

  /** A board may show the photo of a meal on the displayed days' menu only. */
  async canShowPhoto(school: School, photo: MealPhoto): Promise<boolean> {
    const dates = this.displayedDays(school)
    const menus = await this.visibleMenus(school, dates)
    if (!menus.size) return false
    const item = await MenuItem.query()
      .withScopes((scopes) => scopes.current())
      .whereIn(
        'weekly_menu_id',
        [...menus.values()].map((menu) => menu.id)
      )
      .whereIn('date', dates)
      .where('meal_id', photo.mealId)
      .select('id')
      .first()
    return item !== null
  }
}
