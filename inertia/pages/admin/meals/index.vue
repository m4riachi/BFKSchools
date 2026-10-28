<script setup lang="ts">
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import AppButton from '~/components/ui/app_button.vue'
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
const editPath = (meal: MealSummary) => `/admin/meals/${meal.id}/edit`
</script>

<template>
  <AdminLayout>
    <PageHeader
      :title="t('meals.list.title')"
      :description="t('meals.list.description', { count: meta.total })"
    >
      <template #actions>
        <AppButton href="/admin/meals/create">{{ t('meals.list.new') }}</AppButton>
      </template>
    </PageHeader>

    <MealCatalog
      :meals="meals"
      :meta="meta"
      :filters="filters"
      :options="options"
      base-path="/admin/meals"
      :item-path="editPath"
    />
  </AdminLayout>
</template>
