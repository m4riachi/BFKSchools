import { test } from '@japa/runner'
import ExcelJS from 'exceljs'
import ReportExportService, {
  MAX_EXPORT_ROWS,
  type ExportOptions,
} from '#services/report_export_service'
import type ProductionReportService from '#services/production_report_service'
import type { ExportDetailRow } from '#services/production_report_service'
import { csvRows } from '#tests/helpers/reports'

function row(i: number): ExportDetailRow {
  return {
    date: '2026-11-23',
    grade: 'G3',
    className: '3B',
    lastName: `Child${i}`,
    firstName: 'Test',
    allergies: [],
    mealType: 'subscription',
    mealCategory: 'main',
    nameFr: 'Plat',
    nameEn: 'Dish',
    quantity: 1,
    unitPriceCents: 4500,
    lineTotalCents: 4500,
  }
}

/** A report source that keeps producing pages (rows added during the export). */
function endlessReports(pageSize: number, pages: number, seen: { pages: number }) {
  return {
    async *exportDetail() {
      for (let p = 0; p < pages; p++) {
        seen.pages += 1
        yield Array.from({ length: pageSize }, (_, i) => row(p * pageSize + i))
      }
    },
  } as unknown as ProductionReportService
}

class CappedExport extends ReportExportService {
  protected maxRows = 5
}

const options: ExportOptions = {
  kind: 'detail',
  format: 'csv',
  filters: { from: '2026-11-23', to: '2026-11-23', className: null, mealType: null },
  locale: 'fr',
  withAmounts: false,
}

async function text(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as string))
  return Buffer.concat(chunks).toString('utf8')
}

test.group('Exports | hard stop at the row cap', () => {
  test('the default cap is MAX_EXPORT_ROWS', ({ assert }) => {
    assert.equal(MAX_EXPORT_ROWS, 50_000)
  })

  test('CSV: never more rows than the cap, and the source stops being read', async ({ assert }) => {
    const seen = { pages: 0 }
    const service = new CappedExport(endlessReports(3, 10, seen))
    const rows = csvRows(await text(service.csv(1, options)))
    // header + 5 data rows (the 2nd page is cut at 2 rows)
    assert.lengthOf(rows, 1 + 5)
    assert.equal(seen.pages, 2)
  })

  test('xlsx: the same cap applies', async ({ assert }) => {
    const seen = { pages: 0 }
    const service = new CappedExport(endlessReports(4, 10, seen))
    const chunks: Buffer[] = []
    for await (const chunk of service.xlsx(1, { ...options, format: 'xlsx' }, 'Export')) {
      chunks.push(Buffer.from(chunk))
    }
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.concat(chunks) as any)
    assert.equal(workbook.worksheets[0].rowCount, 1 + 5)
    assert.equal(seen.pages, 2)
  })

  test('below the cap every row is exported', async ({ assert }) => {
    const seen = { pages: 0 }
    const service = new CappedExport(endlessReports(2, 2, seen))
    const rows = csvRows(await text(service.csv(1, options)))
    assert.lengthOf(rows, 1 + 4)
  })
})
