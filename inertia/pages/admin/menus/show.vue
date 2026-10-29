<script setup lang="ts">
/**
 * Week builder (design "Back-office — Menu de la semaine"): publication
 * times, readiness banners, one column per school day and the meal catalog.
 * Every action posts to the server, which enforces the rules (holidays,
 * default dish, status workflow) and redirects back here.
 */
import { computed, ref, watch } from 'vue'
import { router, useForm } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import AppButton from '~/components/ui/app_button.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import ConfirmDialog from '~/components/ui/confirm_dialog.vue'
import ModalDialog from '~/components/ui/modal_dialog.vue'
import TextInput from '~/components/ui/text_input.vue'
import MealThumb from '~/components/meals/meal_thumb.vue'
import MenuDayColumn from '~/components/menus/menu_day_column.vue'
import MealPicker from '~/components/menus/meal_picker.vue'
import type { MealSummary } from '~/components/meals/types'
import {
  MEAL_DRAG_TYPE,
  STATUS_TONES,
  type MenuCan,
  type MenuDayView,
  type MenuIssue,
  type MenuItemView,
  type MenuReport,
  type MenuStatus,
  type MenuTemplateView,
} from '~/components/menus/types'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  week: { start: string; first: string; last: string; previous: string; next: string }
  menu: {
    id: number
    status: MenuStatus
    publishAt: string | null
    orderDeadlineAt: string | null
    publishedAt: string | null
    closedAt: string | null
    notes: string | null
  } | null
  times: { publishAt: string; orderDeadlineAt: string; fromSettings: boolean }
  days: MenuDayView[]
  catalog: MealSummary[]
  issues: MenuIssue[]
  templates: MenuTemplateView[]
  hasPreviousWeek: boolean
  recipients: number
  editRule: {
    allowParentEdits: boolean
    editMode: string
    cutoffDaysBefore: number
    cutoffTime: string
  }
  emailsEnabled: boolean
  can: MenuCan
  report: MenuReport | null
}>()

const { t, formatDate, formatDateTime, locale } = useI18n()
const base = computed(() => `/admin/menus/${props.week.start}`)
const status = computed<MenuStatus>(() => props.menu?.status ?? 'draft')
const visitOptions = { preserveScroll: true }

const title = computed(() =>
  t('menus.week_title', {
    start: formatDate(props.week.first, { day: 'numeric', month: 'long' }),
    end: formatDate(props.week.last, { day: 'numeric', month: 'long', year: 'numeric' }),
  })
)
const dayLabel = (date: string) =>
  formatDate(date, { weekday: 'long', day: 'numeric', month: 'short' })

const itemsCount = computed(() => props.days.reduce((sum, day) => sum + day.items.length, 0))
const openDaysWithMeals = computed(
  () => props.days.filter((day) => day.state === 'open' && day.items.length > 0).length
)

/* Publication times ------------------------------------------------------ */
const timesForm = useForm({
  publishAt: props.times.publishAt,
  orderDeadlineAt: props.times.orderDeadlineAt,
})
watch(
  () => props.times,
  (times) => {
    timesForm.defaults({ publishAt: times.publishAt, orderDeadlineAt: times.orderDeadlineAt })
    timesForm.reset()
  }
)
function saveTimes() {
  timesForm.put(`${base.value}/times`, visitOptions)
}

const editRuleLabel = computed(() => {
  const rule = props.editRule
  if (!rule.allowParentEdits) return t('menus.builder.edit_rule.none')
  if (rule.editMode === 'same_day_only') {
    return t('menus.builder.edit_rule.same_day_only', { time: rule.cutoffTime })
  }
  return rule.cutoffDaysBefore === 0
    ? t('menus.builder.edit_rule.until_cutoff_same_day', { time: rule.cutoffTime })
    : t('menus.builder.edit_rule.until_cutoff', {
        days: rule.cutoffDaysBefore,
        time: rule.cutoffTime,
      })
})

/* Issues ----------------------------------------------------------------- */
function issueText(issue: MenuIssue) {
  return 'date' in issue
    ? t(`menus.issues.${issue.code}`, { day: dayLabel(issue.date) })
    : t(`menus.issues.${issue.code}`)
}
const showReady = computed(
  () => props.menu !== null && status.value === 'draft' && props.issues.length === 0
)

/* Report of copy / templates -------------------------------------------- */
const reportVisible = ref(true)
watch(
  () => props.report,
  () => (reportVisible.value = true)
)
const reportLines = computed(() => {
  const report = props.report
  if (!report) return []
  const lines: string[] = []
  if (report.kind !== 'template_saved' || report.added !== undefined) {
    lines.push(t('menus.builder.report_added', { count: report.added ?? 0 }))
  }
  for (const day of report.skippedDays ?? []) {
    lines.push(
      day.reason === 'holiday'
        ? t('menus.builder.report_skipped_day_holiday', {
            day: dayLabel(day.date),
            names: day.names.join(', '),
          })
        : t('menus.builder.report_skipped_day_closed', { day: dayLabel(day.date) })
    )
  }
  for (const meal of report.skippedMeals ?? []) {
    lines.push(
      t('menus.builder.report_skipped_meal', {
        name: locale.value === 'en' ? meal.nameEn : meal.nameFr,
      })
    )
  }
  for (const date of report.newDefaults ?? []) {
    lines.push(t('menus.builder.report_new_default', { day: dayLabel(date) }))
  }
  return lines
})
const reportHasSkips = computed(
  () => (props.report?.skippedDays?.length ?? 0) + (props.report?.skippedMeals?.length ?? 0) > 0
)

/* Items ------------------------------------------------------------------ */
const processing = ref(false)
const pickerOpen = ref(false)
const picker = ref<{ date: string; type: 'subscription' | 'supplement' } | null>(null)
const pickerTaken = computed(() => {
  const day = props.days.find((candidate) => candidate.date === picker.value?.date)
  return day ? day.items.map((item) => item.meal.id) : []
})

function openPicker(date: string, type: 'subscription' | 'supplement') {
  picker.value = { date, type }
  pickerOpen.value = true
}

function addMeal(date: string, mealId: number) {
  router.post(
    `${base.value}/items`,
    { date, mealId },
    {
      ...visitOptions,
      onStart: () => (processing.value = true),
      onFinish: () => {
        processing.value = false
        pickerOpen.value = false
      },
    }
  )
}

const removeTarget = ref<MenuItemView | null>(null)
const removeOpen = ref(false)
function askRemove(item: MenuItemView) {
  // Published menu: the impact page lists the orders and how to handle them.
  if (status.value === 'published') {
    router.get(`${base.value}/items/${item.id}/remove`)
    return
  }
  removeTarget.value = item
  removeOpen.value = true
}
function confirmRemove() {
  if (!removeTarget.value) return
  router.delete(`${base.value}/items/${removeTarget.value.id}`, {
    ...visitOptions,
    onStart: () => (processing.value = true),
    onFinish: () => {
      processing.value = false
      removeOpen.value = false
    },
  })
}

function setDefault(item: MenuItemView) {
  router.post(`${base.value}/items/${item.id}/default`, {}, visitOptions)
}

const maxTarget = ref<MenuItemView | null>(null)
const maxOpen = ref(false)
const maxForm = useForm<{ maxQuantity: string }>({ maxQuantity: '' })
function editMax(item: MenuItemView) {
  maxTarget.value = item
  maxForm.clearErrors()
  maxForm.maxQuantity = item.maxQuantity ? String(item.maxQuantity) : ''
  maxOpen.value = true
}
function saveMax() {
  if (!maxTarget.value) return
  const raw = String(maxForm.maxQuantity ?? '').trim()
  maxForm
    .transform(() => ({ maxQuantity: raw === '' ? null : Number(raw) }))
    .put(`${base.value}/items/${maxTarget.value.id}`, {
      ...visitOptions,
      onSuccess: () => (maxOpen.value = false),
    })
}

/* Copy / templates ------------------------------------------------------- */
const copyOpen = ref(false)
function copyPrevious() {
  router.post(
    `${base.value}/copy-previous`,
    {},
    {
      ...visitOptions,
      onStart: () => (processing.value = true),
      onFinish: () => {
        processing.value = false
        copyOpen.value = false
      },
    }
  )
}
function askCopy() {
  if (itemsCount.value > 0) copyOpen.value = true
  else copyPrevious()
}

const templatesOpen = ref(false)
const templateForm = useForm({ name: '', description: '' })
function saveTemplate() {
  templateForm.post(`${base.value}/save-template`, {
    ...visitOptions,
    onSuccess: () => {
      templateForm.reset()
      templatesOpen.value = false
    },
  })
}
function applyTemplate(template: MenuTemplateView) {
  router.post(
    `${base.value}/apply-template`,
    { templateId: template.id },
    { ...visitOptions, onSuccess: () => (templatesOpen.value = false) }
  )
}
const deleteTemplateTarget = ref<MenuTemplateView | null>(null)
const deleteTemplateOpen = ref(false)
function askDeleteTemplate(template: MenuTemplateView) {
  deleteTemplateTarget.value = template
  deleteTemplateOpen.value = true
}
function deleteTemplate() {
  if (!deleteTemplateTarget.value) return
  router.delete(`/admin/menu-templates/${deleteTemplateTarget.value.id}`, {
    data: { week: props.week.start },
    ...visitOptions,
    onFinish: () => (deleteTemplateOpen.value = false),
  })
}

/* Status ----------------------------------------------------------------- */
const publishOpen = ref(false)
const unscheduleOpen = ref(false)
function transition(action: 'schedule' | 'unschedule' | 'publish') {
  router.post(
    `${base.value}/${action}`,
    {},
    {
      ...visitOptions,
      onStart: () => (processing.value = true),
      onFinish: () => {
        processing.value = false
        publishOpen.value = false
        unscheduleOpen.value = false
      },
    }
  )
}

/* Catalog ---------------------------------------------------------------- */
const catalogType = ref<'all' | 'subscription' | 'supplement'>('all')
const catalogSearch = ref('')
const catalogMeals = computed(() => {
  const query = catalogSearch.value.trim().toLocaleLowerCase()
  return props.catalog.filter(
    (meal) =>
      (catalogType.value === 'all' || meal.type === catalogType.value) &&
      (!query || meal.name.toLocaleLowerCase().includes(query))
  )
})
function onDragStart(event: DragEvent, meal: MealSummary) {
  event.dataTransfer?.setData(MEAL_DRAG_TYPE, String(meal.id))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}
const segmentClass = (active: boolean) =>
  active ? 'bg-surface text-ink shadow-pressed' : 'bg-transparent text-ink-4 hover:text-ink'
</script>

<template>
  <AdminLayout>
    <nav
      :aria-label="t('menus.builder.breadcrumb')"
      class="-mb-4 flex items-center gap-1.5 text-[13px] font-semibold text-ink-4"
    >
      <Link href="/admin/menus" class="text-ink-4 no-underline hover:text-ink">
        {{ t('menus.builder.breadcrumb') }}
      </Link>
      <span aria-hidden="true">›</span>
      <span
        >{{ formatDate(week.first, { day: 'numeric', month: 'short' }) }} –
        {{ formatDate(week.last, { day: 'numeric', month: 'short', year: 'numeric' }) }}</span
      >
    </nav>

    <PageHeader :title="title">
      <template #actions>
        <StatusBadge :tone="STATUS_TONES[status]">{{
          t(`menus.status.${menu ? status : 'none'}`)
        }}</StatusBadge>
        <AppButton
          v-if="can.replaceItems && hasPreviousWeek"
          variant="secondary"
          :disabled="processing"
          @click="askCopy"
        >
          {{ t('menus.builder.copy_previous') }}
        </AppButton>
        <AppButton variant="secondary" @click="templatesOpen = true">
          {{ t('menus.builder.templates') }}
        </AppButton>
        <AppButton
          v-if="can.unschedule"
          variant="secondary"
          :disabled="processing"
          @click="unscheduleOpen = true"
        >
          {{ t('menus.builder.unschedule') }}
        </AppButton>
        <AppButton
          v-if="can.publish"
          variant="secondary"
          :disabled="processing"
          @click="publishOpen = true"
        >
          {{ t('menus.builder.publish_now') }}
        </AppButton>
        <AppButton
          v-if="can.schedule"
          :disabled="processing || !menu || issues.length > 0"
          @click="transition('schedule')"
        >
          {{ t('menus.builder.schedule') }}
        </AppButton>
      </template>
    </PageHeader>

    <div class="flex flex-wrap items-center gap-2">
      <AppButton variant="ghost" size="sm" :href="`/admin/menus/${week.previous}`">
        ‹ {{ t('menus.builder.previous_week') }}
      </AppButton>
      <AppButton variant="ghost" size="sm" :href="`/admin/menus/${week.next}`">
        {{ t('menus.builder.next_week') }} ›
      </AppButton>
    </div>

    <!-- Publication -->
    <section
      :aria-label="t('menus.builder.publication')"
      class="card flex flex-wrap items-end gap-x-7 gap-y-4 px-5 py-[18px]"
    >
      <form
        v-if="can.editTimes"
        class="flex flex-wrap items-end gap-x-5 gap-y-3"
        @submit.prevent="saveTimes"
      >
        <TextInput
          id="publishAt"
          v-model="timesForm.publishAt"
          type="datetime-local"
          :label="t('menus.builder.publish_at')"
          :error="timesForm.errors.publishAt"
          required
        />
        <TextInput
          id="orderDeadlineAt"
          v-model="timesForm.orderDeadlineAt"
          type="datetime-local"
          :label="t('menus.builder.deadline')"
          :error="timesForm.errors.orderDeadlineAt"
          required
        />
        <AppButton
          type="submit"
          variant="secondary"
          :loading="timesForm.processing"
          :disabled="!timesForm.isDirty && !times.fromSettings"
        >
          {{ t('menus.builder.save_times') }}
        </AppButton>
      </form>
      <template v-else>
        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-bold text-ink-4">{{ t('menus.builder.publish_at') }}</span>
          <span class="text-sm font-semibold">
            {{
              menu?.publishedAt
                ? t('menus.builder.published_on', { date: formatDateTime(menu.publishedAt) })
                : menu?.publishAt
                  ? formatDateTime(menu.publishAt)
                  : '—'
            }}
          </span>
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-bold text-ink-4">{{ t('menus.builder.deadline') }}</span>
          <span class="text-sm font-semibold">
            {{ menu?.orderDeadlineAt ? formatDateTime(menu.orderDeadlineAt) : '—' }}
          </span>
        </div>
      </template>
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-bold text-ink-4">{{ t('menus.builder.parent_edits') }}</span>
        <span class="flex h-[50px] items-center text-sm font-semibold">{{ editRuleLabel }}</span>
      </div>
      <div
        class="flex min-w-[240px] flex-[1_1_260px] items-start gap-3 rounded-xl bg-canvas px-3.5 py-3"
      >
        <svg
          class="mt-0.5 size-5 shrink-0 text-ink-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
        <span class="text-[13px] leading-snug text-ink-2">
          {{
            t(emailsEnabled ? 'menus.builder.recipients' : 'menus.builder.recipients_no_email', {
              count: recipients,
            })
          }}
          <template v-if="can.editTimes">
            {{ times.fromSettings ? t('menus.builder.from_settings') : '' }}
            {{ t('menus.builder.times_hint') }}
          </template>
        </span>
      </div>
    </section>

    <!-- Status notices -->
    <div
      v-if="status === 'scheduled' && menu?.publishAt"
      role="status"
      class="rounded-[14px] border border-info-line bg-info-soft px-4 py-3.5 text-sm text-info"
    >
      {{ t('menus.builder.scheduled_notice', { date: formatDateTime(menu.publishAt) }) }}
    </div>
    <div
      v-if="status === 'published'"
      role="status"
      class="rounded-[14px] border border-[#bfdccb] bg-brand-soft px-4 py-3.5 text-sm text-brand-deep"
    >
      {{ t('menus.builder.published_notice') }}
    </div>
    <div
      v-if="status === 'closed'"
      role="status"
      class="rounded-[14px] border border-line bg-subtle px-4 py-3.5 text-sm text-ink-3"
    >
      {{ t('menus.builder.closed_notice') }}
    </div>

    <!-- Copy / template report -->
    <div
      v-if="report && reportVisible"
      role="status"
      class="flex items-start justify-between gap-3 rounded-[14px] border px-4 py-3.5 text-sm"
      :class="
        reportHasSkips
          ? 'border-[#f0d3a8] bg-warning-soft text-warning-ink'
          : 'border-[#bfdccb] bg-brand-soft text-brand-deep'
      "
    >
      <div class="flex flex-col gap-1">
        <strong class="font-bold">{{ t(`menus.builder.report_title_${report.kind}`) }}</strong>
        <ul class="flex list-disc flex-col gap-0.5 pl-5">
          <li v-for="line in reportLines" :key="line">{{ line }}</li>
        </ul>
      </div>
      <button
        type="button"
        class="shrink-0 text-xs font-bold underline"
        @click="reportVisible = false"
      >
        {{ t('menus.builder.dismiss') }}
      </button>
    </div>

    <!-- Readiness -->
    <div
      v-if="menu && issues.length && status !== 'closed'"
      role="status"
      class="flex flex-col gap-1.5 rounded-[14px] border border-[#f0d3a8] bg-warning-soft px-4 py-3.5 text-sm text-warning-ink"
    >
      <strong class="font-bold">{{ t('menus.builder.issues_title') }}</strong>
      <ul class="flex list-disc flex-col gap-0.5 pl-5">
        <li v-for="(issue, index) in issues" :key="index">{{ issueText(issue) }}</li>
      </ul>
    </div>
    <div
      v-if="showReady"
      role="status"
      class="rounded-[14px] border border-[#bfdccb] bg-brand-soft px-4 py-3.5 text-sm text-[#134a31]"
    >
      <strong class="font-bold">{{ t('menus.builder.ready') }}</strong>
      {{ t('menus.builder.ready_detail', { count: openDaysWithMeals }) }}
    </div>

    <!-- Days -->
    <div class="overflow-x-auto pb-1">
      <div
        class="grid gap-3.5"
        :style="{
          gridTemplateColumns: `repeat(${days.length}, minmax(208px, 1fr))`,
          minWidth: `${days.length * 222}px`,
        }"
      >
        <MenuDayColumn
          v-for="day in days"
          :key="day.date"
          :day="day"
          :can="can"
          @add="openPicker"
          @drop="addMeal"
          @remove="askRemove"
          @set-default="setDefault"
          @edit-max="editMax"
        />
      </div>
    </div>

    <!-- Catalog -->
    <section
      v-if="can.addItems"
      :aria-label="t('menus.builder.catalog')"
      class="card flex flex-col gap-4 p-5"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-col gap-0.5">
          <h2 class="text-lg font-bold">{{ t('menus.builder.catalog') }}</h2>
          <span class="text-[13px] text-ink-4">{{ t('menus.builder.catalog_hint') }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div
            role="group"
            :aria-label="t('menus.builder.meal_type')"
            class="flex gap-1 rounded-xl bg-subtle p-1"
          >
            <button
              v-for="option in ['all', 'subscription', 'supplement'] as const"
              :key="option"
              type="button"
              class="min-h-9 rounded-[9px] px-3.5 text-[13px] font-bold"
              :class="segmentClass(catalogType === option)"
              :aria-pressed="catalogType === option"
              @click="catalogType = option"
            >
              {{ t(`menus.builder.filter_${option}`) }}
            </button>
          </div>
          <label
            class="flex h-11 items-center gap-2 rounded-xl border border-line-strong px-3 text-ink-4"
          >
            <svg
              class="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <span class="sr-only">{{ t('menus.builder.search') }}</span>
            <input
              v-model="catalogSearch"
              type="search"
              :placeholder="t('menus.builder.search_placeholder')"
              class="w-40 border-0 bg-transparent text-sm text-ink outline-none"
            />
          </label>
        </div>
      </div>
      <p v-if="!catalogMeals.length" class="text-sm text-ink-4">
        {{ t('menus.builder.picker_empty') }}
      </p>
      <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
        <div
          v-for="meal in catalogMeals"
          :key="meal.id"
          draggable="true"
          class="flex cursor-grab items-center gap-2.5 rounded-xl border border-line p-2.5"
          @dragstart="onDragStart($event, meal)"
        >
          <MealThumb
            :src="meal.cover?.thumbUrl"
            :seed="meal.id"
            class="size-10 shrink-0 overflow-hidden rounded-[10px]"
          />
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-[13px] leading-tight font-bold">{{ meal.name }}</span>
            <span class="text-xs text-ink-4"
              >{{ t(`meals.types.${meal.type}`)
              }}<template v-if="meal.price"> · {{ meal.price }}</template></span
            >
          </div>
        </div>
      </div>
    </section>

    <!-- Dialogs -->
    <MealPicker
      v-model:open="pickerOpen"
      :title="picker ? t('menus.builder.picker_title', { day: dayLabel(picker.date) }) : ''"
      :type="picker?.type ?? 'subscription'"
      :catalog="catalog"
      :taken="pickerTaken"
      :processing="processing"
      @pick="(mealId) => picker && addMeal(picker.date, mealId)"
    />

    <ConfirmDialog
      v-model:open="removeOpen"
      :title="t('menus.builder.remove_confirm_title')"
      :message="
        removeTarget
          ? t('menus.builder.remove_confirm_body', {
              name: removeTarget.meal.name,
              day: dayLabel(removeTarget.date),
            })
          : ''
      "
      :confirm-label="t('ui.delete')"
      danger
      :processing="processing"
      @confirm="confirmRemove"
    />

    <ModalDialog
      v-model:open="maxOpen"
      :title="maxTarget ? t('menus.builder.edit_max', { name: maxTarget.meal.name }) : ''"
      size="sm"
    >
      <form id="max-form" @submit.prevent="saveMax">
        <TextInput
          id="maxQuantity"
          v-model="maxForm.maxQuantity"
          type="number"
          :label="t('menus.builder.max_quantity_label')"
          :hint="t('menus.builder.max_quantity_hint')"
          :error="maxForm.errors.maxQuantity"
        />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="maxOpen = false">{{ t('ui.cancel') }}</AppButton>
        <AppButton type="submit" form="max-form" :loading="maxForm.processing">{{
          t('ui.save')
        }}</AppButton>
      </template>
    </ModalDialog>

    <ConfirmDialog
      v-model:open="copyOpen"
      :title="t('menus.builder.copy_confirm_title')"
      :message="t('menus.builder.copy_confirm_body')"
      :processing="processing"
      @confirm="copyPrevious"
    />
    <ConfirmDialog
      v-model:open="publishOpen"
      :title="t('menus.builder.publish_confirm_title')"
      :message="t('menus.builder.publish_confirm_body')"
      :confirm-label="t('menus.builder.publish_now')"
      :processing="processing"
      @confirm="transition('publish')"
    />
    <ConfirmDialog
      v-model:open="unscheduleOpen"
      :title="t('menus.builder.unschedule_confirm_title')"
      :message="t('menus.builder.unschedule_confirm_body')"
      :confirm-label="t('menus.builder.unschedule')"
      :processing="processing"
      @confirm="transition('unschedule')"
    />

    <ModalDialog v-model:open="templatesOpen" :title="t('menus.builder.templates_title')" size="lg">
      <div class="flex flex-col gap-5 text-ink">
        <section class="flex flex-col gap-2">
          <h3 class="text-sm font-bold">{{ t('menus.builder.templates_apply') }}</h3>
          <p class="text-[13px] text-ink-4">
            {{
              can.replaceItems
                ? t('menus.builder.templates_apply_hint')
                : t('menus.builder.replace_only_draft')
            }}
          </p>
          <p v-if="!templates.length" class="text-sm text-ink-4">
            {{ t('menus.builder.templates_empty') }}
          </p>
          <ul v-else class="flex flex-col gap-2">
            <li
              v-for="template in templates"
              :key="template.id"
              class="flex items-center gap-3 rounded-xl border border-line p-3"
            >
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="text-sm font-bold">{{ template.name }}</span>
                <span class="text-xs text-ink-4">
                  {{ t('menus.builder.templates_items', { count: template.itemsCount }) }}
                  <template v-if="template.description"> · {{ template.description }}</template>
                </span>
              </span>
              <AppButton size="sm" :disabled="!can.replaceItems" @click="applyTemplate(template)">
                {{ t('menus.builder.template_apply') }}
              </AppButton>
              <button
                type="button"
                class="flex size-9 items-center justify-center rounded-lg text-ink-4 hover:bg-danger-soft hover:text-danger"
                :aria-label="t('menus.builder.template_delete', { name: template.name })"
                @click="askDeleteTemplate(template)"
              >
                <svg
                  class="size-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                </svg>
              </button>
            </li>
          </ul>
        </section>
        <form
          v-if="menu && itemsCount > 0"
          class="flex flex-col gap-3 border-t border-line pt-4"
          @submit.prevent="saveTemplate"
        >
          <h3 class="text-sm font-bold">{{ t('menus.builder.templates_save') }}</h3>
          <TextInput
            id="name"
            v-model="templateForm.name"
            :label="t('menus.builder.template_name')"
            :error="templateForm.errors.name"
            required
          />
          <TextInput
            id="description"
            v-model="templateForm.description"
            :label="t('menus.builder.template_description')"
            :error="templateForm.errors.description"
          />
          <AppButton
            type="submit"
            variant="secondary"
            :loading="templateForm.processing"
            class="self-start"
          >
            {{ t('menus.builder.template_save') }}
          </AppButton>
        </form>
      </div>
    </ModalDialog>

    <ConfirmDialog
      v-model:open="deleteTemplateOpen"
      :title="t('menus.builder.template_delete_title')"
      :message="
        deleteTemplateTarget
          ? t('menus.builder.template_delete_body', { name: deleteTemplateTarget.name })
          : ''
      "
      :confirm-label="t('ui.delete')"
      danger
      @confirm="deleteTemplate"
    />
  </AdminLayout>
</template>
