import env from '#start/env'

/**
 * Email outbox (D16, docs/ERD.md §outbound_emails). `node ace mail:dispatch`
 * runs every minute (cron) and sends at most `maxPerRun` emails per run and
 * `maxPerHour` per rolling hour — set MAIL_MAX_PER_HOUR to the SMTP host's
 * hourly limit (unknown yet: pending in docs/DECISIONS.md D16).
 */
function positive(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

export const OUTBOX = {
  maxPerRun: positive(env.get('MAIL_MAX_PER_RUN'), 50),
  maxPerHour: positive(env.get('MAIL_MAX_PER_HOUR'), 250),
  /** Attempts before a row is marked `failed`. */
  maxAttempts: 5,
  /** Delay before attempt n+1 (index = attempts already made − 1). */
  backoffMinutes: [1, 5, 15, 60],
  /** A row stuck in `sending` this long (process crashed mid-run) is retried. */
  staleSendingMinutes: 15,
  /** Rows per bulk INSERT when enqueuing (recipients batches). */
  insertChunk: 500,
}
