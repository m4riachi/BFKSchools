import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import Clock from '#services/clock'
import ProductionReportService from '#services/production_report_service'
import SchoolSettingsService from '#services/school_settings_service'
import LabelPdfService, { MAX_LABELS_PER_PDF } from '#services/label_pdf_service'
import ReportExportService, {
  MAX_EXPORT_DAYS,
  MAX_EXPORT_ROWS,
  type ExportOptions,
} from '#services/report_export_service'
import { MEAL_TYPES } from '#enums/meals'
import { exportQueryValidator, labelsQueryValidator, reportDayValidator } from '#validators/reports'
import { reportDate, resolvePeriod } from '#support/report_period'
import { attachmentHeader, reportSchool, requireReportSchool } from '#support/report_access'
import { presentAllergyRows, presentLabels } from '#support/report_presenters'
import { fileNamePart } from '#support/spreadsheet_safety'
import { addDays } from '#support/dates'
import { pdfRenderGate, RenderBusyError } from '#support/render_gate'

/** Labels shown as an on-screen preview (the PDF has them all). */
const LABEL_PREVIEW = 12

type LabelsQuery = { date?: string; className?: string; cols?: number; rows?: number }
type ExportQuery = Partial<{
  period: 'day' | 'week' | 'month' | 'custom'
  date: string
  from: string
  to: string
  className: string
  mealType: (typeof MEAL_TYPES)[number]
  kind: 'detail' | 'summary'
  format: 'csv' | 'xlsx'
}>

/**
 * Kitchen area reports (brief §5.8): allergy sheet, labels (preview + PDF)
 * and Excel/CSV exports. **GET only** — admin, manager and kitchen read;
 * nothing here writes. Every query is scoped to the user's school
 * (`reportSchoolId`), the class filter is a plain equality on that school's
 * children.
 */
@inject()
export default class ReportsController {
  constructor(
    protected clock: Clock,
    protected reports: ProductionReportService,
    protected settings: SchoolSettingsService,
    protected pdf: LabelPdfService,
    protected exportsService: ReportExportService
  ) {}

  /** GET /kitchen/allergies?date= */
  async allergies(ctx: HttpContext) {
    const { request, inertia, i18n } = ctx
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
    if (!school) return inertia.render('kitchen/allergies', { ...nav, rows: null })
    const rows = await this.reports.allergySheet(school.id, date)
    return inertia.render('kitchen/allergies', {
      ...nav,
      rows: presentAllergyRows(rows, i18n.locale),
    })
  }

  protected async labelsQuery(ctx: HttpContext): Promise<LabelsQuery> {
    try {
      return await labelsQueryValidator.validate(ctx.request.qs())
    } catch {
      return {}
    }
  }

  /** GET /kitchen/labels?date=&className= — count, grid and a preview. */
  async labels(ctx: HttpContext) {
    const { inertia, i18n } = ctx
    const school = await reportSchool(ctx)
    const today = this.clock.today()
    const query = await this.labelsQuery(ctx)
    const date = reportDate(query.date, today)
    const className = query.className || null
    const nav = { date, today, previous: addDays(date, -1), next: addDays(date, 1) }
    if (!school) {
      return inertia.render('kitchen/labels', {
        ...nav,
        className,
        classes: [],
        count: 0,
        grid: { cols: 3, rows: 8 },
        max: MAX_LABELS_PER_PDF,
        preview: [],
      })
    }
    const grid = this.settings.get(school).label_grid
    const count = await this.reports.countLabels(school.id, date, className)
    const preview = await this.reports.labels(school.id, date, { className, limit: LABEL_PREVIEW })
    return inertia.render('kitchen/labels', {
      ...nav,
      className,
      classes: await this.reports.classNames(school.id),
      count,
      grid: { cols: query.cols ?? grid.cols, rows: query.rows ?? grid.rows },
      max: MAX_LABELS_PER_PDF,
      preview: presentLabels(preview, i18n.locale),
    })
  }

  /** GET /kitchen/labels/pdf?date=&className=&cols=&rows= */
  async labelsPdf(ctx: HttpContext) {
    const { request, response, session, i18n } = ctx
    const school = await requireReportSchool(ctx)
    const query = await labelsQueryValidator.validate(request.qs())
    const date = reportDate(query.date, this.clock.today())
    const className = query.className || null
    const back = `/kitchen/labels?${new URLSearchParams({ date, ...(className ? { className } : {}) })}`

    const count = await this.reports.countLabels(school.id, date, className)
    if (count === 0) {
      session.flash('error', i18n.t('reports.labels.none'))
      return response.redirect().withQs(false).toPath(back)
    }
    if (count > MAX_LABELS_PER_PDF) {
      session.flash('error', i18n.t('reports.labels.too_many', { max: MAX_LABELS_PER_PDF }))
      return response.redirect().withQs(false).toPath(back)
    }
    const saved = this.settings.get(school).label_grid
    const grid = { cols: query.cols ?? saved.cols, rows: query.rows ?? saved.rows }
    const rows = await this.reports.labels(school.id, date, {
      className,
      limit: MAX_LABELS_PER_PDF,
    })
    let pdf: Buffer
    try {
      // At most 2 PDF renders at a time (the render also yields every 48 labels).
      pdf = await pdfRenderGate.run(() =>
        this.pdf.render(rows, {
          grid,
          locale: i18n.locale,
          title: i18n.t('reports.labels.pdf_title', { date }),
        })
      )
    } catch (error) {
      if (!(error instanceof RenderBusyError)) throw error
      response.header('Retry-After', '10')
      return response.serviceUnavailable(i18n.t('errors.busy'))
    }
    const name = ['bfk-labels', date, className ? fileNamePart(className) : null]
      .filter(Boolean)
      .join('-')
    response.header('Content-Type', 'application/pdf')
    response.header('Content-Disposition', attachmentHeader(`${name}.pdf`))
    response.header('Cache-Control', 'no-store')
    response.header('X-Content-Type-Options', 'nosniff')
    return response.send(pdf)
  }

  /** GET /kitchen/exports — the export form. */
  async exports(ctx: HttpContext) {
    const { inertia, bouncer } = ctx
    const school = await reportSchool(ctx)
    return inertia.render('kitchen/exports', {
      today: this.clock.today(),
      classes: school ? await this.reports.classNames(school.id) : [],
      mealTypes: [...MEAL_TYPES],
      limits: { days: MAX_EXPORT_DAYS, rows: MAX_EXPORT_ROWS },
      withAmounts: school ? await bouncer.with('ReportPolicy').allows('viewAmounts') : false,
      enabled: school !== null,
    })
  }

  /** GET /kitchen/exports/download?period=&date=&from=&to=&className=&mealType=&kind=&format= */
  async download(ctx: HttpContext) {
    const { request, response, session, i18n, bouncer } = ctx
    const school = await requireReportSchool(ctx)
    let query: ExportQuery
    try {
      query = await exportQueryValidator.validate(request.qs())
    } catch {
      session.flash('error', i18n.t('reports.errors.invalid_filters'))
      return response.redirect().withQs(false).toPath('/kitchen/exports')
    }
    const period = resolvePeriod(query, this.clock.today(), MAX_EXPORT_DAYS)
    if ('error' in period) {
      session.flash('error', i18n.t(`reports.errors.${period.error}`, { max: MAX_EXPORT_DAYS }))
      return response.redirect().withQs(false).toPath('/kitchen/exports')
    }
    const options: ExportOptions = {
      kind: query.kind ?? 'detail',
      format: query.format ?? 'xlsx',
      filters: {
        from: period.from,
        to: period.to,
        className: query.className || null,
        mealType: query.mealType ?? null,
      },
      locale: i18n.locale,
      withAmounts: await bouncer.with('ReportPolicy').allows('viewAmounts'),
    }
    const rows = await this.reports.countExportRows(school.id, options.filters, options.kind)
    if (rows > MAX_EXPORT_ROWS) {
      session.flash('error', i18n.t('reports.errors.too_many_rows', { max: MAX_EXPORT_ROWS }))
      return response.redirect().withQs(false).toPath('/kitchen/exports')
    }

    const name = [
      'bfk',
      options.kind === 'detail' ? 'orders' : 'production',
      period.from === period.to ? period.from : `${period.from}_${period.to}`,
      options.filters.className ? fileNamePart(options.filters.className) : null,
      options.filters.mealType,
    ]
      .filter(Boolean)
      .join('-')
    response.header('Cache-Control', 'no-store')
    response.header('X-Content-Type-Options', 'nosniff')
    response.header('X-Export-Rows', String(rows))
    const onError = (error: NodeJS.ErrnoException): [string, number] => {
      logger.error({ err: error }, 'report export failed')
      return ['Export failed', 500]
    }
    if (options.format === 'csv') {
      response.header('Content-Type', 'text/csv; charset=utf-8')
      response.header('Content-Disposition', attachmentHeader(`${name}.csv`))
      return response.stream(this.exportsService.csv(school.id, options), onError)
    }
    response.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    response.header('Content-Disposition', attachmentHeader(`${name}.xlsx`))
    return response.stream(
      this.exportsService.xlsx(school.id, options, i18n.t('reports.exports.sheet_name')),
      onError
    )
  }
}
