<script setup lang="ts">
/**
 * Parent portal — monthly statement of the family (or of one child), with
 * a month picker, the PDF download and print. Amounts come from the
 * server (price snapshots of active orders).
 */
import { Head } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import ParentLayout from '~/layouts/parent_layout.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import MonthNav from '~/components/statements/month_nav.vue'
import StatementView from '~/components/statements/statement_view.vue'
import { useI18n } from '~/composables/use_i18n'
import type { FamilyStatement, MonthNav as MonthNavProps } from '~/components/statements/types'

const props = defineProps<{
  nav: MonthNavProps
  children: { id: number; firstName: string }[]
  childId: number | null
  statement: FamilyStatement
  pdfUrl: string
}>()

const { t } = useI18n()

function childHref(id: number | null) {
  const query = new URLSearchParams({ month: props.nav.value })
  if (id) query.set('child', String(id))
  return `/statements?${query}`
}

function print() {
  window.print()
}
</script>

<template>
  <ParentLayout>
    <Head :title="t('statements.parent_title')" />
    <div class="flex items-end justify-between gap-3">
      <div class="flex flex-col gap-0.5">
        <span class="text-sm text-ink-3 first-letter:uppercase">{{ nav.label }}</span>
        <h1 class="text-[26px] font-extrabold tracking-[-0.02em]">
          {{ t('statements.parent_title') }}
        </h1>
      </div>
      <StatusBadge :tone="statement.provisional ? 'warning' : 'brand'">
        {{ statement.provisional ? t('statements.provisional') : t('statements.final') }}
      </StatusBadge>
    </div>

    <MonthNav :nav="nav" path="/statements" :keep="{ child: childId }" class="print:hidden" />

    <nav
      v-if="children.length > 1"
      class="flex flex-wrap gap-2 print:hidden"
      :aria-label="t('statements.choose_child')"
    >
      <Link
        :href="childHref(null)"
        class="min-h-11 rounded-full border px-4 py-2 text-sm font-bold no-underline"
        :class="
          childId === null
            ? 'border-brand bg-brand-soft text-brand-strong'
            : 'border-line bg-surface text-ink-2'
        "
      >
        {{ t('statements.all_children') }}
      </Link>
      <Link
        v-for="c in children"
        :key="c.id"
        :href="childHref(c.id)"
        class="min-h-11 rounded-full border px-4 py-2 text-sm font-bold no-underline"
        :class="
          childId === c.id
            ? 'border-brand bg-brand-soft text-brand-strong'
            : 'border-line bg-surface text-ink-2'
        "
      >
        {{ c.firstName }}
      </Link>
    </nav>

    <div class="flex gap-2 print:hidden">
      <a
        :href="pdfUrl"
        class="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-brand px-4 text-sm font-bold text-white no-underline hover:bg-brand-strong hover:text-white"
      >
        {{ t('statements.download_pdf') }}
      </a>
      <button
        type="button"
        class="inline-flex h-11 items-center justify-center rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:bg-subtle"
        @click="print"
      >
        {{ t('statements.print') }}
      </button>
    </div>

    <StatementView :statement="statement" />
  </ParentLayout>
</template>
