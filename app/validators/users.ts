import vine from '@vinejs/vine'
import { LOCALES } from '#enums/locales'
import { PERMISSIONS } from '#enums/permissions'
import { emailRule, nameRule, phoneRule } from '#validators/rules'

/** Staff account (D42). `access`: a built-in role or `role:<id>`, checked by the service. */
export const staffUserValidator = vine.withMetaData<{ userId?: number }>().create({
  fullName: nameRule(120),
  email: emailRule().unique({
    table: 'users',
    column: 'email',
    caseInsensitive: true,
    filter: (query, _value, field) => {
      if (field.meta.userId) query.whereNot('id', field.meta.userId)
    },
  }),
  phone: phoneRule().nullable().optional(),
  locale: vine.enum(LOCALES),
  access: vine.string().regex(/^(admin|manager|kitchen|role:[1-9]\d{0,8})$/),
})

export const staffActiveValidator = vine.create({ isActive: vine.boolean() })

export const staffRoleValidator = vine.create({
  name: nameRule(60),
  permissions: vine.array(vine.enum(PERMISSIONS)).minLength(1).distinct(),
})
