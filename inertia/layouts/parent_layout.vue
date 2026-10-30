<script setup lang="ts">
/**
 * Parent portal layout — mobile-first: compact header with the language
 * switcher, content column, and a bottom navigation bar.
 */
import { computed, onBeforeUnmount } from 'vue'
import { usePage } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import BrandMark from '~/components/ui/brand_mark.vue'
import NavIcon from '~/components/ui/nav_icon.vue'
import InstallButton from '~/components/ui/install_button.vue'
import WhatsappButton from '~/components/ui/whatsapp_button.vue'
import LocaleSwitcher from '~/components/ui/locale_switcher.vue'
import FlashToasts from '~/components/ui/flash_toasts.vue'
import { useI18n } from '~/composables/use_i18n'
import { useActiveNav, type NavItem } from '~/composables/use_nav'

const { t } = useI18n()
const { isActive } = useActiveNav()
const page = usePage()

// On <body>: the page background, dialogs and toasts sit outside this layout.
if (typeof document !== 'undefined') document.body.classList.add('theme-academy')
onBeforeUnmount(() => document.body.classList.remove('theme-academy'))

// Bound on purpose: Vite would resolve a literal `src` as a module import.
const academyLogoUrl = '/logo-academy.png'

/** Unread notifications (shared by the server for parents on every page). */
const unread = computed(() => Number(page.props.unreadNotifications ?? 0))
const bellActive = computed(() => page.url.split('?')[0] === '/notifications')

const nav: NavItem[] = [
  { labelKey: 'nav.parent_orders', href: '/', icon: 'meals', exact: true },
  { labelKey: 'nav.parent_history', href: '/orders/history', icon: 'history' },
  { labelKey: 'nav.parent_statements', href: '/statements', icon: 'statements' },
  { labelKey: 'nav.parent_account', href: '/account', icon: 'account' },
]
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
    <header>
      <div class="flex items-center justify-end gap-2 bg-brand px-4 py-2 text-white">
        <div class="flex shrink-0 gap-1.5">
          <LocaleSwitcher compact />
          <Link
            href="/notifications"
            class="relative flex size-11 items-center justify-center rounded-xl border text-white hover:bg-white/10 hover:text-white"
            :class="bellActive ? 'border-white bg-white/15' : 'border-white/30'"
            :aria-label="t('notifications.bell', { count: unread })"
            :title="t('notifications.bell', { count: unread })"
            :aria-current="bellActive ? 'page' : undefined"
          >
            <NavIcon name="bell" />
            <span
              v-if="unread > 0"
              aria-hidden="true"
              class="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-brand bg-accent px-1 text-[10px] leading-none font-extrabold text-white"
              >{{ unread > 99 ? '99+' : unread }}</span
            >
          </Link>
          <Link
            route="session.destroy"
            as="button"
            class="flex size-11 items-center justify-center rounded-xl border border-white/30 text-white hover:bg-white/10"
            :aria-label="t('app.logout')"
            :title="t('app.logout')"
          >
            <NavIcon name="logout" />
          </Link>
        </div>
      </div>
      <div
        class="flex items-center justify-between gap-4 border-b border-line bg-surface px-4 py-2"
      >
        <BrandMark size="sm" />
        <img
          :src="academyLogoUrl"
          :alt="t('app.academy_name')"
          width="631"
          height="160"
          class="h-10 w-auto min-w-0 object-contain"
        />
      </div>
    </header>

    <main class="flex flex-1 flex-col gap-4 px-4 pt-4 pb-6">
      <slot />
    </main>

    <nav
      :aria-label="t('nav.parent_nav')"
      class="sticky bottom-0 z-20 px-4 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]"
    >
      <div class="mb-2 flex items-center justify-end gap-2 empty:hidden">
        <InstallButton variant="pill" />
        <WhatsappButton />
      </div>
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
