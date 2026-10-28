import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/**
 * Ends persistent logins. Cookie sessions cannot be deleted server-side:
 * they are bound to `users.credentials_version` instead (bumped by the User
 * model, checked by EnsureActiveUserMiddleware). Remember-me tokens live in
 * the database and are deleted here.
 *
 * Call after a password change/reset, an email change and a deactivation.
 */
export async function revokeRememberMeTokens(userId: number, trx?: TransactionClientContract) {
  await (trx ?? db).from('remember_me_tokens').where('tokenable_id', userId).delete()
}
