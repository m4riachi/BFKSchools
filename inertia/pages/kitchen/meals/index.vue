<script setup lang="ts">
import KitchenLayout from '~/layouts/kitchen_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import MealCatalog from '~/components/meals/meal_catalog.vue'
import type { PaginationMeta } from '~/components/ui/pagination_nav.vue'
import type { MealFilters, MealOptions, MealSummary } from '~/components/meals/types'
import { useI18n } from '~/composables/use_i18n'

defineProps<{
  meals: MealSummary[]
  meta: PaginationMeta
  filters: MealFilters
  options: MealOptions
}>()

const { t } = useI18n()
const showPath = (meal: MealSummary) => `/kitchen/meals/${meal.id}`
</script>

<template>
  <KitchenLayout>
    <PageHeader
      :title="t('meals.list.kitchen_title')"
      :description="t('meals.list.kitchen_description')"
    />
    <MealCatalog
      :meals="meals"
      :meta="meta"
      :filters="filters"
      :options="options"
      base-path="/kitchen/meals"
      :item-path="showPath"
      read-only
    />
  </KitchenLayout>
</template>
