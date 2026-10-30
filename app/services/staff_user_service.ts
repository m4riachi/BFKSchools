import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import BusinessRuleException from '#exceptions/business_rule_exception'
import StaffRole from '#models/staff_role'
import User from '#models/user'
import { roleForPermissions } from '#enums/permissions'
import type { AppLocale } from '#enums/locales'
import type { Role } from '#enums/roles'
import { revokeRememberMeTokens } from '#services/account_security_service'
import UserTokenService from '#services/user_token_service'

const STAFF_LEVELS: readonly Role[] = ['admin', 'manager', 'kitchen']

type StaffInput = {
  fullName: string
  email: string
  phone?: string | null
  locale: AppLocale
  /** `admin`, `manager`, `kitchen` or `role:<id>`. */
  access: string
}

/** Staff accounts of a school (D42). Parents are managed in Families. */
@inject()
export default class StaffUserService {
  constructor(protected tokens: UserTokenService) {}

  list(schoolId: number) {
    return User.query()
      .where('school_id', schoolId)
      .whereIn('role', [...STAFF_LEVELS])
      .orderBy('is_active', 'desc')
      .orderByRaw('lower(full_name)')
  }

  /** Another school's account or a parent is a 404. */
  find(schoolId: number, id: number) {
    return User.query()
      .where('school_id', schoolId)
      .whereIn('role', [...STAFF_LEVELS])
      .where('id', id)
      .firstOrFail()
  }

  /** The account has no password until its owner accepts the invitation. */
  async create(actor: User, schoolId: number, input: StaffInput) {
    return db.transaction(async (trx) => {
      await this.assertActorStillAdmin(actor, trx)
      const access = await this.resolveAccess(schoolId, input.access, trx)
      return User.create(
        {
          schoolId,
          fullName: input.fullName,
          email: input.email,
          phone: input.phone ?? null,
          locale: input.locale,
          isActive: true,
          ...access,
        },
        { client: trx }
      )
    })
  }

  async update(actor: User, target: User, input: StaffInput) {
    await db.transaction(async (trx) => {
      const access = await this.resolveAccess(target.schoolId!, input.access, trx)
      await this.assertActorStillAdmin(actor, trx)
      if (actor.id === target.id && input.access !== 'admin') {
        throw new BusinessRuleException('users.errors.own_access', { field: 'access' })
      }
      const row = await this.lockedRow(target, trx)
      row.merge({
        fullName: input.fullName,
        email: input.email,
        phone: input.phone ?? null,
        locale: input.locale,
        ...access,
      })
      const emailChanged = row.$dirty.email !== undefined
      await row.save()
      if (emailChanged) await this.endAccess(row, trx)
    })
  }

  /** Current sessions end on their next request. */
  async setActive(actor: User, target: User, isActive: boolean) {
    if (actor.id === target.id) throw new BusinessRuleException('users.errors.own_account')
    await db.transaction(async (trx) => {
      await this.assertActorStillAdmin(actor, trx)
      const row = await this.lockedRow(target, trx)
      row.isActive = isActive
      await row.save()
      if (!isActive) await this.endAccess(row, trx)
    })
  }

  /** Fresh under lock, so `credentialsVersion` cannot be bumped from a stale copy. */
  protected lockedRow(target: User, trx: TransactionClientContract) {
    return User.query({ client: trx }).where('id', target.id).forUpdate().firstOrFail()
  }

  protected async endAccess(user: User, trx: TransactionClientContract) {
    await this.tokens.revokeOpen(user.id, trx)
    await revokeRememberMeTokens(user.id, trx)
  }

  /**
   * Admins of the school are locked one change at a time: two admins removing
   * each other at the same moment cannot leave the school without any.
   */
  protected async assertActorStillAdmin(actor: User, trx: TransactionClientContract) {
    const admins = await User.query({ client: trx })
      .where('school_id', actor.schoolId!)
      .where('role', 'admin')
      .where('is_active', true)
      .orderBy('id')
      .forUpdate()
    if (!admins.some((admin) => admin.id === actor.id)) {
      throw new BusinessRuleException('users.errors.not_admin_anymore')
    }
  }

  protected async resolveAccess(schoolId: number, access: string, trx: TransactionClientContract) {
    if (STAFF_LEVELS.includes(access as Role)) {
      return { role: access as Role, staffRoleId: null }
    }
    const id = Number(access.replace('role:', ''))
    const role = await StaffRole.query({ client: trx })
      .where('school_id', schoolId)
      .where('id', id)
      .forShare()
      .first()
    if (!role) throw new BusinessRuleException('users.errors.unknown_role', { field: 'access' })
    return { role: roleForPermissions(role.permissions as string[]), staffRoleId: role.id }
  }
}
