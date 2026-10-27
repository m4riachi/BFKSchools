<script setup lang="ts">
/**
 * Kitchen layout: top bar with the kitchen sections; staff also get a link
 * back to the back-office.
 */
import { computed } from 'vue'
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

const nav: NavItem[] = [
  { labelKey: 'nav.production', href: '/kitchen', exact: true },
  { labelKey: 'nav.allergies', href: null },
  { labelKey: 'nav.labels', href: null },
  { labelKey: 'nav.exports', href: null },
]

const user = computed(() => page.props.user)
const isStaff = computed(() => user.value?.role === 'admin' || user.value?.role === 'manager')
</script>

<template>
  <div class="min-h-dvh bg-canvas">
    <header
      class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line bg-surface px-4 py-3 sm:px-8"
    >
      <div class="flex flex-wrap items-center gap-x-7 gap-y-3">
        <div class="flex items-center gap-3">
          <BrandMark />
          <div class="flex flex-col gap-px">
            <span class="text-[15px] font-extrabold">{{ t('app.kitchen') }}</span>
            <span class="text-xs text-ink-4">{{ t('app.school_name') }}</span>
          </div>
        </div>
        <nav :aria-label="t('nav.kitchen_nav')" class="flex flex-wrap gap-1">
          <template v-for="item in nav" :key="item.labelKey">
            <Link
              v-if="item.href"
              :href="item.href"
              :aria-current="isActive(item) ? 'page' : undefined"
              class="flex min-h-10 items-center rounded-[10px] px-3.5 text-sm no-underline"
              :class="
                isActive(item)
                  ? 'bg-brand-soft font-bold text-brand-strong'
                  : 'font-semibold text-ink-2 hover:bg-subtle hover:text-ink'
              "
            >
              {{ t(item.labelKey) }}
            </Link>
            <span
              v-else
              aria-disabled="true"
              :title="t('app.coming_soon')"
              class="flex min-h-10 cursor-not-allowed items-center rounded-[10px] px-3.5 text-sm font-semibold text-ink-4/70"
            >
              {{ t(item.labelKey) }}
            </span>
          </template>
        </nav>
      </div>

      <div class="flex items-center gap-4">
        <Link v-if="isStaff" href="/admin" class="text-[13px] font-bold no-underline">
          {{ t('app.back_office') }}
        </Link>
        <div v-if="user" class="flex items-center gap-2.5">
          <UserAvatar :initials="user.initials" tone="warning" />
          <div class="hidden flex-col gap-px sm:flex">
            <span class="text-sm font-semibold">{{ user.fullName }}</span>
            <span class="text-xs text-ink-4">{{ t(`roles.${user.role}`) }}</span>
          </div>
          <Link
            href="/logout"
            method="post"
            as="button"
            class="flex size-10 items-center justify-center rounded-[10px] text-ink-3 hover:bg-subtle hover:text-ink"
            :aria-label="t('app.logout')"
            :title="t('app.logout')"
          >
            <NavIcon name="logout" />
          </Link>
        </div>
      </div>
    </header>

    <main class="mx-auto flex max-w-[1376px] flex-col gap-5 px-4 pt-7 pb-12 sm:px-8">
      <slot />
    </main>
  </div>
  <FlashToasts />
</template>
