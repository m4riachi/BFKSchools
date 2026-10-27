<script setup lang="ts">
import { computed } from 'vue'
import { usePage } from '@inertiajs/vue3'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import { useI18n } from '~/composables/use_i18n'

const { t } = useI18n()
const page = usePage()
const firstName = computed(() => page.props.user?.fullName.split(' ')[0] ?? '')
</script>

<template>
  <AdminLayout>
    <PageHeader
      :title="t('pages.admin_dashboard.title')"
      :eyebrow="t('pages.admin_dashboard.welcome', { name: firstName })"
    />
    <section class="card">
      <EmptyState
        :title="t('pages.admin_dashboard.empty_title')"
        :description="t('pages.admin_dashboard.empty_body')"
      />
    </section>
  </AdminLayout>
</template>
