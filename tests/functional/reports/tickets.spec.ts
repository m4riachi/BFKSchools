import { test } from '@japa/runner'
import { writeFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { UserFactory } from '#database/factories/user_factory'
import ProductionReportService from '#services/production_report_service'
import TicketPdfService from '#services/ticket_pdf_service'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { TUE, orderSchool } from '#tests/helpers/orders'
import { order, pupil } from '#tests/helpers/reports'

const OPEN = '2026-11-20T12:00'

test.group('Reports | order tickets (D49)', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('one ticket per active order: child, parent, dish, supplements and amounts', async ({
    client,
    assert,
  }) => {
    const ctx = await orderSchool()
    const a = await pupil(ctx.school, { firstName: 'Lina', lastName: 'Tazi' })
    const b = await pupil(ctx.school, { firstName: 'Adam', lastName: 'Alaoui' })
    freezeClock(OPEN)
    await order(a.parent, a.child, TUE, ctx.main.id, [{ mealId: ctx.juice.id, qty: 2 }])
    await order(b.parent, b.child, TUE, ctx.alt.id)

    const rows = await app.container
      .make(ProductionReportService)
      .then((service) => service.tickets(ctx.school.id, TUE, { limit: 100 }))
    assert.lengthOf(rows, 2)
    const lina = rows.find((row) => row.firstName === 'Lina')!
    assert.equal(lina.parentName, a.parent.fullName)
    assert.deepEqual(
      lina.lines.map((line) => [line.mealType, line.quantity, line.lineTotalCents]),
      [
        ['subscription', 1, 0],
        ['supplement', 2, 2000],
      ]
    )
    assert.equal(lina.supplementsCents, 2000)
    const adam = rows.find((row) => row.firstName === 'Adam')!
    assert.equal(adam.supplementsCents, 0)

    // Manager: a PDF with amounts; kitchen: a PDF too (without prices).
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: ctx.school.id }).create()
    for (const [user, cols] of [
      [ctx.manager, 3],
      [kitchen, 4],
    ] as const) {
      const response = await client
        .get(`/kitchen/exports/tickets?date=${TUE}&cols=${cols}`)
        .loginAs(user)
      response.assertStatus(200)
      assert.include(String(response.header('content-type')), 'application/pdf')
      assert.include(String(response.header('content-disposition')), `bfk-tickets-${TUE}.pdf`)
      const body = response.body() as Buffer
      assert.equal(body.subarray(0, 5).toString('latin1'), '%PDF-')
      if (process.env.BFK_TICKETS_PDF_OUT && user === ctx.manager) {
        // Development only: keeps a copy for a visual check.
        await writeFile(process.env.BFK_TICKETS_PDF_OUT, body)
      }
    }

    // No order that day: back to the form with a message, no PDF.
    const empty = await client
      .get('/kitchen/exports/tickets?date=2026-11-25')
      .loginAs(ctx.manager)
      .redirects(0)
    empty.assertStatus(302)
    empty.assertHeader('location', '/kitchen/exports')

    // Roll format: one receipt per ticket for the 80 mm printer.
    const roll = await client
      .get(`/kitchen/exports/tickets?date=${TUE}&format=roll`)
      .loginAs(ctx.manager)
    roll.assertStatus(200)
    assert.include(String(roll.header('content-disposition')), `bfk-tickets-${TUE}-80mm.pdf`)
    assert.equal((roll.body() as Buffer).subarray(0, 5).toString('latin1'), '%PDF-')
    if (process.env.BFK_TICKETS_PDF_OUT) {
      await writeFile(process.env.BFK_TICKETS_PDF_OUT.replace('.pdf', '-roll.pdf'), roll.body())
    }

    // Bad columns are refused.
    const bad = await client
      .get(`/kitchen/exports/tickets?date=${TUE}&cols=5`)
      .loginAs(ctx.manager)
      .redirects(0)
    assert.include([302, 422], bad.status())
  })

  test('the renderer caps the count like the labels', async ({ assert }) => {
    const service = new TicketPdfService()
    const row = (i: number) => ({
      orderId: i,
      date: TUE,
      firstName: 'A',
      lastName: 'B',
      grade: null,
      className: null,
      parentName: 'P',
      lines: [],
      supplementsCents: 0,
    })
    const options = {
      format: 'a4' as const,
      cols: 3 as const,
      locale: 'fr',
      title: 't',
      withAmounts: true,
    }
    const pdf = await service.render([row(1)], options)
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-')
    await assert.rejects(() =>
      service.render(
        Array.from({ length: 1201 }, (_, i) => row(i)),
        options
      )
    )
  })
})
