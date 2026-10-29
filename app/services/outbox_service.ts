import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import OutboundEmail from '#models/outbound_email'
import Clock from '#services/clock'
import OutboxSender from '#services/outbox_sender'
import { buildOutboxMail } from '#mails/outbox_registry'
import { maskEmail } from '#app/mail/log_transport'
import { isSafeEmail } from '#validators/rules'
import type { AppLocale } from '#enums/locales'
import { OUTBOX } from '#config/outbox'

export type OutboxEmailInput = {
  userId: number | null
  toEmail: string
  locale: AppLocale
  /** Key of `OUTBOX_MAILS` (app/mails/outbox_registry.ts). */
  mailKey: string
  /** Ids only: the mail class reloads its data when sending. */
  payload?: Record<string, unknown>
  /** Globally unique idempotency key, e.g. `menu_published:42:user:7`. */
  dedupeKey?: string | null
}

export type EnqueueResult = { created: number; invalid: number }

export type DispatchResult = {
  /** Budget for this run (per-run cap, minus what the hourly cap already used). */
  budget: number
  sent: number
  retried: number
  failed: number
  skipped: number
}

/**
 * A short, address-free description of a send error for logs and
 * `last_error`. Never the message itself: SMTP errors may quote the
 * recipient or the body.
 */
export function safeMailError(error: unknown): string {
  const err = (error ?? {}) as { code?: unknown; responseCode?: unknown; command?: unknown }
  const parts = [
    typeof err.code === 'string' ? err.code : 'error',
    typeof err.responseCode === 'number' ? String(err.responseCode) : null,
    typeof err.command === 'string' ? err.command.replace(/[^A-Z ]/g, '').slice(0, 20) : null,
  ]
  return parts
    .filter(Boolean)
    .join(' ')
    .replace(/[^\w .:-]/g, '')
    .slice(0, 120)
}

/**
 * Email outbox (D16, docs/ERD.md §outbound_emails).
 *
 * - `enqueue`/`enqueueMany` insert rows (optionally inside the caller's
 *   transaction). A `dedupeKey` already present → nothing is inserted, so an
 *   email is queued once even if the job that queues it runs twice.
 * - `dispatch` (command `mail:dispatch`, every minute) sends due rows within
 *   the per-run and per-hour caps, retries failures with backoff and marks
 *   them `failed` after `OUTBOX.maxAttempts`.
 *
 * Logs never contain a full address (masked like the log transport) nor a body.
 */
@inject()
export default class OutboxService {
  constructor(
    protected clock: Clock,
    protected sender: OutboxSender
  ) {}

  async enqueue(input: OutboxEmailInput, client?: QueryClientContract): Promise<boolean> {
    const result = await this.enqueueMany([input], client)
    return result.created === 1
  }

  async enqueueMany(
    inputs: OutboxEmailInput[],
    client: QueryClientContract = db.connection()
  ): Promise<EnqueueResult> {
    const now = this.clock.now().toISO()!
    let invalid = 0
    const rows = []
    for (const input of inputs) {
      const toEmail = input.toEmail.trim().toLowerCase()
      if (!isSafeEmail(toEmail)) {
        invalid += 1
        logger.warn(
          { mailKey: input.mailKey, userId: input.userId, to: maskEmail(toEmail) },
          'outbox: recipient is not a plain validated address; not queued'
        )
        continue
      }
      rows.push({
        user_id: input.userId,
        to_email: toEmail,
        locale: input.locale === 'en' ? 'en' : 'fr',
        mail_key: input.mailKey,
        payload: input.payload ?? {},
        dedupe_key: input.dedupeKey ?? null,
      })
    }

    let created = 0
    for (let start = 0; start < rows.length; start += OUTBOX.insertChunk) {
      const chunk = rows.slice(start, start + OUTBOX.insertChunk)
      const result = await client.rawQuery(
        `INSERT INTO outbound_emails
           (user_id, to_email, locale, mail_key, payload, dedupe_key, send_after, created_at, updated_at)
         SELECT r.user_id, r.to_email, r.locale, r.mail_key, r.payload, r.dedupe_key,
                ?::timestamptz, ?::timestamptz, ?::timestamptz
           FROM jsonb_to_recordset(?::jsonb)
             AS r(user_id integer, to_email text, locale text, mail_key text, payload jsonb, dedupe_key text)
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [now, now, now, JSON.stringify(chunk)]
      )
      created += result.rows.length
    }
    return { created, invalid }
  }

  /**
   * SMTP attempts during the last rolling hour (for the hourly cap): emails
   * sent, plus rows whose last attempt in that hour failed at the SMTP
   * server (hosts usually count refused/failed messages too). Rows skipped
   * before any SMTP call (`skipped: …`, `build_error`) don't count. A row
   * retried several times within the hour counts once (approximation).
   */
  async sentInLastHour(): Promise<number> {
    const since = this.clock.now().minus({ hours: 1 }).toISO()!
    const row = await db
      .from('outbound_emails')
      .where((query) => {
        query
          .where((sent) => sent.where('status', 'sent').where('sent_at', '>', since))
          .orWhere((failed) =>
            failed
              .whereIn('status', ['pending', 'failed'])
              .where('attempts', '>', 0)
              .where('updated_at', '>', since)
              .whereNotNull('last_error')
              .whereNot('last_error', 'like', 'skipped:%')
              .whereNotIn('last_error', ['build_error', 'stale_sending'])
          )
      })
      .count('* as total')
      .first()
    return Number(row?.total ?? 0)
  }

  /**
   * Sends due emails. Call it under the `mail:dispatch` advisory lock;
   * claiming uses `FOR UPDATE SKIP LOCKED` as well, so two dispatchers never
   * pick the same row.
   */
  async dispatch(
    limits: { maxPerRun?: number; maxPerHour?: number } = {}
  ): Promise<DispatchResult> {
    const maxPerRun = limits.maxPerRun ?? OUTBOX.maxPerRun
    const maxPerHour = limits.maxPerHour ?? OUTBOX.maxPerHour
    const result: DispatchResult = { budget: 0, sent: 0, retried: 0, failed: 0, skipped: 0 }

    await this.reclaimStale()
    result.budget = Math.max(0, Math.min(maxPerRun, maxPerHour - (await this.sentInLastHour())))
    if (result.budget === 0) return result

    const rows = await this.claim(result.budget)
    for (const row of rows) {
      const outcome = await this.sendOne(row)
      result[outcome] += 1
    }
    return result
  }

  /**
   * Rows left in `sending` by a crashed run go back to `pending`, unless
   * they already used every attempt: those end `failed` ('stale_sending'),
   * so a row that keeps crashing the sender can't be retried (and possibly
   * delivered again) forever.
   */
  protected async reclaimStale() {
    const now = this.clock.now()
    const staleBefore = now.minus({ minutes: OUTBOX.staleSendingMinutes }).toISO()!
    await db
      .from('outbound_emails')
      .where('status', 'sending')
      .where('updated_at', '<', staleBefore)
      .where('attempts', '>=', OUTBOX.maxAttempts)
      .update({ status: 'failed', last_error: 'stale_sending', updated_at: now.toISO()! })
    await db
      .from('outbound_emails')
      .where('status', 'sending')
      .where('updated_at', '<', staleBefore)
      .update({ status: 'pending', updated_at: now.toISO()! })
  }

  /** Marks up to `limit` due rows as `sending` (attempts + 1) and returns them. */
  protected async claim(limit: number): Promise<OutboundEmail[]> {
    const now = this.clock.now().toISO()!
    const ids = await db.transaction(async (trx) => {
      const due = await trx
        .from('outbound_emails')
        .where('status', 'pending')
        .where('send_after', '<=', now)
        .orderBy('send_after')
        .orderBy('id')
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .select('id')
      const list = due.map((row) => Number(row.id))
      if (list.length) {
        await trx
          .from('outbound_emails')
          .whereIn('id', list)
          .update({
            status: 'sending',
            // Capped at the CHECK limit: one odd row can never fail the whole claim.
            attempts: db.raw('LEAST(attempts + 1, 100)'),
            updated_at: now,
          })
      }
      return list
    })
    if (!ids.length) return []
    return OutboundEmail.query().whereIn('id', ids).orderBy('send_after').orderBy('id')
  }

  protected async sendOne(row: OutboundEmail): Promise<'sent' | 'retried' | 'failed' | 'skipped'> {
    const context = { outboxId: row.id, mailKey: row.mailKey, to: maskEmail(row.toEmail) }
    let built: Awaited<ReturnType<typeof buildOutboxMail>>
    try {
      built = await buildOutboxMail(row)
    } catch (error) {
      logger.error({ ...context, error: safeMailError(error) }, 'outbox: could not build the email')
      await this.finish(row, 'failed', 'build_error')
      return 'failed'
    }
    if ('skip' in built) {
      logger.info({ ...context, reason: built.skip }, 'outbox: email skipped')
      await this.finish(row, 'failed', `skipped: ${built.skip}`)
      return 'skipped'
    }

    try {
      await this.sender.send(built.mail)
    } catch (error) {
      const reason = safeMailError(error)
      if (row.attempts >= OUTBOX.maxAttempts) {
        logger.error({ ...context, attempts: row.attempts, error: reason }, 'outbox: email failed')
        await this.finish(row, 'failed', reason)
        return 'failed'
      }
      const minutes =
        OUTBOX.backoffMinutes[Math.min(row.attempts - 1, OUTBOX.backoffMinutes.length - 1)]
      logger.warn(
        { ...context, attempts: row.attempts, retryInMinutes: minutes, error: reason },
        'outbox: send failed, will retry'
      )
      const now = this.clock.now()
      await db
        .from('outbound_emails')
        .where('id', row.id)
        .update({
          status: 'pending',
          last_error: reason,
          send_after: now.plus({ minutes }).toISO()!,
          updated_at: now.toISO()!,
        })
      return 'retried'
    }

    await this.finish(row, 'sent', null)
    return 'sent'
  }

  protected async finish(row: OutboundEmail, status: 'sent' | 'failed', lastError: string | null) {
    const now = this.clock.now().toISO()!
    await db
      .from('outbound_emails')
      .where('id', row.id)
      .update({
        status,
        last_error: lastError,
        sent_at: status === 'sent' ? now : null,
        updated_at: now,
      })
  }
}
