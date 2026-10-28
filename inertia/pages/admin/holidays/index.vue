<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import AppButton from '~/components/ui/app_button.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import ConfirmDialog from '~/components/ui/confirm_dialog.vue'
import DataTable, { type TableColumn } from '~/components/ui/data_table.vue'
import type { PaginationMeta } from '~/components/ui/pagination_nav.vue'
import HolidayMonth from '~/components/holidays/holiday_month.vue'
import HolidayEditor from '~/components/holidays/holiday_editor.vue'
import {
  SOURCES,
  SOURCE_STYLES,
  type EditorTarget,
  type GroupSummary,
  type HolidayEntry,
  type HolidayFilters,
  type HolidayRow,
  type SchoolCalendarInfo,
} from '~/components/holidays/types'
import { useI18n } from '~/composables/use_i18n'
import { useImpactConfirm } from '~/composables/use_impact_confirm'

const props = defineProps<{
  view: 'calendar' | 'list'
  today: string
  school: SchoolCalendarInfo
  calendar: { month: string; rows: HolidayRow[]; groups: GroupSummary[] } | null
  list: { entries: HolidayEntry[]; meta: PaginationMeta } | null
  filters: HolidayFilters
  options: { sources: string[]; statuses: string[]; periods: string[] }
  settings: { generateMoroccanHolidays: boolean; canConfigure: boolean }
}>()

const { t, formatDate } = useI18n()

/* Editor */
const editorOpen = ref(false)
const target = ref<EditorTarget | null>(null)

function openCreate(date?: string) {
  target.value = { kind: 'create', startDate: date ?? '' }
  editorOpen.value = true
}

function openRow(row: HolidayRow) {
  const group = row.groupId ? props.calendar?.groups.find((g) => g.groupId === row.groupId) : null
  target.value = group
    ? {
        kind: 'group',
        groupId: group.groupId,
        name: row.name,
        startDate: group.startDate,
        endDate: group.endDate,
        days: group.days,
        source: row.source,
        isActive: group.isActive,
        generated: row.generated,
      }
    : {
        kind: 'single',
        id: row.id,
        name: row.name,
        date: row.date,
        source: row.source,
        isActive: row.isActive,
        generated: row.generated,
      }
  editorOpen.value = true
}

function openEntry(entry: HolidayEntry) {
  target.value =
    entry.groupId !== null
      ? {
          kind: 'group',
          groupId: entry.groupId,
          name: entry.name,
          startDate: entry.startDate,
          endDate: entry.endDate,
          days: entry.days,
          source: entry.source,
          isActive: entry.isActive,
          generated: entry.generated,
        }
      : {
          kind: 'single',
          id: entry.id!,
          name: entry.name,
          date: entry.startDate,
          source: entry.source,
          isActive: entry.isActive,
          generated: entry.generated,
        }
  editorOpen.value = true
}

/* Generation */
const impact = useImpactConfirm()
const impactOpen = impact.open
const impactMessage = impact.message
const generateOpen = ref(false)
const generating = ref(false)
function generate(confirmImpact = false) {
  router.post(
    '/admin/holidays/generate',
    { confirmImpact, confirmedCount: confirmImpact ? impact.count.value : undefined },
    {
      preserveScroll: true,
      onStart: () => (generating.value = true),
      onFinish: () => {
        generating.value = false
        generateOpen.value = false
      },
      onError: (errors) => impact.handle(errors, () => generate(true)),
    }
  )
}

/* Moroccan setting (admin) */
const savingSetting = ref(false)
function setMoroccan(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  router.put(
    '/admin/holidays/settings',
    { generateMoroccanHolidays: checked },
    {
      preserveScroll: true,
      onStart: () => (savingSetting.value = true),
      onFinish: () => (savingSetting.value = false),
    }
  )
}

/* List filters (query string; the server filters) */
const search = ref(props.filters.q)
const source = ref(props.filters.source)
const status = ref(props.filters.status)
const period = ref(props.filters.period)
let timer: ReturnType<typeof setTimeout> | undefined

function load() {
  const params: Record<string, string> = { view: 'list' }
  if (search.value.trim()) params.q = search.value.trim()
  if (source.value) params.source = source.value
  if (status.value !== 'all') params.status = status.value
  if (period.value !== 'school_year') params.period = period.value
  router.get('/admin/holidays', params, {
    preserveState: true,
    preserveScroll: true,
    replace: true,
  })
}
watch(search, () => {
  clearTimeout(timer)
  timer = setTimeout(load, 300)
})
watch([source, status, period], load)

const columns = computed<TableColumn[]>(() => [
  { key: 'name', label: t('holidays.list.name') },
  { key: 'dates', label: t('holidays.list.dates') },
  { key: 'source', label: t('holidays.list.source') },
  { key: 'status', label: t('holidays.list.status') },
  { key: 'actions', label: t('holidays.list.actions'), align: 'right' },
])

const tableRows = computed(() =>
  (props.list?.entries ?? []).map((entry) => ({ ...entry, id: entry.key, entry }))
)

function datesLabel(entry: HolidayEntry) {
  if (entry.startDate === entry.endDate) return formatDate(entry.startDate, { dateStyle: 'medium' })
  return t('holidays.form.range', {
    start: formatDate(entry.startDate, { dateStyle: 'medium' }),
    end: formatDate(entry.endDate, { dateStyle: 'medium' }),
  })
}

const viewTabs = ['calendar', 'list'] as const
const segmentClass = (selected: boolean) => [
  'flex min-h-9 items-center rounded-[9px] px-3.5 text-[13px] font-bold whitespace-nowrap no-underline',
  selected ? 'bg-surface text-ink shadow-pressed hover:text-ink' : 'text-ink-4 hover:text-ink',
]
const selectClass =
  'h-11 appearance-none rounded-xl border border-line-strong bg-surface pr-9 pl-3 text-sm font-semibold text-ink'
</script>

<template>
  <AdminLayout>
    <PageHeader
      :title="t('holidays.title')"
      :eyebrow="t('holidays.school_year', { label: school.schoolYearLabel })"
      :description="t('holidays.description')"
    >
      <template #actions>
        <AppButton variant="secondary" href="/admin/holidays/import">
          {{ t('holidays.actions.import') }}
        </AppButton>
        <AppButton variant="secondary" @click="generateOpen = true">
          {{ t('holidays.actions.generate', { year: school.schoolYearLabel }) }}
        </AppButton>
        <AppButton @click="openCreate()">{{ t('holidays.actions.add') }}</AppButton>
      </template>
    </PageHeader>

    <section
      class="card flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5"
    >
      <div class="flex flex-col gap-2">
        <h2 class="text-xs font-bold tracking-[0.04em] text-ink-4 uppercase">
          {{ t('holidays.legend') }}
        </h2>
        <ul class="flex flex-wrap gap-x-4 gap-y-2 text-[13px] font-semibold text-ink-2">
          <li v-for="code in SOURCES" :key="code" class="flex items-center gap-1.5">
            <span
              class="size-2.5 rounded-full"
              :class="SOURCE_STYLES[code].dot"
              aria-hidden="true"
            />
            {{ t(`holidays.sources.${code}`) }}
          </li>
          <li class="flex items-center gap-1.5 text-ink-4">
            <span class="size-2.5 rounded-full bg-line-strong" aria-hidden="true" />
            <span class="line-through">{{ t('holidays.disabled_legend') }}</span>
          </li>
        </ul>
      </div>
      <div class="flex max-w-sm flex-col gap-1">
        <label class="flex items-start gap-2.5 text-sm font-semibold text-ink">
          <input
            type="checkbox"
            class="mt-0.5 size-5 accent-brand"
            :checked="settings.generateMoroccanHolidays"
            :disabled="!settings.canConfigure || savingSetting"
            @change="setMoroccan"
          />
          <span>{{ t('holidays.moroccan.label') }}</span>
        </label>
        <p class="pl-7.5 text-xs text-ink-4">
          {{ t('holidays.moroccan.hint') }}
          <template v-if="!settings.canConfigure">
            {{ t('holidays.moroccan.admin_only') }}</template
          >
        </p>
      </div>
    </section>

    <nav :aria-label="t('holidays.title')" class="-mx-1 overflow-x-auto px-1">
      <div class="flex w-max gap-1 rounded-xl bg-subtle p-1">
        <Link
          v-for="tab in viewTabs"
          :key="tab"
          :href="`/admin/holidays?view=${tab}`"
          preserve-scroll
          :aria-current="view === tab ? 'page' : undefined"
          :class="segmentClass(view === tab)"
        >
          {{ t(`holidays.views.${tab}`) }}
        </Link>
      </div>
    </nav>

    <HolidayMonth
      v-if="view === 'calendar' && calendar"
      :month="calendar.month"
      :rows="calendar.rows"
      :school="school"
      :today="today"
      @select="openRow"
      @add="openCreate"
    />

    <section v-else-if="list" class="card flex flex-col gap-4 p-4 sm:p-5">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
        <label
          class="flex h-11 w-full items-center gap-2 rounded-xl border border-line-strong bg-surface px-3.5 text-ink-4 lg:max-w-xs"
        >
          <span class="sr-only">{{ t('holidays.list.search') }}</span>
          <input
            v-model="search"
            type="search"
            maxlength="100"
            :placeholder="t('holidays.list.search_placeholder')"
            class="w-full border-0 bg-transparent text-sm text-ink outline-none"
          />
        </label>
        <div class="flex flex-wrap gap-2">
          <label>
            <span class="sr-only">{{ t('holidays.list.source') }}</span>
            <select v-model="source" :class="selectClass">
              <option value="">{{ t('holidays.list.all_sources') }}</option>
              <option v-for="value in options.sources" :key="value" :value="value">
                {{ t(`holidays.sources.${value}`) }}
              </option>
            </select>
          </label>
          <label>
            <span class="sr-only">{{ t('holidays.list.status') }}</span>
            <select v-model="status" :class="selectClass">
              <option v-for="value in options.statuses" :key="value" :value="value">
                {{ t(`holidays.statuses.${value}`) }}
              </option>
            </select>
          </label>
          <label>
            <span class="sr-only">{{ t('holidays.list.dates') }}</span>
            <select v-model="period" :class="selectClass">
              <option v-for="value in options.periods" :key="value" :value="value">
                {{ t(`holidays.periods.${value}`) }}
              </option>
            </select>
          </label>
        </div>
        <span class="text-[13px] font-semibold text-ink-4 lg:ml-auto">
          {{ t('holidays.list.count', { count: list.meta.total }) }}
        </span>
      </div>

      <DataTable
        :columns="columns"
        :rows="tableRows"
        :meta="list.meta"
        :caption="t('holidays.title')"
        :empty-title="t('holidays.list.empty')"
        :empty-description="t('holidays.list.empty_body')"
      >
        <template #cell-name="{ row }">
          <span class="font-bold" :class="{ 'text-ink-4 line-through': !row.entry.isActive }">
            {{ row.entry.name }}
          </span>
          <StatusBadge v-if="row.entry.groupId" tone="neutral" class="ml-2">
            {{ t('holidays.list.range_badge') }}
          </StatusBadge>
        </template>
        <template #cell-dates="{ row }">
          <span class="whitespace-nowrap">{{ datesLabel(row.entry) }}</span>
          <span v-if="row.entry.days > 1" class="block text-xs text-ink-4">
            {{ t('holidays.form.days', { count: row.entry.days }) }}
          </span>
        </template>
        <template #cell-source="{ row }">
          <span
            class="inline-flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap"
          >
            <span
              class="size-2.5 rounded-full"
              :class="SOURCE_STYLES[row.entry.source].dot"
              aria-hidden="true"
            />
            {{ t(`holidays.sources.${row.entry.source}`) }}
          </span>
        </template>
        <template #cell-status="{ row }">
          <StatusBadge :tone="row.entry.isActive ? 'brand' : 'neutral'">
            {{ row.entry.isActive ? t('holidays.list.active') : t('holidays.list.disabled') }}
          </StatusBadge>
        </template>
        <template #cell-actions="{ row }">
          <AppButton size="sm" variant="secondary" @click="openEntry(row.entry)">
            {{ t('holidays.actions.edit') }}
          </AppButton>
        </template>
      </DataTable>
    </section>

    <HolidayEditor v-model:open="editorOpen" :target="target" />

    <ConfirmDialog
      v-model:open="generateOpen"
      :title="t('holidays.generate.title', { year: school.schoolYearLabel })"
      :confirm-label="t('holidays.generate.confirm')"
      :processing="generating"
      @confirm="generate()"
    >
      <p>
        {{
          t('holidays.generate.body', {
            start: formatDate(school.schoolYearStart, { dateStyle: 'medium' }),
            end: formatDate(school.schoolYearEnd, { dateStyle: 'medium' }),
          })
        }}
      </p>
      <p class="mt-2 font-semibold">
        {{
          settings.generateMoroccanHolidays
            ? t('holidays.generate.moroccan_on')
            : t('holidays.generate.moroccan_off')
        }}
      </p>
    </ConfirmDialog>

    <ConfirmDialog
      v-model:open="impactOpen"
      :title="t('holidays.impact.title')"
      :message="impactMessage"
      :confirm-label="t('holidays.impact.confirm_button')"
      danger
      @confirm="impact.confirm"
    />
  </AdminLayout>
</template>
