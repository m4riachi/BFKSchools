<script setup lang="ts">
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import ParentForm from '~/components/families/parent_form.vue'
import { useI18n } from '~/composables/use_i18n'

defineProps<{
  parent: { id: number; fullName: string; email: string; phone: string | null; locale: string }
}>()

const { t } = useI18n()
</script>

<template>
  <AdminLayout>
    <PageHeader :title="t('families.parent_form.edit_title')" :eyebrow="parent.fullName" />
    <ParentForm :parent="parent" :cancel-href="`/admin/parents/${parent.id}`" />
  </AdminLayout>
</template>
