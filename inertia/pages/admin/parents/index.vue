<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import AppButton from '~/components/ui/app_button.vue'
import DataTable from '~/components/ui/data_table.vue'
import UserAvatar from '~/components/ui/user_avatar.vue'
import AccessBadge from '~/components/families/access_badge.vue'
import type { ParentRow } from '~/components/families/types'
import type { PaginationMeta } from '~/components/ui/pagination_nav.vue'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  parents: ParentRow[]
  meta: PaginationMeta
  filters: { q: string; status: string }
  statuses: string[]
}>()

const { t, formatDateTime } = useI18n()

const search = ref(props.filters.q)
let timer: ReturnType<typeof setTimeout> | undefined

function load(params: { q?: string; status?: string }) {
  const query: Record<string, string> = {}
  const q = params.q ?? search.value
  const status = params.status ?? props.filters.status
  if (q.trim()) query.q = q.trim()
  if (status && status !== 'all') query.status = status
  router.get('/admin/parents', query, { preserveState: true, preserveScroll: true, replace: true })
}

watch(search, (value) => {
  clearTimeout(timer)
  timer = setTimeout(() => load({ q: value }), 300)
})

function statusHref(status: string) {
  const params = new URLSearchParams()
  if (props.filters.q) params.set('q', props.filters.q)
  if (status !== 'all') params.set('status', status)
  const qs = params.toString()
  return `/admin/parents${qs ? `?${qs}` : ''}`
}

const filtered = computed(() => Boolean(props.filters.q) || props.filters.status !== 'all')

const columns = computed(() => [
  { key: 'parent', label: t('families.parents.columns.parent') },
  { key: 'phone', label: t('families.parents.columns.phone') },
  { key: 'childrenCount', label: t('families.parents.columns.children'), align: 'center' as const },
  { key: 'access', label: t('families.parents.columns.access') },
  { key: 'lastLogin', label: t('families.parents.columns.last_login') },
  { key: 'actions', label: t('families.parents.columns.actions'), align: 'right' as const },
])

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/)
  return `${parts[0]?.charAt(0) ?? ''}${parts.length > 1 ? parts[parts.length - 1].charAt(0) : ''}`.toUpperCase()
}
</script>

<template>
  <AdminLayout>
    <PageHeader
      :title="t('families.parents.title')"
      :description="t('families.parents.description', { count: meta.total })"
    >
      <template #actions>
        <AppButton variant="secondary" href="/admin/imports/families">
          {{ t('families.parents.import') }}
        </AppButton>
        <AppButton href="/admin/parents/create">{{ t('families.parents.new') }}</AppButton>
      </template>
    </PageHeader>

    <section class="card flex flex-col gap-4 p-4 sm:p-5">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label
          class="flex h-11 w-full items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-ink-4 lg:max-w-sm"
        >
          <svg
            class="size-[18px] shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span class="sr-only">{{ t('families.parents.search_label') }}</span>
          <input
            v-model="search"
            type="search"
            :placeholder="t('families.parents.search_placeholder')"
            class="w-full border-0 bg-transparent text-sm text-ink outline-none"
          />
        </label>

        <nav :aria-label="t('families.parents.filters_label')" class="-mx-1 overflow-x-auto px-1">
          <div class="flex w-max gap-1 rounded-xl bg-subtle p-1">
            <Link
              v-for="status in statuses"
              :key="status"
              :href="statusHref(status)"
              preserve-scroll
              :aria-current="filters.status === status ? 'page' : undefined"
              class="flex min-h-9 items-center rounded-[10px] px-3 text-[13px] font-bold whitespace-nowrap no-underline"
              :class="
                filters.status === status
                  ? 'bg-surface text-ink shadow-pressed hover:text-ink'
                  : 'text-ink-3 hover:text-ink'
              "
            >
              {{ t(`families.parents.filters.${status}`) }}
            </Link>
          </div>
        </nav>
      </div>

      <DataTable
        :columns="columns"
        :rows="parents"
        :meta="meta"
        :caption="t('families.parents.title')"
        :empty-title="
          filtered ? t('families.parents.no_results_title') : t('families.parents.empty_title')
        "
        :empty-description="
          filtered ? t('families.parents.no_results_body') : t('families.parents.empty_body')
        "
      >
        <template #cell-parent="{ row }">
          <div class="flex min-w-[220px] items-center gap-3">
            <UserAvatar :initials="initials(row.fullName)" />
            <div class="flex min-w-0 flex-col">
              <Link :href="`/admin/parents/${row.id}`" class="truncate font-bold text-ink">
                {{ row.fullName }}
              </Link>
              <span class="truncate text-[13px] text-ink-4">{{ row.email }}</span>
            </div>
          </div>
        </template>
        <template #cell-phone="{ row }">
          <span class="whitespace-nowrap text-ink-3">{{ row.phone ?? '—' }}</span>
        </template>
        <template #cell-access="{ row }">
          <div class="flex flex-col gap-1">
            <AccessBadge :status="row.accessStatus" />
            <span
              v-if="row.accessStatus === 'invited' && row.invitationExpiresAt"
              class="text-xs whitespace-nowrap text-ink-4"
            >
              {{
                t('families.access.invited_until', {
                  date: formatDateTime(row.invitationExpiresAt, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }),
                })
              }}
            </span>
          </div>
        </template>
        <template #cell-lastLogin="{ row }">
          <span class="whitespace-nowrap text-ink-3">
            {{ row.lastLoginAt ? formatDateTime(row.lastLoginAt) : t('families.parents.never') }}
          </span>
        </template>
        <template #cell-actions="{ row }">
          <AppButton
            size="sm"
            variant="secondary"
            :href="`/admin/parents/${row.id}`"
            :aria-label="t('families.parents.view_label', { name: row.fullName })"
          >
            {{ t('families.parents.view') }}
          </AppButton>
        </template>
      </DataTable>
    </section>
  </AdminLayout>
</template>
