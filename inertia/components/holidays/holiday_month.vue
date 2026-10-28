<script setup lang="ts">
/**
 * Month grid (Monday first) of the school's holidays, coloured by source.
 * Days that are not school days (weekends, outside the school year) are
 * hatched. Clicking a holiday opens it; clicking an empty school day starts
 * a new holiday on that date. Below the grid, the month's holidays are also
 * listed (readable on phones and by screen readers).
 */
import { computed } from 'vue'
import { Link } from '@adonisjs/inertia/vue'
import { useI18n } from '~/composables/use_i18n'
import {
  DISABLED_CHIP,
  SOURCE_STYLES,
  type HolidayRow,
  type SchoolCalendarInfo,
} from '~/components/holidays/types'

const props = defineProps<{
  month: string
  rows: HolidayRow[]
  school: SchoolCalendarInfo
  today: string
}>()
const emit = defineEmits<{ select: [row: HolidayRow]; add: [date: string] }>()

const { t, locale, formatDate } = useI18n()

const pad = (value: number) => String(value).padStart(2, '0')
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

function shiftMonth(month: string, delta: number) {
  const [year, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(year, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

const title = computed(() => {
  const [year, m] = props.month.split('-').map(Number)
  return new Intl.DateTimeFormat(locale.value, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, m - 1, 15)))
})

const weekdays = computed(() => t('holidays.calendar.weekdays').split(','))

const byDate = computed(() => {
  const map = new Map<string, HolidayRow[]>()
  for (const row of props.rows) map.set(row.date, [...(map.get(row.date) ?? []), row])
  return map
})

function isSchoolDay(date: string, weekday: number) {
  return (
    props.school.schoolDays.includes(weekday) &&
    date >= props.school.schoolYearStart &&
    date <= props.school.schoolYearEnd
  )
}

const weeks = computed(() => {
  const [year, m] = props.month.split('-').map(Number)
  const first = new Date(Date.UTC(year, m - 1, 1))
  const offset = (first.getUTCDay() + 6) % 7
  const start = new Date(Date.UTC(year, m - 1, 1 - offset))
  const result = []
  for (let w = 0; w < 6; w++) {
    const days = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * 86_400_000)
      const value = iso(date)
      days.push({
        date: value,
        day: date.getUTCDate(),
        inMonth: date.getUTCMonth() === m - 1,
        schoolDay: isSchoolDay(value, d + 1),
        holidays: byDate.value.get(value) ?? [],
      })
    }
    if (w >= 4 && !days.some((day) => day.inMonth)) break
    result.push(days)
  }
  return result
})

const chipClass = (row: HolidayRow) =>
  row.isActive ? SOURCE_STYLES[row.source].chip : DISABLED_CHIP
const monthHref = (month: string) => `/admin/holidays?view=calendar&month=${month}`
</script>

<template>
  <section class="card flex flex-col gap-4 p-4 sm:p-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-extrabold capitalize">{{ title }}</h2>
      <div class="flex items-center gap-1">
        <Link
          :href="monthHref(shiftMonth(month, -1))"
          preserve-scroll
          class="flex size-9 items-center justify-center rounded-[10px] border border-line-strong bg-surface text-ink no-underline hover:bg-subtle"
          :aria-label="t('holidays.actions.previous_month')"
        >
          <span aria-hidden="true">‹</span>
        </Link>
        <Link
          :href="monthHref(today.slice(0, 7))"
          preserve-scroll
          class="flex h-9 items-center rounded-[10px] border border-line-strong bg-surface px-3 text-[13px] font-bold text-ink no-underline hover:bg-subtle"
        >
          {{ t('holidays.actions.today') }}
        </Link>
        <Link
          :href="monthHref(shiftMonth(month, 1))"
          preserve-scroll
          class="flex size-9 items-center justify-center rounded-[10px] border border-line-strong bg-surface text-ink no-underline hover:bg-subtle"
          :aria-label="t('holidays.actions.next_month')"
        >
          <span aria-hidden="true">›</span>
        </Link>
      </div>
    </div>

    <div class="overflow-x-auto" aria-hidden="true">
      <div
        class="grid min-w-[560px] grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line"
      >
        <div
          v-for="name in weekdays"
          :key="name"
          class="bg-subtle px-2 py-2 text-center text-xs font-bold tracking-[0.04em] text-ink-4 uppercase"
        >
          {{ name }}
        </div>
        <template v-for="(week, w) in weeks" :key="w">
          <div
            v-for="day in week"
            :key="day.date"
            class="relative flex min-h-24 flex-col gap-1 p-1.5"
            :class="[
              day.schoolDay
                ? 'bg-surface'
                : 'bg-[repeating-linear-gradient(135deg,var(--color-subtle)_0px,var(--color-subtle)_6px,var(--color-canvas)_6px,var(--color-canvas)_12px)]',
              day.inMonth ? '' : 'opacity-45',
            ]"
          >
            <button
              v-if="day.schoolDay && day.holidays.length === 0"
              type="button"
              tabindex="-1"
              class="absolute inset-0 cursor-pointer rounded-none bg-transparent hover:bg-brand-soft/40"
              @click="emit('add', day.date)"
            />
            <span
              class="relative self-end text-xs font-bold tabular"
              :class="
                day.date === today
                  ? 'flex size-6 items-center justify-center rounded-full bg-brand text-white'
                  : 'text-ink-3'
              "
            >
              {{ day.day }}
            </span>
            <button
              v-for="row in day.holidays"
              :key="row.id"
              type="button"
              tabindex="-1"
              class="relative w-full truncate rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight font-bold"
              :class="chipClass(row)"
              :title="row.name"
              @click="emit('select', row)"
            >
              {{ row.name }}
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- Same information as a list: phones, keyboard and screen readers. -->
    <ul v-if="rows.length" class="flex flex-col divide-y divide-line-soft">
      <li v-for="row in rows" :key="row.id">
        <button
          type="button"
          class="flex w-full items-center gap-3 py-2.5 text-left hover:bg-subtle"
          @click="emit('select', row)"
        >
          <span
            class="size-2.5 shrink-0 rounded-full"
            :class="row.isActive ? SOURCE_STYLES[row.source].dot : 'bg-line-strong'"
            aria-hidden="true"
          />
          <span class="w-36 shrink-0 text-[13px] font-semibold text-ink-3 tabular">
            {{ formatDate(row.date, { weekday: 'short', day: 'numeric', month: 'short' }) }}
          </span>
          <span
            class="min-w-0 flex-1 truncate text-sm font-bold"
            :class="{ 'text-ink-4 line-through': !row.isActive }"
          >
            {{ row.name }}
          </span>
          <span class="hidden text-xs font-semibold text-ink-4 sm:inline">
            {{ row.isActive ? t(`holidays.sources.${row.source}`) : t('holidays.list.disabled') }}
          </span>
        </button>
      </li>
    </ul>
    <p v-else class="text-sm text-ink-4">{{ t('holidays.calendar.month_empty') }}</p>
  </section>
</template>
