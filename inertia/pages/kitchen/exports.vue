<script setup lang="ts">
/**
 * Kitchen — Excel / CSV exports. The form only builds the download URL;
 * the server validates the period (≤ limits.days), the filters and the row
 * cap, and escapes every text cell (formula injection).
 */
import { computed, reactive } from 'vue'
import { usePage } from '@inertiajs/vue3'
import KitchenLayout from '~/layouts/kitchen_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import SelectInput from '~/components/ui/select_input.vue'
import TextInput from '~/components/ui/text_input.vue'
import { useI18n } from '~/composables/use_i18n'
import { useFeatures } from '~/composables/use_features'

const props = defineProps<{
  today: string
  classes: string[]
  mealTypes: string[]
  limits: { days: number; rows: number }
  withAmounts: boolean
  enabled: boolean
}>()

const { t } = useI18n()
const features = useFeatures()
const page = usePage()
const initialDate = (() => {
  const match = /[?&]date=(\d{4}-\d{2}-\d{2})/.exec(page.url)
  return match ? match[1] : props.today
})()

const form = reactive({
  period: 'day' as 'day' | 'week' | 'month' | 'custom',
  date: initialDate,
  from: initialDate,
  to: initialDate,
  className: '',
  mealType: '',
  kind: 'detail' as 'detail' | 'summary',
  format: 'xlsx' as 'xlsx' | 'csv',
})

const href = computed(() => {
  const params = new URLSearchParams({ period: form.period, kind: form.kind, format: form.format })
  if (form.period === 'custom') {
    params.set('from', form.from)
    params.set('to', form.to)
  } else {
    params.set('date', form.date)
  }
  if (form.className) params.set('className', form.className)
  if (form.mealType) params.set('mealType', form.mealType)
  return `/kitchen/exports/download?${params}`
})

const periods = computed(() =>
  (['day', 'week', 'month', 'custom'] as const).map((value) => ({
    value,
    label: t(`reports.exports.periods.${value}`),
  }))
)
</script>

<template>
  <KitchenLayout>
    <PageHeader
      :title="t('reports.exports.title')"
      :description="t('reports.exports.description')"
    />

    <section v-if="!enabled" class="card">
      <EmptyState
        :title="t('reports.common.no_school_title')"
        :description="t('reports.common.no_school_body')"
      />
    </section>

    <section v-else class="card flex flex-col gap-5 p-5">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SelectInput
          id="period"
          v-model="form.period"
          :label="t('reports.exports.period')"
          :options="periods"
        />
        <template v-if="form.period === 'custom'">
          <TextInput id="from" v-model="form.from" type="date" :label="t('reports.exports.from')" />
          <TextInput id="to" v-model="form.to" type="date" :label="t('reports.exports.to')" />
        </template>
        <TextInput
          v-else
          id="date"
          v-model="form.date"
          type="date"
          :label="t('reports.exports.date')"
        />
      </div>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SelectInput
          v-if="features.className"
          id="className"
          v-model="form.className"
          :label="t('reports.exports.class')"
          :options="[
            { value: '', label: t('reports.exports.all_classes') },
            ...classes.map((c) => ({ value: c, label: c })),
          ]"
        />
        <SelectInput
          id="mealType"
          v-model="form.mealType"
          :label="t('reports.exports.meal_type')"
          :options="[
            { value: '', label: t('reports.exports.all_types') },
            ...mealTypes.map((type) => ({ value: type, label: t(`meals.types.${type}`) })),
          ]"
        />
        <SelectInput
          id="kind"
          v-model="form.kind"
          :label="t('reports.exports.kind')"
          :options="[
            { value: 'detail', label: t('reports.exports.kinds.detail') },
            { value: 'summary', label: t('reports.exports.kinds.summary') },
          ]"
        />
        <SelectInput
          id="format"
          v-model="form.format"
          :label="t('reports.exports.format')"
          :options="[
            { value: 'xlsx', label: t('reports.exports.formats.xlsx') },
            { value: 'csv', label: t('reports.exports.formats.csv') },
          ]"
        />
      </div>
      <div class="flex flex-wrap items-center gap-4">
        <a
          :href="href"
          class="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-[18px] text-sm font-bold text-white no-underline hover:bg-brand-strong hover:text-white"
        >
          {{ t('reports.exports.download') }}
        </a>
        <div class="flex flex-col gap-0.5 text-xs text-ink-4">
          <span>{{ t('reports.exports.limits', limits) }}</span>
          <span>{{
            withAmounts ? t('reports.exports.amounts_note') : t('reports.exports.no_amounts_note')
          }}</span>
        </div>
      </div>
    </section>
  </KitchenLayout>
</template>
