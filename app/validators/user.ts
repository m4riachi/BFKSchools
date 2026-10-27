import vine from '@vinejs/vine'
import { LOCALES } from '#enums/locales'

/**
 * Login form. The email is normalized (trimmed, lower-cased) before lookup.
 */
export const loginValidator = vine.create({
  email: vine.string().trim().toLowerCase().email().maxLength(254),
  password: vine.string().maxLength(200),
  remember: vine.boolean().optional(),
})

export const localeValidator = vine.create({
  locale: vine.enum(LOCALES),
})
