/**
 * Mirrors the CHECK constraint on `user_tokens.type`.
 */
export const USER_TOKEN_TYPES = ['invitation', 'password_reset'] as const
export type UserTokenType = (typeof USER_TOKEN_TYPES)[number]

/**
 * Lifetimes (docs/DECISIONS.md D13): invitations 72 hours, password reset
 * links 60 minutes.
 */
export const USER_TOKEN_TTL_MINUTES: Record<UserTokenType, number> = {
  invitation: 72 * 60,
  password_reset: 60,
}
