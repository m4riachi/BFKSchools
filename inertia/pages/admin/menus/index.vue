<script setup lang="ts">
/**
 * Weekly menus: the weeks around today with their status, and a picker to
 * open any week (the server snaps the date to its Monday).
 */
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import AppButton from '~/components/ui/app_button.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import TextInput from '~/components/ui/text_input.vue'
import { STATUS_TONES, type MenuStatus } from '~/components/menus/types'
import { useI18n } from '~/composables/use_i18n'

defineProps<{
  today: string
  currentWeek: string
  weeks: {
    weekStart: string
    firstDay: string
    lastDay: string
    isCurrent: boolean
    isNext: boolean
    status: MenuStatus | null
    publishAt: string | null
    orderDeadlineAt: string | null
    itemsCount: number
  }[]
}>()

const { t, formatDate, formatDateTime } = useI18n()

const pickedDate = ref('')
function goToWeek() {
  if (pickedDate.value) router.get('/admin/menus', { week: pickedDate.value })
}

const range = (first: string, last: string) =>
  `${formatDate(first, { day: 'numeric', month: 'short' })} – ${formatDate(last, { day: 'numeric', month: 'short', year: 'numeric' })}`
const short = (iso: string | null) =>
  iso
    ? formatDateTime(iso, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'
</script>

<template>
  <AdminLayout>
    <PageHeader :title="t('menus.title')" :description="t('menus.index.description')">
      <template #actions>
        <form class="flex items-end gap-2" @submit.prevent="goToWeek">
          <TextInput
            id="week"
            v-model="pickedDate"
            type="date"
            :label="t('menus.index.go_to_week')"
          />
          <AppButton type="submit" variant="secondary" :disabled="!pickedDate">
            {{ t('menus.index.go') }}
          </AppButton>
        </form>
      </template>
    </PageHeader>

    <div class="card overflow-x-auto">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="border-b border-line text-left text-xs font-bold text-ink-4">
            <th scope="col" class="px-4 py-3">{{ t('menus.index.week') }}</th>
            <th scope="col" class="px-4 py-3">{{ t('menus.index.status') }}</th>
            <th scope="col" class="px-4 py-3">{{ t('menus.index.publish_at') }}</th>
            <th scope="col" class="px-4 py-3">{{ t('menus.index.deadline') }}</th>
            <th scope="col" class="px-4 py-3">{{ t('menus.index.items') }}</th>
            <th scope="col" class="px-4 py-3">
              <span class="sr-only">{{ t('menus.index.open') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="week in weeks"
            :key="week.weekStart"
            class="border-b border-line-soft last:border-0"
            :class="week.isCurrent ? 'bg-brand-soft/40' : ''"
          >
            <td class="px-4 py-3">
              <div class="flex flex-col gap-0.5">
                <Link
                  :href="`/admin/menus/${week.weekStart}`"
                  class="font-bold text-ink no-underline hover:text-brand-strong"
                >
                  {{ range(week.firstDay, week.lastDay) }}
                </Link>
                <span v-if="week.isCurrent || week.isNext" class="text-xs font-semibold text-ink-4">
                  {{ t(week.isCurrent ? 'menus.index.current' : 'menus.index.next') }}
                </span>
              </div>
            </td>
            <td class="px-4 py-3">
              <StatusBadge :tone="week.status ? STATUS_TONES[week.status] : 'neutral'">
                {{ t(`menus.status.${week.status ?? 'none'}`) }}
              </StatusBadge>
            </td>
            <td class="tabular px-4 py-3 whitespace-nowrap text-ink-3">
              {{ short(week.publishAt) }}
            </td>
            <td class="tabular px-4 py-3 whitespace-nowrap text-ink-3">
              {{ short(week.orderDeadlineAt) }}
            </td>
            <td class="px-4 py-3 text-ink-3">
              {{ t('menus.index.items_count', { count: week.itemsCount }) }}
            </td>
            <td class="px-4 py-3 text-right">
              <AppButton size="sm" variant="secondary" :href="`/admin/menus/${week.weekStart}`">
                {{ t('menus.index.open') }}
              </AppButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </AdminLayout>
</template>
