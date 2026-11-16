<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import AppButton from '~/components/ui/app_button.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import ConfirmDialog from '~/components/ui/confirm_dialog.vue'
import ModalDialog from '~/components/ui/modal_dialog.vue'
import AccessBadge from '~/components/families/access_badge.vue'
import type { ChildRow, ParentRow, SubscriptionRow } from '~/components/families/types'
import { useI18n } from '~/composables/use_i18n'
import { useFeatures, usePlacement } from '~/composables/use_features'

const props = defineProps<{
  parent: ParentRow
  children: ChildRow[]
  today: string
  hasWhatsapp: boolean
  whatsappInvite: string | null
  /** D59: QR sign-up (null for accounts created by staff or the import). */
  registration: {
    status: 'pending' | 'approved' | 'refused'
    emailConfirmed: boolean
    registeredAt: string | null
    reviewedAt: string | null
  } | null
  /** D59: wa.me link with the login address and the children's Code borne. */
  activationWhatsapp: string | null
}>()

const { t, formatDate, formatDateTime } = useI18n()
const features = useFeatures()
const placement = usePlacement()

const canInvite = computed(() => props.parent.isActive && !props.parent.hasPassword)
const isResend = computed(() => props.parent.invitedAt !== null)

const processing = ref(false)
const whatsappOpen = ref(false)
watch(
  () => props.whatsappInvite,
  (url) => (whatsappOpen.value = Boolean(url)),
  { immediate: true }
)
const confirmOpen = ref(false)

function post(url: string) {
  router.post(
    url,
    {},
    {
      preserveScroll: true,
      onStart: () => (processing.value = true),
      onFinish: () => {
        processing.value = false
        confirmOpen.value = false
      },
    }
  )
}

/** D59: a sign-up waiting for the school (or refused earlier) is activated with its children. */
const reviewing = computed(
  () => props.registration?.status === 'pending' || props.registration?.status === 'refused'
)
const reviewAction = ref<'approve' | 'refuse'>('approve')
const reviewOpen = ref(false)
function askReview(action: 'approve' | 'refuse') {
  reviewAction.value = action
  reviewOpen.value = true
}
function review() {
  router.post(
    `/admin/parents/${props.parent.id}/registration/${reviewAction.value}`,
    {},
    {
      preserveScroll: true,
      onStart: () => (processing.value = true),
      onFinish: () => {
        processing.value = false
        reviewOpen.value = false
      },
    }
  )
}

function toggleActive() {
  post(`/admin/parents/${props.parent.id}/${props.parent.isActive ? 'deactivate' : 'activate'}`)
}

/** The period covering today, else the next one, else the latest. */
function currentPeriod(subscriptions: SubscriptionRow[]): SubscriptionRow | null {
  const today = props.today
  const covering = subscriptions.find(
    (s) => s.startDate <= today && (s.endDate === null || s.endDate >= today)
  )
  if (covering) return covering
  const upcoming = [...subscriptions]
    .filter((s) => s.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
  return upcoming[0] ?? subscriptions[0] ?? null
}

function periodLabel(s: SubscriptionRow) {
  const start = formatDate(s.startDate, { dateStyle: 'medium' })
  return s.endDate
    ? t('families.subscriptions.period', {
        start,
        end: formatDate(s.endDate, { dateStyle: 'medium' }),
      })
    : t('families.subscriptions.period_open', { start })
}

const statusTone = (status: SubscriptionRow['status']) =>
  status === 'active' ? 'brand' : status === 'paused' ? 'warning' : 'neutral'

const languageLabel = computed(() =>
  props.parent.locale === 'en'
    ? t('families.parent_form.locale_en')
    : t('families.parent_form.locale_fr')
)
</script>

<template>
  <AdminLayout>
    <div>
      <Link href="/admin/parents" class="text-[13px] font-semibold">
        ← {{ t('families.parent_show.back') }}
      </Link>
    </div>
    <PageHeader :title="parent.fullName" :eyebrow="t('families.parents.title')">
      <template #actions>
        <AccessBadge :status="parent.accessStatus" />
        <AppButton variant="secondary" :href="`/admin/parents/${parent.id}/edit`">
          {{ t('families.parent_show.edit') }}
        </AppButton>
      </template>
    </PageHeader>

    <div class="grid gap-4 lg:grid-cols-2">
      <section class="card flex flex-col gap-4 p-5" aria-labelledby="contact-title">
        <h2 id="contact-title" class="text-base font-extrabold">
          {{ t('families.parent_show.contact') }}
        </h2>
        <dl class="grid grid-cols-[minmax(0,140px)_1fr] gap-x-4 gap-y-3 text-sm">
          <dt class="text-ink-4">{{ t('families.parent_show.email') }}</dt>
          <dd class="min-w-0 font-semibold break-all">{{ parent.email }}</dd>
          <dt class="text-ink-4">{{ t('families.parent_show.phone') }}</dt>
          <dd class="font-semibold">{{ parent.phone ?? t('families.parent_show.none') }}</dd>
          <dt class="text-ink-4">{{ t('families.parent_show.language') }}</dt>
          <dd class="font-semibold">{{ languageLabel }}</dd>
          <dt class="text-ink-4">{{ t('families.parent_show.created') }}</dt>
          <dd class="font-semibold">
            {{ parent.createdAt ? formatDateTime(parent.createdAt, { dateStyle: 'long' }) : '—' }}
          </dd>
        </dl>
      </section>

      <section class="card flex flex-col gap-4 p-5" aria-labelledby="access-title">
        <div class="flex items-center justify-between gap-3">
          <h2 id="access-title" class="text-base font-extrabold">
            {{ t('families.parent_show.access') }}
          </h2>
          <AccessBadge :status="parent.accessStatus" />
        </div>
        <p class="text-sm text-ink-3">
          {{ t(`families.parent_show.access_body.${parent.accessStatus}`) }}
          <template v-if="parent.accessStatus === 'invited' && parent.invitationExpiresAt">
            {{
              t('families.access.invited_until', {
                date: formatDateTime(parent.invitationExpiresAt),
              })
            }}
          </template>
        </p>
        <dl class="grid grid-cols-[minmax(0,140px)_1fr] gap-x-4 gap-y-3 text-sm">
          <dt class="text-ink-4">{{ t('families.parent_show.last_login') }}</dt>
          <dd class="font-semibold">
            {{
              parent.lastLoginAt
                ? formatDateTime(parent.lastLoginAt)
                : t('families.parent_show.never_logged_in')
            }}
          </dd>
          <template v-if="registration">
            <dt class="text-ink-4">{{ t('families.registration.email_label') }}</dt>
            <dd class="flex flex-wrap items-center gap-2 font-semibold">
              <StatusBadge :tone="registration.emailConfirmed ? 'brand' : 'warning'">
                {{
                  registration.emailConfirmed
                    ? t('families.registration.email_confirmed')
                    : t('families.registration.email_unconfirmed')
                }}
              </StatusBadge>
              <AppButton
                v-if="!registration.emailConfirmed && registration.status !== 'approved'"
                size="sm"
                variant="secondary"
                :disabled="processing"
                @click="post(`/admin/parents/${parent.id}/registration/confirmation`)"
              >
                {{ t('families.registration.resend_confirmation') }}
              </AppButton>
            </dd>
          </template>
          <template v-if="registration?.registeredAt">
            <dt class="text-ink-4">{{ t('families.parent_show.registered_at') }}</dt>
            <dd class="font-semibold">{{ formatDateTime(registration.registeredAt) }}</dd>
          </template>
          <template v-if="registration?.reviewedAt">
            <dt class="text-ink-4">{{ t('families.parent_show.reviewed_at') }}</dt>
            <dd class="font-semibold">{{ formatDateTime(registration.reviewedAt) }}</dd>
          </template>
          <template v-if="parent.invitedAt">
            <dt class="text-ink-4">{{ t('families.parent_show.invited_at') }}</dt>
            <dd class="font-semibold">{{ formatDateTime(parent.invitedAt) }}</dd>
          </template>
        </dl>
        <div class="mt-auto flex flex-wrap gap-2.5">
          <AppButton
            v-if="canInvite"
            :loading="processing && !confirmOpen"
            @click="post(`/admin/parents/${parent.id}/invitation`)"
          >
            {{ isResend ? t('families.parent_show.resend') : t('families.parent_show.invite') }}
          </AppButton>
          <AppButton
            v-if="canInvite"
            variant="secondary"
            :disabled="!hasWhatsapp || processing"
            :title="hasWhatsapp ? undefined : t('families.parent_show.whatsapp_no_phone')"
            @click="post(`/admin/parents/${parent.id}/invitation/whatsapp`)"
          >
            {{ t('families.parent_show.invite_whatsapp') }}
          </AppButton>
          <template v-if="reviewing">
            <AppButton :disabled="!registration?.emailConfirmed" @click="askReview('approve')">
              {{ t('families.parent_show.approve') }}
            </AppButton>
            <AppButton
              v-if="registration?.status === 'pending'"
              variant="secondary"
              @click="askReview('refuse')"
            >
              {{ t('families.parent_show.refuse') }}
            </AppButton>
          </template>
          <a
            v-if="activationWhatsapp"
            :href="activationWhatsapp"
            target="_blank"
            rel="noopener noreferrer"
            class="flex min-h-11 items-center rounded-xl bg-[#25D366] px-4 text-sm font-bold text-white no-underline hover:bg-[#1EBE5B] hover:text-white"
          >
            {{ t('families.parent_show.send_codes') }}
          </a>
          <AppButton
            v-if="!reviewing"
            :variant="parent.isActive ? 'secondary' : 'primary'"
            @click="confirmOpen = true"
          >
            {{
              parent.isActive
                ? t('families.parent_show.deactivate')
                : t('families.parent_show.activate')
            }}
          </AppButton>
        </div>
        <p v-if="activationWhatsapp" class="text-[13px] text-ink-4">
          {{ t('families.parent_show.send_codes_hint') }}
        </p>
        <p
          v-else-if="registration?.status === 'approved' && parent.isActive && !hasWhatsapp"
          class="text-[13px] text-ink-4"
        >
          {{ t('families.parent_show.send_codes_no_phone') }}
        </p>
        <p v-if="canInvite && !hasWhatsapp" class="text-[13px] text-ink-4">
          {{ t('families.parent_show.whatsapp_no_phone') }}
        </p>
        <p v-if="canInvite && isResend" class="text-[13px] text-ink-4">
          {{ t('families.parent_show.resend_hint') }}
        </p>
      </section>
    </div>

    <section class="flex flex-col gap-4" aria-labelledby="children-title">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 id="children-title" class="text-lg font-extrabold">
          {{ t('families.parent_show.children') }}
        </h2>
        <AppButton size="sm" :href="`/admin/parents/${parent.id}/children/create`">
          {{ t('families.parent_show.add_child') }}
        </AppButton>
      </div>

      <div v-if="children.length" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="child in children"
          :key="child.id"
          class="card flex flex-col gap-3 p-5"
          :class="{ 'opacity-75': !child.isActive }"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 flex-col gap-0.5">
              <h3 class="truncate text-base font-extrabold">
                {{ child.firstName }} {{ child.lastName }}
              </h3>
              <span class="text-[13px] text-ink-4">
                {{ placement(child.grade, child.className) }}
              </span>
            </div>
            <StatusBadge v-if="!child.isActive">
              {{ t('families.parent_show.child_inactive') }}
            </StatusBadge>
          </div>

          <div v-if="features.allergens" class="flex flex-wrap gap-1.5">
            <StatusBadge v-for="code in child.allergies" :key="code" tone="danger">
              {{ t(`allergens.${code}`) }}
            </StatusBadge>
            <span v-if="!child.allergies.length" class="text-[13px] text-ink-4">
              {{ t('families.parent_show.no_allergies') }}
            </span>
          </div>
          <p v-if="child.dietaryNotes" class="text-[13px] text-ink-3">{{ child.dietaryNotes }}</p>

          <div class="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3 text-[13px]">
            <span class="font-bold text-ink-4">{{ t('families.parent_show.subscription') }}</span>
            <template v-if="currentPeriod(child.subscriptions)">
              <StatusBadge :tone="statusTone(currentPeriod(child.subscriptions)!.status)">
                {{
                  t(`families.subscriptions.statuses.${currentPeriod(child.subscriptions)!.status}`)
                }}
              </StatusBadge>
              <span class="text-ink-3">{{ periodLabel(currentPeriod(child.subscriptions)!) }}</span>
            </template>
            <span v-else class="text-ink-3">{{ t('families.parent_show.subscription_none') }}</span>
          </div>

          <div class="mt-auto pt-1">
            <AppButton
              size="sm"
              variant="secondary"
              :href="`/admin/parents/${parent.id}/children/${child.id}/edit`"
              :aria-label="
                t('families.parent_show.edit_child_label', {
                  name: `${child.firstName} ${child.lastName}`,
                })
              "
            >
              {{ t('families.parent_show.edit_child') }}
            </AppButton>
          </div>
        </article>
      </div>
      <section v-else class="card">
        <EmptyState
          :title="t('families.parent_show.no_children_title')"
          :description="t('families.parent_show.no_children_body')"
        />
      </section>
    </section>

    <ConfirmDialog
      v-model:open="confirmOpen"
      :title="
        parent.isActive
          ? t('families.parent_show.deactivate_title')
          : t('families.parent_show.activate_title')
      "
      :message="
        parent.isActive
          ? t('families.parent_show.deactivate_body', { name: parent.fullName })
          : t('families.parent_show.activate_body', { name: parent.fullName })
      "
      :confirm-label="
        parent.isActive ? t('families.parent_show.deactivate') : t('families.parent_show.activate')
      "
      :danger="parent.isActive"
      :processing="processing"
      @confirm="toggleActive"
    />
    <ConfirmDialog
      v-model:open="reviewOpen"
      :title="
        reviewAction === 'refuse'
          ? t('families.parent_show.refuse_title')
          : t('families.parent_show.approve_title')
      "
      :message="
        t(
          reviewAction === 'refuse'
            ? 'families.parent_show.refuse_body'
            : 'families.parent_show.approve_body',
          { name: parent.fullName }
        )
      "
      :confirm-label="
        reviewAction === 'refuse'
          ? t('families.parent_show.refuse')
          : t('families.parent_show.approve')
      "
      :danger="reviewAction === 'refuse'"
      :processing="processing"
      @confirm="review"
    />
    <ModalDialog
      v-model:open="whatsappOpen"
      :title="t('families.parent_show.whatsapp_ready_title')"
      size="sm"
    >
      <p class="m-0 text-sm text-ink-2">{{ t('families.parent_show.whatsapp_ready_body') }}</p>
      <template #footer>
        <AppButton variant="secondary" @click="whatsappOpen = false">
          {{ t('families.parent_show.whatsapp_close') }}
        </AppButton>
        <a
          v-if="whatsappInvite"
          :href="whatsappInvite"
          target="_blank"
          rel="noopener noreferrer"
          class="flex min-h-11 items-center rounded-xl bg-[#25D366] px-4 text-sm font-bold text-white no-underline hover:bg-[#1EBE5B] hover:text-white"
          @click="whatsappOpen = false"
        >
          {{ t('families.parent_show.whatsapp_open') }}
        </a>
      </template>
    </ModalDialog>
  </AdminLayout>
</template>
