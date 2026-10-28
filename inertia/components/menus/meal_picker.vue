<script setup lang="ts">
/**
 * Picker of active meals (subscription or supplement) for one day of the
 * builder. Meals already on that day are shown disabled. The catalog comes
 * from the server (offerable meals only); the server re-checks everything.
 */
import { computed, ref, watch } from 'vue'
import ModalDialog from '~/components/ui/modal_dialog.vue'
import MealThumb from '~/components/meals/meal_thumb.vue'
import MealBadges from '~/components/meals/meal_badges.vue'
import type { MealSummary } from '~/components/meals/types'
import { useI18n } from '~/composables/use_i18n'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  title: string
  type: 'subscription' | 'supplement'
  catalog: MealSummary[]
  taken: number[]
  processing?: boolean
}>()
const emit = defineEmits<{ pick: [mealId: number] }>()

const { t } = useI18n()
const search = ref('')
watch(open, (value) => {
  if (value) search.value = ''
})

const meals = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return props.catalog.filter(
    (meal) =>
      meal.type === props.type &&
      (!query ||
        meal.name.toLocaleLowerCase().includes(query) ||
        meal.nameFr.toLocaleLowerCase().includes(query) ||
        meal.nameEn.toLocaleLowerCase().includes(query))
  )
})
</script>

<template>
  <ModalDialog v-model:open="open" :title="title" size="lg">
    <div class="flex flex-col gap-3">
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
          v-model="search"
          type="search"
          :placeholder="t('menus.builder.search_placeholder')"
          class="h-full flex-1 border-0 bg-transparent text-sm text-ink outline-none"
        />
      </label>
      <p v-if="!meals.length" class="py-6 text-center text-sm text-ink-4">
        {{ t('menus.builder.picker_empty') }}
      </p>
      <ul v-else class="flex max-h-[55vh] flex-col gap-2 overflow-y-auto pr-1">
        <li v-for="meal in meals" :key="meal.id">
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-2.5 text-left hover:border-brand disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="taken.includes(meal.id) || processing"
            @click="emit('pick', meal.id)"
          >
            <MealThumb
              :src="meal.cover?.thumbUrl"
              :seed="meal.id"
              class="size-11 shrink-0 overflow-hidden rounded-[10px]"
            />
            <span class="flex min-w-0 flex-1 flex-col gap-1">
              <span class="text-sm font-bold text-ink">{{ meal.name }}</span>
              <MealBadges :allergens="meal.allergens" :tags="meal.tags" :max="4" />
            </span>
            <span class="flex shrink-0 flex-col items-end gap-1">
              <span class="tabular text-sm font-extrabold text-ink">{{ meal.price }}</span>
              <span v-if="taken.includes(meal.id)" class="text-xs font-semibold text-ink-4">
                {{ t('menus.builder.already_on_day') }}
              </span>
            </span>
          </button>
        </li>
      </ul>
    </div>
  </ModalDialog>
</template>
