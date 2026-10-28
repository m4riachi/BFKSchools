import '@adonisjs/inertia/types'

import type { VNodeProps, AllowedComponentProps, ComponentInstance } from 'vue'

type ExtractProps<T> = Omit<
  ComponentInstance<T>['$props'],
  keyof VNodeProps | keyof AllowedComponentProps
>

declare module '@adonisjs/inertia/types' {
  export interface InertiaPages {
    'admin/children/form': ExtractProps<(typeof import('../../inertia/pages/admin/children/form.vue'))['default']>
    'admin/dashboard': ExtractProps<(typeof import('../../inertia/pages/admin/dashboard.vue'))['default']>
    'admin/imports/families': ExtractProps<(typeof import('../../inertia/pages/admin/imports/families.vue'))['default']>
    'admin/parents/create': ExtractProps<(typeof import('../../inertia/pages/admin/parents/create.vue'))['default']>
    'admin/parents/edit': ExtractProps<(typeof import('../../inertia/pages/admin/parents/edit.vue'))['default']>
    'admin/parents/index': ExtractProps<(typeof import('../../inertia/pages/admin/parents/index.vue'))['default']>
    'admin/parents/show': ExtractProps<(typeof import('../../inertia/pages/admin/parents/show.vue'))['default']>
    'auth/forgot_password': ExtractProps<(typeof import('../../inertia/pages/auth/forgot_password.vue'))['default']>
    'auth/login': ExtractProps<(typeof import('../../inertia/pages/auth/login.vue'))['default']>
    'auth/set_password': ExtractProps<(typeof import('../../inertia/pages/auth/set_password.vue'))['default']>
    'errors/forbidden': ExtractProps<(typeof import('../../inertia/pages/errors/forbidden.vue'))['default']>
    'errors/not_found': ExtractProps<(typeof import('../../inertia/pages/errors/not_found.vue'))['default']>
    'errors/server_error': ExtractProps<(typeof import('../../inertia/pages/errors/server_error.vue'))['default']>
    'kitchen/dashboard': ExtractProps<(typeof import('../../inertia/pages/kitchen/dashboard.vue'))['default']>
    'parent/home': ExtractProps<(typeof import('../../inertia/pages/parent/home.vue'))['default']>
  }
}
