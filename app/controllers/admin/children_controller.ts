import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import Child from '#models/child'
import ChildService from '#services/child_service'
import { childValidator } from '#validators/families'
import { presentChild } from '#support/family_presenters'
import { ALLERGENS } from '#enums/allergens'
import { SUBSCRIPTION_STATUSES } from '#enums/subscriptions'

/**
 * Children of a parent (back-office). Routes are nested under the parent;
 * the child must belong to that parent, otherwise 404.
 */
@inject()
export default class ChildrenController {
  constructor(protected children: ChildService) {}

  async create({ params, inertia, bouncer }: HttpContext) {
    const parent = await this.findParent(params.parentId)
    await bouncer.with('ParentPolicy').authorize('manage', parent)
    return inertia.render('admin/children/form', {
      parent: { id: parent.id, fullName: parent.fullName },
      child: null,
      allergens: [...ALLERGENS],
      subscriptionStatuses: [...SUBSCRIPTION_STATUSES],
    })
  }

  async store({ params, request, response, bouncer, session, i18n }: HttpContext) {
    const parent = await this.findParent(params.parentId)
    await bouncer.with('ParentPolicy').authorize('manage', parent)
    const input = await request.validateUsing(childValidator)
    const child = await this.children.create(parent, input)
    session.flash('success', i18n.t('families.flash.child_created', { name: child.fullName }))
    return response.redirect(`/admin/parents/${parent.id}/children/${child.id}/edit`)
  }

  async edit({ params, inertia, bouncer }: HttpContext) {
    const { parent, child } = await this.findChild(params.parentId, params.id)
    await bouncer.with('ChildPolicy').authorize('manage', child)
    await child.load('subscriptions', (query) => query.orderBy('start_date', 'desc'))
    return inertia.render('admin/children/form', {
      parent: { id: parent.id, fullName: parent.fullName },
      child: presentChild(child),
      allergens: [...ALLERGENS],
      subscriptionStatuses: [...SUBSCRIPTION_STATUSES],
    })
  }

  async update({ params, request, response, bouncer, session, i18n, auth }: HttpContext) {
    const { parent, child } = await this.findChild(params.parentId, params.id)
    await bouncer.with('ChildPolicy').authorize('manage', child)
    const input = await request.validateUsing(childValidator)
    await this.children.update(child, input, auth.getUserOrFail())
    session.flash('success', i18n.t('families.flash.child_updated', { name: child.fullName }))
    return response.redirect(`/admin/parents/${parent.id}/children/${child.id}/edit`)
  }

  async destroy({ params, response, bouncer, session, i18n }: HttpContext) {
    const { parent, child } = await this.findChild(params.parentId, params.id)
    await bouncer.with('ChildPolicy').authorize('manage', child)
    await this.children.delete(child)
    session.flash('success', i18n.t('families.flash.child_deleted', { name: child.fullName }))
    return response.redirect(`/admin/parents/${parent.id}`)
  }

  protected findParent(id: unknown) {
    return User.query().where('id', Number(id)).where('role', 'parent').firstOrFail()
  }

  protected async findChild(parentId: unknown, childId: unknown) {
    const parent = await this.findParent(parentId)
    const child = await Child.query()
      .where('id', Number(childId))
      .where('parent_id', parent.id)
      .firstOrFail()
    return { parent, child }
  }
}
