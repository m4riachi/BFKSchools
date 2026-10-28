import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'
import { safeTranslate } from '#support/safe_translate'

/**
 * A business rule refused the action (overlapping subscription, parent
 * already has access, …). `messageKey` is an i18n key; with `field`, the
 * message is shown under that form field, otherwise as an error toast.
 * Services throw it; it renders itself (flash + redirect back).
 */
export default class BusinessRuleException extends Exception {
  static status = 422

  constructor(
    readonly messageKey: string,
    readonly options: {
      field?: string
      values?: Record<string, string | number>
      /** More field errors to flash with `field` (raw strings, not translated). */
      extraFields?: Record<string, string>
    } = {}
  ) {
    super(messageKey, { status: 422, code: 'E_BUSINESS_RULE' })
  }

  async handle(error: this, ctx: HttpContext) {
    const message = safeTranslate(ctx.i18n, error.messageKey, error.options.values ?? {})
    if (error.options.field) {
      ctx.session.flashValidationErrors({
        code: 'E_VALIDATION_ERROR',
        messages: [
          { field: error.options.field, message },
          ...Object.entries(error.options.extraFields ?? {}).map(([field, value]) => ({
            field,
            message: value,
          })),
        ],
      } as unknown as Parameters<typeof ctx.session.flashValidationErrors>[0])
    } else {
      ctx.session.flashExcept(['_csrf', '_method', 'password', 'password_confirmation'])
      ctx.session.flash('error', message)
    }
    return ctx.response.redirect().back()
  }
}
