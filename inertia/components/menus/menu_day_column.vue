<script setup lang="ts">
/**
 * One day of the week builder (design "Menu de la semaine"): subscription
 * dishes as cards (cover thumbnail, name, allergens, price, default badge),
 * supplements as compact rows. Holiday days and days outside the school
 * year are greyed out and locked. Catalog meals can be dropped on an open
 * day. The server enforces every rule; this only displays and emits.
 */
import { computed, ref } from 'vue'
import { Link } from '@adonisjs/inertia/vue'
import MealThumb from '~/components/meals/meal_thumb.vue'
import MealBadges from '~/components/meals/meal_badges.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import { useI18n } from '~/composables/use_i18n'
import { MEAL_DRAG_TYPE, type MenuCan, type MenuDayView, type MenuItemView } from './types'

const props = defineProps<{ day: MenuDayView; can: MenuCan }>()
const emit = defineEmits<{
  add: [date: string, type: 'subscription' | 'supplement']
  drop: [date: string, mealId: number]
  remove: [item: MenuItemView]
  setDefault: [item: MenuItemView]
  editMax: [item: MenuItemView]
}>()

const { t, formatDate } = useI18n()

const title = computed(() =>
  formatDate(props.day.date, { weekday: 'long', day: 'numeric', month: 'short' })
)
const mains = computed(() => props.day.items.filter((item) => item.type === 'subscription'))
const supplements = computed(() => props.day.items.filter((item) => item.type === 'supplement'))
const open = computed(() => props.day.state === 'open')
const missingDefault = computed(
  () => open.value && mains.value.length > 0 && !mains.value.some((item) => item.isDefault)
)

const summary = computed(() => {
  if (props.day.state === 'holiday') return t('menus.builder.holiday')
  if (props.day.state === 'not_school_day') return t('menus.builder.not_school_day')
  if (missingDefault.value) return t('menus.builder.day_no_default')
  return t('menus.builder.day_summary', {
    meals: mains.value.length,
    supplements: supplements.value.length,
  })
})

const columnClass = computed(() => {
  if (props.day.state === 'holiday') return 'border-info-line holiday-stripes'
  if (props.day.state === 'not_school_day') return 'border-line bg-subtle'
  if (missingDefault.value) return 'border-[#e9b872] bg-[#fffbf5]'
  return 'border-line bg-[#f8faf9]'
})

/* Drop target (desktop drag from the catalog) */
const dragOver = ref(false)
function onDragOver(event: DragEvent) {
  if (!open.value || !props.can.addItems) return
  if (!event.dataTransfer?.types.includes(MEAL_DRAG_TYPE)) return
  event.preventDefault()
  dragOver.value = true
}
function onDrop(event: DragEvent) {
  dragOver.value = false
  if (!open.value || !props.can.addItems) return
  const id = Number(event.dataTransfer?.getData(MEAL_DRAG_TYPE))
  if (Number.isSafeInteger(id) && id > 0) {
    event.preventDefault()
    emit('drop', props.day.date, id)
  }
}

function maxLabel(item: MenuItemView) {
  return item.maxQuantity
    ? t('menus.builder.max_quantity', { count: item.maxQuantity })
    : t('menus.builder.no_max')
}
</script>

<template>
  <section
    :aria-label="title"
    class="flex min-h-[420px] flex-col gap-3.5 rounded-2xl border-[1.5px] p-4 transition-shadow"
    :class="[columnClass, dragOver ? 'ring-2 ring-brand ring-offset-2' : '']"
    @dragover="onDragOver"
    @dragleave="dragOver = false"
    @drop="onDrop"
  >
    <div class="flex flex-col gap-0.5">
      <h2 class="text-base font-extrabold first-letter:uppercase">{{ title }}</h2>
      <span
        class="text-xs font-semibold"
        :class="
          day.state === 'holiday' ? 'text-info' : missingDefault ? 'text-warning' : 'text-ink-4'
        "
      >
        {{ summary }}
      </span>
    </div>

    <!-- Holiday / closed day -->
    <div
      v-if="!open"
      class="flex flex-col items-center justify-center gap-2.5 px-2 py-5 text-center"
      :class="day.items.length ? '' : 'flex-1'"
    >
      <div
        class="flex size-[52px] items-center justify-center rounded-full border bg-surface"
        :class="day.state === 'holiday' ? 'border-info-line text-info' : 'border-line text-ink-4'"
        aria-hidden="true"
      >
        <svg
          class="size-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
        >
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </div>
      <template v-if="day.state === 'holiday'">
        <span class="text-xs font-extrabold tracking-[0.06em] text-info uppercase">
          {{ t('menus.builder.holiday') }}
        </span>
        <span class="text-base font-bold text-ink">{{ day.holidayNames.join(' · ') }}</span>
        <span class="text-[13px] text-ink-3">{{ t('menus.builder.holiday_detail') }}</span>
        <Link
          :href="`/admin/holidays?month=${day.date.slice(0, 7)}`"
          class="text-[13px] font-bold text-info no-underline"
        >
          {{ t('menus.builder.see_calendar') }}
        </Link>
      </template>
      <span v-else class="text-[13px] text-ink-3">
        {{ t('menus.builder.not_school_day_detail') }}
      </span>
    </div>

    <!-- Leftover items on a closed day: shown so they can be removed -->
    <div v-if="!open && day.items.length" class="flex flex-col gap-2" role="alert">
      <p class="text-[13px] font-semibold text-warning">
        {{ t('menus.builder.items_on_closed_day') }}
      </p>
      <div
        v-for="item in day.items"
        :key="item.id"
        class="flex items-center justify-between gap-2 rounded-[10px] border border-line bg-surface py-2 pr-1.5 pl-3"
      >
        <span class="text-[13px] font-semibold">{{ item.meal.name }}</span>
        <button
          v-if="can.removeItems"
          type="button"
          class="flex size-[30px] items-center justify-center rounded-lg text-ink-4 hover:bg-subtle"
          :aria-label="t('menus.builder.remove', { name: item.meal.name })"
          @click="emit('remove', item)"
        >
          <svg
            class="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
    </div>

    <template v-if="open">
      <!-- Main dishes (subscription) -->
      <div class="flex flex-col gap-2.5">
        <h3 class="text-[11px] font-extrabold tracking-[0.07em] text-ink-4 uppercase">
          {{ t('menus.builder.main_meals') }}
        </h3>
        <article
          v-for="item in mains"
          :key="item.id"
          class="flex flex-col gap-2.5 rounded-xl border bg-surface p-3"
          :class="item.isDefault ? 'border-[#9ccbb2]' : 'border-line'"
        >
          <div class="flex items-start gap-2.5">
            <MealThumb
              :src="item.meal.cover?.thumbUrl"
              :seed="item.meal.id"
              class="size-11 shrink-0 overflow-hidden rounded-[10px]"
            />
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <span class="text-sm leading-tight font-bold">{{ item.meal.name }}</span>
              <MealBadges :allergens="item.meal.allergens" :max="3" />
              <StatusBadge v-if="!item.meal.isActive" tone="warning">
                {{ t('menus.builder.unavailable') }}
              </StatusBadge>
            </div>
            <button
              v-if="can.removeItems"
              type="button"
              class="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-4 hover:bg-subtle"
              :aria-label="t('menus.builder.remove', { name: item.meal.name })"
              @click="emit('remove', item)"
            >
              <svg
                class="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="tabular text-sm font-extrabold">{{ item.meal.price }}</span>
            <span
              v-if="item.isDefault"
              class="flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-bold text-brand-strong"
            >
              <svg
                class="size-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
              >
                <path d="M5 12l5 5 9-10" />
              </svg>
              {{ t('menus.builder.default') }}
            </span>
            <button
              v-else-if="can.editItems"
              type="button"
              class="min-h-8 rounded-lg border border-line-strong bg-surface px-2.5 text-xs font-bold text-ink-2 hover:bg-subtle"
              @click="emit('setDefault', item)"
            >
              {{ t('menus.builder.set_default') }}
            </button>
          </div>
          <button
            type="button"
            class="self-start text-xs font-semibold text-ink-4 underline-offset-2 hover:underline disabled:no-underline"
            :disabled="!can.editItems"
            :aria-label="t('menus.builder.edit_max', { name: item.meal.name })"
            @click="emit('editMax', item)"
          >
            {{ maxLabel(item) }}
          </button>
        </article>
        <button
          v-if="can.addItems"
          type="button"
          class="flex h-11 items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-[#b9c6bf] text-[13px] font-bold text-brand-strong hover:bg-surface"
          @click="emit('add', day.date, 'subscription')"
        >
          <span aria-hidden="true">+</span>{{ t('menus.builder.add_meal') }}
        </button>
      </div>

      <!-- Supplements -->
      <div class="flex flex-col gap-2.5">
        <h3 class="text-[11px] font-extrabold tracking-[0.07em] text-ink-4 uppercase">
          {{ t('menus.builder.supplements') }}
        </h3>
        <div
          v-for="item in supplements"
          :key="item.id"
          class="flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface py-2 pr-1.5 pl-2"
        >
          <div class="flex items-center gap-2">
            <MealThumb
              :src="item.meal.cover?.thumbUrl"
              :seed="item.meal.id"
              class="size-8 shrink-0 overflow-hidden rounded-lg"
            />
            <span class="min-w-0 flex-1 text-[13px] leading-tight font-semibold">
              {{ item.meal.name }}
            </span>
            <span class="tabular shrink-0 text-[13px] font-bold text-ink-2">{{
              item.meal.price
            }}</span>
            <button
              v-if="can.removeItems"
              type="button"
              class="flex size-[30px] shrink-0 items-center justify-center rounded-lg text-ink-4 hover:bg-subtle"
              :aria-label="t('menus.builder.remove', { name: item.meal.name })"
              @click="emit('remove', item)"
            >
              <svg
                class="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 pl-10">
            <MealBadges :allergens="item.meal.allergens" :max="2" />
            <StatusBadge v-if="!item.meal.isActive" tone="warning">
              {{ t('menus.builder.unavailable') }}
            </StatusBadge>
            <button
              type="button"
              class="text-xs font-semibold text-ink-4 underline-offset-2 hover:underline disabled:no-underline"
              :disabled="!can.editItems"
              :aria-label="t('menus.builder.edit_max', { name: item.meal.name })"
              @click="emit('editMax', item)"
            >
              {{ maxLabel(item) }}
            </button>
          </div>
        </div>
        <button
          v-if="can.addItems"
          type="button"
          class="flex h-10 items-center justify-center gap-1.5 rounded-[10px] border-[1.5px] border-dashed border-[#b9c6bf] text-[13px] font-bold text-brand-strong hover:bg-surface"
          @click="emit('add', day.date, 'supplement')"
        >
          <span aria-hidden="true">+</span>{{ t('menus.builder.add_supplement') }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.holiday-stripes {
  background: repeating-linear-gradient(
    135deg,
    #f5f7fd 0,
    #f5f7fd 10px,
    #eef1fb 10px,
    #eef1fb 20px
  );
}
</style>
