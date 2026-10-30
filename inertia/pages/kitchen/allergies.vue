<script setup lang="ts">
/**
 * Kitchen — allergy sheet: children with allergies or a special diet who
 * eat that day, their meal, and a red highlight when a meal contains one of
 * their allergens (server-computed overlap). Read-only, printable.
 */
import { computed } from 'vue'
import KitchenLayout from '~/layouts/kitchen_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import DayNav from '~/components/reports/day_nav.vue'
import { useI18n } from '~/composables/use_i18n'
import { useFeatures, usePlacement } from '~/composables/use_features'
import type { AllergyRowView } from '~/components/reports/types'

const props = defineProps<{
  date: string
  today: string
  previous: string
  next: string
  rows: AllergyRowView[] | null
}>()

const { t, formatDate } = useI18n()
const features = useFeatures()
const placement = usePlacement()
const nav = computed(() => ({
  date: props.date,
  today: props.today,
  previous: props.previous,
  next: props.next,
}))
const conflicts = computed(() => (props.rows ?? []).filter((row) => row.hasConflict).length)
</script>

<template>
  <KitchenLayout>
    <PageHeader
      :title="t('reports.allergies.title')"
      :eyebrow="
        formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      "
      :description="t('reports.allergies.description')"
    >
      <template #actions>
        <DayNav path="/kitchen/allergies" :nav="nav" />
      </template>
    </PageHeader>

    <section v-if="!rows" class="card">
      <EmptyState
        :title="t('reports.common.no_school_title')"
        :description="t('reports.common.no_school_body')"
      />
    </section>

    <template v-else>
      <p
        v-if="conflicts"
        class="rounded-xl border-2 border-danger bg-danger-soft px-4 py-3 text-sm font-bold text-danger-ink"
        role="alert"
      >
        {{ t('reports.allergies.conflict_banner', { count: conflicts }) }}
      </p>
      <p class="text-sm text-ink-3 print:hidden">{{ t('reports.allergies.blocked_hint') }}</p>

      <section class="card overflow-hidden">
        <EmptyState v-if="!rows.length" :title="t('reports.allergies.empty')" tone="info" />
        <div v-else class="overflow-x-auto">
          <table class="print-table w-full min-w-[720px] text-left text-sm">
            <thead class="text-xs font-bold text-ink-4 uppercase">
              <tr class="border-b border-line">
                <th scope="col" class="px-4 py-3">{{ t('reports.allergies.child') }}</th>
                <th v-if="features.grade || features.className" scope="col" class="px-4 py-3">
                  {{ t('reports.common.class') }}
                </th>
                <th scope="col" class="px-4 py-3">{{ t('reports.allergies.allergies') }}</th>
                <th scope="col" class="px-4 py-3">{{ t('reports.allergies.meal_of_day') }}</th>
                <th scope="col" class="px-4 py-3">{{ t('reports.allergies.notes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.childId"
                class="border-b border-line-soft align-top last:border-0"
                :class="row.hasConflict ? 'bg-danger-soft' : ''"
              >
                <th scope="row" class="px-4 py-3 font-bold">{{ row.name }}</th>
                <td v-if="features.grade || features.className" class="px-4 py-3 text-ink-3">
                  {{ placement(row.grade, row.className) }}
                </td>
                <td class="px-4 py-3">
                  <div class="flex flex-wrap gap-1">
                    <StatusBadge v-for="a in row.allergies" :key="a.code" tone="danger" solid>{{
                      a.label
                    }}</StatusBadge>
                  </div>
                </td>
                <td class="px-4 py-3">
                  <div
                    v-for="line in row.lines"
                    :key="`${line.mealType}-${line.mealId}`"
                    class="flex flex-wrap items-center gap-1.5"
                    :class="line.conflicts.length ? 'font-bold text-danger-ink' : ''"
                  >
                    <span
                      >{{ line.mealType === 'supplement' ? '+ ' : '' }}{{ line.name
                      }}<template v-if="line.quantity > 1"> ×{{ line.quantity }}</template></span
                    >
                    <StatusBadge v-if="line.conflicts.length" tone="danger" solid>
                      {{
                        t('reports.allergies.conflict_badge', {
                          allergens: line.conflicts.map((c) => c.label).join(', '),
                        })
                      }}
                    </StatusBadge>
                  </div>
                </td>
                <td class="px-4 py-3 text-ink-3">{{ row.dietaryNotes ?? '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </KitchenLayout>
</template>
