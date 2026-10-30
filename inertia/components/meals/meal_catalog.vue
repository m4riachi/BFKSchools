<script setup lang="ts">
/**
 * Catalog list shared by the back-office (editable) and the kitchen
 * (read-only): search, type segmented control (design: "Tous / Abonnement /
 * Suppléments"), category and status filters, grid (cover photos) or list.
 * Filters live in the query string; the server does the filtering.
 */
import { computed, ref, watch } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import DataTable from '~/components/ui/data_table.vue'
import PaginationNav, { type PaginationMeta } from '~/components/ui/pagination_nav.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import AppButton from '~/components/ui/app_button.vue'
import MealThumb from '~/components/meals/meal_thumb.vue'
import MealBadges from '~/components/meals/meal_badges.vue'
import type { MealFilters, MealOptions, MealSummary } from '~/components/meals/types'
import { useI18n } from '~/composables/use_i18n'
import { useFeatures } from '~/composables/use_features'

const props = defineProps<{
  meals: MealSummary[]
  meta: PaginationMeta
  filters: MealFilters
  options: MealOptions
  /** '/admin/meals' or '/kitchen/meals' */
  basePath: string
  /** Link of a meal (edit page or read-only detail). */
  itemPath: (meal: MealSummary) => string
  readOnly?: boolean
}>()

const { t } = useI18n()
const features = useFeatures()

const search = ref(props.filters.q)
let timer: ReturnType<typeof setTimeout> | undefined

function query(overrides: Partial<MealFilters>) {
  const next = { ...props.filters, q: search.value, ...overrides }
  const params: Record<string, string> = {}
  if (next.q.trim()) params.q = next.q.trim()
  if (next.type !== 'all') params.type = next.type
  if (next.category !== 'all') params.category = next.category
  if (next.active !== 'all') params.active = next.active
  if (next.view !== 'grid') params.view = next.view
  return params
}

function load(overrides: Partial<MealFilters>) {
  router.get(props.basePath, query(overrides), {
    preserveState: true,
    preserveScroll: true,
    replace: true,
  })
}

watch(search, (value) => {
  clearTimeout(timer)
  timer = setTimeout(() => load({ q: value }), 300)
})

const category = ref(props.filters.category)
const active = ref(props.filters.active)
watch(category, (value) => value !== props.filters.category && load({ category: value }))
watch(active, (value) => value !== props.filters.active && load({ active: value }))

function hrefWith(overrides: Partial<MealFilters>) {
  const qs = new URLSearchParams(query(overrides)).toString()
  return `${props.basePath}${qs ? `?${qs}` : ''}`
}

const filtered = computed(
  () =>
    Boolean(props.filters.q) ||
    props.filters.type !== 'all' ||
    props.filters.category !== 'all' ||
    props.filters.active !== 'all'
)

const typeTabs = computed(() => ['all', ...props.options.types])

const segmentClass = (selected: boolean) => [
  'flex min-h-9 items-center rounded-[9px] px-3.5 text-[13px] font-bold whitespace-nowrap no-underline',
  selected ? 'bg-surface text-ink shadow-pressed hover:text-ink' : 'text-ink-4 hover:text-ink',
]

const selectClass =
  'h-11 appearance-none rounded-xl border border-line-strong bg-surface pr-9 pl-3 text-sm font-semibold text-ink'

const columns = computed(() => [
  { key: 'meal', label: t('meals.list.columns.meal') },
  { key: 'type', label: t('meals.list.columns.type') },
  { key: 'price', label: t('meals.list.columns.price'), align: 'right' as const },
  ...(features.value.allergens
    ? [{ key: 'allergens', label: t('meals.list.columns.allergens') }]
    : []),
  { key: 'status', label: t('meals.list.columns.status') },
  { key: 'actions', label: t('meals.list.columns.actions'), align: 'right' as const },
])

const actionLabel = (meal: MealSummary) =>
  props.readOnly
    ? t('meals.list.view_label_meal', { name: meal.name })
    : t('meals.list.edit_label', { name: meal.name })
</script>

<template>
  <section class="card flex flex-col gap-4 p-4 sm:p-5">
    <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <label
        class="flex h-11 w-full items-center gap-2 rounded-xl border border-line-strong bg-surface px-3.5 text-ink-4 xl:max-w-xs"
      >
        <svg
          class="size-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="M20 20l-4.2-4.2" />
        </svg>
        <span class="sr-only">{{ t('meals.list.search_label') }}</span>
        <input
          v-model="search"
          type="search"
          maxlength="100"
          :placeholder="t('meals.list.search_placeholder')"
          class="w-full border-0 bg-transparent text-sm text-ink outline-none"
        />
      </label>

      <div class="flex flex-wrap items-center gap-2">
        <nav :aria-label="t('meals.list.type_filter')" class="-mx-1 overflow-x-auto px-1">
          <div class="flex w-max gap-1 rounded-xl bg-subtle p-1">
            <Link
              v-for="type in typeTabs"
              :key="type"
              :href="hrefWith({ type })"
              preserve-scroll
              :aria-current="filters.type === type ? 'page' : undefined"
              :class="segmentClass(filters.type === type)"
            >
              {{ t(`meals.types_plural.${type}`) }}
            </Link>
          </div>
        </nav>

        <label class="relative">
          <span class="sr-only">{{ t('meals.list.category_filter') }}</span>
          <select v-model="category" :class="selectClass">
            <option value="all">{{ t('meals.categories.all') }}</option>
            <option v-for="value in options.categories" :key="value" :value="value">
              {{ t(`meals.categories.${value}`) }}
            </option>
          </select>
          <svg
            class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </label>

        <label class="relative">
          <span class="sr-only">{{ t('meals.list.active_filter') }}</span>
          <select v-model="active" :class="selectClass">
            <option v-for="value in options.activeFilters" :key="value" :value="value">
              {{ t(`meals.active_filters.${value}`) }}
            </option>
          </select>
          <svg
            class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </label>

        <div
          role="group"
          :aria-label="t('meals.list.view_label')"
          class="flex gap-1 rounded-xl bg-subtle p-1"
        >
          <Link
            :href="hrefWith({ view: 'grid' })"
            preserve-scroll
            :aria-current="filters.view === 'grid' ? 'page' : undefined"
            :class="segmentClass(filters.view === 'grid')"
          >
            {{ t('meals.list.view_grid') }}
          </Link>
          <Link
            :href="hrefWith({ view: 'list' })"
            preserve-scroll
            :aria-current="filters.view === 'list' ? 'page' : undefined"
            :class="segmentClass(filters.view === 'list')"
          >
            {{ t('meals.list.view_list') }}
          </Link>
        </div>
      </div>
    </div>

    <!-- Grid with cover photos -->
    <template v-if="filters.view !== 'list'">
      <EmptyState
        v-if="meals.length === 0"
        :title="filtered ? t('meals.list.no_results_title') : t('meals.list.empty_title')"
        :description="filtered ? t('meals.list.no_results_body') : t('meals.list.empty_body')"
      />
      <ul
        v-else
        class="grid list-none grid-cols-1 gap-3 p-0 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
      >
        <li
          v-for="meal in meals"
          :key="meal.id"
          class="flex flex-col overflow-hidden rounded-xl border border-line bg-surface"
        >
          <Link
            :href="itemPath(meal)"
            class="relative block aspect-[4/3] overflow-hidden bg-subtle no-underline"
            :aria-label="actionLabel(meal)"
          >
            <MealThumb :src="meal.cover?.thumbUrl" :seed="meal.id" fill />
            <span class="absolute top-2 left-2 flex gap-1.5">
              <StatusBadge :tone="meal.type === 'subscription' ? 'brand' : 'info'" solid>
                {{ t(`meals.types.${meal.type}`) }}
              </StatusBadge>
              <StatusBadge v-if="!meal.isActive" tone="neutral" solid>
                {{ t('meals.status.inactive') }}
              </StatusBadge>
            </span>
          </Link>
          <div class="flex flex-1 flex-col gap-2.5 p-3.5">
            <div class="flex items-start justify-between gap-3">
              <div class="flex min-w-0 flex-col gap-0.5">
                <Link :href="itemPath(meal)" class="text-sm leading-snug font-bold text-ink">
                  {{ meal.name }}
                </Link>
                <span class="text-xs text-ink-4">
                  {{ t(`meals.categories.${meal.category}`) }} ·
                  {{ t('meals.list.photos_count', { count: meal.photosCount }) }}
                </span>
              </div>
              <span v-if="meal.price" class="tabular text-sm font-extrabold whitespace-nowrap">{{
                meal.price
              }}</span>
              <span v-else class="text-right text-xs font-semibold text-ink-4">{{
                t('meals.included')
              }}</span>
            </div>
            <MealBadges :tags="meal.tags" :allergens="meal.allergens" :max="4" />
          </div>
        </li>
      </ul>
      <PaginationNav v-if="meta.lastPage > 1" :meta="meta" />
    </template>

    <!-- List -->
    <DataTable
      v-else
      :columns="columns"
      :rows="meals"
      :meta="meta"
      :caption="t('meals.list.title')"
      :empty-title="filtered ? t('meals.list.no_results_title') : t('meals.list.empty_title')"
      :empty-description="filtered ? t('meals.list.no_results_body') : t('meals.list.empty_body')"
    >
      <template #cell-meal="{ row }">
        <div class="flex min-w-[220px] items-center gap-3">
          <MealThumb
            :src="row.cover?.thumbUrl"
            :seed="row.id"
            class="size-11 shrink-0 overflow-hidden rounded-[10px]"
          />
          <div class="flex min-w-0 flex-col">
            <Link :href="itemPath(row)" class="truncate font-bold text-ink">{{ row.name }}</Link>
            <span class="text-xs text-ink-4">{{ t(`meals.categories.${row.category}`) }}</span>
          </div>
        </div>
      </template>
      <template #cell-type="{ row }">
        <StatusBadge :tone="row.type === 'subscription' ? 'brand' : 'info'">
          {{ t(`meals.types.${row.type}`) }}
        </StatusBadge>
      </template>
      <template #cell-price="{ row }">
        <span v-if="row.price" class="tabular font-bold whitespace-nowrap">{{ row.price }}</span>
        <span v-else class="text-xs font-semibold text-ink-4">{{ t('meals.included') }}</span>
      </template>
      <template #cell-allergens="{ row }">
        <MealBadges v-if="row.allergens.length" :allergens="row.allergens" :max="3" />
        <span v-else class="text-ink-4">{{ t('meals.list.no_allergens') }}</span>
      </template>
      <template #cell-status="{ row }">
        <StatusBadge :tone="row.isActive ? 'brand' : 'neutral'">
          {{ row.isActive ? t('meals.status.active') : t('meals.status.inactive') }}
        </StatusBadge>
      </template>
      <template #cell-actions="{ row }">
        <AppButton
          size="sm"
          variant="secondary"
          :href="itemPath(row)"
          :aria-label="actionLabel(row)"
        >
          {{ readOnly ? t('meals.list.view') : t('meals.list.edit') }}
        </AppButton>
      </template>
    </DataTable>
  </section>
</template>
