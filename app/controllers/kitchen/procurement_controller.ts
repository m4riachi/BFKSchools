import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import ProcurementService from '#services/procurement_service'
import MealIngredientService from '#services/meal_ingredient_service'
import ProcurementPdfService from '#services/procurement_pdf_service'
import Clock from '#services/clock'
import { reportSchool, requireReportSchool } from '#support/report_access'
import { reportDate } from '#support/report_period'
import { reportDayValidator } from '#validators/reports'
import { attachmentHeader, renderPdfForUser } from '#support/report_access'
import { addDays } from '#support/dates'
import { ingredientIcon } from '#support/ingredient_icon'

const idRule = () => vine.number().withoutDecimals().range([1, 2147483647])

const confirmValidator = vine.create({
  date: vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/),
  note: vine.string().trim().maxLength(500).nullable().optional(),
  lines: vine
    .array(
      vine.object({
        ingredientId: idRule().nullable().optional(),
        label: vine.string().trim().minLength(1).maxLength(200),
        unit: vine.string().trim().maxLength(40).nullable().optional(),
        quantity: vine.number().min(0).max(1000000),
      })
    )
    .maxLength(500),
})

const newIngredientValidator = vine.create({
  label: vine.string().trim().minLength(1).maxLength(200),
  unit: vine.string().trim().maxLength(40).nullable().optional(),
})

/**
 * D56: économat / bon de commande. Daily purchase list computed from the
 * orders, edited and confirmed by the kitchen (admin, manager, kitchen).
 */
@inject()
export default class ProcurementController {
  constructor(
    protected clock: Clock,
    protected procurement: ProcurementService,
    protected fiches: MealIngredientService,
    protected pdf: ProcurementPdfService
  ) {}

  async show(ctx: HttpContext) {
    const { request, inertia } = ctx
    const school = await reportSchool(ctx)
    const today = this.clock.today()
    let query: { date?: string } = {}
    try {
      query = await reportDayValidator.validate(request.qs())
    } catch {
      query = {}
    }
    const date = reportDate(query.date, today)
    const nav = { date, today, previous: addDays(date, -1), next: addDays(date, 1) }
    if (!school) return inertia.render('kitchen/procurement', { ...nav, order: null })
    return inertia.render('kitchen/procurement', {
      ...nav,
      order: await this.procurement.current(school.id, date),
    })
  }

  async confirm(ctx: HttpContext) {
    const { request, response, session, i18n, auth } = ctx
    const school = await requireReportSchool(ctx)
    const { date, note, lines } = await request.validateUsing(confirmValidator)
    await this.procurement.confirm(
      school,
      date,
      {
        note: note ?? null,
        lines: lines.map((l) => ({
          ingredientId: l.ingredientId ?? null,
          label: l.label,
          unit: l.unit ?? null,
          quantity: l.quantity,
        })),
      },
      auth.getUserOrFail()
    )
    session.flash('success', i18n.t('procurement.flash.confirmed'))
    return response.redirect().withQs({ date }).toPath('/kitchen/procurement')
  }

  /** Ingredient search for the picker (?q=). */
  async search(ctx: HttpContext) {
    const { request } = ctx
    await requireReportSchool(ctx)
    const q = String(request.input('q', '')).slice(0, 80)
    const results = await this.fiches.search(q)
    return {
      results: results.map((r) => ({
        id: r.ingredientId,
        label: r.label,
        icon: r.icon,
        unit: r.unit,
      })),
    }
  }

  /** Add a brand-new article to the catalog (not found when ordering). */
  async createIngredient(ctx: HttpContext) {
    const { request } = ctx
    await requireReportSchool(ctx)
    const { label, unit } = await request.validateUsing(newIngredientValidator)
    const ingredient = await this.procurement.createIngredient(label, unit ?? null)
    return {
      ingredient: {
        id: ingredient.id,
        label: ingredient.label,
        icon: ingredientIcon(ingredient.label),
        unit: ingredient.unit,
      },
    }
  }

  /** The confirmed bon de commande as a PDF. */
  async download(ctx: HttpContext) {
    const { request, response, i18n, session } = ctx
    const school = await requireReportSchool(ctx)
    const validated = await reportDayValidator.validate(request.qs())
    const date = reportDate(validated.date, this.clock.today())
    const view = await this.procurement.current(school.id, date)
    if (!view.saved) {
      session.flash('error', i18n.t('procurement.flash.confirm_first'))
      return response.redirect().withQs({ date }).toPath('/kitchen/procurement')
    }
    const buffer = await renderPdfForUser(ctx, () => this.pdf.render(school, view, i18n.locale))
    if (buffer === null) return
    response.header('Content-Type', 'application/pdf')
    response.header('Content-Disposition', attachmentHeader(`${view.reference}.pdf`))
    return response.send(buffer)
  }
}
