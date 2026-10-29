import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import Child from '#models/child'
import Clock from '#services/clock'
import StatementService from '#services/statement_service'
import StatementPdfService from '#services/statement_pdf_service'
import { statementQueryValidator } from '#validators/statements'
import { consumeDownload, pickMonth, schoolOf, sendStatementPdf } from '#support/statement_access'
import { presentFamilyStatement, presentMonthNav } from '#support/statement_presenters'
import type { StatementMonth } from '#support/statement_month'

type Query = { month?: string; child?: number }

/**
 * Parent portal — monthly statement of the family (brief §5.5): page with
 * a month picker and the PDF download. Children come only from
 * `Child.visibleTo(user)`; a `child` the parent can't see (another
 * family's, unknown, malformed) is a 404, never a fallback.
 */
@inject()
export default class StatementsController {
  constructor(
    protected clock: Clock,
    protected statements: StatementService,
    protected pdf: StatementPdfService
  ) {}

  protected async build(ctx: HttpContext, strict: boolean) {
    const { request, bouncer, auth, response } = ctx
    await bouncer.authorize('accessParentPortal')
    await bouncer.with('StatementPolicy').authorize('viewOwn')
    const user = auth.getUserOrFail()
    const raw = request.qs()

    let query: Query
    try {
      query = await statementQueryValidator.validate(raw)
    } catch {
      // A malformed child id is a 404 like a foreign one; a bad month falls
      // back to the current month on the page and is a 404 for the PDF.
      if (raw.child !== undefined) return response.notFound()
      if (strict) return response.notFound()
      query = {}
    }
    const today = this.clock.today()
    const month = pickMonth(query.month, today, strict)
    if (!month) return response.notFound()

    const all = await Child.query()
      .withScopes((scopes) => scopes.visibleTo(user))
      .orderBy('first_name')
      .orderBy('id')
    if (raw.child !== undefined && !all.some((child) => child.id === query.child)) {
      return response.notFound()
    }
    const children = query.child ? all.filter((child) => child.id === query.child) : all

    const statement = await this.statements.family({
      school: await schoolOf(user),
      parent: { id: user.id, fullName: user.fullName, email: user.email },
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
    return { statement, month, all, childId: query.child ?? null, today }
  }

  /** GET /statements?month=YYYY-MM&child= */
  async show(ctx: HttpContext) {
    const built = await this.build(ctx, false)
    if (!built || !('statement' in built)) return built
    const { statement, month, all, childId, today } = built
    const locale = ctx.i18n.locale
    return ctx.inertia.render('parent/statements/index', {
      nav: presentMonthNav(month, today, locale),
      children: all
        .filter((child) => child.isActive || statement.children.some((c) => c.childId === child.id))
        .map((child) => ({ id: child.id, firstName: child.firstName })),
      childId,
      statement: presentFamilyStatement(statement, locale),
      pdfUrl: this.pdfUrl(month, childId),
    })
  }

  /** GET /statements/pdf?month=YYYY-MM&child= */
  async download(ctx: HttpContext) {
    // The download limiter first: a client over it costs no statement query.
    await consumeDownload(ctx)
    const built = await this.build(ctx, true)
    if (!built || !('statement' in built)) return built
    const { statement, month, childId } = built
    const name = ['bfk-statement', month, childId ? `child-${childId}` : null]
      .filter(Boolean)
      .join('-')
    return sendStatementPdf(ctx, statement, this.pdf, this.clock, `${name}.pdf`)
  }

  protected pdfUrl(month: StatementMonth, childId: number | null) {
    const query = new URLSearchParams({ month, ...(childId ? { child: String(childId) } : {}) })
    return `/statements/pdf?${query}`
  }
}
