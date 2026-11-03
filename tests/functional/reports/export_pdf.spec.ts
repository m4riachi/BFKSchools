import { test } from '@japa/runner'
import { writeFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { UserFactory } from '#database/factories/user_factory'
import ProductionReportService from '#services/production_report_service'
import { MAX_PDF_EXPORT_ROWS } from '#services/report_export_service'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { TUE, orderSchool } from '#tests/helpers/orders'
import { order, pupil } from '#tests/helpers/reports'

const OPEN = '2026-11-20T12:00'

test.group('Reports | PDF export (D54)', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('the export form offers PDF with the same columns, for the detail and the summary', async ({
    client,
    assert,
  }) => {
    const ctx = await orderSchool()
    const a = await pupil(ctx.school, { firstName: 'Lina', lastName: 'Tazi' })
    freezeClock(OPEN)
    await order(a.parent, a.child, TUE, ctx.main.id, [{ mealId: ctx.juice.id, qty: 2 }])
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: ctx.school.id }).create()

    for (const [user, kind] of [
      [ctx.manager, 'detail'],
      [kitchen, 'summary'],
    ] as const) {
      const response = await client
        .get(`/kitchen/exports/download?period=day&date=${TUE}&kind=${kind}&format=pdf`)
        .loginAs(user)
      response.assertStatus(200)
      assert.include(String(response.header('content-type')), 'application/pdf')
      assert.match(String(response.header('content-disposition')), /\.pdf"/)
      const body = response.body() as Buffer
      assert.equal(body.subarray(0, 5).toString('latin1'), '%PDF-')
      if (process.env.BFK_EXPORT_PDF_OUT && kind === 'detail') {
        await writeFile(process.env.BFK_EXPORT_PDF_OUT, body)
      }
    }

    // The PDF cap is lower than the spreadsheets'.
    class Big extends ProductionReportService {
      async countExportRows() {
        return MAX_PDF_EXPORT_ROWS + 1
      }
    }
    app.container.swap(ProductionReportService, () => new Big())
    try {
      const refused = await client
        .get(`/kitchen/exports/download?period=day&date=${TUE}&format=pdf`)
        .loginAs(ctx.manager)
        .redirects(0)
      refused.assertStatus(302)
      const stillXlsx = await client
        .get(`/kitchen/exports/download?period=day&date=${TUE}&format=xlsx`)
        .loginAs(ctx.manager)
      stillXlsx.assertStatus(200)
    } finally {
      app.container.restore(ProductionReportService)
    }
  })
})
