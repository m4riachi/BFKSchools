import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/shield'
import env from '#start/env'
import { imgSrcDirective, readStorageEnv, type StorageEnv } from '#support/storage_origin'

/**
 * Built from options so tests can check the production CSP with any
 * storage settings (tests/unit/storage_origin.spec.ts).
 */
export function makeShieldConfig(options: { inProduction: boolean; storage: StorageEnv }) {
  return defineConfig({
    /**
     * Content-Security-Policy, enforced in production only (the Vite dev
     * server injects inline scripts for HMR). Vue's `:style` bindings need
     * inline styles; scripts must come from our own origin.
     */
    csp: {
      enabled: options.inProduction,
      directives: {
        defaultSrc: [`'self'`],
        scriptSrc: [`'self'`, '@nonce'],
        styleSrc: [`'self'`, `'unsafe-inline'`],
        // With DRIVE_DISK=s3, photos are 302-redirected to signed bucket URLs:
        // the bucket origin (exactly that one) must be allowed.
        imgSrc: imgSrcDirective(options.storage),
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
      enabled: options.inProduction,
      maxAge: '180 days',
    },

    contentTypeSniffing: {
      enabled: true,
    },
  })
}

const shieldConfig = makeShieldConfig({
  inProduction: app.inProduction,
  storage: readStorageEnv(env),
})

export default shieldConfig
