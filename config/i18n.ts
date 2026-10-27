import app from '@adonisjs/core/services/app'
import { defineConfig, formatters, loaders } from '@adonisjs/i18n'

const i18nConfig = defineConfig({
  /**
   * The back-office defaults to French.
   */
  defaultLocale: 'fr',
  supportedLocales: ['fr', 'en'],
  fallbackLocales: { en: 'fr' },
  formatter: formatters.icu(),

  loaders: [
    /**
     * resources/lang/<locale>/<namespace>.json — keys are flattened as
     * "<namespace>.<path>", e.g. "auth.login.title".
     */
    loaders.fs({
      location: app.languageFilesPath(),
    }),
  ],
})

export default i18nConfig
