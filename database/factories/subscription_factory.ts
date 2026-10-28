import factory from '@adonisjs/lucid/factories'
import Subscription from '#models/subscription'

/**
 * Subscription periods for tests (set `childId` with `.merge()`).
 */
export const SubscriptionFactory = factory
  .define(Subscription, () => ({
    startDate: '2026-09-01',
    endDate: '2027-06-11',
    status: 'active' as const,
    notes: null,
  }))
  .build()
