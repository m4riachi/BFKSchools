<script setup lang="ts">
/**
 * Parent portal — weekly orders (design "Lunch orders", mobile-first).
 * The server sends each day's state, reason and option flags
 * (OrderWindowService); edits autosave per day and the page reloads the
 * server's answer. Nothing here decides whether a day is orderable.
 */
import { computed, ref } from 'vue'
import { Head, router, usePage } from '@inertiajs/vue3'
import ParentLayout from '~/layouts/parent_layout.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import ModalDialog from '~/components/ui/modal_dialog.vue'
import DayCard from '~/components/orders/day_card.vue'
import { useI18n } from '~/composables/use_i18n'
import type { Selection, WeekView } from '~/components/orders/types'

type ChildItem = {
  id: number
  firstName: string
  lastName: string
  grade: string | null
  className: string | null
  totalCents: number
  total: string
}

const props = defineProps<{
  today: string
  week: {
    start: string
    first: string
    last: string
    current: string
    following: string
    previous: string | null
    next: string | null
  }
  children: ChildItem[]
  childId: number | null
  view: WeekView | null
  family: { totalCents: number; total: string }
}>()

const { t, formatDate, formatDateTime } = useI18n()
const page = usePage()
const firstName = computed(() => page.props.user?.fullName.split(' ')[0] ?? '')
const child = computed(() => props.children.find((c) => c.id === props.childId) ?? null)
const nextWeek = computed(() => props.week.following)

function go(params: { child?: number; week?: string }) {
  router.get(
    '/',
    { child: params.child ?? props.childId ?? undefined, week: params.week ?? props.week.start },
    { preserveScroll: true, preserveState: false }
  )
}

function range(first: string, last: string) {
  return `${formatDate(first, { day: 'numeric' })} – ${formatDate(last, { day: 'numeric', month: 'short' })}`
}

const instant = (iso: string) =>
  formatDateTime(iso, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

const published = computed(
  () => props.view?.menu && ['published', 'closed'].includes(props.view.menu.status)
)

const banner = computed(() => {
  const menu = props.view?.menu
  if (!menu || !published.value || !menu.orderDeadlineAt) return null
  const rules = props.view!.rules
  if (!menu.deadlinePassed) {
    return {
      strong: t('orders.week.deadline_open', { date: instant(menu.orderDeadlineAt) }),
      rest: t('orders.week.autosave'),
    }
  }
  let rest = t('orders.week.edits_closed')
  if (rules.allowParentEdits) {
    const day = props.view!.days[0]
    const time = day ? formatDateTime(day.cutoffAt, { hour: '2-digit', minute: '2-digit' }) : ''
    rest =
      rules.editMode === 'same_day_only'
        ? t('orders.week.edits_same_day', { time })
        : t('orders.week.edits_until_cutoff', { time, days: rules.cutoffDaysBefore })
  }
  return { strong: t('orders.week.deadline_passed', { date: instant(menu.orderDeadlineAt) }), rest }
})

/* Saving (debounced per day) */
const saving = ref<string | null>(null)
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function post(url: string, data: Record<string, any>, date: string) {
  router.post(url, data, {
    preserveScroll: true,
    preserveState: true,
    onStart: () => (saving.value = date),
    onFinish: () => (saving.value = null),
  })
}

function onChange(date: string, selection: Selection, confirmAllergy: boolean) {
  if (!props.childId) return
  clearTimeout(timers.get(date))
  timers.set(
    date,
    setTimeout(() => {
      post(`/orders/${props.childId}/days/${date}`, { ...selection, confirmAllergy }, date)
    }, 500)
  )
}

function onAbsent(date: string) {
  if (!props.childId) return
  clearTimeout(timers.get(date))
  post(`/orders/${props.childId}/days/${date}/absent`, {}, date)
}

/* Same choice for all my children */
const applyOpen = ref(false)
const applyDate = ref('')
const applySelection = ref<Selection | 'absent'>('absent')
const applyChildren = ref<number[]>([])
const others = computed(() => props.children.filter((c) => c.id !== props.childId))

function askApply(date: string, selection: Selection | 'absent') {
  applyDate.value = date
  applySelection.value = selection
  applyChildren.value = others.value.map((c) => c.id)
  applyOpen.value = true
}

function apply() {
  const ids = applyChildren.value
  if (!ids.length) return
  const selection = applySelection.value
  router.post(
    `/orders/days/${applyDate.value}/all`,
    selection === 'absent' ? { absent: true, childIds: ids } : { ...selection, childIds: ids },
    { preserveScroll: true, onSuccess: () => (applyOpen.value = false) }
  )
}
</script>

<template>
  <ParentLayout>
    <Head :title="t('pages.parent_home.title')" />
    <div class="flex items-end justify-between gap-3">
      <div class="flex flex-col gap-0.5">
        <span class="text-sm text-ink-3">{{ t('orders.week.hello', { name: firstName }) }}</span>
        <h1 class="text-[26px] font-extrabold tracking-[-0.02em]">
          {{ t('pages.parent_home.title') }}
        </h1>
      </div>
      <div v-if="child && view" class="flex flex-col items-end gap-px">
        <span class="text-xs text-ink-3">{{
          t('orders.week.child_week_total', { name: child.firstName })
        }}</span>
        <span class="tabular text-lg font-extrabold">{{ view.total }}</span>
      </div>
    </div>

    <section v-if="!children.length" class="rounded-[18px] border border-line bg-surface">
      <EmptyState
        tone="info"
        :title="t('orders.week.no_children_title')"
        :description="t('orders.week.no_children_body')"
      />
    </section>

    <template v-else>
      <div
        v-if="children.length > 1"
        role="group"
        :aria-label="t('orders.week.choose_child')"
        class="flex gap-2.5"
      >
        <button
          v-for="c in children"
          :key="c.id"
          type="button"
          :aria-pressed="c.id === childId ? 'true' : 'false'"
          class="flex min-h-[60px] min-w-0 flex-1 items-center gap-2.5 rounded-[14px] border-[1.5px] px-3 py-2.5 text-left"
          :class="c.id === childId ? 'border-brand bg-[#eef6f1]' : 'border-line bg-surface'"
          @click="go({ child: c.id })"
        >
          <span
            aria-hidden="true"
            class="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold"
            :class="c.id === childId ? 'bg-brand text-white' : 'bg-brand-tint text-brand-strong'"
          >
            {{ c.firstName.charAt(0) }}
          </span>
          <span class="flex min-w-0 flex-col gap-px">
            <span class="truncate text-[15px] font-bold text-ink">{{ c.firstName }}</span>
            <span class="truncate text-xs text-ink-3">{{
              [c.grade, c.className].filter(Boolean).join(' · ')
            }}</span>
          </span>
        </button>
      </div>

      <div
        role="group"
        :aria-label="t('orders.week.week_group')"
        class="flex gap-1 rounded-[14px] bg-muted-bg p-1"
      >
        <button
          v-if="week.start !== week.current && week.start !== nextWeek && week.previous"
          type="button"
          class="flex min-h-12 w-12 items-center justify-center rounded-[11px] text-ink-3"
          :aria-label="t('orders.week.previous')"
          @click="go({ week: week.previous! })"
        >
          ‹
        </button>
        <button
          type="button"
          :aria-pressed="week.start === week.current ? 'true' : 'false'"
          class="flex min-h-12 flex-1 flex-col items-center justify-center gap-px rounded-[11px]"
          :class="week.start === week.current ? 'bg-surface text-ink shadow-sm' : 'text-ink-3'"
          @click="go({ week: week.current })"
        >
          <span class="text-sm font-bold">{{ t('orders.week.this_week') }}</span>
        </button>
        <button
          type="button"
          :aria-pressed="week.start === nextWeek ? 'true' : 'false'"
          class="flex min-h-12 flex-1 flex-col items-center justify-center gap-px rounded-[11px]"
          :class="week.start === nextWeek ? 'bg-surface text-ink shadow-sm' : 'text-ink-3'"
          @click="go({ week: nextWeek })"
        >
          <span class="text-sm font-bold">{{ t('orders.week.next_week') }}</span>
        </button>
        <button
          v-if="week.next"
          type="button"
          class="flex min-h-12 w-12 items-center justify-center rounded-[11px] text-ink-3"
          :aria-label="t('orders.week.next')"
          @click="go({ week: week.next! })"
        >
          ›
        </button>
      </div>
      <p class="-mt-2 text-center text-xs font-semibold text-ink-3">
        {{ range(week.first, week.last) }}
      </p>

      <!-- Menu not published -->
      <section
        v-if="view && !published"
        class="flex flex-col items-center gap-3 rounded-[18px] border border-line bg-surface px-5 py-6 text-center"
      >
        <h2 class="text-[19px] font-extrabold">{{ t('orders.week.not_published_title') }}</h2>
        <p class="text-sm leading-relaxed text-ink-3">
          {{
            view.menu?.status === 'scheduled' && view.menu.publishAt
              ? t('orders.week.not_published_body', { date: instant(view.menu.publishAt) })
              : t('orders.week.not_published_soon')
          }}
        </p>
        <span
          v-if="view.menu?.status === 'scheduled' && view.menu.orderDeadlineAt"
          class="rounded-full bg-warning-soft px-3 py-1.5 text-[13px] font-bold text-warning"
        >
          {{ t('orders.week.closes', { date: instant(view.menu.orderDeadlineAt) }) }}
        </span>
      </section>

      <template v-else-if="view && child">
        <div
          v-if="banner"
          role="note"
          class="rounded-[14px] bg-warning-soft px-3.5 py-3 text-[13px] leading-normal text-warning-ink"
        >
          <strong class="font-bold">{{ banner.strong }}</strong> {{ banner.rest }}
        </div>
        <div
          v-if="view.allergies.length"
          role="note"
          class="rounded-[14px] bg-danger-soft px-3.5 py-3 text-[13px] leading-normal text-danger-ink"
        >
          {{
            t('orders.week.allergies', {
              name: child.firstName,
              list: view.allergies.map((a) => a.label).join(', '),
            })
          }}
          {{
            view.rules.allergyRule === 'block'
              ? t('orders.week.allergies_block')
              : t('orders.week.allergies_confirm')
          }}
        </div>

        <DayCard
          v-for="day in view.days"
          :key="`${childId}-${day.date}`"
          :day="day"
          :child-name="child.firstName"
          :saving="saving === day.date"
          :can-apply-all="others.length > 0"
          @change="(selection, confirm) => onChange(day.date, selection, confirm)"
          @absent="onAbsent(day.date)"
          @apply-all="(selection) => askApply(day.date, selection)"
        />

        <section
          :aria-label="t('orders.week.summary')"
          class="flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-4"
        >
          <h2 class="text-[17px] font-extrabold">{{ t('orders.week.summary') }}</h2>
          <div v-for="c in children" :key="c.id" class="flex items-baseline justify-between gap-2">
            <span class="text-sm text-ink-2"
              >{{ c.firstName }} · {{ range(week.first, week.last) }}</span
            >
            <span class="tabular text-base font-extrabold">{{ c.total }}</span>
          </div>
          <div class="h-px bg-line" />
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-sm font-bold">{{
              t('orders.week.family_total', { count: children.length })
            }}</span>
            <span class="tabular text-xl font-extrabold">{{ family.total }}</span>
          </div>
          <p class="text-xs leading-normal text-ink-3">{{ t('orders.week.summary_note') }}</p>
        </section>
      </template>
    </template>

    <ModalDialog v-model:open="applyOpen" :title="t('orders.week.apply_all_title')" size="sm">
      <div class="flex flex-col gap-3">
        <p class="text-sm text-ink-2">
          {{
            t('orders.week.apply_all_body', {
              name: child?.firstName ?? '',
              date: applyDate
                ? formatDate(applyDate, { weekday: 'long', day: 'numeric', month: 'long' })
                : '',
            })
          }}
        </p>
        <label
          v-for="c in others"
          :key="c.id"
          class="flex min-h-11 items-center gap-3 text-sm font-semibold"
        >
          <input
            v-model="applyChildren"
            type="checkbox"
            :value="c.id"
            class="size-5 accent-brand"
          />
          {{ c.firstName }}
        </label>
        <button
          type="button"
          class="min-h-11 rounded-xl bg-brand px-4 text-sm font-bold text-white disabled:opacity-60"
          :disabled="!applyChildren.length"
          @click="apply"
        >
          {{ t('orders.week.apply') }}
        </button>
      </div>
    </ModalDialog>
  </ParentLayout>
</template>
