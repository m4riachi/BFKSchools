<script setup lang="ts">
import KitchenLayout from '~/layouts/kitchen_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import { useI18n } from '~/composables/use_i18n'

const { t } = useI18n()
</script>

<template>
  <KitchenLayout>
    <PageHeader :title="t('pages.kitchen_dashboard.title')" />
    <section class="card">
      <EmptyState
        :title="t('pages.kitchen_dashboard.empty_title')"
        :description="t('pages.kitchen_dashboard.empty_body')"
      />
    </section>
  </KitchenLayout>
</template>
