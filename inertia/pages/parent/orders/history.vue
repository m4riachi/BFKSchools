<script setup lang="ts">
/** Parent portal — order history of the family (newest first, snapshot prices). */
import { Head } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import ParentLayout from '~/layouts/parent_layout.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import PaginationNav, { type PaginationMeta } from '~/components/ui/pagination_nav.vue'
import { useI18n } from '~/composables/use_i18n'

defineProps<{
  children: { id: number; firstName: string }[]
  childId: number | null
  orders: {
    id: number
    date: string
    childName: string
    status: string
    cancelReason: string | null
    origin: string
    lines: { name: string; type: string; quantity: number; unitPrice: string; lineTotal: string }[]
    total: string
  }[]
  meta: PaginationMeta
}>()

const { t, formatDate } = useI18n()
</script>

<template>
  <ParentLayout>
    <Head :title="t('orders.history.title')" />
    <h1 class="text-[26px] font-extrabold tracking-[-0.02em]">{{ t('orders.history.title') }}</h1>

    <nav
      v-if="children.length > 1"
      class="flex flex-wrap gap-2"
      :aria-label="t('orders.week.choose_child')"
    >
      <Link
        href="/orders/history"
        class="min-h-10 rounded-full border px-4 py-2 text-sm font-bold no-underline"
        :class="
          childId === null
            ? 'border-brand bg-brand-soft text-brand-strong'
            : 'border-line bg-surface text-ink-2'
        "
      >
        {{ t('orders.history.all_children') }}
      </Link>
      <Link
        v-for="c in children"
        :key="c.id"
        :href="`/orders/history?child=${c.id}`"
        class="min-h-10 rounded-full border px-4 py-2 text-sm font-bold no-underline"
        :class="
          childId === c.id
            ? 'border-brand bg-brand-soft text-brand-strong'
            : 'border-line bg-surface text-ink-2'
        "
      >
        {{ c.firstName }}
      </Link>
    </nav>

    <section v-if="!orders.length" class="rounded-[18px] border border-line bg-surface">
      <EmptyState tone="info" :title="t('orders.history.empty')" />
    </section>

    <article
      v-for="order in orders"
      :key="order.id"
      class="flex flex-col gap-2 rounded-[18px] border border-line bg-surface p-4"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="flex flex-col gap-0.5">
          <h2 class="text-[15px] font-extrabold first-letter:uppercase">
            {{
              formatDate(order.date, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })
            }}
          </h2>
          <span class="text-[13px] text-ink-3">
            {{ order.childName }} ·
            {{
              order.status === 'cancelled' && order.cancelReason
                ? t(`orders.cancel_reasons.${order.cancelReason}`)
                : t(`orders.statuses.${order.status}`)
            }}
            <template v-if="order.origin !== 'parent'">
              · {{ t(`orders.origins.${order.origin}`) }}</template
            >
          </span>
        </div>
        <span class="tabular text-[15px] font-extrabold">{{ order.total }}</span>
      </div>
      <ul v-if="order.status === 'active'" class="flex flex-col gap-1">
        <li
          v-for="(line, index) in order.lines"
          :key="index"
          class="flex justify-between gap-2 text-sm"
        >
          <span
            >{{ line.name
            }}<template v-if="line.type === 'supplement'"> × {{ line.quantity }}</template></span
          >
          <span class="tabular text-ink-3">{{ line.lineTotal }}</span>
        </li>
      </ul>
    </article>

    <PaginationNav v-if="meta.lastPage > 1" :meta="meta" />
  </ParentLayout>
</template>
