<script setup lang="ts">
/**
 * FR/EN switcher. Posts to /locale: saved on the user when logged in, and in
 * a cookie for guests. `compact` shows a single button with the other locale.
 */
import { router } from '@inertiajs/vue3'
import { useI18n } from '~/composables/use_i18n'

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const { t, locale } = useI18n()
const locales = ['fr', 'en'] as const

function switchTo(next: (typeof locales)[number]) {
  if (next === locale.value) return
  router.post('/locale', { locale: next }, { preserveScroll: true })
}
</script>

<template>
  <button
    v-if="compact"
    type="button"
    class="h-11 min-w-11 rounded-xl border border-line bg-surface px-2 text-[13px] font-extrabold text-ink-2 uppercase hover:bg-subtle"
    :aria-label="`${t('app.language')}: ${locale === 'fr' ? 'English' : 'Français'}`"
    @click="switchTo(locale === 'fr' ? 'en' : 'fr')"
  >
    {{ locale === 'fr' ? 'EN' : 'FR' }}
  </button>
  <div
    v-else
    role="group"
    :aria-label="t('app.language')"
    class="flex gap-0.5 rounded-[10px] bg-muted-bg p-[3px]"
  >
    <button
      v-for="code in locales"
      :key="code"
      type="button"
      :aria-pressed="locale === code"
      class="min-h-9 min-w-12 rounded-sm text-[13px] font-bold uppercase"
      :class="locale === code ? 'bg-surface text-ink shadow-pressed' : 'text-ink-3 hover:text-ink'"
      @click="switchTo(code)"
    >
      {{ code }}
    </button>
  </div>
</template>
