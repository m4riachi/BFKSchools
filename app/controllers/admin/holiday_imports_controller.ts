import { readFile, rm } from 'node:fs/promises'
import { inject } from '@adonisjs/core'
import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import School from '#models/school'
import HolidayImportService from '#services/holiday_import_service'
import HolidayImportStore from '#services/holiday_import_store'
import SafeHttpFetcher, { SafeFetchError, type FetchErrorReason } from '#services/safe_http_fetcher'
import { IcsInvalidError } from '#services/ics_parser'
import { staffSchoolId } from '#policies/parent_policy'
import { icsConfirmValidator, icsUploadValidator, icsUrlValidator } from '#validators/holidays'
import { ICS_IMPORT } from '#config/holidays'
import { holidayImportLimiter, uploadKeys } from '#start/limiter'
import { schoolYearLabel } from '#controllers/admin/holidays_controller'

/** Reasons shown to the browser as one generic "not allowed or unreachable". */
const GENERIC_URL_REASONS = new Set<FetchErrorReason>(['blocked_address', 'dns_failed', 'network'])

function hostOf(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/**
 * ICS import of school breaks: upload a file (or download a URL behind the
 * SSRF guard) → preview with checkboxes and duplicate detection (nothing
 * saved) → import the checked ranges with `source = 'import'`.
 * D7: the school publishes no ICS URL; URL import stays available for later.
 */
@inject()
export default class HolidayImportsController {
  constructor(
    protected imports: HolidayImportService,
    protected store: HolidayImportStore
  ) {}

  protected async school(ctx: HttpContext) {
    await ctx.bouncer.with('HolidayPolicy').authorize('manage')
    return School.findOrFail(staffSchoolId(ctx.auth.getUserOrFail()))
  }

  /** 10 imports (file or URL) / 10 min per user, then 429. */
  protected async consumeImportBudget(ctx: HttpContext) {
    await holidayImportLimiter().consume(uploadKeys.holidayImport(ctx.auth.getUserOrFail().id))
  }

  protected pageProps(school: School) {
    return {
      schoolYear: {
        start: school.schoolYearStart,
        end: school.schoolYearEnd,
        label: schoolYearLabel(school),
      },
      maxBytes: ICS_IMPORT.maxBytes,
    }
  }

  async create(ctx: HttpContext) {
    const school = await this.school(ctx)
    return ctx.inertia.render('admin/holidays/import', {
      ...this.pageProps(school),
      importId: null,
      preview: null,
    })
  }

  /** Stores the uploaded file, then shows its preview. */
  async upload(ctx: HttpContext) {
    const { request, response, auth } = ctx
    const school = await this.school(ctx)
    await this.consumeImportBudget(ctx)
    const { calendar } = await request.validateUsing(icsUploadValidator)
    let content: string
    try {
      content = await readFile(calendar.tmpPath!, 'utf8')
    } finally {
      await rm(calendar.tmpPath!, { force: true })
    }
    return this.keep(ctx, school, auth.getUserOrFail().id, content, response)
  }

  /** Downloads an https calendar through the SSRF guard, then shows its preview. */
  async fetchUrl(ctx: HttpContext) {
    const { request, response, auth, session, i18n, logger } = ctx
    const school = await this.school(ctx)
    await this.consumeImportBudget(ctx)
    const { url } = await request.validateUsing(icsUrlValidator)
    const fetcher = await app.container.make(SafeHttpFetcher)
    let content: string
    try {
      content = await fetcher.fetchText(url, {
        maxBytes: ICS_IMPORT.maxBytes,
        timeoutMs: ICS_IMPORT.timeoutMs,
        maxRedirects: ICS_IMPORT.maxRedirects,
      })
    } catch (error) {
      if (!(error instanceof SafeFetchError)) throw error
      // Internal-network and DNS outcomes share one message (no DNS/port
      // oracle for the browser); the precise reason is logged with the host
      // only (never the path or query string).
      logger.warn({ reason: error.reason, host: hostOf(url) }, 'holiday ICS URL refused')
      const reason = GENERIC_URL_REASONS.has(error.reason) ? 'unreachable' : error.reason
      session.flashValidationErrors({
        code: 'E_VALIDATION_ERROR',
        messages: [{ field: 'url', message: i18n.t(`holidays.import.url_errors.${reason}`) }],
      } as unknown as Parameters<typeof session.flashValidationErrors>[0])
      return response.redirect('/admin/holidays/import')
    }
    return this.keep(ctx, school, auth.getUserOrFail().id, content, response)
  }

  protected async keep(
    ctx: HttpContext,
    school: School,
    userId: number,
    content: string,
    response: HttpContext['response']
  ) {
    // The only parse of this calendar: the store keeps the parsed result.
    let parsed
    try {
      parsed = await this.imports.parse(school, content)
    } catch (error) {
      if (!(error instanceof IcsInvalidError)) throw error
      ctx.session.flash('error', ctx.i18n.t(`holidays.import.file_errors.${error.reason}`))
      return response.redirect('/admin/holidays/import')
    }
    const id = await this.store.put(userId, school.id, this.imports.serialize(school, parsed))
    return response.redirect(`/admin/holidays/import/${id}`)
  }

  /** Preview: re-checked against the database on every visit. */
  async show(ctx: HttpContext) {
    const { params, inertia, response, session, i18n, auth } = ctx
    const school = await this.school(ctx)
    const stored = await this.store.get(String(params.id), auth.getUserOrFail().id, school.id)
    const parsed = stored === null ? null : this.imports.deserialize(school, stored)
    if (parsed === null) {
      session.flash('error', i18n.t('holidays.import.expired'))
      return response.redirect('/admin/holidays/import')
    }
    const preview = await this.imports.preview(school, parsed, i18n.t('holidays.import.untitled'))
    return inertia.render('admin/holidays/import', {
      ...this.pageProps(school),
      importId: String(params.id),
      preview,
    })
  }

  async confirm(ctx: HttpContext) {
    const { params, request, response, session, i18n, auth } = ctx
    const school = await this.school(ctx)
    const user = auth.getUserOrFail()
    const { importId, ranges, confirmImpact, confirmedCount } = await request.validateUsing(
      icsConfirmValidator,
      {
        data: { ...request.body(), importId: params.id },
      }
    )
    const stored = await this.store.get(importId, user.id, school.id)
    const parsed = stored === null ? null : this.imports.deserialize(school, stored)
    if (parsed === null) {
      session.flash('error', i18n.t('holidays.import.expired'))
      return response.redirect('/admin/holidays/import')
    }
    const result = await this.imports.apply(
      school,
      parsed,
      ranges,
      i18n.t('holidays.import.untitled'),
      { confirmImpact, confirmedCount, actor: user }
    )
    await this.store.delete(importId)
    session.flash('success', i18n.t('holidays.import.done', { ...result }))
    return response.redirect('/admin/holidays?view=list')
  }
}
