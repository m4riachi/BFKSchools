import { UserSchema } from '#database/schema'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { beforeSave, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { DbRememberMeTokensProvider } from '@adonisjs/auth/session'
import School from '#models/school'
import { STAFF_ROLES, KITCHEN_ROLES } from '#enums/roles'

export default class User extends compose(UserSchema, withAuthFinder(hash)) {
  static rememberMeTokens = DbRememberMeTokensProvider.forModel(User)

  @belongsTo(() => School)
  declare school: BelongsTo<typeof School>

  /**
   * Emails are stored lower-cased (unique index on lower(email)).
   */
  @beforeSave()
  static normalizeEmail(user: User) {
    if (user.$dirty.email) {
      user.email = user.email.trim().toLowerCase()
    }
  }

  static findByEmail(email: string) {
    return this.query().whereRaw('lower(email) = ?', [email.trim().toLowerCase()]).first()
  }

  get isStaff() {
    return STAFF_ROLES.includes(this.role)
  }

  get canAccessKitchen() {
    return KITCHEN_ROLES.includes(this.role)
  }

  get initials() {
    const parts = this.fullName.trim().split(/\s+/).filter(Boolean)
    const [first, last] = [parts[0], parts.length > 1 ? parts[parts.length - 1] : undefined]
    if (first && last) return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
    return (first ?? this.email).slice(0, 2).toUpperCase()
  }
}
