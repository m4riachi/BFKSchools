<script setup lang="ts" generic="Row extends Record<string, unknown>">
/**
 * Table with the design's header style, row dividers, an empty state and
 * optional pagination. Customize a cell with a `#cell-<key>` slot.
 */
import EmptyState from '~/components/ui/empty_state.vue'
import PaginationNav, { type PaginationMeta } from '~/components/ui/pagination_nav.vue'
import { useI18n } from '~/composables/use_i18n'

export type TableColumn = { key: string; label: string; align?: 'left' | 'right' | 'center' }

withDefaults(
  defineProps<{
    columns: TableColumn[]
    rows: Row[]
    rowKey?: string
    meta?: PaginationMeta
    caption?: string
    emptyTitle?: string
    emptyDescription?: string
  }>(),
  {
    rowKey: 'id',
    meta: undefined,
    caption: undefined,
    emptyTitle: undefined,
    emptyDescription: undefined,
  }
)

const { t } = useI18n()

const alignClass = (align?: TableColumn['align']) =>
  align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-sm">
        <caption v-if="caption" class="sr-only">
          {{
            caption
          }}
        </caption>
        <thead>
          <tr class="border-b border-line">
            <th
              v-for="column in columns"
              :key="column.key"
              scope="col"
              class="px-3 py-2.5 text-xs font-bold tracking-[0.04em] whitespace-nowrap text-ink-4 uppercase"
              :class="alignClass(column.align)"
            >
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody v-if="rows.length" class="tabular">
          <tr
            v-for="(row, index) in rows"
            :key="String(row[rowKey] ?? index)"
            class="border-b border-line-soft last:border-b-0"
          >
            <td
              v-for="column in columns"
              :key="column.key"
              class="p-3"
              :class="alignClass(column.align)"
            >
              <slot :name="`cell-${column.key}`" :row="row" :value="row[column.key]">
                {{ row[column.key] }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <EmptyState
      v-if="!rows.length"
      :title="emptyTitle ?? t('ui.empty_title')"
      :description="emptyDescription ?? t('ui.empty_body')"
    />
    <PaginationNav v-if="meta && rows.length" :meta="meta" />
  </div>
</template>
