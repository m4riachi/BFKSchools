import vine from '@vinejs/vine'
import { emailRule, newPasswordRule } from '#validators/rules'

/** "Forgot password" form. */
export const forgotPasswordValidator = vine.create({
  email: emailRule(),
})

/** Set-password form (invitation acceptance and password reset). */
export const setPasswordValidator = vine.create({
  password: newPasswordRule(),
})
