<script setup lang="ts">
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import ParentForm from '~/components/families/parent_form.vue'
import { useI18n } from '~/composables/use_i18n'

const { t } = useI18n()
</script>

<template>
  <AdminLayout>
    <PageHeader
      :title="t('families.parent_form.create_title')"
      :eyebrow="t('families.parent_form.eyebrow')"
    />
    <ParentForm cancel-href="/admin/parents" />
  </AdminLayout>
</template>
