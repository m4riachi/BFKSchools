<script setup lang="ts">
/**
 * Parent portal layout — mobile-first: compact header with the language
 * switcher, content column, and a bottom navigation bar.
 */
import { Link } from '@adonisjs/inertia/vue'
import BrandMark from '~/components/ui/brand_mark.vue'
import NavIcon from '~/components/ui/nav_icon.vue'
import LocaleSwitcher from '~/components/ui/locale_switcher.vue'
import FlashToasts from '~/components/ui/flash_toasts.vue'
import { useI18n } from '~/composables/use_i18n'
import { useActiveNav, type NavItem } from '~/composables/use_nav'

const { t } = useI18n()
const { isActive } = useActiveNav()

const nav: NavItem[] = [
  { labelKey: 'nav.parent_orders', href: '/', icon: 'meals', exact: true },
  { labelKey: 'nav.parent_history', href: '/orders/history', icon: 'history' },
  { labelKey: 'nav.parent_statements', href: null, icon: 'statements' },
  { labelKey: 'nav.parent_account', href: null, icon: 'account' },
]
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col bg-canvas">
    <header class="flex items-center justify-between px-4 pt-4">
      <div class="flex items-center gap-2.5">
        <BrandMark size="sm" />
        <span class="text-[15px] font-extrabold">{{ t('app.short_name') }}</span>
      </div>
      <div class="flex gap-1.5">
        <LocaleSwitcher compact />
        <Link
          route="session.destroy"
          as="button"
          class="flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-ink-2 hover:bg-subtle"
          :aria-label="t('app.logout')"
          :title="t('app.logout')"
        >
          <NavIcon name="logout" />
        </Link>
      </div>
    </header>

    <main class="flex flex-1 flex-col gap-4 px-4 pt-4 pb-6">
      <slot />
    </main>

    <nav
      :aria-label="t('nav.parent_nav')"
      class="sticky bottom-0 z-20 px-4 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]"
    >
      <div class="flex gap-1 rounded-3xl border border-line bg-surface p-1.5">
        <template v-for="item in nav" :key="item.labelKey">
          <Link
            v-if="item.href"
            :href="item.href"
            :aria-current="isActive(item) ? 'page' : undefined"
            class="flex min-h-14 flex-1 flex-col items-center justify-center gap-[3px] rounded-[14px] text-xs font-bold no-underline"
            :class="
              isActive(item)
                ? 'bg-brand-soft text-brand-strong hover:text-brand-strong'
                : 'text-ink-3 hover:text-ink'
            "
          >
            <NavIcon v-if="item.icon" :name="item.icon" />
            {{ t(item.labelKey) }}
          </Link>
          <span
            v-else
            aria-disabled="true"
            :title="t('app.coming_soon')"
            class="flex min-h-14 flex-1 cursor-not-allowed flex-col items-center justify-center gap-[3px] rounded-[14px] text-xs font-bold text-ink-4/60"
          >
            <NavIcon v-if="item.icon" :name="item.icon" />
            {{ t(item.labelKey) }}
          </span>
        </template>
      </div>
    </nav>
  </div>
  <FlashToasts />
</template>
