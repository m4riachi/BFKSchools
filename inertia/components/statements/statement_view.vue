<script setup lang="ts">
/**
 * One family's monthly statement (parent portal and back-office): a card
 * per child with the subscription meals (a count — included, D31: never
 * priced), one line per extra, the child total (extras) and a collapsible
 * daily detail; then the family total. Everything is computed and formatted by
 * the server — this only lays it out.
 */
import StatusBadge from '~/components/ui/status_badge.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import { useI18n } from '~/composables/use_i18n'
import type { FamilyStatement } from '~/components/statements/types'

defineProps<{ statement: FamilyStatement }>()

const { t, formatDate } = useI18n()
</script>

<template>
  <div class="flex flex-col gap-4">
    <p
      v-if="statement.provisional"
      class="rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning-ink"
    >
      {{ t('statements.provisional_note') }}
    </p>

    <section v-if="!statement.children.length" class="rounded-[18px] border border-line bg-surface">
      <EmptyState tone="info" :title="t('statements.empty')" />
    </section>

    <article
      v-for="child in statement.children"
      :key="child.childId"
      class="flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-4"
    >
      <header class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h2 class="text-[17px] font-extrabold">{{ child.firstName }} {{ child.lastName }}</h2>
          <span class="text-[13px] text-ink-3">
            {{ [child.grade, child.className].filter(Boolean).join(' · ') }}
          </span>
          <StatusBadge v-if="!child.isActive" tone="neutral">{{
            t('statements.inactive')
          }}</StatusBadge>
        </div>
        <span class="tabular text-lg font-extrabold whitespace-nowrap">{{ child.total }}</span>
      </header>

      <div class="flex flex-col gap-1.5">
        <h3 class="text-xs font-bold tracking-[0.04em] text-ink-4 uppercase">
          {{ t('statements.subscription_meals') }}
        </h3>
        <div class="flex justify-between gap-3 text-sm">
          <span>
            {{
              child.subscription.count
                ? t('statements.subscription_line', { count: child.subscription.count })
                : t('statements.no_subscription_meals')
            }}
          </span>
          <span v-if="child.subscription.count" class="text-ink-3">{{
            t('statements.subscription_included')
          }}</span>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <h3 class="text-xs font-bold tracking-[0.04em] text-ink-4 uppercase">
          {{ t('statements.supplements') }}
        </h3>
        <div
          v-for="(line, index) in child.supplements.lines"
          :key="`x${index}`"
          class="flex justify-between gap-3 text-sm"
        >
          <span>
            {{ line.name }}
            <span class="text-ink-4">
              · {{ t('statements.unit_price', { quantity: line.quantity, price: line.unitPrice }) }}
            </span>
          </span>
          <span class="tabular">{{ line.amount }}</span>
        </div>
        <p v-if="!child.supplements.lines.length" class="text-sm text-ink-4">
          {{ t('statements.no_supplements') }}
        </p>
      </div>

      <div class="flex justify-between gap-3 border-t border-line pt-2 text-[15px] font-extrabold">
        <span>{{ t('statements.child_total') }}</span>
        <span class="tabular">{{ child.total }}</span>
      </div>

      <details v-if="child.days.length" class="group rounded-xl bg-subtle px-3 py-2">
        <summary class="min-h-11 cursor-pointer py-3 text-sm font-bold text-ink-2">
          {{ t('statements.show_days') }}
        </summary>
        <ul class="flex flex-col divide-y divide-line-soft">
          <li
            v-for="day in child.days"
            :key="day.date"
            class="flex justify-between gap-3 py-1.5 text-[13px]"
          >
            <span class="flex flex-col">
              <span class="font-semibold first-letter:uppercase">{{
                formatDate(day.date, { weekday: 'long', day: 'numeric', month: 'long' })
              }}</span>
              <span class="text-ink-3">
                {{
                  day.items
                    .map((item) =>
                      item.type === 'supplement' && item.quantity > 1
                        ? `${item.name} × ${item.quantity}`
                        : item.name
                    )
                    .join(', ')
                }}
              </span>
            </span>
            <span v-if="day.totalCents > 0" class="tabular whitespace-nowrap">{{ day.total }}</span>
            <span v-else class="whitespace-nowrap text-ink-4">{{ t('statements.included') }}</span>
          </li>
        </ul>
      </details>
    </article>

    <section
      v-if="statement.children.length"
      class="flex items-center justify-between gap-3 rounded-[18px] bg-brand px-4 py-4 text-white"
    >
      <span class="text-[15px] font-extrabold">{{ t('statements.family_total') }}</span>
      <span class="tabular text-xl font-extrabold">{{ statement.totals.total }}</span>
    </section>
    <p class="text-[13px] text-ink-4">{{ t('statements.included_note') }}</p>
  </div>
</template>
