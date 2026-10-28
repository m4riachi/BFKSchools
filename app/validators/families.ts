import vine from '@vinejs/vine'
import { LOCALES } from '#enums/locales'
import { ALLERGENS } from '#enums/allergens'
import { PARENT_FILTERS } from '#enums/parents'
import { SUBSCRIPTION_STATUSES } from '#enums/subscriptions'
import { emailRule, isoDateRule, nameRule, phoneRule } from '#validators/rules'

/**
 * Parents list query string. Unknown values fall back to the defaults.
 */
export const parentListValidator = vine.create({
  q: vine.string().trim().maxLength(100).optional(),
  status: vine.enum(PARENT_FILTERS).optional(),
  page: vine.number().withoutDecimals().min(1).max(10_000).optional(),
})

/**
 * Create / edit a parent. `userId` (meta) excludes the edited user from the
 * unique email check.
 */
export const parentValidator = vine.withMetaData<{ userId?: number }>().create({
  fullName: nameRule(120),
  email: emailRule().unique({
    table: 'users',
    column: 'email',
    caseInsensitive: true,
    filter: (query, _value, field) => {
      if (field.meta.userId) query.whereNot('id', field.meta.userId)
    },
  }),
  phone: phoneRule().optional(),
  locale: vine.enum(LOCALES),
  sendInvitation: vine.boolean().optional(),
})

export const childValidator = vine.create({
  firstName: nameRule(80),
  lastName: nameRule(80),
  grade: nameRule(40).optional(),
  className: nameRule(40).optional(),
  allergies: vine.array(vine.enum(ALLERGENS)).maxLength(ALLERGENS.length).distinct().optional(),
  dietaryNotes: vine.string().trim().maxLength(1000).optional(),
  isActive: vine.boolean().optional(),
})

export const subscriptionValidator = vine.create({
  startDate: isoDateRule(),
  endDate: isoDateRule().optional(),
  status: vine.enum(SUBSCRIPTION_STATUSES),
  notes: vine.string().trim().maxLength(500).optional(),
})
