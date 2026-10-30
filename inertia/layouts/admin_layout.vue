<script setup lang="ts">
/**
 * Back-office layout (admin + manager): white sidebar on desktop, top bar
 * with a drawer on small screens. French by default (user locale).
 */
import { computed, ref, watch } from 'vue'
import { usePage } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import BrandMark from '~/components/ui/brand_mark.vue'
import NavIcon from '~/components/ui/nav_icon.vue'
import UserAvatar from '~/components/ui/user_avatar.vue'
import FlashToasts from '~/components/ui/flash_toasts.vue'
import { useI18n } from '~/composables/use_i18n'
import { useActiveNav, type NavItem } from '~/composables/use_nav'

const page = usePage()
const { t } = useI18n()
const { isActive } = useActiveNav()

/**
 * Areas are added by later phases (set `href` when the area exists).
 */
const nav: NavItem[] = [
  {
    labelKey: 'nav.dashboard',
    href: '/admin',
    icon: 'dashboard',
    exact: true,
    permission: 'dashboard',
  },
  { labelKey: 'nav.families', href: '/admin/parents', icon: 'families', permission: 'families' },
  { labelKey: 'nav.meals', href: '/admin/meals', icon: 'meals', permission: 'meals' },
  { labelKey: 'nav.weekly_menus', href: '/admin/menus', icon: 'calendar', permission: 'menus' },
  { labelKey: 'nav.holidays', href: '/admin/holidays', icon: 'holidays', permission: 'holidays' },
  { labelKey: 'nav.orders', href: '/admin/orders', icon: 'orders', permission: 'orders' },
  { labelKey: 'nav.pos', href: '/admin/pos', icon: 'pos', permission: 'pos' },
  { labelKey: 'nav.kitchen', href: '/kitchen', icon: 'kitchen', permission: 'kitchen' },
  {
    labelKey: 'nav.statements',
    href: '/admin/statements',
    icon: 'statements',
    permission: 'statements',
  },
  { labelKey: 'nav.reports', href: '/admin/reports', icon: 'reports', permission: 'reports' },
  { labelKey: 'nav.users', href: '/admin/users', icon: 'families', roles: ['admin'] },
  { labelKey: 'nav.settings', href: '/admin/settings', icon: 'settings', roles: ['admin'] },
]

const user = computed(() => page.props.user)
const items = computed(() =>
  nav.filter(
    (item) =>
      (!item.roles || (user.value && item.roles.includes(user.value.role))) &&
      (!item.permission || page.props.access?.permissions.includes(item.permission as never))
  )
)

const drawerOpen = ref(false)
watch(
  () => page.url,
  () => (drawerOpen.value = false)
)

const itemClass = (item: NavItem) => [
  'flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm no-underline',
  isActive(item)
    ? 'bg-brand-soft font-bold text-brand-strong hover:text-brand-strong'
    : 'font-semibold text-ink-2 hover:bg-subtle hover:text-ink',
]
</script>

<template>
  <div class="min-h-dvh bg-canvas lg:flex">
    <!-- Mobile top bar -->
    <div
      class="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden"
    >
      <BrandMark size="sm" />
      <button
        type="button"
        class="flex size-11 items-center justify-center rounded-xl border border-line text-ink-2"
        :aria-label="drawerOpen ? t('app.close_menu') : t('app.open_menu')"
        :aria-expanded="drawerOpen"
        aria-controls="admin-sidebar"
        @click="drawerOpen = !drawerOpen"
      >
        <NavIcon :name="drawerOpen ? 'close' : 'menu'" />
      </button>
    </div>

    <div
      v-if="drawerOpen"
      class="fixed inset-0 z-30 bg-ink/30 lg:hidden"
      aria-hidden="true"
      @click="drawerOpen = false"
    />

    <!-- Sidebar -->
    <aside
      id="admin-sidebar"
      class="fixed inset-y-0 left-0 z-40 w-[264px] flex-col gap-7 overflow-y-auto border-r border-line bg-surface px-4 py-6 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-[248px] lg:shrink-0"
      :class="drawerOpen ? 'flex' : 'hidden'"
    >
      <div class="flex items-center gap-3 px-2">
        <BrandMark />
        <span class="text-xs text-ink-4">{{
          t('app.partner', { school: t('app.school_name') })
        }}</span>
      </div>

      <nav :aria-label="t('nav.main')" class="flex flex-col gap-1">
        <template v-for="item in items" :key="item.labelKey">
          <Link
            v-if="item.href"
            :href="item.href"
            :class="itemClass(item)"
            :aria-current="isActive(item) ? 'page' : undefined"
          >
            <NavIcon v-if="item.icon" :name="item.icon" />
            {{ t(item.labelKey) }}
          </Link>
          <span
            v-else
            class="flex cursor-not-allowed items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-semibold text-ink-4/70"
            aria-disabled="true"
            :title="t('app.coming_soon')"
          >
            <NavIcon v-if="item.icon" :name="item.icon" />
            {{ t(item.labelKey) }}
          </span>
        </template>
      </nav>

      <div v-if="user" class="mt-auto flex items-center gap-2.5 px-2">
        <UserAvatar :initials="user.initials" />
        <div class="flex min-w-0 flex-1 flex-col gap-px">
          <span class="truncate text-sm font-semibold">{{ user.fullName }}</span>
          <span class="text-xs text-ink-4">{{
            page.props.access?.roleName ?? t(`roles.${user.role}`)
          }}</span>
        </div>
        <Link
          route="session.destroy"
          as="button"
          class="flex size-10 items-center justify-center rounded-[10px] text-ink-3 hover:bg-subtle hover:text-ink"
          :aria-label="t('app.logout')"
          :title="t('app.logout')"
        >
          <NavIcon name="logout" />
        </Link>
      </div>
    </aside>

    <main class="flex min-w-0 flex-1 flex-col gap-6 px-4 pt-6 pb-12 sm:px-8 sm:pt-7">
      <slot />
    </main>
  </div>
  <FlashToasts />
</template>
