import { UserSchema } from '#database/schema'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { beforeSave, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { DbRememberMeTokensProvider } from '@adonisjs/auth/session'
import School from '#models/school'
import Child from '#models/child'
import { STAFF_ROLES, KITCHEN_ROLES } from '#enums/roles'

// Lazy: ace may import this model (through a command) before the app boots,
// when the hash service isn't set yet.
export default class User extends compose(
  UserSchema,
  withAuthFinder(() => hash.use())
) {
  static rememberMeTokens = DbRememberMeTokensProvider.forModel(User)

  @belongsTo(() => School)
  declare school: BelongsTo<typeof School>

  /** Children of a parent account (D8: read access goes through Child.visibleTo). */
  @hasMany(() => Child, { foreignKey: 'parentId' })
  declare children: HasMany<typeof Child>

  /**
   * Emails are stored lower-cased (unique index on lower(email)).
   */
  @beforeSave()
  static normalizeEmail(user: User) {
    if (user.$dirty.email) {
      user.email = user.email.trim().toLowerCase()
    }
  }

  /**
   * Any change that should end existing logins bumps `credentialsVersion`:
   * a new password, a new email, or deactivation. Sessions (see
   * EnsureActiveUserMiddleware) and the known-device cookie are bound to it.
   * Remember-me tokens are deleted separately by SessionRevoker.
   */
  @beforeSave()
  static bumpCredentialsVersion(user: User) {
    if (!user.$isPersisted) return
    const dirty = user.$dirty
    if ('password' in dirty || 'email' in dirty || ('isActive' in dirty && !user.isActive)) {
      user.credentialsVersion = (user.credentialsVersion ?? 0) + 1
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
