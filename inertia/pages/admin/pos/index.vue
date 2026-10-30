<script setup lang="ts">
/**
 * Ordering desk (D39): find a family, pick a child, then order for a parent
 * who does not use the app. Every rule is decided by the server.
 */
import { ref, watch } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import AppButton from '~/components/ui/app_button.vue'
import TextInput from '~/components/ui/text_input.vue'
import DayCard from '~/components/orders/day_card.vue'
import { useI18n } from '~/composables/use_i18n'
import { usePlacement } from '~/composables/use_features'
import type { Selection, WeekView } from '~/components/orders/types'

const props = defineProps<{
  q: string
  families: {
    id: number
    fullName: string
    phone: string | null
    children: {
      id: number
      firstName: string
      lastName: string
      grade: string | null
      className: string | null
    }[]
  }[]
  selected: {
    child: { id: number; firstName: string; lastName: string }
    parentName: string
    siblings: { id: number; firstName: string }[]
    week: { start: string; first: string; last: string; previous: string; next: string }
    view: WeekView
  } | null
}>()

const { t, formatDate } = useI18n()
const placement = usePlacement()

const search = ref(props.q)
function submitSearch() {
  router.get('/admin/pos', search.value ? { q: search.value } : {}, { preserveScroll: true })
}

const childUrl = (id: number, week?: string) =>
  `/admin/pos?child=${id}${week ? `&week=${week}` : ''}`

/* One day open at a time, the one the server puts forward first. */
const openDate = ref<string | null>(null)
watch(
  () => `${props.selected?.child.id}-${props.selected?.week.start}`,
  () => {
    openDate.value = props.selected?.view.days.find((day) => day.isFocus)?.date ?? null
  },
  { immediate: true }
)
const toggleDay = (date: string) => (openDate.value = openDate.value === date ? null : date)

const saving = ref<string | null>(null)
function post(url: string, data: Record<string, any>, date: string) {
  router.post(url, data, {
    preserveScroll: true,
    onStart: () => (saving.value = date),
    onFinish: () => (saving.value = null),
  })
}
function save(date: string, selection: Selection, confirmAllergy: boolean) {
  post(
    `/admin/pos/children/${props.selected!.child.id}/days/${date}`,
    { ...selection, confirmAllergy },
    date
  )
}
function cancel(date: string) {
  post(`/admin/pos/children/${props.selected!.child.id}/days/${date}/cancel`, {}, date)
}
</script>

<template>
  <AdminLayout>
    <Head :title="t('orders.pos.title')" />
    <PageHeader :title="t('orders.pos.title')" :description="t('orders.pos.description')" />

    <template v-if="selected">
      <div class="flex flex-wrap items-center gap-3 text-sm font-bold">
        <Link :href="q ? `/admin/pos?q=${encodeURIComponent(q)}` : '/admin/pos'"
          >← {{ t('orders.pos.back') }}</Link
        >
        <span class="text-ink-3">{{ selected.parentName }}</span>
      </div>

      <div class="flex flex-wrap gap-2">
        <Link
          v-for="sibling in selected.siblings"
          :key="sibling.id"
          :href="childUrl(sibling.id, selected.week.start)"
          class="flex min-h-11 items-center rounded-xl border px-4 text-sm font-bold no-underline"
          :class="
            sibling.id === selected.child.id
              ? 'border-brand bg-brand-soft text-brand-strong hover:text-brand-strong'
              : 'border-line bg-surface text-ink-2 hover:text-ink'
          "
        >
          {{ sibling.firstName }}
        </Link>
      </div>

      <div class="flex flex-wrap items-center gap-3 text-sm font-bold">
        <Link :href="childUrl(selected.child.id, selected.week.previous)"
          >‹ {{ t('orders.week.previous') }}</Link
        >
        <span class="text-ink-3">
          {{ formatDate(selected.week.first, { day: 'numeric', month: 'short' }) }} –
          {{ formatDate(selected.week.last, { day: 'numeric', month: 'short', year: 'numeric' }) }}
        </span>
        <Link :href="childUrl(selected.child.id, selected.week.next)"
          >{{ t('orders.week.next') }} ›</Link
        >
      </div>

      <p class="rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning-ink">
        {{ t('orders.pos.notice') }}
      </p>
      <p v-if="selected.view.allergies.length" class="text-sm font-bold text-danger">
        {{
          t('orders.week.allergies', {
            name: selected.child.firstName,
            list: selected.view.allergies.map((a) => a.label).join(', '),
          })
        }}
      </p>

      <div class="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DayCard
          v-for="(day, index) in selected.view.days"
          :key="`${selected.child.id}-${day.date}`"
          :day="day"
          :index="index"
          :child-name="selected.child.firstName"
          mode="staff"
          :saving="saving === day.date"
          :open="openDate === day.date"
          @toggle="toggleDay(day.date)"
          @change="(selection, confirm) => save(day.date, selection, confirm)"
          @absent="cancel(day.date)"
        />
      </div>
    </template>

    <template v-else>
      <form class="card flex flex-wrap items-end gap-3 p-4" @submit.prevent="submitSearch">
        <div class="min-w-60 flex-1">
          <TextInput id="q" v-model="search" :label="t('orders.pos.search')" />
        </div>
        <AppButton type="submit">{{ t('orders.pos.search_action') }}</AppButton>
      </form>

      <EmptyState
        v-if="!families.length"
        :title="t('orders.pos.empty')"
        :description="t('orders.pos.empty_hint')"
      />
      <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <section v-for="family in families" :key="family.id" class="card flex flex-col gap-3 p-4">
          <div class="flex flex-col gap-0.5">
            <h2 class="text-[15px] font-bold">{{ family.fullName }}</h2>
            <span v-if="family.phone" class="tabular text-[13px] text-ink-3">{{
              family.phone
            }}</span>
          </div>
          <div class="flex flex-wrap gap-2">
            <Link
              v-for="child in family.children"
              :key="child.id"
              :href="childUrl(child.id)"
              class="flex min-h-11 flex-col justify-center rounded-xl border border-line px-3 py-1 text-sm font-bold text-ink-2 no-underline hover:border-brand hover:text-ink"
            >
              {{ child.firstName }} {{ child.lastName }}
              <span
                v-if="placement(child.grade, child.className)"
                class="text-xs font-normal text-ink-4"
                >{{ placement(child.grade, child.className) }}</span
              >
            </Link>
          </div>
        </section>
      </div>
    </template>
  </AdminLayout>
</template>
