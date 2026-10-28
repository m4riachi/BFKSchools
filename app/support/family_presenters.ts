import type { DateTime } from 'luxon'
import type User from '#models/user'
import type Child from '#models/child'
import type Subscription from '#models/subscription'
import type { AccessStatus } from '#enums/parents'

/**
 * Plain objects sent to the back-office Inertia pages. Never include the
 * password, tokens or credentials version.
 */

const iso = (value: DateTime | null | undefined) => (value ? value.toISO() : null)

export function presentParent(
  parent: User,
  access: { status: AccessStatus; invitationExpiresAt: DateTime | null }
) {
  return {
    id: parent.id,
    fullName: parent.fullName,
    email: parent.email,
    phone: parent.phone,
    locale: parent.locale,
    isActive: parent.isActive,
    hasPassword: parent.password !== null,
    accessStatus: access.status,
    invitationExpiresAt: iso(access.invitationExpiresAt),
    invitedAt: iso(parent.invitedAt),
    lastLoginAt: iso(parent.lastLoginAt),
    createdAt: iso(parent.createdAt),
    childrenCount: Number(parent.$extras.children_count ?? 0),
  }
}
export type ParentView = ReturnType<typeof presentParent>

export function presentSubscription(subscription: Subscription) {
  return {
    id: subscription.id,
    startDate: subscription.startDate,
    endDate: subscription.endDate,
    status: subscription.status,
    notes: subscription.notes,
  }
}
export type SubscriptionView = ReturnType<typeof presentSubscription>

export function presentChild(child: Child) {
  return {
    id: child.id,
    parentId: child.parentId,
    firstName: child.firstName,
    lastName: child.lastName,
    grade: child.grade,
    className: child.className,
    allergies: [...child.allergies],
    dietaryNotes: child.dietaryNotes,
    isActive: child.isActive,
    subscriptions: (child.subscriptions ?? []).map(presentSubscription),
  }
}
export type ChildView = ReturnType<typeof presentChild>
