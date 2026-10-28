import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import { isIsoDate } from '#support/dates'

/**
 * Plain ASCII address: no quotes, spaces, commas, angle brackets, comments
 * or display names. Stricter than RFC 5322 on purpose: stored emails are
 * passed to nodemailer as bare recipient strings, and nodemailer's address
 * parser has known interpretation issues with quoted/odd local parts
 * (security follow-up, Phase 1 review).
 */
export const SAFE_EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

export function isSafeEmail(value: string): boolean {
  return value.length <= 254 && SAFE_EMAIL_RE.test(value)
}

/** Email field: trimmed, lower-cased, strict. */
export function emailRule() {
  return vine.string().trim().toLowerCase().maxLength(254).email().regex(SAFE_EMAIL_RE)
}

/**
 * Phone: digits with optional leading "+" and common separators, stored
 * without separators (E.164 when the user typed the country code).
 */
export function phoneRule() {
  return vine
    .string()
    .trim()
    .maxLength(30)
    .regex(/^\+?[0-9 ().-]{6,30}$/)
    .transform((value) => value.replace(/[ ().-]/g, ''))
}

/** Free text: trimmed, inner whitespace collapsed. */
export function nameRule(max = 120) {
  return vine
    .string()
    .trim()
    .minLength(1)
    .maxLength(max)
    .transform((value) => value.replace(/\s+/g, ' '))
}

const isoDate = vine.createRule((value: unknown, _options: undefined, field: FieldContext) => {
  if (!field.isValid) return
  if (!isIsoDate(value))
    field.report('The {{ field }} field must be a date (YYYY-MM-DD)', 'isoDate', field)
})

/** A business day as a 'YYYY-MM-DD' string (never converted to a Date). */
export function isoDateRule() {
  return vine.string().trim().use(isoDate())
}

/**
 * Password strength (set-password and reset pages): 10–128 characters with
 * at least one letter and one digit.
 */
export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 128

export function passwordStrengthIssues(value: string): string[] {
  const issues: string[] = []
  if (value.length < PASSWORD_MIN_LENGTH) issues.push('length')
  if (!/\p{L}/u.test(value)) issues.push('letter')
  if (!/\p{N}/u.test(value)) issues.push('digit')
  return issues
}

const strongPassword = vine.createRule(
  (value: unknown, _options: undefined, field: FieldContext) => {
    if (!field.isValid || typeof value !== 'string') return
    if (passwordStrengthIssues(value).length) {
      field.report('The {{ field }} field is too weak', 'strongPassword', field)
    }
  }
)

export function newPasswordRule() {
  return vine.string().maxLength(PASSWORD_MAX_LENGTH).use(strongPassword()).confirmed()
}
