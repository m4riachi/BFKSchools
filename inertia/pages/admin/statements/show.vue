<script setup lang="ts">
/** Back-office — one family's monthly statement (same view as the parent's) + PDF. */
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import MonthNav from '~/components/statements/month_nav.vue'
import StatementView from '~/components/statements/statement_view.vue'
import type { FamilyStatement, MonthNav as MonthNavProps } from '~/components/statements/types'
import { useI18n } from '~/composables/use_i18n'

defineProps<{
  nav: MonthNavProps
  parent: { id: number; fullName: string; email: string }
  statement: FamilyStatement
  pdfUrl: string
  backUrl: string
}>()

const { t } = useI18n()
</script>

<template>
  <AdminLayout>
    <Link :href="backUrl" class="text-sm font-bold">‹ {{ t('statements.admin.back') }}</Link>
    <PageHeader :title="parent.fullName" :eyebrow="nav.label" :description="parent.email">
      <template #actions>
        <StatusBadge :tone="statement.provisional ? 'warning' : 'brand'">
          {{ statement.provisional ? t('statements.provisional') : t('statements.final') }}
        </StatusBadge>
        <a
          :href="pdfUrl"
          class="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-[18px] text-sm font-bold text-white no-underline hover:bg-brand-strong hover:text-white"
        >
          {{ t('statements.download_pdf') }}
        </a>
      </template>
    </PageHeader>
    <div class="w-full max-w-[340px]">
      <MonthNav :nav="nav" :path="`/admin/statements/parents/${parent.id}`" />
    </div>
    <div class="max-w-[720px]">
      <StatementView :statement="statement" />
    </div>
  </AdminLayout>
</template>
