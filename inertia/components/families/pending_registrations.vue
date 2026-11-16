<script setup lang="ts">
/**
 * D59: the "À activer" list — what each parent typed on the QR form, with
 * Activer (parent + children active, then the WhatsApp button on their
 * page) and Refuser (kept, deactivated). The server checks everything.
 */
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AppButton from '~/components/ui/app_button.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import ConfirmDialog from '~/components/ui/confirm_dialog.vue'
import PaginationNav, { type PaginationMeta } from '~/components/ui/pagination_nav.vue'
import type { RegistrationRow } from '~/components/families/types'
import { useI18n } from '~/composables/use_i18n'
import { useFeatures, usePlacement } from '~/composables/use_features'

defineProps<{ registrations: RegistrationRow[]; meta: PaginationMeta }>()

const { t, formatDateTime } = useI18n()
const features = useFeatures()
const placement = usePlacement()

const target = ref<{ row: RegistrationRow; action: 'approve' | 'refuse' } | null>(null)
const open = ref(false)
const processing = ref(false)

function ask(row: RegistrationRow, action: 'approve' | 'refuse') {
  target.value = { row, action }
  open.value = true
}

function confirm() {
  if (!target.value) return
  const { row, action } = target.value
  router.post(
    `/admin/parents/${row.id}/registration/${action}`,
    action === 'refuse' ? { from: 'list' } : {},
    {
      preserveScroll: true,
      onStart: () => (processing.value = true),
      onFinish: () => {
        processing.value = false
        open.value = false
      },
    }
  )
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="registrations.length" class="m-0 text-[13px] text-ink-3">
      {{ t('families.registration.review_hint') }}
    </p>
    <EmptyState
      v-if="!registrations.length"
      :title="t('families.registration.list_empty_title')"
      :description="t('families.registration.list_empty_body')"
    />

    <article
      v-for="row in registrations"
      :key="row.id"
      class="flex flex-col gap-3 rounded-2xl border border-line p-4"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-0.5">
          <Link :href="`/admin/parents/${row.id}`" class="font-extrabold text-ink">
            {{ row.fullName }}
          </Link>
          <span class="text-[13px] break-all text-ink-3">{{ row.email }}</span>
          <span class="text-[13px] text-ink-3">{{ row.phone ?? '—' }}</span>
          <span v-if="row.registeredAt" class="text-xs text-ink-4">
            {{
              t('families.registration.registered_on', {
                date: formatDateTime(row.registeredAt, { dateStyle: 'medium', timeStyle: 'short' }),
              })
            }}
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <StatusBadge
            :tone="row.emailConfirmed ? 'brand' : row.confirmationExpired ? 'danger' : 'warning'"
          >
            {{
              row.emailConfirmed
                ? t('families.registration.email_confirmed')
                : row.confirmationExpired
                  ? t('families.registration.link_expired')
                  : t('families.registration.email_unconfirmed')
            }}
          </StatusBadge>
          <AppButton
            size="sm"
            :disabled="!row.emailConfirmed"
            :title="
              row.emailConfirmed ? undefined : t('families.registration.errors.email_not_confirmed')
            "
            @click="ask(row, 'approve')"
          >
            {{ t('families.parent_show.approve') }}
          </AppButton>
          <AppButton size="sm" variant="secondary" @click="ask(row, 'refuse')">
            {{ t('families.parent_show.refuse') }}
          </AppButton>
        </div>
      </div>

      <ul class="flex flex-col gap-2">
        <li
          v-for="child in row.children"
          :key="child.id"
          class="flex flex-col gap-1.5 rounded-xl bg-subtle px-3 py-2.5 text-sm"
        >
          <div class="flex flex-wrap items-baseline gap-2">
            <span class="font-bold">{{ child.firstName }} {{ child.lastName }}</span>
            <span class="text-[13px] text-ink-4">
              {{ placement(child.grade, child.className) }}
            </span>
          </div>
          <div v-if="features.allergens" class="flex flex-wrap gap-1.5">
            <StatusBadge v-for="code in child.allergies" :key="code" tone="danger">
              {{ t(`allergens.${code}`) }}
            </StatusBadge>
            <span v-if="!child.allergies.length" class="text-[13px] text-ink-4">
              {{ t('families.parent_show.no_allergies') }}
            </span>
          </div>
          <p class="m-0 text-[13px] text-ink-3">
            {{ child.dietaryNotes || t('families.registration.no_notes') }}
          </p>
        </li>
      </ul>
    </article>

    <PaginationNav v-if="meta.lastPage > 1" :meta="meta" />

    <ConfirmDialog
      v-model:open="open"
      :title="
        target?.action === 'refuse'
          ? t('families.parent_show.refuse_title')
          : t('families.parent_show.approve_title')
      "
      :message="
        target
          ? t(
              target.action === 'refuse'
                ? 'families.parent_show.refuse_body'
                : 'families.parent_show.approve_body',
              { name: target.row.fullName }
            )
          : ''
      "
      :confirm-label="
        target?.action === 'refuse'
          ? t('families.parent_show.refuse')
          : t('families.parent_show.approve')
      "
      :danger="target?.action === 'refuse'"
      :processing="processing"
      @confirm="confirm"
    />
  </div>
</template>
