<script setup lang="ts">
/** Kitchen — daily production sheet (quantities per dish, by grade or class). Read-only. */
import { computed, ref } from 'vue'
import { Link } from '@adonisjs/inertia/vue'
import KitchenLayout from '~/layouts/kitchen_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import AppButton from '~/components/ui/app_button.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import DayNav from '~/components/reports/day_nav.vue'
import ProductionTable from '~/components/reports/production_table.vue'
import { useI18n } from '~/composables/use_i18n'
import { useFeatures } from '~/composables/use_features'
import type { DayInfo, ProductionView } from '~/components/reports/types'

const props = defineProps<{
  date: string
  today: string
  previous: string
  next: string
  sheet: ProductionView | null
  day: DayInfo | null
}>()

const { t, formatDate, formatDateTime } = useI18n()
const features = useFeatures()
const groupOptions = computed(() => [
  ...(features.value.grade ? (['grade'] as const) : []),
  ...(features.value.className ? (['class'] as const) : []),
])
const chosenGroup = ref<'grade' | 'class'>('grade')
// D33: only the enabled breakdowns; none = totals only.
const groupBy = computed(() =>
  groupOptions.value.includes(chosenGroup.value as never)
    ? chosenGroup.value
    : (groupOptions.value[0] ?? 'none')
)
const nav = computed(() => ({
  date: props.date,
  today: props.today,
  previous: props.previous,
  next: props.next,
}))
const title = computed(() =>
  formatDate(props.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
)
const notice = computed(() => {
  const day = props.day
  if (!day) return null
  if (day.holidayNames.length) {
    return {
      tone: 'warning',
      text: t('reports.common.holiday', { names: day.holidayNames.join(', ') }),
    }
  }
  if (!day.isSchoolDay) return { tone: 'neutral', text: t('reports.common.not_school_day') }
  if (!day.hasMenu) return { tone: 'neutral', text: t('reports.common.no_menu') }
  if (day.editableUntil) {
    return {
      tone: 'info',
      text: t('reports.common.editable_until', {
        when: formatDateTime(day.editableUntil, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        }),
      }),
    }
  }
  return { tone: 'brand', text: t('reports.common.final') }
})
const toneClass: Record<string, string> = {
  warning: 'border-warning/30 bg-warning-soft text-warning-ink',
  neutral: 'border-line bg-subtle text-ink-2',
  info: 'border-info-line bg-info-soft text-info',
  brand: 'border-brand/20 bg-brand-soft text-brand-strong',
}
const subscriptionTotal = computed(() => props.sheet?.totals.subscription.total ?? 0)
const supplementTotal = computed(() => props.sheet?.totals.supplement.total ?? 0)
</script>

<template>
  <KitchenLayout>
    <PageHeader :title="t('reports.production.title')" :eyebrow="title">
      <template #actions>
        <DayNav path="/kitchen" :nav="nav">
          <template v-if="sheet">
            <AppButton
              v-if="features.labels"
              variant="secondary"
              :href="`/kitchen/labels?date=${date}`"
            >
              {{ t('reports.production.labels_pdf') }}
            </AppButton>
            <AppButton variant="secondary" :href="`/kitchen/exports?date=${date}`">
              {{ t('reports.production.export') }}
            </AppButton>
          </template>
        </DayNav>
      </template>
    </PageHeader>

    <section v-if="!sheet" class="card">
      <EmptyState
        :title="t('reports.common.no_school_title')"
        :description="t('reports.common.no_school_body')"
      />
    </section>

    <template v-else>
      <p
        v-if="notice"
        class="rounded-xl border px-4 py-3 text-sm font-semibold"
        :class="toneClass[notice.tone]"
        role="status"
      >
        {{ notice.text }}
      </p>

      <div
        class="grid grid-cols-2 gap-3"
        :class="features.allergens ? 'lg:grid-cols-4' : 'lg:grid-cols-3'"
      >
        <div class="card flex flex-col gap-1 p-4">
          <span class="tabular text-[28px] font-extrabold">{{ subscriptionTotal }}</span>
          <span class="text-sm text-ink-3">{{
            t('reports.production.meals_to_serve', { count: subscriptionTotal })
          }}</span>
        </div>
        <div class="card flex flex-col gap-1 p-4">
          <span class="tabular text-[28px] font-extrabold">{{ supplementTotal }}</span>
          <span class="text-sm text-ink-3">{{
            t('reports.production.supplements', { count: supplementTotal })
          }}</span>
        </div>
        <Link
          v-if="features.allergens"
          :href="`/kitchen/allergies?date=${date}`"
          class="card flex flex-col gap-1 p-4 no-underline"
          :class="sheet.orders.withAllergies ? 'border-danger-line bg-danger-soft' : ''"
        >
          <span
            class="tabular text-[28px] font-extrabold"
            :class="sheet.orders.withAllergies ? 'text-danger' : 'text-ink'"
            >{{ sheet.orders.withAllergies }}</span
          >
          <span class="text-sm text-ink-3">{{
            t('reports.production.with_allergies', { count: sheet.orders.withAllergies })
          }}</span>
        </Link>
        <div class="card flex flex-col gap-1 p-4">
          <span class="tabular text-[28px] font-extrabold">{{ sheet.orders.absent }}</span>
          <span class="text-sm text-ink-3">{{
            t('reports.production.absent', { count: sheet.orders.absent })
          }}</span>
        </div>
      </div>

      <section class="card overflow-hidden">
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3"
        >
          <h2 class="text-base font-bold">{{ t('reports.production.table_title') }}</h2>
          <div
            v-if="groupOptions.length > 1"
            class="flex rounded-xl bg-subtle p-1 print:hidden"
            role="group"
            :aria-label="t('reports.common.breakdown')"
          >
            <button
              v-for="option in groupOptions"
              :key="option"
              type="button"
              class="h-9 rounded-[10px] px-3 text-[13px] font-bold"
              :class="option === groupBy ? 'bg-surface shadow-pressed' : 'text-ink-3'"
              :aria-pressed="option === groupBy"
              @click="chosenGroup = option"
            >
              {{ t(`reports.common.by_${option}`) }}
            </button>
          </div>
        </div>
        <EmptyState v-if="!sheet.lines.length" :title="t('reports.production.empty')" tone="info" />
        <ProductionTable v-else :sheet="sheet" :group-by="groupBy" />
      </section>
    </template>
  </KitchenLayout>
</template>
