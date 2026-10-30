import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import Child from '#models/child'
import School from '#models/school'
import User from '#models/user'
import Clock from '#services/clock'
import StatementService from '#services/statement_service'
import StatementPdfService from '#services/statement_pdf_service'
import StatementExportService from '#services/statement_export_service'
import SchoolSettingsService from '#services/school_settings_service'
import { schoolStatementQueryValidator, statementQueryValidator } from '#validators/statements'
import { staffSchoolId } from '#policies/parent_policy'
import { consumeDownload, pickMonth, sendStatementPdf } from '#support/statement_access'
import { attachmentHeader } from '#support/report_access'
import {
  presentFamilyStatement,
  presentMonthNav,
  presentSchoolFamilies,
  presentSchoolTotals,
} from '#support/statement_presenters'
import { reportDownloadLimiter, reportKeys } from '#start/limiter'

const FAMILIES_PER_PAGE = 50

/**
 * Back-office statements (admin + manager of the school; D11: no payment
 * tracking): every family of a month with totals, the Excel export, and
 * one family's statement (page + PDF). Families of another school are a
 * 404 (the parent is looked up inside the staff member's school).
 */
@inject()
export default class StatementsController {
  constructor(
    protected clock: Clock,
    protected statements: StatementService,
    protected pdf: StatementPdfService,
    protected exporter: StatementExportService
  ) {}

  protected async school(ctx: HttpContext) {
    await ctx.bouncer.with('StatementPolicy').authorize('viewAny')
    return School.findOrFail(staffSchoolId(ctx.auth.getUserOrFail()))
  }

  /** GET /admin/statements?month=&q=&page= */
  async index(ctx: HttpContext) {
    const { request, inertia, i18n } = ctx
    const school = await this.school(ctx)
    let query: { month?: string; q?: string; page?: number } = {}
    try {
      query = await schoolStatementQueryValidator.validate(request.qs())
    } catch {
      query = {}
    }
    const today = this.clock.today()
    const month = pickMonth(query.month, today)!
    const statement = await this.statements.school(school, month, today)

    const needle = (query.q ?? '').toLocaleLowerCase()
    const families = needle
      ? statement.families.filter(
          (family) =>
            family.parentName.toLocaleLowerCase().includes(needle) ||
            family.parentEmail.toLocaleLowerCase().includes(needle) ||
            family.children.some((child) =>
              `${child.firstName} ${child.lastName}`.toLocaleLowerCase().includes(needle)
            )
        )
      : statement.families
    const lastPage = Math.max(1, Math.ceil(families.length / FAMILIES_PER_PAGE))
    const currentPage = Math.min(query.page ?? 1, lastPage)
    const slice = families.slice(
      (currentPage - 1) * FAMILIES_PER_PAGE,
      currentPage * FAMILIES_PER_PAGE
    )

    return inertia.render('admin/statements/index', {
      nav: presentMonthNav(month, today, i18n.locale),
      provisional: statement.provisional,
      filters: { q: query.q ?? '' },
      totals: presentSchoolTotals(statement, i18n.locale),
      families: presentSchoolFamilies(slice, i18n.locale),
      meta: { total: families.length, perPage: FAMILIES_PER_PAGE, currentPage, lastPage },
      exportUrl: `/admin/statements/export?month=${month}`,
    })
  }

  /** GET /admin/statements/export?month= — xlsx of every family of the month. */
  async export(ctx: HttpContext) {
    const { request, response, i18n, auth } = ctx
    const school = await this.school(ctx)
    let query: { month?: string } = {}
    try {
      query = await schoolStatementQueryValidator.validate(request.qs())
    } catch {
      return response.notFound()
    }
    const month = pickMonth(query.month, this.clock.today(), true)
    if (!month) return response.notFound()
    await reportDownloadLimiter().consume(reportKeys.download(auth.getUserOrFail().id))
    const statement = await this.statements.school(school, month, this.clock.today())
    response.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    response.header('Content-Disposition', attachmentHeader(`bfk-statements-${month}.xlsx`))
    response.header('Cache-Control', 'no-store')
    response.header('X-Content-Type-Options', 'nosniff')
    return response.stream(
      this.exporter.xlsx(statement, i18n.locale, new SchoolSettingsService().features(school)),
      (error) => {
        logger.error({ error: error?.code ?? error?.name ?? 'Error' }, 'statement export failed')
        return [i18n.t('reports.errors.export_failed'), 500]
      }
    )
  }

  /** The family (parent of the staff member's school) of `:id`, or a 404. */
  protected async family(ctx: HttpContext, strict: boolean) {
    const { params, request, response, auth, bouncer } = ctx
    const school = await this.school(ctx)
    const parent = await User.query()
      .where('id', Number(params.id))
      .where('role', 'parent')
      .where('school_id', school.id)
      .first()
    if (!parent) return response.notFound()
    await bouncer.with('StatementPolicy').authorize('viewFamily', parent)

    let query: { month?: string } = {}
    try {
      query = await statementQueryValidator.validate({ month: request.qs().month })
    } catch {
      if (strict) return response.notFound()
    }
    const today = this.clock.today()
    const month = pickMonth(query.month, today, strict)
    if (!month) return response.notFound()
    const children = await Child.query()
      .withScopes((scopes) => scopes.visibleTo(auth.getUserOrFail()))
      .where('children.parent_id', parent.id)
      .orderBy('first_name')
      .orderBy('id')
    const statement = await this.statements.family({
      parent: { id: parent.id, fullName: parent.fullName, email: parent.email },
      children: children.map((child) => ({
        id: child.id,
        firstName: child.firstName,
        lastName: child.lastName,
        grade: child.grade,
        className: child.className,
        isActive: child.isActive,
      })),
      month,
      today,
    })
    return { statement, month, parent, today }
  }

  /** GET /admin/statements/parents/:id?month= */
  async show(ctx: HttpContext) {
    const built = await this.family(ctx, false)
    if (!built || !('statement' in built)) return built
    const { statement, month, parent, today } = built
    return ctx.inertia.render('admin/statements/show', {
      nav: presentMonthNav(month, today, ctx.i18n.locale),
      parent: { id: parent.id, fullName: parent.fullName, email: parent.email },
      statement: presentFamilyStatement(statement, ctx.i18n.locale),
      pdfUrl: `/admin/statements/parents/${parent.id}/pdf?month=${month}`,
      backUrl: `/admin/statements?month=${month}`,
    })
  }

  /** GET /admin/statements/parents/:id/pdf?month= */
  async download(ctx: HttpContext) {
    // The download limiter first: a client over it costs no statement query.
    await consumeDownload(ctx)
    const built = await this.family(ctx, true)
    if (!built || !('statement' in built)) return built
    const { statement, month, parent } = built
    return sendStatementPdf(
      ctx,
      statement,
      this.pdf,
      this.clock,
      `bfk-statement-${month}-parent-${parent.id}.pdf`
    )
  }
}
