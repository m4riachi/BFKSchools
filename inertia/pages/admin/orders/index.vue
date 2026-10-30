<script setup lang="ts">
/** Back-office — orders of one day with filters (status, class, search). */
import { reactive } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import AppButton from '~/components/ui/app_button.vue'
import TextInput from '~/components/ui/text_input.vue'
import SelectInput from '~/components/ui/select_input.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import PaginationNav, { type PaginationMeta } from '~/components/ui/pagination_nav.vue'
import { useI18n } from '~/composables/use_i18n'
import { useFeatures, usePlacement } from '~/composables/use_features'

const props = defineProps<{
  filters: { date: string; status: string; q: string; className: string }
  classes: string[]
  counts: { total: number; active: number; cancelled: number }
  orders: {
    id: number
    childId: number
    childName: string
    grade: string | null
    className: string | null
    hasAllergies: boolean
    parentName: string
    status: string
    cancelReason: string | null
    origin: string
    lines: { name: string; type: string; quantity: number }[]
    total: string
  }[]
  meta: PaginationMeta
  weekOf: string
}>()

const { t, formatDate } = useI18n()
const features = useFeatures()
const placement = usePlacement()
const form = reactive({ ...props.filters })

function apply() {
  router.get(
    '/admin/orders',
    {
      date: form.date || undefined,
      status: form.status === 'all' ? undefined : form.status,
      className: form.className || undefined,
      q: form.q || undefined,
    },
    { preserveScroll: true }
  )
}
</script>

<template>
  <AdminLayout>
    <Head :title="t('orders.admin.title')" />
    <PageHeader
      :title="t('orders.admin.title')"
      :eyebrow="
        formatDate(filters.date, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      "
      :description="t('orders.admin.subtitle')"
    />

    <form
      class="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface p-4"
      @submit.prevent="apply"
    >
      <TextInput id="date" v-model="form.date" type="date" :label="t('orders.admin.date')" />
      <SelectInput
        id="status"
        v-model="form.status"
        :label="t('orders.admin.status')"
        :options="[
          { value: 'all', label: t('orders.admin.all') },
          { value: 'active', label: t('orders.statuses.active') },
          { value: 'cancelled', label: t('orders.statuses.cancelled') },
        ]"
      />
      <SelectInput
        v-if="features.className"
        id="className"
        v-model="form.className"
        :label="t('orders.admin.class')"
        :options="[
          { value: '', label: t('orders.admin.all_classes') },
          ...classes.map((c) => ({ value: c, label: c })),
        ]"
      />
      <TextInput id="q" v-model="form.q" :label="t('orders.admin.search')" />
      <AppButton type="submit">{{ t('orders.admin.filter') }}</AppButton>
    </form>

    <p class="text-sm text-ink-3">{{ t('orders.admin.counts', counts) }}</p>

    <section class="overflow-x-auto rounded-2xl border border-line bg-surface">
      <EmptyState v-if="!orders.length" :title="t('orders.admin.empty')" tone="info" />
      <table v-else class="w-full min-w-[720px] text-left text-sm">
        <thead class="text-xs font-bold text-ink-4 uppercase">
          <tr class="border-b border-line">
            <th class="px-4 py-3">{{ t('orders.admin.child') }}</th>
            <th v-if="features.grade || features.className" class="px-4 py-3">
              {{ t('orders.admin.class') }}
            </th>
            <th class="px-4 py-3">{{ t('orders.admin.meals') }}</th>
            <th class="px-4 py-3">{{ t('orders.admin.status') }}</th>
            <th class="px-4 py-3 text-right">{{ t('orders.admin.total') }}</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="order in orders"
            :key="order.id"
            class="border-b border-line-soft last:border-0"
          >
            <td class="px-4 py-3">
              <div class="flex flex-col">
                <span class="font-bold">{{ order.childName }}</span>
                <span class="text-xs text-ink-4">{{ order.parentName }}</span>
              </div>
              <StatusBadge v-if="order.hasAllergies" tone="danger">{{
                t('orders.admin.allergy_badge')
              }}</StatusBadge>
            </td>
            <td v-if="features.grade || features.className" class="px-4 py-3 text-ink-3">
              {{ placement(order.grade, order.className) }}
            </td>
            <td class="px-4 py-3">
              <template v-if="order.status === 'active'">
                <div v-for="(line, i) in order.lines" :key="i">
                  {{ line.name
                  }}<template v-if="line.type === 'supplement'"> × {{ line.quantity }}</template>
                </div>
              </template>
            </td>
            <td class="px-4 py-3">
              <StatusBadge :tone="order.status === 'active' ? 'brand' : 'warning'">
                {{
                  order.status === 'cancelled' && order.cancelReason
                    ? t(`orders.cancel_reasons.${order.cancelReason}`)
                    : t(`orders.statuses.${order.status}`)
                }}
              </StatusBadge>
              <span class="ml-1 text-xs text-ink-4">{{ t(`orders.origins.${order.origin}`) }}</span>
            </td>
            <td class="tabular px-4 py-3 text-right font-bold">{{ order.total }}</td>
            <td class="px-4 py-3 text-right">
              <Link
                :href="`/admin/orders/children/${order.childId}?week=${weekOf}`"
                class="font-bold"
              >
                {{ t('orders.admin.open_week') }}
              </Link>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <PaginationNav v-if="meta.lastPage > 1" :meta="meta" />
  </AdminLayout>
</template>
