<script setup lang="ts">
/**
 * Production sheet table: one row per dish (main dishes, then extras),
 * one column per grade or per class, totals per section. Numbers come from
 * the server (ProductionReportService); this only lays them out.
 */
import { computed } from 'vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import { useI18n } from '~/composables/use_i18n'
import type { ProductionView } from '~/components/reports/types'

const props = defineProps<{ sheet: ProductionView; groupBy: 'grade' | 'class' }>()
const { t } = useI18n()

const columns = computed(() =>
  props.groupBy === 'grade'
    ? props.sheet.grades.map((key) => ({ key, label: key || t('reports.common.none') }))
    : props.sheet.classes.map((entry) => ({
        key: entry.className,
        label: entry.className || t('reports.common.none'),
      }))
)
const field = computed<'byGrade' | 'byClass'>(() =>
  props.groupBy === 'grade' ? 'byGrade' : 'byClass'
)

const sections = computed(() =>
  (['subscription', 'supplement'] as const)
    .map((type) => ({
      type,
      title: t(`reports.production.${type}_section`),
      totalLabel: t(`reports.production.total_${type}`),
      lines: props.sheet.lines.filter((line) => line.mealType === type),
      totals: props.sheet.totals[type],
    }))
    .filter((section) => section.lines.length)
)
</script>

<template>
  <div class="overflow-x-auto">
    <table class="print-table w-full min-w-[560px] text-left text-sm">
      <thead class="text-xs font-bold text-ink-4 uppercase">
        <tr class="border-b border-line">
          <th scope="col" class="px-4 py-3">{{ t('reports.production.meal') }}</th>
          <th
            v-for="column in columns"
            :key="column.key"
            scope="col"
            class="px-3 py-3 text-right whitespace-nowrap"
          >
            {{ column.label }}
          </th>
          <th scope="col" class="px-4 py-3 text-right">{{ t('reports.common.total') }}</th>
        </tr>
      </thead>
      <tbody v-for="section in sections" :key="section.type">
        <tr class="bg-subtle">
          <th
            :colspan="columns.length + 2"
            scope="colgroup"
            class="px-4 py-2 text-xs font-bold tracking-wide text-ink-3 uppercase"
          >
            {{ section.title }}
          </th>
        </tr>
        <tr
          v-for="line in section.lines"
          :key="`${line.mealType}-${line.mealId}`"
          class="border-b border-line-soft"
        >
          <th scope="row" class="px-4 py-2.5 font-semibold">
            <span>{{ line.name }}</span>
            <span
              v-if="line.allergens.length"
              class="ml-2 inline-flex flex-wrap gap-1 align-middle"
            >
              <StatusBadge v-for="a in line.allergens" :key="a.code" tone="warning">{{
                a.label
              }}</StatusBadge>
            </span>
          </th>
          <td
            v-for="column in columns"
            :key="column.key"
            class="tabular px-3 py-2.5 text-right text-ink-2"
          >
            {{ line[field][column.key] ?? '' }}
          </td>
          <td class="tabular px-4 py-2.5 text-right text-base font-extrabold">{{ line.total }}</td>
        </tr>
        <tr class="border-b border-line">
          <th scope="row" class="px-4 py-2.5 text-xs font-bold text-ink-3 uppercase">
            {{ section.totalLabel }}
          </th>
          <td
            v-for="column in columns"
            :key="column.key"
            class="tabular px-3 py-2.5 text-right font-bold"
          >
            {{ section.totals[field][column.key] ?? 0 }}
          </td>
          <td class="tabular px-4 py-2.5 text-right text-base font-extrabold text-brand-strong">
            {{ section.totals.total }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
