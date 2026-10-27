<script setup lang="ts">
/**
 * Layout for the sign-in pages (mobile-first, centered column).
 */
import BrandMark from '~/components/ui/brand_mark.vue'
import LocaleSwitcher from '~/components/ui/locale_switcher.vue'
import { useI18n } from '~/composables/use_i18n'

const { t } = useI18n()
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col gap-6 px-5 pt-5 pb-6">
    <div class="flex justify-end">
      <LocaleSwitcher />
    </div>

    <div class="flex flex-col items-center gap-3 pt-2 text-center">
      <BrandMark size="lg" />
      <div class="flex flex-col gap-1">
        <span class="text-xl font-extrabold tracking-[-0.01em]">{{ t('app.name') }}</span>
        <span class="text-sm text-ink-3">{{ t('app.tagline') }}</span>
      </div>
    </div>

    <slot />
  </div>
</template>
