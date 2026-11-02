/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import net from 'node:net'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import { UserFactory } from '#database/factories/user_factory'
import School from '#models/school'
import TicketPrintJob from '#models/ticket_print_job'
import ApiKeyService from '#services/api_key_service'
import EscPosTicketService, { encodeCp858, twoColumns } from '#services/escpos_ticket_service'
import SchoolSettingsService from '#services/school_settings_service'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { TUE, orderSchool } from '#tests/helpers/orders'
import { order, pupil } from '#tests/helpers/reports'

const OPEN = '2026-11-20T12:00'

/** A fake receipt printer: collects what is sent to its port. */
async function fakePrinter() {
  const received: Buffer[] = []
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => received.push(Buffer.from(chunk)))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  return {
    port,
    bytes: () => Buffer.concat(received),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

async function configure(schoolId: number, settings: Record<string, unknown>) {
  const school = await School.findOrFail(schoolId)
  await new SchoolSettingsService().update(school, settings)
}

test.group('Reports | receipt printer (D50)', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => limiter.clear(['memory']))
  group.each.teardown(() => restoreClock())

  test('ESC/POS: one receipt per order, French accents in CP858, a cut after each', async ({
    assert,
  }) => {
    const service = new EscPosTicketService()
    const ticket = (i: number) => ({
      orderId: i,
      date: TUE,
      firstName: 'Léa',
      lastName: 'Tazi',
      grade: null,
      className: null,
      parentName: 'Mère Tazi',
      lines: [
        {
          mealId: 1,
          nameFr: 'Tajine',
          nameEn: 'Tagine',
          mealType: 'subscription' as const,
          quantity: 1,
          lineTotalCents: 0,
        },
        {
          mealId: 2,
          nameFr: 'Jus',
          nameEn: 'Juice',
          mealType: 'supplement' as const,
          quantity: 2,
          lineTotalCents: 2000,
        },
      ],
      supplementsCents: 2000,
    })
    const bytes = service.render([ticket(1), ticket(2)], { locale: 'fr', withAmounts: true })
    const cuts = bytes.toString('latin1').split('\x1dV\x42\x00').length - 1
    assert.equal(cuts, 2)
    assert.include(bytes.toString('latin1'), 'L\x82a Tazi') // é → 0x82
    assert.include(bytes.toString('latin1'), '+ Jus x2')
    assert.include(bytes.toString('latin1'), '20,00 MAD')
    assert.deepEqual([...encodeCp858('à€ع')], [0x85, 0xd5, 0x3f])
    assert.equal(twoColumns('Jus', '1,00', 12), 'Jus     1,00')
  })

  test('direct mode: the button sends the tickets to the printer and records the job', async ({
    client,
    assert,
  }) => {
    const ctx = await orderSchool()
    const printer = await fakePrinter()
    await configure(ctx.school.id, {
      printer_mode: 'direct',
      printer_host: '127.0.0.1',
      printer_port: printer.port,
    })
    const p = await pupil(ctx.school, { firstName: 'Adam', lastName: 'Alaoui' })
    freezeClock(OPEN)
    await order(p.parent, p.child, TUE, ctx.main.id, [{ mealId: ctx.juice.id, qty: 1 }])
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: ctx.school.id }).create()

    const response = await client
      .post('/kitchen/exports/tickets/print')
      .loginAs(kitchen)
      .withCsrfToken()
      .json({ date: TUE })
      .redirects(0)
    response.assertStatus(302)
    response.assertHeader('location', '/kitchen/exports')
    await new Promise((resolve) => setTimeout(resolve, 50))
    const sent = printer.bytes().toString('latin1')
    assert.include(sent, 'Adam Alaoui')
    assert.include(sent, '\x1dV\x42\x00')
    // Kitchen staff see no prices.
    assert.notInclude(sent, 'MAD')
    const job = await TicketPrintJob.query().orderBy('id', 'desc').firstOrFail()
    assert.equal(job.status, 'done')
    assert.equal(job.ticketsCount, 1)
    assert.isFalse(job.withAmounts)
    await printer.close()

    // Printer off the network: the job fails and the user is told.
    await configure(ctx.school.id, { printer_port: printer.port })
    const failed = await client
      .post('/kitchen/exports/tickets/print')
      .loginAs(ctx.manager)
      .withCsrfToken()
      .json({ date: TUE })
      .redirects(0)
    failed.assertStatus(302)
    assert.equal(
      (await TicketPrintJob.query().orderBy('id', 'desc').firstOrFail()).status,
      'failed'
    )
  })

  test('agent mode: the button queues; the agent fetches the bytes with the API keys and acknowledges', async ({
    client,
    assert,
  }) => {
    const ctx = await orderSchool()
    await configure(ctx.school.id, { printer_mode: 'agent' })
    const p = await pupil(ctx.school, { firstName: 'Lina', lastName: 'Tazi' })
    freezeClock(OPEN)
    await order(p.parent, p.child, TUE, ctx.main.id)
    const keys = await (await app.container.make(ApiKeyService)).generate(ctx.school.id, ctx.admin)
    const auth = { 'X-Api-Key': keys.publicKey, 'X-Api-Secret': keys.secret }

    // Nothing queued yet.
    ;(await client.get('/api/v1/print-jobs/next').headers(auth)).assertStatus(204)

    const queued = await client
      .post('/kitchen/exports/tickets/print')
      .loginAs(ctx.manager)
      .withCsrfToken()
      .json({ date: TUE })
      .redirects(0)
    queued.assertStatus(302)
    const job = await TicketPrintJob.query().orderBy('id', 'desc').firstOrFail()
    assert.equal(job.status, 'queued')
    assert.isTrue(job.withAmounts)

    const next = await client.get('/api/v1/print-jobs/next').headers(auth)
    next.assertStatus(200)
    assert.equal(next.body().id, job.id)
    assert.equal(next.body().ticketsCount, 1)
    const bytes = Buffer.from(next.body().escpos, 'base64').toString('latin1')
    assert.include(bytes, 'Lina Tazi')
    assert.equal((await TicketPrintJob.findOrFail(job.id)).status, 'printing')
    // Taken: not served twice.
    ;(await client.get('/api/v1/print-jobs/next').headers(auth)).assertStatus(204)

    const ack = await client
      .post(`/api/v1/print-jobs/${job.id}/ack`)
      .headers(auth)
      .json({ status: 'done' })
    ack.assertStatus(200)
    assert.equal((await TicketPrintJob.findOrFail(job.id)).status, 'done')

    // Another school's keys never see this school's jobs; no keys → 401.
    ;(await client.get('/api/v1/print-jobs/next')).assertStatus(401)
    ;(
      await client.post(`/api/v1/print-jobs/${job.id}/ack`).json({ status: 'failed' })
    ).assertStatus(401)
  })

  test('printer off: the button is refused with a message, nothing is recorded', async ({
    client,
    assert,
  }) => {
    const ctx = await orderSchool()
    const response = await client
      .post('/kitchen/exports/tickets/print')
      .loginAs(ctx.manager)
      .withCsrfToken()
      .json({ date: TUE })
      .redirects(0)
    assert.include([302, 422], response.status())
    assert.equal(
      await TicketPrintJob.query()
        .count('* as total')
        .first()
        .then((r) => Number(r?.$extras.total)),
      0
    )
  })
})
