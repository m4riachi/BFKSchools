<script setup lang="ts">
/**
 * Back-office dashboard (brief §5.7): today and the next school day
 * (quantities per dish, extras, children without a choice), next week's
 * menu (status, % of children with a choice, deadline countdown), upcoming
 * holidays and month-to-date amounts. Every number comes from the server.
 */
import { computed, ref } from 'vue'
import { usePage } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import { useI18n } from '~/composables/use_i18n'
import type { ProductionView } from '~/components/reports/types'

type Day = {
  date: string
  kind: 'today' | 'tomorrow' | 'next_school_day'
  state: 'open' | 'holiday' | 'not_school_day' | 'no_menu'
  holidayNames: string[]
  production: ProductionView
  missing: {
    eligible: number
    missing: number
    children: { id: number; firstName: string; lastName: string; className: string | null }[]
  } | null
}

const props = defineProps<{
  dashboard: {
    today: string
    days: Day[]
    nextWeek: {
      weekStart: string
      status: 'none' | 'draft' | 'scheduled' | 'published' | 'closed'
      publishAt: string | null
      orderDeadlineAt: string | null
      minutesToDeadline: number | null
      openDays: number
      selection: { children: number; complete: number; started: number; percent: number } | null
    }
    holidays: { from: string; to: string; name: string; days: number }[]
    monthToDate: {
      from: string
      to: string
      orders: number
      subscription: string
      supplement: string
      total: string
    } | null
  } | null
}>()

const { t, formatDate, formatDateTime } = useI18n()
const page = usePage()
const firstName = computed(() => page.props.user?.fullName.split(' ')[0] ?? '')
const selected = ref(0)
const day = computed(() => props.dashboard?.days[selected.value] ?? null)

const longDate = (iso: string) =>
  formatDate(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const shortDate = (iso: string) =>
  formatDate(iso, { weekday: 'short', day: 'numeric', month: 'short' })
const instant = (iso: string) =>
  formatDateTime(iso, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

function lines(d: Day, type: 'subscription' | 'supplement') {
  return d.production.lines.filter((line) => line.mealType === type)
}
function share(value: number, total: number) {
  return total ? Math.round((value * 100) / total) : 0
}
function dayLabel(d: Day) {
  return t(`reports.dashboard.${d.kind}`)
}
function stateText(d: Day) {
  if (d.state === 'holiday')
    return t('reports.common.holiday', { names: d.holidayNames.join(', ') })
  if (d.state === 'not_school_day') return t('reports.common.not_school_day')
  if (d.state === 'no_menu') return t('reports.common.no_menu')
  return null
}

function duration(minutes: number) {
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  if (days) return t('reports.dashboard.duration_days', { days, hours })
  if (hours) return t('reports.dashboard.duration_hours', { hours, minutes: rest })
  return t('reports.dashboard.duration_minutes', { minutes: rest })
}

const monthName = computed(() =>
  props.dashboard ? formatDate(props.dashboard.today, { month: 'long' }) : ''
)
const statusTone = (status: string) =>
  status === 'published'
    ? 'brand'
    : status === 'scheduled'
      ? 'info'
      : status === 'draft'
        ? 'warning'
        : 'neutral'
</script>

<template>
  <AdminLayout>
    <PageHeader
      :title="t('pages.admin_dashboard.title')"
      :eyebrow="
        dashboard
          ? `${t('pages.admin_dashboard.welcome', { name: firstName })} · ${longDate(dashboard.today)}`
          : t('pages.admin_dashboard.welcome', { name: firstName })
      "
    />

    <section v-if="!dashboard" class="card">
      <EmptyState
        :title="t('reports.common.no_school_title')"
        :description="t('reports.common.no_school_body')"
      />
    </section>

    <template v-else>
      <!-- KPIs -->
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div class="card flex flex-col gap-1 p-4">
          <span class="text-[13px] font-semibold text-ink-4">{{
            t('reports.dashboard.kpi_today')
          }}</span>
          <span class="tabular text-[28px] font-extrabold">{{
            dashboard.days[0].production.totals.subscription.total
          }}</span>
          <span class="text-xs text-ink-3">{{
            t('reports.dashboard.kpi_day_detail', {
              active: dashboard.days[0].production.orders.active,
              absent: dashboard.days[0].production.orders.absent,
            })
          }}</span>
        </div>
        <div class="card flex flex-col gap-1 p-4">
          <span class="text-[13px] font-semibold text-ink-4">{{
            dashboard.days[1].kind === 'tomorrow'
              ? t('reports.dashboard.kpi_tomorrow', { date: shortDate(dashboard.days[1].date) })
              : t('reports.dashboard.kpi_next_school_day', {
                  date: shortDate(dashboard.days[1].date),
                })
          }}</span>
          <span class="tabular text-[28px] font-extrabold">{{
            dashboard.days[1].production.totals.subscription.total
          }}</span>
          <span class="text-xs text-ink-3">{{
            stateText(dashboard.days[1]) ??
            t('reports.dashboard.items_count', {
              count: dashboard.days[1].production.totals.supplement.total,
            }) + ` · ${t('reports.dashboard.supplements').toLowerCase()}`
          }}</span>
        </div>
        <div class="card flex flex-col gap-1 p-4">
          <span class="text-[13px] font-semibold text-ink-4">{{
            t('reports.dashboard.kpi_supplements')
          }}</span>
          <span class="tabular text-[28px] font-extrabold">{{
            dashboard.days[0].production.totals.supplement.total
          }}</span>
          <span class="truncate text-xs text-ink-3">{{
            lines(dashboard.days[0], 'supplement')
              .slice(0, 4)
              .map((line) => `${line.name} ${line.total}`)
              .join(' · ')
          }}</span>
        </div>
        <div v-if="dashboard.monthToDate" class="card flex flex-col gap-1 p-4">
          <span class="text-[13px] font-semibold text-ink-4 first-letter:uppercase">{{
            t('reports.dashboard.kpi_month', { month: monthName })
          }}</span>
          <span class="tabular text-[24px] font-extrabold">{{ dashboard.monthToDate.total }}</span>
          <span class="text-xs text-ink-3">{{
            t('reports.dashboard.kpi_month_detail', {
              subscription: dashboard.monthToDate.subscription,
              supplement: dashboard.monthToDate.supplement,
            })
          }}</span>
        </div>
      </div>

      <div class="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div class="flex min-w-0 flex-col gap-5">
          <!-- Production today / next day -->
          <section v-if="day" class="card flex flex-col">
            <div
              class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4"
            >
              <div class="flex flex-col">
                <h2 class="text-base font-bold">{{ t('reports.dashboard.production') }}</h2>
                <span class="text-xs text-ink-4">{{ longDate(day.date) }}</span>
              </div>
              <div class="flex rounded-xl bg-subtle p-1" role="group">
                <button
                  v-for="(d, index) in dashboard.days"
                  :key="d.date"
                  type="button"
                  class="h-9 rounded-[10px] px-3 text-[13px] font-bold"
                  :class="index === selected ? 'bg-surface shadow-pressed' : 'text-ink-3'"
                  :aria-pressed="index === selected"
                  @click="selected = index"
                >
                  {{ dayLabel(d) }}
                </button>
              </div>
            </div>
            <p
              v-if="stateText(day)"
              class="mx-5 mt-4 rounded-xl bg-subtle px-4 py-2.5 text-sm font-semibold text-ink-2"
            >
              {{ stateText(day) }}
            </p>
            <div class="grid gap-6 p-5 md:grid-cols-2">
              <div
                v-for="type in ['subscription', 'supplement'] as const"
                :key="type"
                class="flex flex-col gap-3"
              >
                <div class="flex items-baseline justify-between">
                  <h3 class="text-xs font-bold tracking-wide text-ink-4 uppercase">
                    {{
                      t(
                        type === 'subscription'
                          ? 'reports.dashboard.mains'
                          : 'reports.dashboard.supplements'
                      )
                    }}
                  </h3>
                  <span class="text-xs font-semibold text-ink-3">{{
                    t(
                      type === 'subscription'
                        ? 'reports.dashboard.meals_count'
                        : 'reports.dashboard.items_count',
                      {
                        count: day.production.totals[type].total,
                      }
                    )
                  }}</span>
                </div>
                <p v-if="!lines(day, type).length" class="text-sm text-ink-4">
                  {{ t('reports.dashboard.no_orders') }}
                </p>
                <div
                  v-for="line in lines(day, type)"
                  :key="line.mealId"
                  class="flex flex-col gap-1"
                >
                  <div class="flex items-baseline justify-between gap-3 text-sm">
                    <span class="font-semibold">{{ line.name }}</span>
                    <span class="tabular font-extrabold">{{ line.total }}</span>
                  </div>
                  <div class="h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
                    <div
                      class="h-full rounded-full"
                      :class="type === 'subscription' ? 'bg-brand' : 'bg-accent'"
                      :style="{ width: `${share(line.total, day.production.totals[type].total)}%` }"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div
              class="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3"
            >
              <span class="text-sm text-ink-3">
                <template v-if="day.missing">
                  {{
                    t('reports.dashboard.missing', {
                      missing: day.missing.missing,
                      eligible: day.missing.eligible,
                    })
                  }}
                </template>
                <template v-else>{{ t('reports.dashboard.missing_na') }}</template>
              </span>
              <Link :href="`/kitchen?date=${day.date}`" class="text-sm font-bold">
                {{ t('reports.dashboard.open_sheet') }} →
              </Link>
            </div>
          </section>

          <!-- Children without a choice -->
          <section v-if="day?.missing && day.missing.missing" class="card flex flex-col gap-3 p-5">
            <h2 class="text-base font-bold">
              {{ t('reports.dashboard.missing_title') }} · {{ dayLabel(day) }}
            </h2>
            <ul class="flex flex-wrap gap-2">
              <li v-for="child in day.missing.children" :key="child.id">
                <Link
                  :href="`/admin/orders/children/${child.id}?week=${day.date}`"
                  class="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[13px] font-semibold no-underline"
                >
                  {{ child.firstName }} {{ child.lastName }}
                  <span v-if="child.className" class="text-ink-4">{{ child.className }}</span>
                </Link>
              </li>
            </ul>
            <p v-if="day.missing.missing > day.missing.children.length" class="text-xs text-ink-4">
              {{
                t('reports.dashboard.missing_more', {
                  count: day.missing.missing - day.missing.children.length,
                })
              }}
            </p>
          </section>
        </div>

        <div class="flex min-w-0 flex-col gap-5">
          <!-- Next week -->
          <section class="card flex flex-col gap-3 p-5">
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-base font-bold">{{ t('reports.dashboard.next_week') }}</h2>
              <StatusBadge :tone="statusTone(dashboard.nextWeek.status)">
                {{ t(`menus.status.${dashboard.nextWeek.status}`) }}
              </StatusBadge>
            </div>
            <span class="text-sm font-semibold">{{ longDate(dashboard.nextWeek.weekStart) }}</span>
            <div class="flex flex-col gap-1 text-sm text-ink-3">
              <span
                v-if="
                  dashboard.nextWeek.publishAt &&
                  dashboard.nextWeek.status !== 'published' &&
                  dashboard.nextWeek.status !== 'closed'
                "
              >
                {{
                  t('reports.dashboard.publish_at', { when: instant(dashboard.nextWeek.publishAt) })
                }}
              </span>
              <span v-if="dashboard.nextWeek.orderDeadlineAt">
                {{
                  t('reports.dashboard.deadline_at', {
                    when: instant(dashboard.nextWeek.orderDeadlineAt),
                  })
                }}
              </span>
              <span
                v-if="dashboard.nextWeek.minutesToDeadline !== null"
                class="font-bold"
                :class="dashboard.nextWeek.minutesToDeadline > 0 ? 'text-warning' : 'text-ink-4'"
              >
                {{
                  dashboard.nextWeek.minutesToDeadline > 0
                    ? t('reports.dashboard.countdown', {
                        time: duration(dashboard.nextWeek.minutesToDeadline),
                      })
                    : t('reports.dashboard.deadline_passed')
                }}
              </span>
            </div>
            <template v-if="dashboard.nextWeek.selection">
              <div class="flex flex-col gap-1.5">
                <span class="text-sm font-bold">{{
                  t('reports.dashboard.selection', {
                    percent: dashboard.nextWeek.selection.percent,
                  })
                }}</span>
                <div
                  class="h-2 overflow-hidden rounded-full bg-subtle"
                  role="progressbar"
                  :aria-valuenow="dashboard.nextWeek.selection.percent"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <div
                    class="h-full rounded-full bg-brand"
                    :style="{ width: `${dashboard.nextWeek.selection.percent}%` }"
                  />
                </div>
                <span class="text-xs text-ink-4">{{
                  t('reports.dashboard.selection_detail', {
                    ...dashboard.nextWeek.selection,
                    days: dashboard.nextWeek.openDays,
                  })
                }}</span>
              </div>
            </template>
            <p v-else class="text-sm text-ink-4">{{ t('reports.dashboard.selection_pending') }}</p>
            <Link :href="`/admin/menus/${dashboard.nextWeek.weekStart}`" class="text-sm font-bold">
              {{ t('reports.dashboard.open_menu') }} →
            </Link>
          </section>

          <!-- Upcoming holidays -->
          <section class="card flex flex-col gap-3 p-5">
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-base font-bold">{{ t('reports.dashboard.holidays') }}</h2>
              <span class="text-xs font-semibold text-ink-4">{{
                t('reports.dashboard.holidays_window')
              }}</span>
            </div>
            <p v-if="!dashboard.holidays.length" class="text-sm text-ink-4">
              {{ t('reports.dashboard.holidays_none') }}
            </p>
            <ul v-else class="flex flex-col divide-y divide-line-soft">
              <li
                v-for="holiday in dashboard.holidays"
                :key="`${holiday.from}-${holiday.name}`"
                class="flex items-center gap-3 py-2"
              >
                <div
                  class="flex size-11 shrink-0 flex-col items-center justify-center rounded-xl bg-violet-soft text-violet"
                >
                  <span class="text-sm leading-none font-extrabold">{{
                    formatDate(holiday.from, { day: 'numeric' })
                  }}</span>
                  <span class="text-[10px] font-bold uppercase">{{
                    formatDate(holiday.from, { month: 'short' })
                  }}</span>
                </div>
                <div class="flex min-w-0 flex-col">
                  <span class="truncate text-sm font-semibold">{{ holiday.name }}</span>
                  <span class="text-xs text-ink-4">
                    {{ shortDate(holiday.from)
                    }}<template v-if="holiday.to !== holiday.from">
                      – {{ shortDate(holiday.to) }}</template
                    >
                    · {{ t('reports.dashboard.holiday_days', { count: holiday.days }) }}
                  </span>
                </div>
              </li>
            </ul>
            <Link href="/admin/holidays" class="text-sm font-bold">
              {{ t('reports.dashboard.manage_holidays') }} →
            </Link>
          </section>

          <!-- Month to date -->
          <section v-if="dashboard.monthToDate" class="card flex flex-col gap-3 p-5">
            <h2 class="text-base font-bold">{{ t('reports.dashboard.month_title') }}</h2>
            <dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
              <dt class="text-ink-3">{{ t('reports.dashboard.month_subscription') }}</dt>
              <dd class="tabular text-right font-semibold">
                {{ dashboard.monthToDate.subscription }}
              </dd>
              <dt class="text-ink-3">{{ t('reports.dashboard.month_supplement') }}</dt>
              <dd class="tabular text-right font-semibold">
                {{ dashboard.monthToDate.supplement }}
              </dd>
              <dt class="border-t border-line pt-1.5 font-bold">
                {{ t('reports.dashboard.month_total') }}
              </dt>
              <dd class="tabular border-t border-line pt-1.5 text-right font-extrabold">
                {{ dashboard.monthToDate.total }}
              </dd>
            </dl>
            <span class="text-xs text-ink-4">{{
              t('reports.dashboard.month_orders', {
                count: dashboard.monthToDate.orders,
                from: shortDate(dashboard.monthToDate.from),
                to: shortDate(dashboard.monthToDate.to),
              })
            }}</span>
          </section>
        </div>
      </div>
    </template>
  </AdminLayout>
</template>
