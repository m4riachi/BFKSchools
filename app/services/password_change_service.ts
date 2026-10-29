import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import User from '#models/user'
import UserTokenService from '#services/user_token_service'
import { revokeRememberMeTokens } from '#services/account_security_service'

export type PasswordChangeResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'wrong_current' | 'same_password' | 'unavailable' }

/**
 * D30 — a logged-in user changes their password (parent "Account" page).
 *
 * Inside one transaction, with the user row locked first (same lock order
 * as UserTokenService.issue and AccountLinkService.setPassword):
 * - the current password is checked against the locked row;
 * - the new password is saved, which bumps `credentials_version`
 *   (User.bumpCredentialsVersion): every other session ends on its next
 *   request and every known-device cookie stops matching;
 * - remember-me tokens and open invitation / reset links are revoked.
 *
 * The caller re-binds the current session to the new version, so only
 * this browser stays signed in.
 */
@inject()
export default class PasswordChangeService {
  constructor(protected tokens: UserTokenService) {}

  async change(userId: number, current: string, next: string): Promise<PasswordChangeResult> {
    return db.transaction(async (trx) => {
      const user = await User.query({ client: trx }).where('id', userId).forUpdate().first()
      if (!user || !user.isActive || !user.password) return { ok: false, reason: 'unavailable' }

      if (!(await hash.verify(user.password, current))) {
        return { ok: false, reason: 'wrong_current' }
      }
      if (current === next) return { ok: false, reason: 'same_password' }

      user.password = next
      await user.save()
      await this.tokens.revokeOpen(user.id, trx)
      await revokeRememberMeTokens(user.id, trx)
      return { ok: true, user }
    })
  }
}
