import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import PurchaseOrder from '#models/purchase_order'
import type School from '#models/school'
import type User from '#models/user'
import Clock from '#services/clock'
import MealIngredientService from '#services/meal_ingredient_service'
import { isIsoDate, type IsoDate } from '#support/dates'
import { ingredientIcon } from '#support/ingredient_icon'

export type ProcurementLine = {
  ingredientId: number | null
  label: string
  icon: string
  unit: string | null
  quantity: number
}

export type ProcurementView = {
  date: IsoDate
  reference: string
  note: string | null
  saved: boolean
  confirmedAt: string | null
  lines: ProcurementLine[]
}

export type ConfirmInput = {
  note: string | null
  /** Confirm does not store the icon (derived from the label on read). */
  lines: Omit<ProcurementLine, 'icon'>[]
}

function assertDate(date: IsoDate) {
  if (!isIsoDate(date)) throw new TypeError(`Invalid ISO date "${date}"`)
}

/** Round to 3 decimals without float noise. */
function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000
}

/**
 * D56: the économat (purchase) list of a day. The provisional quantities come
 * from the day's active orders (Σ meals × quantity per meal, per ingredient);
 * the kitchen edits them and confirms them into a saved bon de commande
 * (one per school and day). Parent ingredient removals are not subtracted.
 */
@inject()
export default class ProcurementService {
  constructor(
    protected clock: Clock,
    protected fiches: MealIngredientService
  ) {}

  reference(date: IsoDate): string {
    return `BC-${date.replace(/-/g, '')}`
  }

  /** Provisional quantities from the day's orders and the fiches techniques. */
  async provisional(schoolId: number, date: IsoDate): Promise<ProcurementLine[]> {
    assertDate(date)
    const meals = await db.rawQuery(
      `SELECT moi.meal_id, SUM(moi.quantity)::int AS meals
         FROM meal_orders mo
         JOIN meal_order_items moi ON moi.meal_order_id = mo.id
        WHERE mo.school_id = ? AND mo.date = ? AND mo.status = 'active'
        GROUP BY moi.meal_id`,
      [schoolId, date]
    )
    const mealCounts = new Map<number, number>(
      meals.rows.map((row: { meal_id: number; meals: number }) => [
        Number(row.meal_id),
        Number(row.meals),
      ])
    )
    const byMeal = await this.fiches.quantitiesByMeal([...mealCounts.keys()])

    const totals = new Map<number, ProcurementLine>()
    for (const [mealId, count] of mealCounts) {
      for (const ing of byMeal.get(mealId) ?? []) {
        if (ing.quantityPerMeal <= 0) continue
        const line = totals.get(ing.ingredientId) ?? {
          ingredientId: ing.ingredientId,
          label: ing.label,
          icon: ingredientIcon(ing.label),
          unit: ing.unit,
          quantity: 0,
        }
        line.quantity += count * ing.quantityPerMeal
        totals.set(ing.ingredientId, line)
      }
    }
    return [...totals.values()]
      .map((line) => ({ ...line, quantity: round3(line.quantity) }))
      .filter((line) => line.quantity > 0)
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  /** The saved bon de commande of the day, or the provisional one. */
  async current(schoolId: number, date: IsoDate): Promise<ProcurementView> {
    assertDate(date)
    const order = await PurchaseOrder.query()
      .where('school_id', schoolId)
      .where('date', date)
      .preload('lines', (q) => q.orderBy('position', 'asc').orderBy('id', 'asc'))
      .first()
    if (order) {
      return {
        date,
        reference: order.reference,
        note: order.note,
        saved: true,
        confirmedAt: order.confirmedAt?.toISO() ?? null,
        lines: order.lines.map((line) => ({
          ingredientId: line.ingredientId,
          label: line.label,
          icon: ingredientIcon(line.label),
          unit: line.unit,
          quantity: Number(line.quantity),
        })),
      }
    }
    return {
      date,
      reference: this.reference(date),
      note: null,
      saved: false,
      confirmedAt: null,
      lines: await this.provisional(schoolId, date),
    }
  }

  /** Confirm (create or replace) the day's bon de commande. */
  async confirm(school: School, date: IsoDate, input: ConfirmInput, actor: User) {
    assertDate(date)
    const lines = input.lines
      .map((line) => ({
        ingredientId: line.ingredientId ?? null,
        label: line.label.trim().slice(0, 200),
        unit: line.unit ? line.unit.trim().slice(0, 40) : null,
        quantity: round3(Number(line.quantity) || 0),
      }))
      .filter((line) => line.label && line.quantity > 0)

    return db.transaction(async (trx) => {
      const now = this.clock.now()
      let order = await PurchaseOrder.query({ client: trx })
        .where('school_id', school.id)
        .where('date', date)
        .forUpdate()
        .first()
      if (!order) {
        order = await PurchaseOrder.create(
          {
            schoolId: school.id,
            date,
            reference: this.reference(date),
            note: input.note,
            confirmedAt: now,
            confirmedBy: actor.id,
          },
          { client: trx }
        )
      } else {
        order.useTransaction(trx)
        order.merge({ note: input.note, confirmedAt: now, confirmedBy: actor.id })
        await order.save()
        await trx.from('purchase_order_lines').where('purchase_order_id', order.id).delete()
      }
      if (lines.length) {
        await trx.table('purchase_order_lines').insert(
          lines.map((line, position) => ({
            purchase_order_id: order!.id,
            ingredient_id: line.ingredientId,
            label: line.label,
            unit: line.unit,
            quantity: line.quantity,
            position,
            created_at: now.toISO()!,
            updated_at: now.toISO()!,
          }))
        )
      }
      return order
    })
  }

  /** Add a brand-new article to the catalog (not found when ordering). */
  createIngredient(label: string, unit: string | null) {
    return this.fiches.createIngredient(label, unit)
  }
}
