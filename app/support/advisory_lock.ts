import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/**
 * Runs `work` only if no other process holds the lock `name`
 * (docs/STACK_NOTES.md §7: scheduled commands never overlap). Uses a
 * transaction-level PostgreSQL advisory lock (`pg_try_advisory_xact_lock`),
 * released automatically at commit/rollback — no connection pinning needed.
 * Returns `{ acquired: false }` without running `work` when the lock is taken.
 */
export async function withAdvisoryLock<T>(
  name: string,
  work: (trx: TransactionClientContract) => Promise<T>
): Promise<{ acquired: true; result: T } | { acquired: false }> {
  return db.transaction(async (trx) => {
    const { rows } = await trx.rawQuery('SELECT pg_try_advisory_xact_lock(hashtext(?)) AS locked', [
      name,
    ])
    if (!rows[0]?.locked) return { acquired: false as const }
    return { acquired: true as const, result: await work(trx) }
  })
}
