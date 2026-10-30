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
    'admin/holidays/import': ExtractProps<(typeof import('../../inertia/pages/admin/holidays/import.vue'))['default']>
    'admin/holidays/index': ExtractProps<(typeof import('../../inertia/pages/admin/holidays/index.vue'))['default']>
    'admin/imports/families': ExtractProps<(typeof import('../../inertia/pages/admin/imports/families.vue'))['default']>
    'admin/meals/form': ExtractProps<(typeof import('../../inertia/pages/admin/meals/form.vue'))['default']>
    'admin/meals/index': ExtractProps<(typeof import('../../inertia/pages/admin/meals/index.vue'))['default']>
    'admin/menus/index': ExtractProps<(typeof import('../../inertia/pages/admin/menus/index.vue'))['default']>
    'admin/menus/remove_item': ExtractProps<(typeof import('../../inertia/pages/admin/menus/remove_item.vue'))['default']>
    'admin/menus/show': ExtractProps<(typeof import('../../inertia/pages/admin/menus/show.vue'))['default']>
    'admin/orders/child': ExtractProps<(typeof import('../../inertia/pages/admin/orders/child.vue'))['default']>
    'admin/orders/index': ExtractProps<(typeof import('../../inertia/pages/admin/orders/index.vue'))['default']>
    'admin/parents/create': ExtractProps<(typeof import('../../inertia/pages/admin/parents/create.vue'))['default']>
    'admin/parents/edit': ExtractProps<(typeof import('../../inertia/pages/admin/parents/edit.vue'))['default']>
    'admin/parents/index': ExtractProps<(typeof import('../../inertia/pages/admin/parents/index.vue'))['default']>
    'admin/parents/show': ExtractProps<(typeof import('../../inertia/pages/admin/parents/show.vue'))['default']>
    'admin/reports/index': ExtractProps<(typeof import('../../inertia/pages/admin/reports/index.vue'))['default']>
    'admin/settings': ExtractProps<(typeof import('../../inertia/pages/admin/settings.vue'))['default']>
    'admin/statements/index': ExtractProps<(typeof import('../../inertia/pages/admin/statements/index.vue'))['default']>
    'admin/statements/show': ExtractProps<(typeof import('../../inertia/pages/admin/statements/show.vue'))['default']>
    'auth/forgot_password': ExtractProps<(typeof import('../../inertia/pages/auth/forgot_password.vue'))['default']>
    'auth/login': ExtractProps<(typeof import('../../inertia/pages/auth/login.vue'))['default']>
    'auth/set_password': ExtractProps<(typeof import('../../inertia/pages/auth/set_password.vue'))['default']>
    'errors/forbidden': ExtractProps<(typeof import('../../inertia/pages/errors/forbidden.vue'))['default']>
    'errors/not_found': ExtractProps<(typeof import('../../inertia/pages/errors/not_found.vue'))['default']>
    'errors/server_error': ExtractProps<(typeof import('../../inertia/pages/errors/server_error.vue'))['default']>
    'kitchen/allergies': ExtractProps<(typeof import('../../inertia/pages/kitchen/allergies.vue'))['default']>
    'kitchen/dashboard': ExtractProps<(typeof import('../../inertia/pages/kitchen/dashboard.vue'))['default']>
    'kitchen/exports': ExtractProps<(typeof import('../../inertia/pages/kitchen/exports.vue'))['default']>
    'kitchen/labels': ExtractProps<(typeof import('../../inertia/pages/kitchen/labels.vue'))['default']>
    'kitchen/meals/index': ExtractProps<(typeof import('../../inertia/pages/kitchen/meals/index.vue'))['default']>
    'kitchen/meals/show': ExtractProps<(typeof import('../../inertia/pages/kitchen/meals/show.vue'))['default']>
    'parent/account/index': ExtractProps<(typeof import('../../inertia/pages/parent/account/index.vue'))['default']>
    'parent/notifications/index': ExtractProps<(typeof import('../../inertia/pages/parent/notifications/index.vue'))['default']>
    'parent/orders/history': ExtractProps<(typeof import('../../inertia/pages/parent/orders/history.vue'))['default']>
    'parent/orders/week': ExtractProps<(typeof import('../../inertia/pages/parent/orders/week.vue'))['default']>
    'parent/statements/index': ExtractProps<(typeof import('../../inertia/pages/parent/statements/index.vue'))['default']>
  }
}
