import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import TicketPrintService from '#services/ticket_print_service'

const ackValidator = vine.create({
  status: vine.enum(['done', 'failed'] as const),
  error: vine.string().trim().maxLength(500).nullable().optional(),
})

/**
 * D50: the print agent's API (X-Api-Key + X-Api-Secret, see ApiKeyMiddleware).
 * GET next → the oldest queued job of the school as ESC/POS bytes (204 when
 * none); POST :id/ack → done or failed.
 */
@inject()
export default class PrintJobsController {
  constructor(protected printing: TicketPrintService) {}

  async next({ response, apiSchool }: HttpContext) {
    const job = await this.printing.takeNext(apiSchool)
    if (!job) {
      response.status(204)
      return
    }
    const bytes = await this.printing.bytesFor(apiSchool, job)
    await job.save()
    return {
      id: job.id,
      date: job.date,
      className: job.className,
      ticketsCount: job.ticketsCount,
      escpos: bytes.toString('base64'),
    }
  }

  async ack({ request, response, params, apiSchool }: HttpContext) {
    const input = await request.validateUsing(ackValidator)
    const job = await this.printing.ack(
      apiSchool,
      Number(params.id),
      input.status,
      input.error ?? null
    )
    if (!job) return response.notFound({ error: { code: 'not_found', message: 'Unknown job.' } })
    return { id: job.id, status: job.status }
  }
}
