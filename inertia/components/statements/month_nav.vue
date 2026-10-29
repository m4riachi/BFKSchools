<script setup lang="ts">
/**
 * Month picker of the statement pages: previous / next arrows and a
 * select of the recent months. Every link is a plain GET (`?month=`); the
 * server validates the month and the window.
 */
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import { useI18n } from '~/composables/use_i18n'
import type { MonthNav } from '~/components/statements/types'

const props = defineProps<{
  nav: MonthNav
  /** Path of the page (query string built here). */
  path: string
  /** Other query parameters to keep (e.g. the selected child). */
  keep?: Record<string, string | number | null | undefined>
}>()

const { t } = useI18n()

function href(month: string) {
  const query = new URLSearchParams({ month })
  for (const [key, value] of Object.entries(props.keep ?? {})) {
    if (value !== null && value !== undefined && value !== '') query.set(key, String(value))
  }
  return `${props.path}?${query}`
}

function pick(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value) router.get(href(value), {}, { preserveScroll: true })
}

const arrow =
  'flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink-2 no-underline hover:bg-subtle'
</script>

<template>
  <div class="flex items-center gap-2">
    <Link
      v-if="nav.previous"
      :href="href(nav.previous)"
      :class="arrow"
      :aria-label="t('statements.previous_month')"
      :title="t('statements.previous_month')"
    >
      <span aria-hidden="true">‹</span>
    </Link>
    <span v-else :class="[arrow, 'opacity-40']" aria-hidden="true">‹</span>
    <label class="sr-only" for="statement-month">{{ t('statements.month') }}</label>
    <select
      id="statement-month"
      class="h-11 min-w-0 flex-1 rounded-xl border border-line-input bg-surface px-3 text-[15px] font-bold first-letter:uppercase"
      :value="nav.value"
      @change="pick"
    >
      <option v-for="choice in nav.choices" :key="choice.value" :value="choice.value">
        {{ choice.label }}
      </option>
    </select>
    <Link
      v-if="nav.next"
      :href="href(nav.next)"
      :class="arrow"
      :aria-label="t('statements.next_month')"
      :title="t('statements.next_month')"
    >
      <span aria-hidden="true">›</span>
    </Link>
    <span v-else :class="[arrow, 'opacity-40']" aria-hidden="true">›</span>
  </div>
</template>
