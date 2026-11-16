/**
 * Shapes of the back-office family props (see app/support/family_presenters.ts).
 */
import type { AccessStatus } from '~/components/families/access_badge.vue'

export type ParentRow = {
  id: number
  fullName: string
  email: string
  phone: string | null
  locale: string
  isActive: boolean
  hasPassword: boolean
  accessStatus: AccessStatus
  invitationExpiresAt: string | null
  invitedAt: string | null
  lastLoginAt: string | null
  createdAt: string | null
  childrenCount: number
}

export type SubscriptionRow = {
  id: number
  startDate: string
  endDate: string | null
  status: 'active' | 'paused' | 'ended'
  notes: string | null
}

export type ChildRow = {
  /** D51: the child's code on the board's kiosk. */
  pin?: string | null
  id: number
  parentId: number
  firstName: string
  lastName: string
  grade: string | null
  className: string | null
  allergies: string[]
  dietaryNotes: string | null
  isActive: boolean
  subscriptions: SubscriptionRow[]
}

/** D59: a QR sign-up waiting in "À activer" (app/support/family_presenters.ts). */
export type RegistrationRow = {
  id: number
  fullName: string
  email: string
  phone: string | null
  locale: string
  registeredAt: string | null
  /** H1: Activer stays disabled until the parent confirmed the email. */
  emailConfirmed: boolean
  emailConfirmedByStaff: boolean
  hasWhatsapp: boolean
  /** M3: unconfirmed and no usable link left. */
  confirmationExpired: boolean
  children: {
    id: number
    firstName: string
    lastName: string
    grade: string | null
    className: string | null
    allergies: string[]
    dietaryNotes: string | null
  }[]
}
