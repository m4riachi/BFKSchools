import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import School from '#models/school'
import { PERMISSIONS } from '#enums/permissions'
import AccountLinkService from '#services/account_link_service'
import StaffRoleService from '#services/staff_role_service'
import StaffUserService from '#services/staff_user_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import { staffActiveValidator, staffRoleValidator, staffUserValidator } from '#validators/users'

/**
 * Staff users and custom roles (D42), admins of the school only
 * (`SchoolPolicy.manageUsers`). Parents are managed in Families.
 */
@inject()
export default class UsersController {
  constructor(
    protected users: StaffUserService,
    protected roles: StaffRoleService,
    protected accountLinks: AccountLinkService
  ) {}

  protected async school(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const school = typeof user.schoolId === 'number' ? await School.find(user.schoolId) : null
    await ctx.bouncer.with('SchoolPolicy').authorize('manageUsers', school ?? new School())
    return school!
  }

  async index(ctx: HttpContext) {
    const school = await this.school(ctx)
    const [users, roles] = await Promise.all([
      this.users.list(school.id),
      this.roles.list(school.id),
    ])
    return ctx.inertia.render('admin/users/index', {
      users: users.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        locale: user.locale,
        role: user.role,
        access: user.staffRoleId ? `role:${user.staffRoleId}` : user.role,
        roleName: roles.find((role) => role.id === user.staffRoleId)?.name ?? null,
        isActive: user.isActive,
        hasPassword: Boolean(user.password),
        isSelf: user.id === ctx.auth.user!.id,
      })),
      roles: roles.map((role) => ({ id: role.id, name: role.name })),
    })
  }

  async store(ctx: HttpContext) {
    const { request, response, session, i18n, auth } = ctx
    const school = await this.school(ctx)
    const input = await request.validateUsing(staffUserValidator, { meta: {} })
    const user = await this.users.create(auth.getUserOrFail(), school.id, input)
    try {
      await this.accountLinks.invite(user, auth.getUserOrFail(), 'staff')
      session.flash('success', i18n.t('users.flash.created'))
    } catch (error) {
      if (!(error instanceof BusinessRuleException)) throw error
      session.flash('error', i18n.t('users.flash.created_not_sent'))
    }
    return response.redirect('/admin/users')
  }

  async update(ctx: HttpContext) {
    const { request, response, session, i18n, auth, params } = ctx
    const school = await this.school(ctx)
    const target = await this.users.find(school.id, Number(params.id))
    const input = await request.validateUsing(staffUserValidator, {
      meta: { userId: target.id },
    })
    await this.users.update(auth.getUserOrFail(), target, input)
    session.flash('success', i18n.t('users.flash.updated'))
    return response.redirect('/admin/users')
  }

  async setActive(ctx: HttpContext) {
    const { request, response, session, i18n, auth, params } = ctx
    const school = await this.school(ctx)
    const target = await this.users.find(school.id, Number(params.id))
    const { isActive } = await request.validateUsing(staffActiveValidator)
    await this.users.setActive(auth.getUserOrFail(), target, isActive)
    session.flash('success', i18n.t(isActive ? 'users.flash.activated' : 'users.flash.deactivated'))
    return response.redirect('/admin/users')
  }

  async invite(ctx: HttpContext) {
    const { response, session, i18n, auth, params } = ctx
    const school = await this.school(ctx)
    const target = await this.users.find(school.id, Number(params.id))
    await this.accountLinks.invite(target, auth.getUserOrFail(), 'staff')
    session.flash('success', i18n.t('users.flash.invited'))
    return response.redirect('/admin/users')
  }

  async roleIndex(ctx: HttpContext) {
    const school = await this.school(ctx)
    return ctx.inertia.render('admin/users/roles', {
      roles: await this.roles.list(school.id),
      permissions: [...PERMISSIONS],
    })
  }

  async roleStore(ctx: HttpContext) {
    const { request, response, session, i18n } = ctx
    const school = await this.school(ctx)
    await this.roles.create(school.id, await request.validateUsing(staffRoleValidator))
    session.flash('success', i18n.t('users.flash.role_saved'))
    return response.redirect('/admin/roles')
  }

  async roleUpdate(ctx: HttpContext) {
    const { request, response, session, i18n, params } = ctx
    const school = await this.school(ctx)
    const role = await this.roles.find(school.id, Number(params.id))
    await this.roles.update(role, await request.validateUsing(staffRoleValidator))
    session.flash('success', i18n.t('users.flash.role_saved'))
    return response.redirect('/admin/roles')
  }

  async roleDestroy(ctx: HttpContext) {
    const { response, session, i18n, params } = ctx
    const school = await this.school(ctx)
    await this.roles.delete(await this.roles.find(school.id, Number(params.id)))
    session.flash('success', i18n.t('users.flash.role_deleted'))
    return response.redirect('/admin/roles')
  }
}
