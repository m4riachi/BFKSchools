import { createHash, randomBytes } from 'node:crypto'
import { inject } from '@adonisjs/core'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type User from '#models/user'
import UserToken from '#models/user_token'
import Clock from '#services/clock'
import { USER_TOKEN_TTL_MINUTES, type UserTokenType } from '#enums/user_tokens'

/** base64url of 32 random bytes = 43 characters. */
const RAW_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

/**
 * Invitation and password-reset tokens (docs/ERD.md §user_tokens).
 *
 * - 32 random bytes, sent only in the email link; the database keeps the
 *   SHA-256 hex, so a leaked dump cannot be used to log in.
 * - Issuing a token revokes every open token of the same user and type
 *   ("resend invalidates the previous link").
 * - Consuming locks the row (FOR UPDATE) and sets `used_at`: single use.
 */
@inject()
export default class UserTokenService {
  constructor(protected clock: Clock) {}

  static hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex')
  }

  async issue(
    user: User,
    type: UserTokenType,
    options: { trx: TransactionClientContract; createdBy?: number | null; ip?: string | null }
  ): Promise<{ token: string; record: UserToken }> {
    const now = this.clock.now()
    await this.revokeOpen(user.id, options.trx, type)

    const token = randomBytes(32).toString('base64url')
    const record = await UserToken.create(
      {
        userId: user.id,
        type,
        tokenHash: UserTokenService.hash(token),
        expiresAt: now.plus({ minutes: USER_TOKEN_TTL_MINUTES[type] }),
        createdBy: options.createdBy ?? null,
        requestIp: options.ip ?? null,
      },
      { client: options.trx }
    )
    return { token, record }
  }

  /**
   * The usable token row for a raw token (not consumed), with its user, or
   * null when unknown, used, revoked, expired or the user is inactive.
   */
  async findUsable(raw: string, type: UserTokenType): Promise<UserToken | null> {
    if (!RAW_TOKEN_RE.test(raw)) return null
    const record = await UserToken.query()
      .where('token_hash', UserTokenService.hash(raw))
      .where('type', type)
      .preload('user')
      .first()
    return record && this.isUsable(record) && record.user.isActive ? record : null
  }

  /**
   * Locks and consumes a token inside `trx`. Returns null when it cannot be
   * used (the caller shows the "invalid or expired link" page).
   */
  async consume(
    raw: string,
    type: UserTokenType,
    trx: TransactionClientContract
  ): Promise<UserToken | null> {
    if (!RAW_TOKEN_RE.test(raw)) return null
    const record = await UserToken.query({ client: trx })
      .where('token_hash', UserTokenService.hash(raw))
      .where('type', type)
      .forUpdate()
      .first()
    if (!record || !this.isUsable(record)) return null

    record.usedAt = this.clock.now()
    await record.save()
    return record
  }

  /** Revokes the user's open tokens (of one type, or all types). */
  async revokeOpen(userId: number, trx: TransactionClientContract, type?: UserTokenType) {
    const query = UserToken.query({ client: trx })
      .where('user_id', userId)
      .whereNull('used_at')
      .whereNull('revoked_at')
    if (type) query.where('type', type)
    await query.update({ revoked_at: this.clock.now().toJSDate() })
  }

  protected isUsable(record: UserToken) {
    return !record.usedAt && !record.revokedAt && record.expiresAt > this.clock.now()
  }
}
