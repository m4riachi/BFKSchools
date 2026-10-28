import { UserTokenSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

/**
 * Invitation / password-reset token. Only `tokenHash` (SHA-256 hex) is
 * stored; issue and consume tokens through UserTokenService.
 */
export default class UserToken extends UserTokenSchema {
  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
