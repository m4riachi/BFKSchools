<script setup lang="ts">
/**
 * Date picker of the kitchen sheets: previous / today / next day and a
 * date input (GET `path?date=`, plus any extra query such as the class).
 * Hidden when printing.
 */
import { ref, watch } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AppButton from '~/components/ui/app_button.vue'
import { useI18n } from '~/composables/use_i18n'
import type { DayNav } from '~/components/reports/types'

const props = withDefaults(
  defineProps<{ path: string; nav: DayNav; query?: Record<string, string>; printable?: boolean }>(),
  { query: () => ({}), printable: true }
)

const { t } = useI18n()
const value = ref(props.nav.date)
watch(
  () => props.nav.date,
  (date) => (value.value = date)
)

function href(date: string) {
  const params = new URLSearchParams({ ...props.query, date })
  return `${props.path}?${params}`
}

function go() {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.value))
    router.get(props.path, { ...props.query, date: value.value })
}

function print() {
  window.print()
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 print:hidden">
    <div class="flex items-center rounded-xl border border-line-strong bg-surface">
      <Link
        :href="href(nav.previous)"
        class="flex h-11 items-center px-3 text-ink-2 no-underline hover:text-ink"
        :aria-label="t('reports.common.previous_day')"
        :title="t('reports.common.previous_day')"
      >
        ‹
      </Link>
      <label class="sr-only" for="report-date">{{ t('reports.common.date') }}</label>
      <input
        id="report-date"
        v-model="value"
        type="date"
        class="h-11 border-x border-line bg-transparent px-2 text-sm font-semibold"
        @change="go"
      />
      <Link
        :href="href(nav.next)"
        class="flex h-11 items-center px-3 text-ink-2 no-underline hover:text-ink"
        :aria-label="t('reports.common.next_day')"
        :title="t('reports.common.next_day')"
      >
        ›
      </Link>
    </div>
    <AppButton v-if="nav.date !== nav.today" variant="secondary" :href="href(nav.today)">
      {{ t('reports.common.today') }}
    </AppButton>
    <AppButton v-if="printable" variant="secondary" @click="print">
      {{ t('reports.common.print') }}
    </AppButton>
    <slot />
  </div>
</template>
