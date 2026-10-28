<script setup lang="ts">
/**
 * Back-office — a child's week. Staff can change or cancel any day the
 * window rules lock for parents (time locks only); every change needs a
 * reason, is audited as a staff override and notifies the parent.
 */
import { ref } from 'vue'
import { Head, router, usePage } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import TextInput from '~/components/ui/text_input.vue'
import DayCard from '~/components/orders/day_card.vue'
import { useI18n } from '~/composables/use_i18n'
import type { Selection, WeekView } from '~/components/orders/types'

const props = defineProps<{
  child: {
    id: number
    firstName: string
    lastName: string
    grade: string | null
    className: string | null
    isActive: boolean
    parentId: number
    parentName: string
  }
  week: { start: string; first: string; last: string; previous: string; next: string }
  view: WeekView
  audit: {
    id: number
    date: string
    action: string
    actorRole: string
    actorName: string | null
    reason: string | null
    createdAt: string
  }[]
}>()

const { t, formatDate, formatDateTime } = useI18n()
const page = usePage()
const reason = ref('')
const saving = ref<string | null>(null)

function post(url: string, data: Record<string, any>, date: string) {
  router.post(
    url,
    { ...data, reason: reason.value },
    {
      preserveScroll: true,
      onStart: () => (saving.value = date),
      onFinish: () => (saving.value = null),
    }
  )
}
function save(date: string, selection: Selection, confirmAllergy: boolean) {
  post(
    `/admin/orders/children/${props.child.id}/days/${date}`,
    { ...selection, confirmAllergy },
    date
  )
}
function cancel(date: string) {
  post(`/admin/orders/children/${props.child.id}/days/${date}/cancel`, {}, date)
}
</script>

<template>
  <AdminLayout>
    <Head
      :title="t('orders.admin.child_title', { name: `${child.firstName} ${child.lastName}` })"
    />
    <PageHeader
      :title="t('orders.admin.child_title', { name: `${child.firstName} ${child.lastName}` })"
      :eyebrow="[child.grade, child.className, child.parentName].filter(Boolean).join(' · ')"
    />
    <div class="flex flex-wrap items-center gap-3 text-sm font-bold">
      <Link href="/admin/orders">← {{ t('orders.admin.back') }}</Link>
      <Link :href="`/admin/orders/children/${child.id}?week=${week.previous}`"
        >‹ {{ t('orders.week.previous') }}</Link
      >
      <span class="text-ink-3">
        {{ formatDate(week.first, { day: 'numeric', month: 'short' }) }} –
        {{ formatDate(week.last, { day: 'numeric', month: 'short', year: 'numeric' }) }}
      </span>
      <Link :href="`/admin/orders/children/${child.id}?week=${week.next}`"
        >{{ t('orders.week.next') }} ›</Link
      >
    </div>

    <p class="rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning-ink">
      {{ t('orders.admin.staff_notice') }}
    </p>
    <div class="max-w-xl">
      <TextInput
        id="reason"
        v-model="reason"
        :label="t('orders.admin.reason')"
        :placeholder="t('orders.admin.reason_placeholder')"
        :error="page.props.errors?.reason"
        required
      />
    </div>
    <p v-if="view.allergies.length" class="text-sm font-bold text-danger">
      {{
        t('orders.week.allergies', {
          name: child.firstName,
          list: view.allergies.map((a) => a.label).join(', '),
        })
      }}
    </p>

    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <DayCard
        v-for="day in view.days"
        :key="day.date"
        :day="day"
        :child-name="child.firstName"
        mode="staff"
        :saving="saving === day.date"
        @change="(selection, confirm) => save(day.date, selection, confirm)"
        @absent="cancel(day.date)"
      />
    </div>
    <p class="text-sm font-bold">
      {{ t('orders.week.summary') }} : <span class="tabular">{{ view.total }}</span>
    </p>

    <section class="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
      <h2 class="text-base font-extrabold">{{ t('orders.admin.audit') }}</h2>
      <p v-if="!audit.length" class="text-sm text-ink-3">{{ t('orders.admin.audit_empty') }}</p>
      <ul v-else class="flex flex-col divide-y divide-line-soft text-sm">
        <li v-for="row in audit" :key="row.id" class="flex flex-wrap gap-x-3 py-2">
          <span class="tabular text-ink-4">{{ formatDateTime(row.createdAt) }}</span>
          <span class="font-bold">{{
            formatDate(row.date, { weekday: 'short', day: 'numeric', month: 'short' })
          }}</span>
          <span>{{ t(`orders.admin.actions.${row.action}`) }}</span>
          <span class="text-ink-3">{{ row.actorName ?? t('orders.admin.actor_system') }}</span>
          <span v-if="row.reason && row.actorRole !== 'system'" class="text-ink-3 italic"
            >« {{ row.reason }} »</span
          >
        </li>
      </ul>
    </section>
  </AdminLayout>
</template>
