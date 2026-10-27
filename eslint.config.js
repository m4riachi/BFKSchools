import { configApp } from '@adonisjs/eslint-config'
import { vue } from '@adonisjs/eslint-config/vue'

export default configApp({ ignores: ['database/schema.ts'] }, ...vue, {
  name: 'inertia-vue ts overrides',
  files: ['inertia/**/*.ts'],
  rules: {
    'vue/component-api-style': 'off',
  },
})
