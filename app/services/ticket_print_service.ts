import net from 'node:net'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type School from '#models/school'
import type User from '#models/user'
import TicketPrintJob from '#models/ticket_print_job'
import Clock from '#services/clock'
import EscPosTicketService from '#services/escpos_ticket_service'
import { MAX_LABELS_PER_PDF } from '#services/label_pdf_service'
import ProductionReportService from '#services/production_report_service'
import SchoolSettingsService from '#services/school_settings_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import type { IsoDate } from '#support/dates'

/** How long a direct print may take before it is reported as unreachable. */
const DIRECT_TIMEOUT_MS = 8_000
/** A job the agent took but never acknowledged goes back to the queue after this. */
const PRINTING_STALE_MS = 2 * 60_000

export type PrintRequest = {
  date: IsoDate
  className: string | null
  locale: string
  withAmounts: boolean
  actor: User
}

/**
 * D50: prints the day's order tickets on the kitchen's receipt printer.
 * - `direct`: the server opens a TCP connection to the printer (same
 *   network, or a VPN) and sends the ESC/POS bytes; the job records the result.
 * - `agent`: the job waits in the queue; the print agent next to the printer
 *   (scripts/print-agent.mjs) fetches the bytes through the API and
 *   acknowledges the job.
 */
@inject()
export default class TicketPrintService {
  constructor(
    protected clock: Clock,
    protected settings: SchoolSettingsService,
    protected reports: ProductionReportService,
    protected escpos: EscPosTicketService
  ) {}

  /** Starts a print (direct) or queues it (agent). */
  async print(school: School, request: PrintRequest): Promise<TicketPrintJob> {
    const settings = this.settings.get(school)
    if (settings.printer_mode === 'off') {
      throw new BusinessRuleException('reports.tickets.printer_off')
    }
    const count = await this.reports.countLabels(school.id, request.date, request.className)
    if (count === 0) {
      throw new BusinessRuleException('reports.tickets.none', { values: { date: request.date } })
    }
    if (count > MAX_LABELS_PER_PDF) {
      throw new BusinessRuleException('reports.tickets.too_many', {
        values: { max: MAX_LABELS_PER_PDF },
      })
    }
    const now = this.clock.now()
    const job = await TicketPrintJob.create({
      schoolId: school.id,
      date: request.date,
      className: request.className,
      locale: request.locale,
      withAmounts: request.withAmounts,
      status: settings.printer_mode === 'direct' ? 'printing' : 'queued',
      ticketsCount: count,
      requestedBy: request.actor.id,
      createdAt: now,
      updatedAt: now,
    })
    if (settings.printer_mode === 'agent') return job

    if (!settings.printer_host) {
      await this.finish(job, 'failed', 'no printer address')
      throw new BusinessRuleException('reports.tickets.printer_unreachable', {
        values: { host: '' },
      })
    }
    try {
      const bytes = await this.bytesFor(school, job)
      await this.send(settings.printer_host, settings.printer_port, bytes)
      await this.finish(job, 'done')
      return job
    } catch (error) {
      await this.finish(job, 'failed', String((error as Error).message ?? error))
      throw new BusinessRuleException('reports.tickets.printer_unreachable', {
        values: { host: `${settings.printer_host}:${settings.printer_port}` },
      })
    }
  }

  /** The ESC/POS bytes of a job (tickets read now, so late orders are included). */
  async bytesFor(school: School, job: TicketPrintJob): Promise<Buffer> {
    const rows = await this.reports.tickets(school.id, job.date, {
      className: job.className,
      limit: MAX_LABELS_PER_PDF,
    })
    job.ticketsCount = rows.length
    return this.escpos.render(rows, { locale: job.locale, withAmounts: job.withAmounts })
  }

  /** Agent API: the oldest queued job, marked printing (stale "printing" jobs are retried). */
  async takeNext(school: School): Promise<TicketPrintJob | null> {
    const now = this.clock.now()
    return db.transaction(async (trx) => {
      // A technical timeout on the row's own (auto-updated) timestamp: the
      // database clock, not the business Clock.
      await TicketPrintJob.query({ client: trx })
        .where('school_id', school.id)
        .where('status', 'printing')
        .whereRaw(`updated_at < now() - make_interval(secs => ?)`, [PRINTING_STALE_MS / 1000])
        .update({ status: 'queued' })
      const job = await TicketPrintJob.query({ client: trx })
        .where('school_id', school.id)
        .where('status', 'queued')
        .orderBy('id', 'asc')
        .forUpdate()
        .skipLocked()
        .first()
      if (!job) return null
      job.status = 'printing'
      job.updatedAt = now
      await job.useTransaction(trx).save()
      return job
    })
  }

  /** Agent API: the printer took the job (done) or refused it (failed). */
  async ack(school: School, id: number, status: 'done' | 'failed', error: string | null) {
    const job = await TicketPrintJob.query().where('school_id', school.id).where('id', id).first()
    if (!job) return null
    await this.finish(job, status, error)
    return job
  }

  /** The latest jobs of a school, for the exports page. */
  recent(school: School, limit = 5) {
    return TicketPrintJob.query().where('school_id', school.id).orderBy('id', 'desc').limit(limit)
  }

  protected async finish(job: TicketPrintJob, status: 'done' | 'failed', error?: string | null) {
    const now = this.clock.now()
    job.status = status
    job.error = status === 'failed' ? (error ?? 'failed').slice(0, 500) : null
    job.printedAt = status === 'done' ? now : null
    job.updatedAt = now
    await job.save()
  }

  /** Raw bytes to the printer's network port (ESC/POS over TCP, usually 9100). */
  protected send(host: string, port: number, bytes: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port })
      socket.setTimeout(DIRECT_TIMEOUT_MS)
      socket.on('timeout', () => socket.destroy(new Error('printer timeout')))
      socket.on('error', reject)
      socket.on('connect', () => socket.end(bytes, () => resolve()))
    })
  }
}
