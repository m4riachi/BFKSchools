<script setup lang="ts">
/**
 * Kitchen — Excel / CSV exports. The form only builds the download URL;
 * the server validates the period (≤ limits.days), the filters and the row
 * cap, and escapes every text cell (formula injection).
 */
import { computed, reactive, ref } from 'vue'
import { usePage } from '@inertiajs/vue3'
import KitchenLayout from '~/layouts/kitchen_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import SelectInput from '~/components/ui/select_input.vue'
import TextInput from '~/components/ui/text_input.vue'
import { router } from '@inertiajs/vue3'
import AppButton from '~/components/ui/app_button.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import { useI18n } from '~/composables/use_i18n'
import { useFeatures } from '~/composables/use_features'

const props = defineProps<{
  printer: {
    mode: 'off' | 'direct' | 'agent'
    jobs: {
      id: number
      date: string
      className: string | null
      status: 'queued' | 'printing' | 'done' | 'failed'
      ticketsCount: number
      error: string | null
      at: string
    }[]
  }
  today: string
  classes: string[]
  mealTypes: string[]
  limits: { days: number; rows: number; pdfRows: number }
  withAmounts: boolean
  enabled: boolean
}>()

const { t } = useI18n()
const JOB_TONES = {
  queued: 'info',
  printing: 'warning',
  done: 'brand',
  failed: 'danger',
} as const
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
  format: 'xlsx' as 'xlsx' | 'csv' | 'pdf',
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

/** D49: order tickets PDF (one per active order of the day, 3 or 4 per row). */
const tickets = reactive({
  date: initialDate,
  className: '',
  cols: '3' as '3' | '4',
  format: 'a4' as 'a4' | 'roll',
})
/** D50: print on the kitchen's receipt printer (direct or through the agent). */
const printing = ref(false)
function printTickets() {
  router.post(
    '/kitchen/exports/tickets/print',
    { date: tickets.date, ...(tickets.className ? { className: tickets.className } : {}) },
    {
      preserveScroll: true,
      onStart: () => (printing.value = true),
      onFinish: () => (printing.value = false),
    }
  )
}
const ticketsHref = computed(() => {
  const params = new URLSearchParams({ date: tickets.date, format: tickets.format })
  if (tickets.format === 'a4') params.set('cols', tickets.cols)
  if (tickets.className) params.set('className', tickets.className)
  return `/kitchen/exports/tickets?${params}`
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
            { value: 'pdf', label: t('reports.exports.formats.pdf') },
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
          <span v-if="form.format === 'pdf'">{{
            t('reports.exports.pdf_limit', { rows: limits.pdfRows })
          }}</span>
          <span>{{
            withAmounts ? t('reports.exports.amounts_note') : t('reports.exports.no_amounts_note')
          }}</span>
        </div>
      </div>
    </section>

    <!-- D49: order tickets to hand out with the trays -->
    <section v-if="enabled" class="card flex flex-col gap-5 p-5">
      <div class="flex flex-col gap-1">
        <h2 class="text-lg font-bold">{{ t('reports.tickets.title') }}</h2>
        <p class="text-[13px] text-ink-4">{{ t('reports.tickets.description') }}</p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextInput
          id="tickets_date"
          v-model="tickets.date"
          type="date"
          :label="t('reports.exports.date')"
        />
        <SelectInput
          v-if="features.className"
          id="tickets_class"
          v-model="tickets.className"
          :label="t('reports.exports.class')"
          :options="[
            { value: '', label: t('reports.exports.all_classes') },
            ...classes.map((c) => ({ value: c, label: c })),
          ]"
        />
        <SelectInput
          id="tickets_format"
          v-model="tickets.format"
          :label="t('reports.tickets.format')"
          :options="[
            { value: 'a4', label: t('reports.tickets.formats.a4') },
            { value: 'roll', label: t('reports.tickets.formats.roll') },
          ]"
        />
        <SelectInput
          v-if="tickets.format === 'a4'"
          id="tickets_cols"
          v-model="tickets.cols"
          :label="t('reports.tickets.per_row')"
          :options="[
            { value: '3', label: t('reports.tickets.per_row_count', { count: 3 }) },
            { value: '4', label: t('reports.tickets.per_row_count', { count: 4 }) },
          ]"
        />
      </div>
      <div class="flex flex-wrap items-center gap-4">
        <a
          :href="ticketsHref"
          class="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-[18px] text-sm font-bold text-white no-underline hover:bg-brand-strong hover:text-white"
        >
          {{ t('reports.tickets.download') }}
        </a>
        <AppButton
          v-if="printer.mode !== 'off'"
          variant="secondary"
          :loading="printing"
          @click="printTickets"
        >
          🖨 {{ t('reports.tickets.print_button') }}
        </AppButton>
        <div class="flex flex-col gap-0.5 text-xs text-ink-4">
          <span v-if="tickets.format === 'roll'">{{ t('reports.tickets.roll_note') }}</span>
          <span>{{
            withAmounts ? t('reports.tickets.amounts_note') : t('reports.tickets.no_amounts_note')
          }}</span>
        </div>
      </div>
      <div v-if="printer.mode !== 'off' && printer.jobs.length" class="flex flex-col gap-1.5">
        <span class="text-[13px] font-bold">{{ t('reports.tickets.jobs') }}</span>
        <ul class="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
          <li v-for="job in printer.jobs" :key="job.id" class="flex flex-wrap items-center gap-2">
            <StatusBadge :tone="JOB_TONES[job.status]">
              {{ t(`reports.tickets.statuses.${job.status}`) }}
            </StatusBadge>
            <span
              >{{ job.date }}<template v-if="job.className"> · {{ job.className }}</template></span
            >
            <span class="text-ink-4">
              {{ t('reports.tickets.job_count', { count: job.ticketsCount }) }} · {{ job.at }}
            </span>
            <span v-if="job.error" class="text-danger">{{ job.error }}</span>
          </li>
        </ul>
      </div>
    </section>
  </KitchenLayout>
</template>
