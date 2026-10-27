import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/shield'

const shieldConfig = defineConfig({
  /**
   * Content-Security-Policy, enforced in production only (the Vite dev
   * server injects inline scripts for HMR). Vue's `:style` bindings need
   * inline styles; scripts must come from our own origin.
   */
  csp: {
    enabled: app.inProduction,
    directives: {
      defaultSrc: [`'self'`],
      scriptSrc: [`'self'`, '@nonce'],
      styleSrc: [`'self'`, `'unsafe-inline'`],
      imgSrc: [`'self'`, 'data:', 'blob:'],
      fontSrc: [`'self'`, 'data:'],
      connectSrc: [`'self'`],
      formAction: [`'self'`],
      frameAncestors: [`'none'`],
      baseUri: [`'self'`],
      objectSrc: [`'none'`],
    },
    reportOnly: false,
  },

  /**
   * CSRF on for every state-changing request. Inertia sends the token from
   * the XSRF-TOKEN cookie automatically.
   */
  csrf: {
    enabled: true,
    exceptRoutes: [],
    enableXsrfCookie: true,
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  },

  xFrame: {
    enabled: true,
    action: 'DENY',
  },

  /**
   * HSTS only matters over HTTPS (production).
   */
  hsts: {
    enabled: app.inProduction,
    maxAge: '180 days',
  },

  contentTypeSniffing: {
    enabled: true,
  },
})

export default shieldConfig
