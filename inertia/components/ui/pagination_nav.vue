<script setup lang="ts">
/**
 * Pagination for Lucid paginators (`paginator.getMeta()` / serialized meta).
 * Links keep the current query string and only change `page`.
 */
import { computed } from 'vue'
import { usePage } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import { useI18n } from '~/composables/use_i18n'

export type PaginationMeta = {
  total: number
  perPage: number
  currentPage: number
  lastPage: number
}

const props = defineProps<{ meta: PaginationMeta }>()
const page = usePage()
const { t } = useI18n()

function hrefFor(target: number) {
  const url = new URL(page.url, 'http://localhost')
  url.searchParams.set('page', String(target))
  return `${url.pathname}${url.search}`
}

const from = computed(() =>
  props.meta.total === 0 ? 0 : (props.meta.currentPage - 1) * props.meta.perPage + 1
)
const to = computed(() => Math.min(props.meta.currentPage * props.meta.perPage, props.meta.total))

/** Up to 7 page numbers around the current page. */
const pages = computed(() => {
  const { currentPage, lastPage } = props.meta
  const start = Math.max(1, Math.min(currentPage - 3, lastPage - 6))
  const end = Math.min(lastPage, start + 6)
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
})

const itemClass =
  'flex h-9 min-w-9 items-center justify-center rounded-[10px] px-3 text-[13px] font-bold no-underline'
</script>

<template>
  <nav
    v-if="meta.lastPage > 1 || meta.total > 0"
    :aria-label="t('ui.pagination.label')"
    class="flex flex-wrap items-center justify-between gap-3"
  >
    <span class="text-[13px] text-ink-4 tabular">
      {{ t('ui.pagination.summary', { from, to, total: meta.total }) }}
    </span>
    <div v-if="meta.lastPage > 1" class="flex flex-wrap items-center gap-1">
      <Link
        v-if="meta.currentPage > 1"
        :href="hrefFor(meta.currentPage - 1)"
        :class="[itemClass, 'text-ink-2 hover:bg-subtle']"
        preserve-scroll
      >
        {{ t('ui.pagination.previous') }}
      </Link>
      <Link
        v-for="n in pages"
        :key="n"
        :href="hrefFor(n)"
        :aria-current="n === meta.currentPage ? 'page' : undefined"
        :aria-label="t('ui.pagination.page', { page: n })"
        :class="[
          itemClass,
          'tabular',
          n === meta.currentPage ? 'bg-brand-soft text-brand-strong' : 'text-ink-2 hover:bg-subtle',
        ]"
        preserve-scroll
      >
        {{ n }}
      </Link>
      <Link
        v-if="meta.currentPage < meta.lastPage"
        :href="hrefFor(meta.currentPage + 1)"
        :class="[itemClass, 'text-ink-2 hover:bg-subtle']"
        preserve-scroll
      >
        {{ t('ui.pagination.next') }}
      </Link>
    </div>
  </nav>
</template>
