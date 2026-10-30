<script setup lang="ts">
/**
 * Back-office reports (D38): revenue, extras, subscriptions and clicks on the
 * Glovo and home delivery buttons for a period. Every number comes from the server.
 */
import { computed, ref } from 'vue'
import { router } from '@inertiajs/vue3'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import AppButton from '~/components/ui/app_button.vue'
import TextInput from '~/components/ui/text_input.vue'
import StackedBarChart, { type ChartPoint } from '~/components/reports/stacked_bar_chart.vue'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  report: {
    from: string
    to: string
    revenue: string
    subscriptionMeals: number
    subscriptionAmount: string
    extras: number
    extrasAmount: string
    activeSubscriptions: number
    activeChildren: number
    links: {
      glovo: { clicks: number; parents: number }
      delivery: { clicks: number; parents: number }
    }
    topExtras: { id: number; name: string; quantity: number; amount: string; barPercent: number }[]
    chart: {
      byWeek: boolean
      points: {
        date: string
        subscriptionMeals: number
        extras: number
        subscriptionAmountCents: number
        extrasAmountCents: number
        subscriptionAmount: string
        extrasAmount: string
        total: string
        glovo: number
        delivery: number
      }[]
    }
    days: {
      date: string
      subscriptionMeals: number
      extras: number
      total: string
      glovo: number
      delivery: number
    }[]
  } | null
}>()

const { t, formatDate, locale } = useI18n()

const from = ref(props.report?.from ?? '')
const to = ref(props.report?.to ?? '')
function apply() {
  router.get(
    '/admin/reports',
    { from: from.value, to: to.value },
    {
      preserveScroll: true,
      onSuccess: () => {
        from.value = props.report?.from ?? ''
        to.value = props.report?.to ?? ''
      },
    }
  )
}

const shortDate = (iso: string) =>
  formatDate(iso, { weekday: 'short', day: 'numeric', month: 'short' })

const chartPoints = computed(() => props.report?.chart.points ?? [])
function base(point: { date: string }) {
  return {
    date: point.date,
    title: props.report?.chart.byWeek
      ? t('reports.admin.week_of', {
          date: formatDate(point.date, { day: 'numeric', month: 'short' }),
        })
      : shortDate(point.date),
    axis: formatDate(point.date, { day: 'numeric', month: 'short' }),
  }
}
const revenuePoints = computed<ChartPoint[]>(() =>
  chartPoints.value.map((point) => ({
    ...base(point),
    values: { meals: point.subscriptionAmountCents, extras: point.extrasAmountCents },
    texts: { meals: point.subscriptionAmount, extras: point.extrasAmount },
    total: point.total,
  }))
)
const portionPoints = computed<ChartPoint[]>(() =>
  chartPoints.value.map((point) => ({
    ...base(point),
    values: { meals: point.subscriptionMeals, extras: point.extras },
    texts: { meals: String(point.subscriptionMeals), extras: String(point.extras) },
  }))
)
const clickPoints = computed<ChartPoint[]>(() =>
  chartPoints.value.map((point) => ({
    ...base(point),
    values: { glovo: point.glovo, delivery: point.delivery },
    texts: { glovo: String(point.glovo), delivery: String(point.delivery) },
  }))
)

const mealSeries = computed(() => [
  { key: 'meals', label: t('reports.admin.subscription_meals'), color: 'var(--color-chart-meals)' },
  { key: 'extras', label: t('reports.admin.extras'), color: 'var(--color-chart-extras)' },
])
const clickSeries = computed(() => [
  { key: 'glovo', label: t('reports.admin.glovo'), color: 'var(--color-chart-glovo)' },
  { key: 'delivery', label: t('reports.admin.delivery'), color: 'var(--color-chart-delivery)' },
])

const count = (value: number) => new Intl.NumberFormat(locale.value).format(value)
const moneyTick = (cents: number) =>
  new Intl.NumberFormat(locale.value, { notation: 'compact' }).format(cents / 100)
</script>

<template>
  <AdminLayout>
    <PageHeader :title="t('reports.admin.title')" :description="t('reports.admin.description')" />

    <EmptyState
      v-if="!report"
      :title="t('reports.admin.no_school')"
      :description="t('reports.admin.no_school_hint')"
    />

    <div v-else class="flex flex-col gap-5">
      <form class="card flex flex-wrap items-end gap-3 p-4" @submit.prevent="apply">
        <TextInput id="from" v-model="from" type="date" :label="t('reports.admin.from')" required />
        <TextInput id="to" v-model="to" type="date" :label="t('reports.admin.to')" required />
        <AppButton type="submit">{{ t('reports.admin.apply') }}</AppButton>
      </form>

      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div class="card flex flex-col gap-1 p-4">
          <span class="text-[13px] font-bold text-ink-4">{{ t('reports.admin.revenue') }}</span>
          <span class="tabular text-2xl font-extrabold">{{ report.revenue }}</span>
          <span class="text-[13px] text-ink-3">{{ t('reports.admin.revenue_hint') }}</span>
        </div>
        <div class="card flex flex-col gap-1 p-4">
          <span class="text-[13px] font-bold text-ink-4">{{
            t('reports.admin.subscription_meals')
          }}</span>
          <span class="tabular text-2xl font-extrabold">{{ report.subscriptionMeals }}</span>
          <span class="tabular text-[13px] text-ink-3">{{ report.subscriptionAmount }}</span>
        </div>
        <div class="card flex flex-col gap-1 p-4">
          <span class="text-[13px] font-bold text-ink-4">{{ t('reports.admin.extras') }}</span>
          <span class="tabular text-2xl font-extrabold">{{ report.extras }}</span>
          <span class="tabular text-[13px] text-ink-3">{{ report.extrasAmount }}</span>
        </div>
        <div class="card flex flex-col gap-1 p-4">
          <span class="text-[13px] font-bold text-ink-4">{{
            t('reports.admin.active_subscriptions')
          }}</span>
          <span class="tabular text-2xl font-extrabold">{{ report.activeSubscriptions }}</span>
          <span class="text-[13px] text-ink-3">{{
            t('reports.admin.active_subscriptions_hint', { children: report.activeChildren })
          }}</span>
        </div>
        <div class="card flex flex-col gap-1 p-4">
          <span class="text-[13px] font-bold text-ink-4">{{ t('reports.admin.glovo') }}</span>
          <span class="tabular text-2xl font-extrabold">{{ report.links.glovo.clicks }}</span>
          <span class="text-[13px] text-ink-3">{{
            t('reports.admin.clicks_hint', { parents: report.links.glovo.parents })
          }}</span>
        </div>
        <div class="card flex flex-col gap-1 p-4">
          <span class="text-[13px] font-bold text-ink-4">{{ t('reports.admin.delivery') }}</span>
          <span class="tabular text-2xl font-extrabold">{{ report.links.delivery.clicks }}</span>
          <span class="text-[13px] text-ink-3">{{
            t('reports.admin.clicks_hint', { parents: report.links.delivery.parents })
          }}</span>
        </div>
      </div>

      <section class="card flex flex-col gap-4 p-5">
        <div class="flex flex-col gap-0.5">
          <h2 class="text-lg font-bold">{{ t('reports.admin.revenue_chart') }}</h2>
          <p v-if="report.chart.byWeek" class="text-[13px] text-ink-4">
            {{ t('reports.admin.by_week_hint') }}
          </p>
        </div>
        <StackedBarChart
          :label="t('reports.admin.revenue_chart')"
          :series="mealSeries"
          :points="revenuePoints"
          :total-label="t('reports.admin.revenue')"
          :empty-text="t('reports.admin.no_data')"
          :format-tick="moneyTick"
        />
      </section>

      <div class="grid gap-5 xl:grid-cols-2">
        <section class="card flex min-w-0 flex-col gap-4 p-5">
          <h2 class="text-lg font-bold">{{ t('reports.admin.portions_chart') }}</h2>
          <StackedBarChart
            :label="t('reports.admin.portions_chart')"
            :series="mealSeries"
            :points="portionPoints"
            :empty-text="t('reports.admin.no_data')"
            :format-tick="count"
          />
        </section>
        <section class="card flex min-w-0 flex-col gap-4 p-5">
          <h2 class="text-lg font-bold">{{ t('reports.admin.clicks_chart') }}</h2>
          <StackedBarChart
            :label="t('reports.admin.clicks_chart')"
            :series="clickSeries"
            :points="clickPoints"
            :empty-text="t('reports.admin.no_clicks')"
            :format-tick="count"
          />
        </section>
      </div>

      <section class="card flex flex-col gap-3 p-5">
        <h2 class="text-lg font-bold">{{ t('reports.admin.top_extras') }}</h2>
        <p v-if="!report.topExtras.length" class="text-sm text-ink-3">
          {{ t('reports.admin.no_data') }}
        </p>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-line text-left text-[13px] text-ink-4">
                <th class="py-2 pr-3 font-bold">{{ t('reports.admin.extra') }}</th>
                <th class="py-2 pr-3 text-right font-bold">{{ t('reports.admin.quantity') }}</th>
                <th class="py-2 text-right font-bold">{{ t('reports.admin.amount') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="extra in report.topExtras"
                :key="extra.id"
                class="border-b border-line-soft"
              >
                <td class="py-2 pr-3 font-semibold">
                  {{ extra.name }}
                  <span
                    class="mt-1 block h-2 rounded-r bg-chart-extras"
                    :style="{ width: `${extra.barPercent}%` }"
                    aria-hidden="true"
                  />
                </td>
                <td class="tabular py-2 pr-3 text-right">{{ extra.quantity }}</td>
                <td class="tabular py-2 text-right whitespace-nowrap">{{ extra.amount }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card flex flex-col gap-3 p-5">
        <h2 class="text-lg font-bold">{{ t('reports.admin.by_day') }}</h2>
        <p v-if="!report.days.length" class="text-sm text-ink-3">
          {{ t('reports.admin.no_data') }}
        </p>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-line text-left text-[13px] text-ink-4">
                <th class="py-2 pr-3 font-bold">{{ t('reports.admin.date') }}</th>
                <th class="py-2 pr-3 text-right font-bold">
                  {{ t('reports.admin.subscription_meals') }}
                </th>
                <th class="py-2 pr-3 text-right font-bold">{{ t('reports.admin.extras') }}</th>
                <th class="py-2 pr-3 text-right font-bold">{{ t('reports.admin.revenue') }}</th>
                <th class="py-2 pr-3 text-right font-bold">{{ t('reports.admin.glovo') }}</th>
                <th class="py-2 text-right font-bold">{{ t('reports.admin.delivery') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="day in report.days" :key="day.date" class="border-b border-line-soft">
                <td class="py-2 pr-3 font-semibold whitespace-nowrap first-letter:uppercase">
                  {{ shortDate(day.date) }}
                </td>
                <td class="tabular py-2 pr-3 text-right">{{ day.subscriptionMeals }}</td>
                <td class="tabular py-2 pr-3 text-right">{{ day.extras }}</td>
                <td class="tabular py-2 pr-3 text-right whitespace-nowrap">{{ day.total }}</td>
                <td class="tabular py-2 pr-3 text-right">{{ day.glovo }}</td>
                <td class="tabular py-2 text-right">{{ day.delivery }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </AdminLayout>
</template>
