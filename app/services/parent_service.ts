import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import User from '#models/user'
import Clock from '#services/clock'
import UserTokenService from '#services/user_token_service'
import OrderCancellationService from '#services/order_cancellation_service'
import { revokeRememberMeTokens } from '#services/account_security_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import type { AccessStatus, ParentFilter } from '#enums/parents'
import type { AppLocale } from '#enums/locales'

export const PARENTS_PER_PAGE = 20

export type ParentInput = {
  fullName: string
  email: string
  phone?: string | null
  locale: AppLocale
}

/** Escapes LIKE wildcards in a user search string. */
function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

/**
 * Back-office parent accounts. Every parent belongs to exactly one school
 * (`users.school_id`, required for parents); staff only manage parents of
 * their own school (ParentPolicy).
 */
@inject()
export default class ParentService {
  constructor(
    protected clock: Clock,
    protected tokens: UserTokenService,
    protected cancellations: OrderCancellationService
  ) {}

  /**
   * Access status shown in the list and on the detail page (derived, see
   * docs/ERD.md §user_tokens).
   */
  accessStatus(
    parent: Pick<User, 'isActive' | 'password' | 'invitedAt'>,
    openInvitationExpiresAt: DateTime | null
  ): AccessStatus {
    if (!parent.isActive) return 'inactive'
    if (parent.password) return 'active'
    if (openInvitationExpiresAt && openInvitationExpiresAt > this.clock.now()) return 'invited'
    return parent.invitedAt ? 'expired' : 'not_invited'
  }

  /** Expiry of the open (unused, unrevoked) invitation of each parent. */
  async openInvitationExpiries(parentIds: number[]): Promise<Map<number, DateTime>> {
    const map = new Map<number, DateTime>()
    if (!parentIds.length) return map
    const rows = await db
      .from('user_tokens')
      .select('user_id')
      .max('expires_at as expires_at')
      .whereIn('user_id', parentIds)
      .where('type', 'invitation')
      .whereNull('used_at')
      .whereNull('revoked_at')
      .groupBy('user_id')
    for (const row of rows) {
      const value = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at)
      map.set(row.user_id, DateTime.fromJSDate(value))
    }
    return map
  }

  /**
   * Paginated parents of the staff member's school with search and filter.
   */
  async list(schoolId: number, options: { q?: string; status?: ParentFilter; page?: number }) {
    const now = this.clock.now().toJSDate()
    const query = User.query()
      .where('role', 'parent')
      .where('school_id', schoolId)
      .withCount('children')
      .orderByRaw('lower(full_name) asc')
      .orderBy('id', 'asc')

    const search = options.q?.trim()
    if (search) {
      const pattern = likePattern(search)
      const digits = search.replace(/[^0-9+]/g, '')
      query.where((builder) => {
        builder
          .whereRaw('full_name ILIKE ?', [pattern])
          .orWhereRaw('email ILIKE ?', [pattern])
          .orWhereRaw('phone ILIKE ?', [pattern])
        if (digits.length >= 3) builder.orWhereRaw('phone ILIKE ?', [likePattern(digits)])
      })
    }

    const openInvitation = `EXISTS (
      SELECT 1 FROM user_tokens t
      WHERE t.user_id = users.id AND t.type = 'invitation'
        AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > ?
    )`

    switch (options.status) {
      case 'active':
        query.where('is_active', true).whereNotNull('password')
        break
      case 'invited':
        query.where('is_active', true).whereNull('password').whereRaw(openInvitation, [now])
        break
      case 'not_invited':
        query
          .where('is_active', true)
          .whereNull('password')
          .whereRaw(`NOT ${openInvitation}`, [now])
        break
      case 'never_logged_in':
        query.where('is_active', true).whereNull('last_login_at')
        break
      case 'inactive':
        query.where('is_active', false)
        break
    }

    return query.paginate(options.page ?? 1, PARENTS_PER_PAGE)
  }

  async create(schoolId: number, input: ParentInput): Promise<User> {
    return User.create({
      fullName: input.fullName,
      email: input.email,
      phone: input.phone ?? null,
      locale: input.locale,
      role: 'parent',
      schoolId,
      password: null,
      isActive: true,
      notificationPrefs: {},
      credentialsVersion: 0,
    })
  }

  /**
   * Updates a parent. A new email ends existing logins and invalidates any
   * open invitation/reset link (sent to the old address).
   */
  async update(parent: User, input: ParentInput): Promise<User> {
    this.assertParent(parent)
    await db.transaction(async (trx) => {
      parent.useTransaction(trx)
      parent.merge({
        fullName: input.fullName,
        email: input.email,
        phone: input.phone ?? null,
        locale: input.locale,
      })
      const emailChanged = parent.$dirty.email !== undefined
      await parent.save()
      if (emailChanged) {
        await this.tokens.revokeOpen(parent.id, trx)
        await revokeRememberMeTokens(parent.id, trx)
      }
    })
    return parent
  }

  /**
   * Deactivates a parent: they can no longer log in, their current sessions
   * end on the next request (credentials version bump), remember-me tokens
   * and open links are deleted/revoked.
   */
  async deactivate(parent: User, actor: User | null = null) {
    this.assertParent(parent)
    if (!parent.isActive) return parent
    await db.transaction(async (trx) => {
      // Their children's future orders are cancelled (child_inactive).
      // Lock order as in OrderService: school, then children, then orders.
      if (typeof parent.schoolId === 'number') {
        await trx.from('schools').where('id', parent.schoolId).forShare().select('id')
      }
      const children = await trx
        .from('children')
        .where('parent_id', parent.id)
        .orderBy('id')
        .forUpdate()
        .select('id')
      parent.useTransaction(trx)
      parent.isActive = false
      await parent.save()
      await this.cancellations.cancelFutureOrders(
        trx,
        children.map((row) => Number(row.id)),
        actor
      )
      await this.tokens.revokeOpen(parent.id, trx)
      await revokeRememberMeTokens(parent.id, trx)
    })
    return parent
  }

  async activate(parent: User) {
    this.assertParent(parent)
    if (parent.isActive) return parent
    parent.isActive = true
    await parent.save()
    return parent
  }

  protected assertParent(user: User) {
    if (user.role !== 'parent') throw new BusinessRuleException('families.errors.not_a_parent')
  }
}
