import { PassThrough, Readable } from 'node:stream'
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import i18nManager from '@adonisjs/i18n/services/main'
import { stringify } from 'csv-stringify/sync'
import ExcelJS from 'exceljs'
import ProductionReportService, {
  type ExportDetailRow,
  type ExportFilters,
  type ExportSummaryRow,
} from '#services/production_report_service'
import { allergenLabels, isBilledType, mealName } from '#support/meal_display'
import { safeCell } from '#support/spreadsheet_safety'

/**
 * Excel / CSV exports (brief §5.8) of active orders for a period (day,
 * week, month or a custom range ≤ `MAX_EXPORT_DAYS`), filtered by class and
 * meal type.
 *
 * - `detail`: one row per order line (date, grade, class, child, allergens,
 *   meal, quantity [, unit price, line total]);
 * - `summary`: quantities per date × meal × grade/class [, amount].
 *
 * Money columns only when `withAmounts` (admin + manager); the kitchen gets
 * quantities. No parent data (name, email, phone) is ever exported.
 *
 * Safety: every text cell goes through `safeCell()` (formula injection);
 * numbers are written as numbers. Rows are read in pages and streamed
 * (csv-stringify per page, exceljs `WorkbookWriter`), and the controller
 * checks `countExportRows()` against `MAX_EXPORT_ROWS` before starting, so
 * memory stays bounded.
 */
export const MAX_EXPORT_DAYS = 366
export const MAX_EXPORT_ROWS = 50_000

export type ExportKind = 'detail' | 'summary'
export type ExportFormat = 'csv' | 'xlsx'

export type ExportOptions = {
  kind: ExportKind
  format: ExportFormat
  filters: ExportFilters
  locale: string
  withAmounts: boolean
  /** D33: allergens module on (adds the allergies column of the detail export). */
  withAllergens: boolean
  /** D33: Niveau / Classe modules on (their columns). */
  withGrade: boolean
  withClass: boolean
}

type Cell = string | number
type Column<Row> = { key: string; width: number; value: (row: Row) => Cell; money?: boolean }

/** Centimes as a MAD number with 2 decimals, for spreadsheets (integer maths, then one division). */
function centsToNumber(cents: number): number {
  return Number(`${Math.trunc(cents / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`)
}

/** D31: only supplements carry an amount; subscription rows leave the cell empty (included). */
function billed(type: string, cents: number): Cell {
  return isBilledType(type) ? centsToNumber(cents) : ''
}

@inject()
export default class ReportExportService {
  /** Hard stop of one export file (a subclass may lower it, e.g. in tests). */
  protected maxRows = MAX_EXPORT_ROWS

  constructor(protected reports: ProductionReportService) {}

  protected detailColumns(
    locale: string,
    withAmounts: boolean,
    withAllergens: boolean
  ): Column<ExportDetailRow>[] {
    const i18n = i18nManager.locale(locale)
    const columns: Column<ExportDetailRow>[] = [
      { key: 'date', width: 12, value: (row) => row.date },
      { key: 'grade', width: 8, value: (row) => safeCell(row.grade) },
      { key: 'class', width: 10, value: (row) => safeCell(row.className) },
      { key: 'last_name', width: 18, value: (row) => safeCell(row.lastName) },
      { key: 'first_name', width: 18, value: (row) => safeCell(row.firstName) },
      ...(withAllergens
        ? [
            {
              key: 'allergies',
              width: 24,
              value: (row: ExportDetailRow) =>
                safeCell(
                  allergenLabels(row.allergies, locale)
                    .map((entry) => entry.label)
                    .join(', ')
                ),
            },
          ]
        : []),
      { key: 'meal_type', width: 14, value: (row) => i18n.t(`meals.types.${row.mealType}`) },
      {
        key: 'category',
        width: 12,
        value: (row) => i18n.t(`meals.categories.${row.mealCategory}`),
      },
      { key: 'meal', width: 32, value: (row) => safeCell(mealName(row, locale)) },
      { key: 'quantity', width: 9, value: (row) => row.quantity },
    ]
    if (withAmounts) {
      columns.push(
        {
          key: 'unit_price',
          width: 12,
          money: true,
          value: (row) => billed(row.mealType, row.unitPriceCents),
        },
        {
          key: 'line_total',
          width: 12,
          money: true,
          value: (row) => billed(row.mealType, row.lineTotalCents),
        }
      )
    }
    return columns
  }

  protected summaryColumns(locale: string, withAmounts: boolean): Column<ExportSummaryRow>[] {
    const i18n = i18nManager.locale(locale)
    const columns: Column<ExportSummaryRow>[] = [
      { key: 'date', width: 12, value: (row) => row.date },
      { key: 'meal_type', width: 14, value: (row) => i18n.t(`meals.types.${row.mealType}`) },
      {
        key: 'category',
        width: 12,
        value: (row) => i18n.t(`meals.categories.${row.mealCategory}`),
      },
      { key: 'meal', width: 32, value: (row) => safeCell(mealName(row, locale)) },
      { key: 'grade', width: 8, value: (row) => safeCell(row.grade) },
      { key: 'class', width: 10, value: (row) => safeCell(row.className) },
      { key: 'quantity', width: 9, value: (row) => row.quantity },
    ]
    if (withAmounts) {
      columns.push({
        key: 'amount',
        width: 12,
        money: true,
        value: (row) => billed(row.mealType, row.amountCents),
      })
    }
    return columns
  }

  /** Header labels of the columns, translated (escaped too, for consistency). */
  protected headers(columns: Column<any>[], locale: string): string[] {
    const i18n = i18nManager.locale(locale)
    return columns.map((column) => safeCell(i18n.t(`reports.exports.columns.${column.key}`)))
  }

  /**
   * Pages of cells (header row excluded). Hard stop at MAX_EXPORT_ROWS: the
   * controller counted the rows first, but orders placed while the file is
   * written (pages are separate queries, not one snapshot) can never make
   * it grow past the cap.
   */
  protected async *pages(schoolId: number, options: ExportOptions): AsyncGenerator<Cell[][]> {
    let left = this.maxRows
    const source =
      options.kind === 'detail'
        ? this.mapPages(
            this.reports.exportDetail(schoolId, options.filters),
            this.visible(
              this.detailColumns(options.locale, options.withAmounts, options.withAllergens),
              options
            )
          )
        : this.mapPages(
            this.reports.exportSummary(schoolId, options.filters),
            this.visible(this.summaryColumns(options.locale, options.withAmounts), options)
          )
    for await (const page of source) {
      const kept = page.slice(0, left)
      left -= kept.length
      if (kept.length) yield kept
      if (left <= 0) return
    }
  }

  protected async *mapPages<Row>(
    pages: AsyncGenerator<Row[]>,
    columns: Column<Row>[]
  ): AsyncGenerator<Cell[][]> {
    for await (const page of pages) {
      yield page.map((row) => columns.map((column) => column.value(row)))
    }
  }

  /** D33: without the columns of the disabled Niveau / Classe modules. */
  protected visible<Row>(columns: Column<Row>[], options: ExportOptions): Column<Row>[] {
    return columns.filter(
      (column) =>
        (column.key !== 'grade' || options.withGrade) &&
        (column.key !== 'class' || options.withClass)
    )
  }

  protected columns(options: ExportOptions): Column<any>[] {
    return options.kind === 'detail'
      ? this.visible(
          this.detailColumns(options.locale, options.withAmounts, options.withAllergens),
          options
        )
      : this.visible(this.summaryColumns(options.locale, options.withAmounts), options)
  }

  /**
   * CSV (UTF-8 with BOM so Excel reads accents; `;` separator in French —
   * the decimal comma locale — `,` in English; CRLF). A readable stream.
   */
  csv(schoolId: number, options: ExportOptions): Readable {
    const delimiter = options.locale === 'en' ? ',' : ';'
    const headers = this.headers(this.columns(options), options.locale)
    const pages = this.pages(schoolId, options)
    const moneyIndexes = this.columns(options)
      .map((column, index) => (column.money ? index : -1))
      .filter((index) => index >= 0)
    const formatMoney = (value: Cell) =>
      typeof value === 'number' && options.locale !== 'en'
        ? value.toFixed(2).replace('.', ',')
        : typeof value === 'number'
          ? value.toFixed(2)
          : value
    async function* generate() {
      yield String.fromCodePoint(0xfeff) +
        stringify([headers], { delimiter, record_delimiter: 'windows' })
      for await (const rows of pages) {
        const cells = rows.map((row) =>
          row.map((value, index) => (moneyIndexes.includes(index) ? formatMoney(value) : value))
        )
        yield stringify(cells, { delimiter, record_delimiter: 'windows', quoted_string: true })
      }
    }
    return Readable.from(generate())
  }

  /** Excel workbook written with the streaming writer into a PassThrough. */
  xlsx(schoolId: number, options: ExportOptions, sheetName: string): Readable {
    const output = new PassThrough()
    const columns = this.columns(options)
    const headers = this.headers(columns, options.locale)
    const pages = this.pages(schoolId, options)
    const run = async () => {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: output,
        useStyles: true,
        useSharedStrings: false,
      })
      workbook.creator = 'British Academy × Beldi Fusion'
      const sheet = workbook.addWorksheet(safeCell(sheetName).slice(0, 31) || 'Export', {
        views: [{ state: 'frozen', ySplit: 1 }],
      })
      sheet.columns = columns.map((column, index) => ({
        header: headers[index],
        key: column.key,
        width: column.width,
        style: column.money ? { numFmt: '0.00' } : undefined,
      }))
      sheet.getRow(1).font = { bold: true }
      sheet.getRow(1).commit()
      for await (const rows of pages) {
        // The client went away (response stream destroyed): stop querying.
        if (output.destroyed) return
        for (const row of rows) sheet.addRow(row).commit()
      }
      sheet.commit()
      await workbook.commit()
    }
    run().catch((error) => {
      logger.error({ error: (error as Error)?.name ?? 'Error' }, 'report export (xlsx) failed')
      output.destroy(error as Error)
    })
    return output
  }
}
