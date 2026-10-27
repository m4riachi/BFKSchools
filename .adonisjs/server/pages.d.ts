import '@adonisjs/inertia/types'

import type { VNodeProps, AllowedComponentProps, ComponentInstance } from 'vue'

type ExtractProps<T> = Omit<
  ComponentInstance<T>['$props'],
  keyof VNodeProps | keyof AllowedComponentProps
>

declare module '@adonisjs/inertia/types' {
  export interface InertiaPages {
    'admin/dashboard': ExtractProps<(typeof import('../../inertia/pages/admin/dashboard.vue'))['default']>
    'auth/login': ExtractProps<(typeof import('../../inertia/pages/auth/login.vue'))['default']>
    'errors/forbidden': ExtractProps<(typeof import('../../inertia/pages/errors/forbidden.vue'))['default']>
    'errors/not_found': ExtractProps<(typeof import('../../inertia/pages/errors/not_found.vue'))['default']>
    'errors/server_error': ExtractProps<(typeof import('../../inertia/pages/errors/server_error.vue'))['default']>
    'kitchen/dashboard': ExtractProps<(typeof import('../../inertia/pages/kitchen/dashboard.vue'))['default']>
    'parent/home': ExtractProps<(typeof import('../../inertia/pages/parent/home.vue'))['default']>
  }
}
