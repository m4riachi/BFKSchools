<script setup lang="ts">
/**
 * Read-only meal sheet for the kitchen: photos, description, allergens.
 */
import { computed, ref } from 'vue'
import { Link } from '@adonisjs/inertia/vue'
import KitchenLayout from '~/layouts/kitchen_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import MealThumb from '~/components/meals/meal_thumb.vue'
import MealBadges from '~/components/meals/meal_badges.vue'
import type { MealDetail } from '~/components/meals/types'
import { useI18n } from '~/composables/use_i18n'
import { useFeatures } from '~/composables/use_features'

const props = defineProps<{ meal: MealDetail }>()
const { t } = useI18n()
const features = useFeatures()

const selected = ref(
  Math.max(
    0,
    props.meal.photos.findIndex((photo) => photo.isCover)
  )
)
const current = computed(() => props.meal.photos[selected.value] ?? null)
</script>

<template>
  <KitchenLayout>
    <div>
      <Link href="/kitchen/meals" class="text-[13px] font-semibold">
        ← {{ t('meals.detail.back') }}
      </Link>
    </div>
    <PageHeader :title="meal.name" :eyebrow="t(`meals.categories.${meal.category}`)" />

    <div class="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section
        class="card flex flex-col gap-3 overflow-hidden p-3"
        :aria-label="t('meals.detail.photos')"
      >
        <div class="aspect-[4/3] overflow-hidden rounded-xl bg-subtle">
          <MealThumb
            :src="current?.url"
            :alt="t('meals.photos.alt', { position: selected + 1, name: meal.name })"
            :seed="meal.id"
            fill
          />
        </div>
        <div v-if="meal.photos.length > 1" class="flex flex-wrap gap-2">
          <button
            v-for="(photo, index) in meal.photos"
            :key="photo.id"
            type="button"
            class="size-16 overflow-hidden rounded-[10px] border-2"
            :class="index === selected ? 'border-brand' : 'border-transparent'"
            :aria-label="t('meals.photos.alt', { position: index + 1, name: meal.name })"
            :aria-pressed="index === selected"
            @click="selected = index"
          >
            <img :src="photo.thumbUrl" alt="" class="size-full object-cover" loading="lazy" />
          </button>
        </div>
      </section>

      <section class="card flex flex-col gap-5 p-5 sm:p-6">
        <div class="flex flex-wrap items-center gap-2">
          <StatusBadge :tone="meal.type === 'subscription' ? 'brand' : 'info'">
            {{ t(`meals.types.${meal.type}`) }}
          </StatusBadge>
          <StatusBadge :tone="meal.isActive ? 'brand' : 'neutral'">
            {{ meal.isActive ? t('meals.status.active') : t('meals.status.inactive') }}
          </StatusBadge>
        </div>

        <dl class="grid gap-4">
          <div class="flex flex-col gap-1">
            <dt class="text-xs font-extrabold tracking-[0.07em] text-ink-4 uppercase">
              {{ t('meals.detail.price') }}
            </dt>
            <dd v-if="meal.price" class="tabular text-lg font-extrabold">{{ meal.price }}</dd>
            <dd v-else class="text-sm font-semibold text-ink-3">{{ t('meals.included') }}</dd>
          </div>
          <div class="flex flex-col gap-1">
            <dt class="text-xs font-extrabold tracking-[0.07em] text-ink-4 uppercase">
              {{ t('meals.detail.description') }}
            </dt>
            <dd class="text-sm whitespace-pre-line text-ink-2">
              {{ meal.description ?? t('meals.detail.no_description') }}
            </dd>
          </div>
          <div v-if="features.allergens" class="flex flex-col gap-1.5">
            <dt class="text-xs font-extrabold tracking-[0.07em] text-ink-4 uppercase">
              {{ t('meals.detail.allergens') }}
            </dt>
            <dd>
              <MealBadges v-if="meal.allergens.length" :allergens="meal.allergens" />
              <span v-else class="text-sm text-ink-4">{{ t('meals.detail.no_allergens') }}</span>
            </dd>
          </div>
          <div v-if="meal.tags.length" class="flex flex-col gap-1.5">
            <dt class="text-xs font-extrabold tracking-[0.07em] text-ink-4 uppercase">
              {{ t('meals.detail.tags') }}
            </dt>
            <dd><MealBadges :tags="meal.tags" /></dd>
          </div>
          <div v-if="meal.externalRecipeRef" class="flex flex-col gap-1">
            <dt class="text-xs font-extrabold tracking-[0.07em] text-ink-4 uppercase">
              {{ t('meals.detail.recipe_ref') }}
            </dt>
            <dd class="text-sm">{{ meal.externalRecipeRef }}</dd>
          </div>
        </dl>
      </section>
    </div>
  </KitchenLayout>
</template>
