import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import Child from '#models/child'
import Subscription from '#models/subscription'
import SubscriptionService from '#services/subscription_service'
import { subscriptionValidator } from '#validators/families'

/**
 * Subscription periods of a child (back-office). Nested under
 * /admin/parents/:parentId/children/:childId; every id is checked against
 * its parent in the URL (404 otherwise).
 */
@inject()
export default class SubscriptionsController {
  constructor(protected subscriptions: SubscriptionService) {}

  async store({ params, request, response, bouncer, session, i18n }: HttpContext) {
    const child = await this.findChild(params.parentId, params.childId)
    await bouncer.with('ChildPolicy').authorize('manage', child)
    const input = await request.validateUsing(subscriptionValidator)
    await this.subscriptions.create(child, input)
    session.flash('success', i18n.t('families.flash.subscription_created'))
    return response.redirect(this.childUrl(child))
  }

  async update({ params, request, response, bouncer, session, i18n, auth }: HttpContext) {
    const { child, subscription } = await this.findSubscription(params)
    await bouncer.with('ChildPolicy').authorize('manage', child)
    const input = await request.validateUsing(subscriptionValidator)
    await this.subscriptions.update(subscription, input, auth.getUserOrFail())
    session.flash('success', i18n.t('families.flash.subscription_updated'))
    return response.redirect(this.childUrl(child))
  }

  async destroy({ params, response, bouncer, session, i18n, auth }: HttpContext) {
    const { child, subscription } = await this.findSubscription(params)
    await bouncer.with('ChildPolicy').authorize('manage', child)
    await this.subscriptions.delete(subscription, auth.getUserOrFail())
    session.flash('success', i18n.t('families.flash.subscription_deleted'))
    return response.redirect(this.childUrl(child))
  }

  protected childUrl(child: Child) {
    return `/admin/parents/${child.parentId}/children/${child.id}/edit`
  }

  protected findChild(parentId: unknown, childId: unknown) {
    return Child.query()
      .where('id', Number(childId))
      .where('parent_id', Number(parentId))
      .firstOrFail()
  }

  protected async findSubscription(params: Record<string, unknown>) {
    const child = await this.findChild(params.parentId, params.childId)
    const subscription = await Subscription.query()
      .where('id', Number(params.id))
      .where('child_id', child.id)
      .firstOrFail()
    return { child, subscription }
  }
}
