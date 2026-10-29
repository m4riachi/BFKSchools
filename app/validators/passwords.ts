import vine from '@vinejs/vine'
import { PASSWORD_MAX_LENGTH, emailRule, newPasswordRule } from '#validators/rules'

/** "Forgot password" form. */
export const forgotPasswordValidator = vine.create({
  email: emailRule(),
})

/** Set-password form (invitation acceptance and password reset). */
export const setPasswordValidator = vine.create({
  password: newPasswordRule(),
})

/** Parent "Account" page (D30): current password + new password (same strength rules). */
export const changePasswordValidator = vine.create({
  currentPassword: vine.string().maxLength(PASSWORD_MAX_LENGTH),
  password: newPasswordRule(),
})
