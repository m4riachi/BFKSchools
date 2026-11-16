<script setup lang="ts">
/**
 * Layout for the sign-in pages (mobile-first, centered column).
 */
import BrandMark from '~/components/ui/brand_mark.vue'
import InstallButton from '~/components/ui/install_button.vue'
import LocaleSwitcher from '~/components/ui/locale_switcher.vue'
import { useI18n } from '~/composables/use_i18n'

const { t } = useI18n()
const academyLogoUrl = '/logo-academy.png'
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col gap-6 px-5 pt-5 pb-6">
    <div class="flex items-center justify-end gap-2">
      <InstallButton />
      <LocaleSwitcher />
    </div>

    <div class="flex flex-col items-center gap-3 pt-2 text-center">
      <!-- Beldi Fusion Kitchen on the left, the school on the right. -->
      <div class="flex w-full items-center justify-between gap-4">
        <span class="flex min-w-0 flex-1 justify-start">
          <BrandMark size="lg" class="max-w-full" />
        </span>
        <span class="flex min-w-0 flex-1 justify-end">
          <img
            :src="academyLogoUrl"
            :alt="t('app.academy_name')"
            width="631"
            height="160"
            class="h-auto max-h-16 w-full object-contain object-right"
          />
        </span>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-xl font-extrabold tracking-[-0.01em]">{{ t('app.name') }}</span>
        <span class="text-sm text-ink-3">{{ t('app.tagline') }}</span>
      </div>
    </div>

    <slot />
  </div>
</template>
