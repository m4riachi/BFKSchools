import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { safeTranslate } from '#support/safe_translate'
import User from '#models/user'
import ParentService from '#services/parent_service'
import Clock from '#services/clock'
import AccountLinkService from '#services/account_link_service'
import { parentListValidator, parentValidator } from '#validators/families'
import { presentChild, presentParent } from '#support/family_presenters'
import { staffSchoolId } from '#policies/parent_policy'
import { PARENT_FILTERS, type ParentFilter } from '#enums/parents'
import BusinessRuleException from '#exceptions/business_rule_exception'

/**
 * Back-office parents (admin + manager of the parent's school).
 */
@inject()
export default class ParentsController {
  constructor(
    protected parents: ParentService,
    protected accountLinks: AccountLinkService,
    protected clock: Clock
  ) {}

  async index({ request, inertia, bouncer, auth }: HttpContext) {
    await bouncer.with('ParentPolicy').authorize('viewAny')
    const schoolId = staffSchoolId(auth.getUserOrFail())!

    let filters: { q?: string; status?: ParentFilter; page?: number } = {}
    try {
      filters = await parentListValidator.validate(request.qs())
    } catch {
      filters = {}
    }

    const page = await this.parents.list(schoolId, filters)
    const parents = page.all()
    const expiries = await this.parents.openInvitationExpiries(parents.map((parent) => parent.id))

    return inertia.render('admin/parents/index', {
      parents: parents.map((parent) => {
        const expiresAt = expiries.get(parent.id) ?? null
        return presentParent(parent, {
          status: this.parents.accessStatus(parent, expiresAt),
          invitationExpiresAt: expiresAt,
        })
      }),
      meta: {
        total: page.total,
        perPage: page.perPage,
        currentPage: page.currentPage,
        lastPage: page.lastPage,
      },
      filters: { q: filters.q ?? '', status: filters.status ?? 'all' },
      statuses: [...PARENT_FILTERS],
    })
  }

  async create({ inertia, bouncer }: HttpContext) {
    await bouncer.with('ParentPolicy').authorize('create')
    return inertia.render('admin/parents/create', {})
  }

  async store({ request, response, bouncer, auth, session, i18n }: HttpContext) {
    await bouncer.with('ParentPolicy').authorize('create')
    const staff = auth.getUserOrFail()
    const { sendInvitation, ...input } = await request.validateUsing(parentValidator, {
      meta: {},
    })

    const parent = await this.parents.create(staffSchoolId(staff)!, input)
    session.flash('success', i18n.t('families.flash.parent_created'))

    if (sendInvitation) {
      try {
        await this.accountLinks.invite(parent, staff)
        session.flash('success', i18n.t('families.flash.parent_created_invited'))
      } catch (error) {
        if (!(error instanceof BusinessRuleException)) throw error
        session.flash('error', safeTranslate(i18n, error.messageKey))
      }
    }
    return response.redirect(`/admin/parents/${parent.id}`)
  }

  async show({ params, inertia, bouncer, auth }: HttpContext) {
    const parent = await this.findParent(params.id, auth.getUserOrFail())
    await bouncer.with('ParentPolicy').authorize('manage', parent)

    await parent.load('children', (query) =>
      query
        .orderByRaw('lower(first_name), lower(last_name)')
        .preload('subscriptions', (subscriptions) => subscriptions.orderBy('start_date', 'desc'))
    )
    const expiries = await this.parents.openInvitationExpiries([parent.id])
    const expiresAt = expiries.get(parent.id) ?? null
    parent.$extras.children_count = parent.children.length

    return inertia.render('admin/parents/show', {
      parent: presentParent(parent, {
        status: this.parents.accessStatus(parent, expiresAt),
        invitationExpiresAt: expiresAt,
      }),
      children: parent.children.map(presentChild),
      today: this.clock.today(),
    })
  }

  async edit({ params, inertia, bouncer, auth }: HttpContext) {
    const parent = await this.findParent(params.id, auth.getUserOrFail())
    await bouncer.with('ParentPolicy').authorize('manage', parent)
    return inertia.render('admin/parents/edit', {
      parent: {
        id: parent.id,
        fullName: parent.fullName,
        email: parent.email,
        phone: parent.phone,
        locale: parent.locale,
      },
    })
  }

  async update({ params, request, response, bouncer, session, i18n, auth }: HttpContext) {
    const parent = await this.findParent(params.id, auth.getUserOrFail())
    await bouncer.with('ParentPolicy').authorize('manage', parent)

    const { fullName, email, phone, locale } = await request.validateUsing(parentValidator, {
      meta: { userId: parent.id },
    })
    const input = { fullName, email, phone, locale }
    await this.parents.update(parent, input)

    session.flash('success', i18n.t('families.flash.parent_updated'))
    return response.redirect(`/admin/parents/${parent.id}`)
  }

  async deactivate({ params, response, bouncer, session, i18n, auth }: HttpContext) {
    const parent = await this.findParent(params.id, auth.getUserOrFail())
    await bouncer.with('ParentPolicy').authorize('manage', parent)
    await this.parents.deactivate(parent, auth.getUserOrFail())
    session.flash('success', i18n.t('families.flash.parent_deactivated'))
    return response.redirect(`/admin/parents/${parent.id}`)
  }

  async activate({ params, response, bouncer, session, i18n, auth }: HttpContext) {
    const parent = await this.findParent(params.id, auth.getUserOrFail())
    await bouncer.with('ParentPolicy').authorize('manage', parent)
    await this.parents.activate(parent)
    session.flash('success', i18n.t('families.flash.parent_activated'))
    return response.redirect(`/admin/parents/${parent.id}`)
  }

  /** Sends or re-sends the invitation (the previous link stops working). */
  async invite({ params, response, bouncer, auth, session, i18n }: HttpContext) {
    const parent = await this.findParent(params.id, auth.getUserOrFail())
    await bouncer.with('ParentPolicy').authorize('manage', parent)
    const resend = parent.invitedAt !== null
    await this.accountLinks.invite(parent, auth.getUserOrFail())
    session.flash(
      'success',
      i18n.t(resend ? 'families.flash.invitation_resent' : 'families.flash.invitation_sent', {
        email: parent.email,
      })
    )
    return response.redirect().back()
  }

  /**
   * Parents of the staff member's school only: another role or a parent of
   * another school behind this id is a 404 (no 403 that would confirm the
   * account exists). Staff without a school fall through to the policy (403).
   */
  protected async findParent(id: unknown, staff: User) {
    const parentId = Number(id)
    if (!Number.isSafeInteger(parentId) || parentId <= 0) {
      return User.query().whereRaw('false').firstOrFail()
    }
    const query = User.query().where('id', parentId).where('role', 'parent')
    const schoolId = staffSchoolId(staff)
    if (schoolId !== null) query.where('school_id', schoolId)
    return query.firstOrFail()
  }
}
