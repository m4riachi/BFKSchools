<script setup lang="ts">
/**
 * Kitchen — labels: count for the day (optionally one class), A4 grid,
 * an on-screen preview and the PDF download (generated server-side).
 */
import { computed, reactive, watch } from 'vue'
import { router } from '@inertiajs/vue3'
import KitchenLayout from '~/layouts/kitchen_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import SelectInput from '~/components/ui/select_input.vue'
import TextInput from '~/components/ui/text_input.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import DayNav from '~/components/reports/day_nav.vue'
import { useI18n } from '~/composables/use_i18n'
import { useFeatures } from '~/composables/use_features'
import type { LabelView } from '~/components/reports/types'

const props = defineProps<{
  date: string
  today: string
  previous: string
  next: string
  className: string | null
  classes: string[]
  count: number
  grid: { cols: number; rows: number }
  max: number
  preview: LabelView[]
}>()

const { t, formatDate } = useI18n()
const features = useFeatures()
const form = reactive({
  className: props.className ?? '',
  cols: props.grid.cols,
  rows: props.grid.rows,
})
watch(
  () => [props.className, props.grid] as const,
  ([className, grid]) => Object.assign(form, { className: className ?? '', ...grid })
)

const nav = computed(() => ({
  date: props.date,
  today: props.today,
  previous: props.previous,
  next: props.next,
}))
const query = computed(() => {
  const value: Record<string, string> = {}
  if (props.className) value.className = props.className
  return value
})

function clamp(value: number, min: number, max: number) {
  const number = Math.trunc(Number(value))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min
}

const pdfHref = computed(() => {
  const params = new URLSearchParams({
    date: props.date,
    cols: String(clamp(form.cols, 1, 6)),
    rows: String(clamp(form.rows, 1, 20)),
  })
  if (form.className) params.set('className', form.className)
  return `/kitchen/labels/pdf?${params}`
})

function changeClass() {
  router.get('/kitchen/labels', {
    date: props.date,
    ...(form.className ? { className: form.className } : {}),
  })
}

const perPage = computed(() => clamp(form.cols, 1, 6) * clamp(form.rows, 1, 20))
const dateLabel = computed(() =>
  formatDate(props.date, { weekday: 'short', day: 'numeric', month: 'short' })
)
</script>

<template>
  <KitchenLayout>
    <PageHeader
      :title="t('reports.labels.title')"
      :eyebrow="
        formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      "
      :description="t('reports.labels.description')"
    >
      <template #actions>
        <DayNav path="/kitchen/labels" :nav="nav" :query="query" :printable="false" />
      </template>
    </PageHeader>

    <section class="card flex flex-wrap items-end gap-4 p-4">
      <SelectInput
        v-if="features.className"
        id="className"
        v-model="form.className"
        :label="t('reports.labels.class_filter')"
        :options="[
          { value: '', label: t('reports.labels.all_classes') },
          ...classes.map((c) => ({ value: c, label: c })),
        ]"
        @change="changeClass"
      />
      <div class="w-24">
        <TextInput
          id="cols"
          v-model.number="form.cols"
          type="number"
          :label="t('reports.labels.cols')"
        />
      </div>
      <div class="w-24">
        <TextInput
          id="rows"
          v-model.number="form.rows"
          type="number"
          :label="t('reports.labels.rows')"
        />
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-lg font-extrabold">{{ t('reports.labels.count', { count }) }}</span>
        <span class="text-xs text-ink-4">{{
          t('reports.labels.grid', { cols: form.cols, rows: form.rows, per: perPage })
        }}</span>
      </div>
      <a
        v-if="count > 0 && count <= max"
        :href="pdfHref"
        class="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-[18px] text-sm font-bold text-white no-underline hover:bg-brand-strong hover:text-white"
      >
        {{ t('reports.labels.download') }}
      </a>
      <p v-else-if="count > max" class="text-sm font-semibold text-danger" role="alert">
        {{ t('reports.labels.too_many', { max }) }}
      </p>
      <p class="w-full text-xs text-ink-4">{{ t('reports.labels.grid_hint') }}</p>
    </section>

    <section class="card flex flex-col gap-4 p-4">
      <h2 class="text-base font-bold">{{ t('reports.labels.preview_title') }}</h2>
      <EmptyState v-if="!preview.length" :title="t('reports.labels.none')" tone="info" />
      <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="label in preview"
          :key="label.orderId"
          class="flex min-h-[132px] flex-col gap-1 rounded-xl border border-dashed border-line-strong p-3"
        >
          <span class="text-[15px] font-extrabold" dir="auto">{{ label.name }}</span>
          <span class="text-xs text-ink-4">
            {{ [label.className, label.grade, dateLabel].filter(Boolean).join(' · ') }}
          </span>
          <span
            v-for="line in label.lines"
            :key="`${line.mealType}-${line.mealId}`"
            class="text-[13px]"
            :class="[
              line.mealType === 'subscription' ? 'font-bold' : 'text-ink-2',
              line.conflicts.length ? 'text-danger' : '',
            ]"
            dir="auto"
          >
            {{ line.mealType === 'supplement' ? '+ ' : '' }}{{ line.name
            }}<template v-if="line.quantity > 1"> ×{{ line.quantity }}</template>
          </span>
          <StatusBadge v-if="label.allergies.length" tone="danger" solid class="mt-auto self-start">
            {{
              (label.hasConflict
                ? t('reports.labels.pdf_conflict', {
                    allergens: label.lines
                      .flatMap((line) => line.conflicts.map((c) => c.label))
                      .join(', '),
                  })
                : t('reports.labels.pdf_allergies', {
                    allergens: label.allergies.map((a) => a.label).join(', '),
                  })
              ).toLocaleUpperCase()
            }}
          </StatusBadge>
        </article>
      </div>
      <p v-if="count > preview.length" class="text-sm text-ink-3">
        {{ t('reports.labels.preview_more', { count: count - preview.length }) }}
      </p>
    </section>
  </KitchenLayout>
</template>
