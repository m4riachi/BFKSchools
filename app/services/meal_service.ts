import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import i18nManager from '@adonisjs/i18n/services/main'
import Meal from '#models/meal'
import type User from '#models/user'
import Clock from '#services/clock'
import MealPhotoService from '#services/meal_photo_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import type { AllergenCode } from '#enums/allergens'
import type { MealActiveFilter, MealCategory, MealType } from '#enums/meals'
import { MEAL_NAME_MAX_LENGTH, MEALS_PER_PAGE } from '#config/meals'

export type MealInput = {
  nameFr: string
  nameEn: string
  descriptionFr?: string | null
  descriptionEn?: string | null
  type: MealType
  category: MealCategory
  /** Integer centimes, already parsed by the validator (never a float). */
  price: number
  allergens?: AllergenCode[]
  tags?: string[]
  isActive?: boolean
  externalRecipeRef?: string | null
}

export type MealListFilters = {
  q?: string
  type?: MealType
  category?: MealCategory
  active?: MealActiveFilter
  page?: number
}

/** Escapes LIKE wildcards in a user search string. */
function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

/**
 * The meal catalog (BFK-wide). Deleting is always a soft delete
 * (golden rule 7): `deleted_at` + `is_active = false`; the row and its
 * photos stay for order history and statements.
 */
@inject()
export default class MealService {
  constructor(
    protected clock: Clock,
    protected photos: MealPhotoService
  ) {}

  /** Catalog page (deleted meals excluded) with the cover photo preloaded. */
  async list(filters: MealListFilters, locale: string) {
    const query = Meal.query()
      .withScopes((scopes) => scopes.catalog())
      .preload('photos', (photos) => photos.where('is_cover', true))
      .withCount('photos')

    if (filters.type) query.where('type', filters.type)
    if (filters.category) query.where('category', filters.category)
    if (filters.active === 'active') query.where('is_active', true)
    if (filters.active === 'inactive') query.where('is_active', false)
    if (filters.q) {
      const pattern = likePattern(filters.q)
      query.where((search) => {
        search
          .whereILike('name_fr', pattern)
          .orWhereILike('name_en', pattern)
          .orWhereILike('external_recipe_ref', pattern)
      })
    }

    const nameColumn = locale === 'en' ? 'name_en' : 'name_fr'
    return query
      .orderByRaw(`lower(${nameColumn})`)
      .orderBy('id')
      .paginate(filters.page ?? 1, MEALS_PER_PAGE)
  }

  /** A meal of the catalog (not deleted) or a 404. */
  async findInCatalog(id: unknown): Promise<Meal> {
    const mealId = Number(id)
    const query = Meal.query().withScopes((scopes) => scopes.catalog())
    if (!Number.isSafeInteger(mealId) || mealId <= 0) return query.whereRaw('false').firstOrFail()
    return query.where('id', mealId).firstOrFail()
  }

  async create(input: MealInput, staff: User): Promise<Meal> {
    return Meal.create({
      ...this.attributes(input),
      isActive: input.isActive ?? true,
      createdBy: staff.id,
      deletedAt: null,
    })
  }

  /**
   * The meal row is locked `FOR UPDATE` while the type lock is checked and
   * the change saved; MenuBuilderService takes the same row `FOR SHARE` when
   * it adds the meal to a menu or a template. The two can't interleave, so a
   * meal never changes type (or becomes inactive) under a menu item that is
   * being inserted. Returns the saved (fresh) row.
   */
  async update(meal: Meal, input: MealInput): Promise<Meal> {
    return db.transaction(async (trx) => {
      const locked = await Meal.query({ client: trx })
        .where('id', meal.id)
        .forUpdate()
        .firstOrFail()
      if (input.type !== locked.type && (await this.isUsedOnMenus(locked.id, trx))) {
        throw new BusinessRuleException('meals.errors.type_locked', { field: 'type' })
      }
      locked.merge({ ...this.attributes(input), isActive: input.isActive ?? locked.isActive })
      await locked.save()
      return locked
    })
  }

  /**
   * Copies a meal with its photos (new files under new keys). The copy is
   * created **inactive** with " (copie)" / " (copy)" appended, so it can't be
   * offered by mistake before it is reviewed.
   */
  async duplicate(source: Meal, staff: User): Promise<Meal> {
    const copied: { cleanup?: () => Promise<void> } = {}
    try {
      return await db.transaction(async (trx) => {
        const copy = await Meal.create(
          {
            nameFr: this.withSuffix(source.nameFr, 'fr'),
            nameEn: this.withSuffix(source.nameEn, 'en'),
            descriptionFr: source.descriptionFr,
            descriptionEn: source.descriptionEn,
            type: source.type,
            category: source.category,
            priceCents: source.priceCents,
            allergens: [...source.allergens],
            tags: [...source.tags],
            externalRecipeRef: source.externalRecipeRef,
            isActive: false,
            createdBy: staff.id,
            deletedAt: null,
          },
          { client: trx }
        )
        const { cleanup } = await this.photos.copyAll(trx, source, copy)
        copied.cleanup = cleanup
        return copy
      })
    } catch (error) {
      await copied.cleanup?.()
      throw error
    }
  }

  /**
   * Soft delete: hidden from the catalog and menu pickers, still readable
   * through order/statement relations. Photos and their files are kept.
   */
  async softDelete(meal: Meal) {
    await db.transaction(async (trx) => {
      const locked = await Meal.query({ client: trx })
        .where('id', meal.id)
        .forUpdate()
        .firstOrFail()
      locked.merge({ deletedAt: this.clock.now(), isActive: false })
      await locked.save()
    })
    meal.merge({ deletedAt: this.clock.now(), isActive: false })
  }

  /**
   * Whether the meal appears on a weekly menu (any status, removed items
   * included) or a menu template (docs/ERD.md: `meals.type` is locked once
   * it does).
   */
  async isUsedOnMenus(mealId: number, client: QueryClientContract = db.connection()) {
    for (const table of ['menu_items', 'menu_template_items']) {
      const used = await client.from(table).where('meal_id', mealId).select('meal_id').first()
      if (used) return true
    }
    return false
  }

  protected attributes(input: MealInput) {
    return {
      nameFr: input.nameFr,
      nameEn: input.nameEn,
      descriptionFr: input.descriptionFr || null,
      descriptionEn: input.descriptionEn || null,
      type: input.type,
      category: input.category,
      priceCents: input.price,
      allergens: [...new Set(input.allergens ?? [])],
      tags: [...new Set(input.tags ?? [])],
      externalRecipeRef: input.externalRecipeRef || null,
    }
  }

  protected withSuffix(name: string, locale: 'fr' | 'en') {
    const suffix = ` ${i18nManager.locale(locale).t('meals.duplicate_suffix')}`
    return `${name.slice(0, MEAL_NAME_MAX_LENGTH - suffix.length)}${suffix}`
  }
}
