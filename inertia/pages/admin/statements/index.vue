<script setup lang="ts">
/**
 * Back-office — statements of every family for a month (D11: statements
 * only, no payment tracking): school totals, a searchable family list and
 * the Excel export. Amounts come from the server.
 */
import { reactive } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import AppButton from '~/components/ui/app_button.vue'
import TextInput from '~/components/ui/text_input.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import PaginationNav, { type PaginationMeta } from '~/components/ui/pagination_nav.vue'
import MonthNav from '~/components/statements/month_nav.vue'
import type { MonthNav as MonthNavProps, Totals } from '~/components/statements/types'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  nav: MonthNavProps
  provisional: boolean
  filters: { q: string }
  totals: Totals & { families: number; children: number }
  families: {
    parentId: number
    parentName: string
    parentEmail: string
    children: {
      childId: number
      name: string
      className: string | null
      totals: Totals
    }[]
    totals: Totals
  }[]
  meta: PaginationMeta
  exportUrl: string
}>()

const { t } = useI18n()
const form = reactive({ ...props.filters })

function apply() {
  router.get(
    '/admin/statements',
    { month: props.nav.value, q: form.q || undefined },
    { preserveScroll: true }
  )
}
</script>

<template>
  <AdminLayout>
    <PageHeader
      :title="t('statements.admin.title')"
      :eyebrow="nav.label"
      :description="t('statements.admin.subtitle')"
    >
      <template #actions>
        <StatusBadge :tone="provisional ? 'warning' : 'brand'">
          {{ provisional ? t('statements.provisional') : t('statements.final') }}
        </StatusBadge>
        <a
          :href="exportUrl"
          class="inline-flex h-11 items-center justify-center rounded-xl border border-line-strong bg-surface px-[18px] text-sm font-semibold text-ink no-underline hover:bg-subtle hover:text-ink"
        >
          {{ t('statements.admin.export') }}
        </a>
      </template>
    </PageHeader>

    <div class="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface p-4">
      <div class="w-full max-w-[340px]">
        <MonthNav :nav="nav" path="/admin/statements" :keep="{ q: filters.q }" />
      </div>
      <form class="flex flex-1 flex-wrap items-end gap-3" @submit.prevent="apply">
        <TextInput id="q" v-model="form.q" :label="t('statements.admin.search')" />
        <AppButton type="submit" variant="secondary">{{ t('statements.admin.filter') }}</AppButton>
      </form>
    </div>

    <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div class="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4">
        <span class="text-xs font-bold text-ink-4 uppercase">{{
          t('statements.admin.family')
        }}</span>
        <span class="text-xl font-extrabold">
          {{ t('statements.admin.families', { count: totals.families }) }}
        </span>
        <span class="text-[13px] text-ink-3">{{
          t('statements.admin.children', { count: totals.children })
        }}</span>
      </div>
      <div class="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4">
        <span class="text-xs font-bold text-ink-4 uppercase">{{
          t('statements.admin.subscription')
        }}</span>
        <span class="tabular text-xl font-extrabold">{{
          t('statements.meals_count', { count: totals.subscriptionCount })
        }}</span>
        <span class="text-[13px] text-ink-3">{{ t('statements.subscription_included') }}</span>
      </div>
      <div class="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4">
        <span class="text-xs font-bold text-ink-4 uppercase">{{
          t('statements.admin.supplements')
        }}</span>
        <span class="tabular text-xl font-extrabold">{{
          t('statements.meals_count', { count: totals.supplementCount })
        }}</span>
      </div>
      <div class="flex flex-col gap-1 rounded-2xl bg-brand p-4 text-white">
        <span class="text-xs font-bold uppercase opacity-80">{{
          t('statements.admin.school_total')
        }}</span>
        <span class="tabular text-xl font-extrabold">{{ totals.total }}</span>
      </div>
    </section>

    <section class="overflow-x-auto rounded-2xl border border-line bg-surface">
      <EmptyState v-if="!families.length" :title="t('statements.admin.empty')" tone="info" />
      <table v-else class="w-full min-w-[760px] text-left text-sm">
        <thead class="text-xs font-bold text-ink-4 uppercase">
          <tr class="border-b border-line">
            <th class="px-4 py-3">{{ t('statements.admin.family') }}</th>
            <th class="px-4 py-3 text-right">{{ t('statements.admin.subscription') }}</th>
            <th class="px-4 py-3 text-right">{{ t('statements.admin.supplements') }}</th>
            <th class="px-4 py-3 text-right">{{ t('statements.admin.total') }}</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="family in families"
            :key="family.parentId"
            class="border-b border-line-soft align-top last:border-0"
          >
            <td class="px-4 py-3">
              <div class="flex flex-col">
                <span class="font-bold">{{ family.parentName }}</span>
                <span class="text-xs text-ink-4">{{ family.parentEmail }}</span>
                <span
                  v-for="child in family.children"
                  :key="child.childId"
                  class="text-xs text-ink-3"
                >
                  {{ child.name
                  }}<template v-if="child.className"> · {{ child.className }}</template> ·
                  {{ child.totals.total }}
                </span>
              </div>
            </td>
            <td class="tabular px-4 py-3 text-right">
              {{ t('statements.meals_count', { count: family.totals.subscriptionCount }) }}
              <div class="text-xs text-ink-4">{{ t('statements.included') }}</div>
            </td>
            <td class="tabular px-4 py-3 text-right">
              {{ t('statements.meals_count', { count: family.totals.supplementCount }) }}
            </td>
            <td class="tabular px-4 py-3 text-right font-bold">{{ family.totals.total }}</td>
            <td class="px-4 py-3 text-right">
              <Link
                :href="`/admin/statements/parents/${family.parentId}?month=${nav.value}`"
                class="font-bold"
              >
                {{ t('statements.admin.open') }}
              </Link>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <PaginationNav v-if="meta.lastPage > 1" :meta="meta" />
    <p class="text-[13px] text-ink-4">
      {{ t('statements.admin.no_payment') }} {{ t('statements.included_note') }}
    </p>
  </AdminLayout>
</template>
