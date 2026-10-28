import { ChildSchema } from '#database/schema'
import { belongsTo, hasMany, scope } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import School from '#models/school'
import Subscription from '#models/subscription'
import { STAFF_ROLES } from '#enums/roles'

/**
 * A child of a parent account (D8: one parent per child).
 *
 * Every "can this user see this child" question goes through
 * `Child.query().withScopes((s) => s.visibleTo(user))` or ChildPolicy, so a
 * future `child_guardians` pivot only changes those two places.
 */
export default class Child extends ChildSchema {
  @belongsTo(() => User, { foreignKey: 'parentId' })
  declare parent: BelongsTo<typeof User>

  @belongsTo(() => School)
  declare school: BelongsTo<typeof School>

  @hasMany(() => Subscription)
  declare subscriptions: HasMany<typeof Subscription>

  /**
   * Children the user may see:
   * - a parent: their own children;
   * - back-office staff: children of their school (staff without a school
   *   see nothing — `school_id null` never means "all schools" here);
   * - anyone else: nothing.
   */
  static visibleTo = scope((query, user: User) => {
    if (!user.isActive) return query.whereRaw('false')
    if (user.role === 'parent') return query.where('children.parent_id', user.id)
    if (STAFF_ROLES.includes(user.role) && typeof user.schoolId === 'number') {
      return query.where('children.school_id', user.schoolId)
    }
    return query.whereRaw('false')
  })

  get fullName() {
    return `${this.firstName} ${this.lastName}`
  }
}
