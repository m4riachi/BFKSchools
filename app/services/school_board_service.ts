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
import {
  addDays,
  datesBetween,
  focusDay,
  isoWeekday,
  weekStart,
  type IsoDate,
} from '#support/dates'
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
  /** Full-size cover photo through the board's own photo route, or null. */
  photoUrl: string | null
}

export type BoardDay = {
  date: IsoDate
  holiday: string | null
  /** The day's main dishes, in menu order. */
  dishes: BoardMeal[]
  supplements: BoardMeal[]
}

export type BoardWeek = {
  weekStart: IsoDate
  today: IsoDate
  /** False when the week's menu is not published yet (days are then empty). */
  published: boolean
  days: BoardDay[]
}

/**
 * School display board (D46): a screen at the school opens `/board/<slug>`
 * without logging in and sees the published menu of the week, one day at a
 * time: the main dishes and the supplements, with photos. The address is
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
   * The week on the board: the current one, or the next one from the last
   * school day of the week (Saturday and Sunday on a Mon–Fri school).
   */
  displayedWeek(school: School): { from: IsoDate; to: IsoDate; dates: IsoDate[] } {
    const from = weekStart(focusDay(this.clock.today(), school.schoolDays))
    const to = addDays(from, 6)
    const dates = datesBetween(from, to).filter((date) =>
      school.schoolDays.includes(isoWeekday(date))
    )
    return { from, to, dates }
  }

  /** The published (or closed) menu of the displayed week, or null. */
  protected async visibleMenu(school: School, from: IsoDate): Promise<WeeklyMenu | null> {
    const menu = await WeeklyMenu.query()
      .where('school_id', school.id)
      .where('week_start', from)
      .first()
    return menu && ['published', 'closed'].includes(menu.status) ? menu : null
  }

  /** The menu of the displayed week, day by day. */
  async week(school: School, slug: string, locale: string): Promise<BoardWeek> {
    const { from, to, dates } = this.displayedWeek(school)
    const menu = await this.visibleMenu(school, from)
    const items = menu
      ? await MenuItem.query()
          .withScopes((scopes) => scopes.current())
          .where('weekly_menu_id', menu.id)
          .preload('meal', (meal) => meal.preload('photos'))
          .orderBy('date')
          .orderBy('position')
          .orderBy('id')
      : []

    const holidayNames = new Map<IsoDate, string[]>()
    for (const holiday of await this.holidays.holidaysBetween(school.id, from, to)) {
      holidayNames.set(holiday.date, [...(holidayNames.get(holiday.date) ?? []), holiday.name])
    }

    const present = (item: MenuItem): BoardMeal => {
      const cover = coverPhoto(item.meal.photos)
      return {
        mealId: item.meal.id,
        name: mealName(item.meal, locale),
        description: mealDescription(item.meal, locale),
        mealType: item.mealType,
        photoUrl: cover
          ? mealPhotoUrl(cover, 'full').replace(MEAL_PHOTO_PATH, `/board/${slug}/photos`)
          : null,
      }
    }

    return {
      weekStart: from,
      today: this.clock.today(),
      published: menu !== null,
      days: dates.map((date) => {
        const ofDay = items.filter((item) => item.date === date)
        return {
          date,
          holiday: holidayNames.get(date)?.join(' · ') ?? null,
          dishes: ofDay.filter((item) => item.mealType === 'subscription').map(present),
          supplements: ofDay.filter((item) => item.mealType === 'supplement').map(present),
        }
      }),
    }
  }

  /** A board may show the photo of a meal on the displayed week's menu only. */
  async canShowPhoto(school: School, photo: MealPhoto): Promise<boolean> {
    const { from } = this.displayedWeek(school)
    const menu = await this.visibleMenu(school, from)
    if (!menu) return false
    const item = await MenuItem.query()
      .withScopes((scopes) => scopes.current())
      .where('weekly_menu_id', menu.id)
      .where('meal_id', photo.mealId)
      .select('id')
      .first()
    return item !== null
  }
}
