<script setup lang="ts">
import { Head } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import BrandMark from '~/components/ui/brand_mark.vue'
import { useI18n } from '~/composables/use_i18n'

const { t } = useI18n()
</script>

<template>
  <Head :title="t('errors.not_found.title')" />
  <div
    class="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-5 text-center"
  >
    <BrandMark size="lg" />
    <h1 class="text-2xl font-extrabold tracking-[-0.02em]">{{ t('errors.not_found.title') }}</h1>
    <p class="text-sm text-ink-3">{{ t('errors.not_found.body') }}</p>
    <Link href="/" class="text-sm font-bold no-underline">{{ t('errors.back_home') }}</Link>
  </div>
</template>
