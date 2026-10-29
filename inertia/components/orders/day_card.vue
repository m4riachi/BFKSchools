<script setup lang="ts">
/**
 * One day of a child's week (design "Lunch orders"): state pill and reason,
 * main meal radios, extras with +/−, "no meal this day". Every state, flag
 * and limit comes from the server (OrderWindowService); this component only
 * displays them and emits the selection the user wants. The server checks
 * everything again on save.
 *
 * mode = 'parent': emits `change` on every edit (the page autosaves).
 * mode = 'staff': edits stay local until "Save day" (audited override).
 */
import { computed, ref, watch } from 'vue'
import MealThumb from '~/components/meals/meal_thumb.vue'
import ConfirmDialog from '~/components/ui/confirm_dialog.vue'
import { useI18n } from '~/composables/use_i18n'
import {
  isEmptySelection,
  selectionOf,
  type DayView,
  type OptionView,
  type Selection,
} from './types'

const props = withDefaults(
  defineProps<{
    day: DayView
    childName: string
    mode?: 'parent' | 'staff'
    saving?: boolean
    canApplyAll?: boolean
  }>(),
  { mode: 'parent', saving: false, canApplyAll: false }
)
const emit = defineEmits<{
  change: [selection: Selection, confirmAllergy: boolean]
  absent: []
  applyAll: [selection: Selection | 'absent']
}>()

const { t, formatDate, formatDateTime } = useI18n()

const selection = ref<Selection>(selectionOf(props.day))
const confirmed = ref(false)
watch(
  () => props.day,
  (day) => {
    selection.value = selectionOf(day)
    confirmed.value = false
  }
)

const title = computed(() =>
  formatDate(props.day.date, { weekday: 'short', day: 'numeric', month: 'short' })
)
const absent = computed(() => props.day.order?.status === 'cancelled')
/** Staff may override time locks; structural locks stay closed. */
const editable = computed(() =>
  props.mode === 'staff' ? props.day.staffEditable : props.day.editable
)
const mains = computed(() => props.day.options.filter((o) => o.type === 'subscription'))
const extras = computed(() => props.day.options.filter((o) => o.type === 'supplement'))

const pill = computed(() => {
  if (props.day.state === 'holiday')
    return { label: t('orders.states.holiday'), cls: 'bg-info-soft text-info' }
  if (props.day.state === 'open' && absent.value)
    return { label: t('orders.states.absent'), cls: 'bg-warning-soft text-warning' }
  if (props.day.state === 'open')
    return { label: t('orders.states.open'), cls: 'bg-brand-soft text-brand-strong' }
  return { label: t(`orders.states.${props.day.state}`), cls: 'bg-muted-bg text-ink-3' }
})

const note = computed(() => {
  if (props.day.editable && props.day.editableUntil) {
    return t('orders.week.change_until', {
      date: formatDateTime(props.day.editableUntil, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
    })
  }
  if (props.day.state === 'holiday') return props.day.holidayNames.join(' · ')
  return props.day.reason ? t(`orders.reasons.${props.day.reason}`) : ''
})

function qtyOf(option: OptionView) {
  if (option.type === 'subscription')
    return selection.value.subscriptionMealId === option.mealId ? 1 : 0
  return selection.value.supplements.find((s) => s.mealId === option.mealId)?.qty ?? 0
}

/** Can the user add this option (one more portion)? Server flags only. */
function canAdd(option: OptionView) {
  return qtyOf(option) < option.maxQty
}

function emitChange() {
  if (props.mode === 'parent') {
    if (isEmptySelection(selection.value)) {
      if (props.day.order?.status === 'active') emit('absent')
      return
    }
    emit('change', selection.value, confirmed.value)
  }
}

/* Allergy confirmation (warn_confirm rule) */
const confirmOpen = ref(false)
const pendingOption = ref<OptionView | null>(null)
function needsConfirm(option: OptionView) {
  return option.needsAllergyConfirm && qtyOf(option) === option.quantity && !confirmed.value
}
function withConfirm(option: OptionView, apply: () => void) {
  if (needsConfirm(option)) {
    pendingOption.value = option
    pendingApply = apply
    confirmOpen.value = true
    return
  }
  apply()
}
let pendingApply: (() => void) | null = null
function onConfirm() {
  confirmOpen.value = false
  confirmed.value = true
  pendingApply?.()
  pendingApply = null
}

function pickMain(option: OptionView) {
  if (!editable.value || qtyOf(option) === 1 || !canAdd(option)) return
  withConfirm(option, () => {
    selection.value = { ...selection.value, subscriptionMealId: option.mealId }
    emitChange()
  })
}

function changeExtra(option: OptionView, delta: number) {
  const current = qtyOf(option)
  const next = current + delta
  if (next < 0 || (delta > 0 && !canAdd(option))) return
  const apply = () => {
    const others = selection.value.supplements.filter((s) => s.mealId !== option.mealId)
    selection.value = {
      ...selection.value,
      supplements: next > 0 ? [...others, { mealId: option.mealId, qty: next }] : others,
    }
    emitChange()
  }
  if (delta > 0) withConfirm(option, apply)
  else apply()
}

function orderInstead() {
  const fallback =
    mains.value.find((o) => o.isDefault && o.maxQty > 0) ?? mains.value.find((o) => o.maxQty > 0)
  if (!fallback) return
  selection.value = { subscriptionMealId: fallback.mealId, supplements: [] }
  withConfirm(fallback, emitChange)
}

function staffSave() {
  emit('change', selection.value, confirmed.value)
}

function mainNote(option: OptionView) {
  if (option.allergyConflicts.length) {
    return t('orders.week.contains', {
      list: option.allergyConflicts.map((a) => a.label.toLowerCase()).join(', '),
      name: props.childName,
    })
  }
  if (option.unavailable) return t('orders.week.unavailable')
  if (option.noSubscription) return t('orders.week.no_subscription')
  if (option.soldOut && option.quantity === 0) return t('orders.week.sold_out')
  if (option.remaining !== null && option.remaining <= 5) {
    return t('orders.week.remaining', { count: option.remaining })
  }
  return ''
}
</script>

<template>
  <section
    :aria-label="title"
    class="flex flex-col gap-3.5 rounded-[18px] border p-4"
    :class="day.state === 'holiday' ? 'border-info-line bg-[#f5f7fd]' : 'border-line bg-surface'"
  >
    <div class="flex items-start justify-between gap-2.5">
      <div class="flex min-w-0 flex-col gap-[3px]">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-[17px] font-extrabold first-letter:uppercase">{{ title }}</h2>
          <span class="rounded-full px-[9px] py-[3px] text-xs font-bold" :class="pill.cls">
            {{ pill.label }}
          </span>
        </div>
        <span class="text-[13px] text-ink-3">{{ note }}</span>
      </div>
      <span
        v-if="day.state !== 'holiday' && day.state !== 'not_published' && day.totalCents > 0"
        class="tabular text-[15px] font-extrabold whitespace-nowrap"
      >
        {{ day.total }}
      </span>
    </div>

    <!-- Holiday -->
    <div v-if="day.state === 'holiday'" class="flex items-center gap-3">
      <div
        class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#e3e8f8] text-info"
        aria-hidden="true"
      >
        <svg
          class="size-[22px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
        >
          <path d="M5 21V4" />
          <path d="M5 4h11l-2 4 2 4H5" />
        </svg>
      </div>
      <div class="flex flex-col gap-0.5">
        <span class="text-[15px] font-bold text-info">{{ day.holidayNames.join(' · ') }}</span>
        <span class="text-[13px] text-ink-3">{{ t('orders.week.holiday_text') }}</span>
      </div>
    </div>

    <!-- Locked (or not editable): what was ordered -->
    <div
      v-else-if="!editable && day.state !== 'not_published'"
      class="flex flex-col gap-2 rounded-xl bg-canvas p-3"
    >
      <template v-if="day.order?.status === 'active' && day.order.lines.length">
        <span
          v-for="line in day.order.lines"
          :key="line.mealId"
          class="flex items-center gap-2 text-sm font-semibold"
        >
          <svg
            class="size-4 text-brand"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            aria-hidden="true"
          >
            <path d="M5 12.5 10 17.5 19 7" />
          </svg>
          {{ line.name
          }}<template v-if="line.type === 'supplement'"> × {{ line.quantity }}</template>
        </span>
      </template>
      <span v-else class="text-sm font-semibold text-ink-3">
        {{ absent ? t('orders.states.absent') : t('orders.week.nothing_ordered') }}
      </span>
      <span v-if="day.state === 'locked'" class="flex items-center gap-1.5 text-xs text-ink-3">
        <svg
          class="size-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <rect x="5" y="10.5" width="14" height="10" rx="2" />
          <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
        </svg>
        {{ t('orders.week.locked_note') }}
      </span>
    </div>

    <!-- Open but "no meal this day" -->
    <div
      v-else-if="editable && absent && mode === 'parent'"
      class="flex flex-col gap-3 rounded-xl bg-[#fff9f1] p-3.5"
    >
      <span class="text-sm leading-normal text-ink-2">
        {{ t('orders.week.absent_text', { name: childName }) }}
      </span>
      <button
        type="button"
        class="min-h-11 self-start rounded-xl border border-line-input bg-surface px-4 text-sm font-bold text-ink disabled:opacity-60"
        :disabled="saving || !mains.some((o) => o.maxQty > 0)"
        @click="orderInstead"
      >
        {{ t('orders.week.order_instead') }}
      </button>
    </div>

    <!-- Editable -->
    <template v-else-if="editable">
      <fieldset v-if="mains.length" class="m-0 flex flex-col gap-2 border-0 p-0">
        <legend class="mb-2 p-0 text-[11px] font-extrabold tracking-[0.07em] text-ink-3 uppercase">
          {{ t('orders.week.main_meal') }}
        </legend>
        <p v-if="!day.hasSubscription" class="text-[13px] text-ink-3">
          {{ t('orders.week.no_subscription_note', { name: childName }) }}
        </p>
        <label
          v-for="option in mains"
          :key="option.menuItemId"
          class="flex items-start gap-3 rounded-[14px] border-[1.5px] p-3"
          :class="[
            qtyOf(option) === 1
              ? 'border-brand bg-[#eef6f1]'
              : canAdd(option)
                ? 'cursor-pointer border-line bg-surface'
                : 'cursor-not-allowed border-line bg-[#f6f7f6]',
          ]"
        >
          <input
            type="radio"
            :name="`meal-${day.date}`"
            class="mt-[15px] size-5 shrink-0 accent-brand"
            :checked="qtyOf(option) === 1"
            :disabled="saving || (qtyOf(option) === 0 && !canAdd(option))"
            @change="pickMain(option)"
          />
          <MealThumb
            :src="option.cover?.thumbUrl"
            :seed="option.mealId"
            class="size-[52px] shrink-0 overflow-hidden rounded-xl"
          />
          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <div class="flex justify-between gap-2">
              <span
                class="text-[15px] leading-tight font-bold"
                :class="canAdd(option) || qtyOf(option) ? 'text-ink' : 'text-ink-4'"
              >
                {{ option.name }}
              </span>
              <span v-if="option.price" class="tabular text-sm font-extrabold whitespace-nowrap">{{
                option.price
              }}</span>
            </div>
            <span v-if="option.description" class="text-[13px] leading-snug text-ink-3">
              {{ option.description }}
            </span>
            <div class="flex flex-wrap gap-[5px]">
              <span
                v-if="option.isDefault"
                class="rounded-full bg-brand px-2 py-[3px] text-[11px] font-extrabold text-white"
              >
                {{ t('orders.week.default') }}
              </span>
              <span
                v-for="tag in option.tags"
                :key="tag"
                class="rounded-full bg-brand-soft px-2 py-[3px] text-[11px] font-bold text-brand-strong"
              >
                {{ t(`meals.tags.${tag}`) }}
              </span>
              <span
                v-for="allergen in option.allergens"
                :key="allergen.code"
                class="rounded-full px-2 py-[3px] text-[11px] font-bold"
                :class="
                  option.allergyConflicts.some((a) => a.code === allergen.code)
                    ? 'bg-danger-soft text-danger'
                    : 'bg-[#eef1ef] text-ink-3'
                "
              >
                {{ allergen.label }}
              </span>
            </div>
            <span
              v-if="mainNote(option)"
              class="text-[13px] font-bold"
              :class="option.allergyConflicts.length ? 'text-danger' : 'text-warning'"
            >
              {{ mainNote(option) }}
            </span>
          </div>
        </label>
      </fieldset>

      <div v-if="extras.length" class="flex flex-col gap-2">
        <h3 class="mb-0.5 text-[11px] font-extrabold tracking-[0.07em] text-ink-3 uppercase">
          {{ t('orders.week.extras') }}
        </h3>
        <div
          v-for="option in extras"
          :key="option.menuItemId"
          class="flex items-center justify-between gap-2.5 rounded-[14px] border py-1.5 pr-1.5 pl-3.5"
          :class="qtyOf(option) > 0 ? 'border-[#9ccbb2] bg-[#f3f9f6]' : 'border-line bg-surface'"
        >
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-sm font-bold">{{ option.name }}</span>
            <span class="text-xs text-ink-3">
              {{ option.price ?? t('meals.included')
              }}<template v-if="option.allergens.length">
                · {{ option.allergens.map((a) => a.label).join(', ') }}</template
              >
            </span>
            <span
              v-if="mainNote(option)"
              class="text-xs font-bold"
              :class="option.allergyConflicts.length ? 'text-danger' : 'text-warning'"
            >
              {{ mainNote(option) }}
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              class="flex size-11 items-center justify-center rounded-xl text-ink disabled:text-ink-4/60"
              :disabled="saving || qtyOf(option) === 0"
              :aria-label="t('orders.week.remove_one', { name: option.name })"
              @click="changeExtra(option, -1)"
            >
              <svg
                class="size-[18px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                aria-hidden="true"
              >
                <path d="M5 12h14" />
              </svg>
            </button>
            <span aria-live="polite" class="tabular min-w-5 text-center text-base font-extrabold">
              {{ qtyOf(option) }}
            </span>
            <button
              type="button"
              class="flex size-11 items-center justify-center rounded-xl text-ink disabled:text-ink-4/60"
              :disabled="saving || !canAdd(option)"
              :aria-label="t('orders.week.add_one', { name: option.name })"
              @click="changeExtra(option, 1)"
            >
              <svg
                class="size-[18px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
        <template v-if="mode === 'parent'">
          <button
            type="button"
            class="min-h-11 border-0 bg-transparent px-1 text-sm font-bold text-brand-strong underline underline-offset-[3px] disabled:opacity-60"
            :disabled="saving"
            @click="emit('absent')"
          >
            {{ t('orders.week.no_meal') }}
          </button>
          <button
            v-if="canApplyAll && day.order"
            type="button"
            class="min-h-11 border-0 bg-transparent px-1 text-sm font-bold text-ink-3 underline underline-offset-[3px] disabled:opacity-60"
            :disabled="saving"
            @click="emit('applyAll', absent ? 'absent' : selection)"
          >
            {{ t('orders.week.apply_all') }}
          </button>
          <span v-if="saving" class="text-xs text-ink-4" aria-live="polite">
            {{ t('orders.week.saving') }}
          </span>
        </template>
        <template v-else>
          <button
            type="button"
            class="min-h-10 rounded-xl bg-brand px-4 text-sm font-bold text-white disabled:opacity-60"
            :disabled="saving || isEmptySelection(selection)"
            @click="staffSave"
          >
            {{ t('orders.admin.save_day') }}
          </button>
          <button
            type="button"
            class="min-h-10 rounded-xl border border-line-strong bg-surface px-4 text-sm font-bold text-ink-2 disabled:opacity-60"
            :disabled="saving || absent"
            @click="emit('absent')"
          >
            {{ t('orders.admin.cancel_day') }}
          </button>
        </template>
      </div>
    </template>

    <ConfirmDialog
      v-model:open="confirmOpen"
      :title="t('orders.week.confirm_allergy_title')"
      :message="
        pendingOption
          ? t('orders.week.confirm_allergy_body', {
              meal: pendingOption.name,
              list: pendingOption.allergyConflicts.map((a) => a.label.toLowerCase()).join(', '),
              name: childName,
            })
          : ''
      "
      :confirm-label="t('orders.week.confirm')"
      danger
      @confirm="onConfirm"
    />
  </section>
</template>
