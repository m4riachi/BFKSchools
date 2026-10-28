<script setup lang="ts">
import { computed, ref } from 'vue'
import { router, useForm } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import TextInput from '~/components/ui/text_input.vue'
import TextArea from '~/components/ui/text_area.vue'
import SelectInput from '~/components/ui/select_input.vue'
import CheckboxField from '~/components/ui/checkbox_field.vue'
import AppButton from '~/components/ui/app_button.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import ModalDialog from '~/components/ui/modal_dialog.vue'
import ConfirmDialog from '~/components/ui/confirm_dialog.vue'
import AllergenPicker from '~/components/families/allergen_picker.vue'
import type { ChildRow, SubscriptionRow } from '~/components/families/types'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  parent: { id: number; fullName: string }
  child: ChildRow | null
  allergens: string[]
  subscriptionStatuses: string[]
}>()

const { t, formatDate } = useI18n()
const base = computed(() => `/admin/parents/${props.parent.id}/children`)
const childName = computed(() =>
  props.child ? `${props.child.firstName} ${props.child.lastName}` : ''
)

/* Child details */
const form = useForm({
  firstName: props.child?.firstName ?? '',
  lastName: props.child?.lastName ?? '',
  grade: props.child?.grade ?? '',
  className: props.child?.className ?? '',
  allergies: [...(props.child?.allergies ?? [])],
  dietaryNotes: props.child?.dietaryNotes ?? '',
  isActive: props.child?.isActive ?? true,
})

const allergyError = computed(() => {
  const errors = form.errors as Record<string, string | undefined>
  return (
    errors.allergies ??
    Object.entries(errors).find(([key]) => key.startsWith('allergies.'))?.[1] ??
    undefined
  )
})

function submit() {
  if (props.child) form.put(`${base.value}/${props.child.id}`, { preserveScroll: true })
  else form.post(base.value)
}

/* Delete child */
const deleteOpen = ref(false)
const deleting = ref(false)
function destroyChild() {
  if (!props.child) return
  router.delete(`${base.value}/${props.child.id}`, {
    onStart: () => (deleting.value = true),
    onFinish: () => {
      deleting.value = false
      deleteOpen.value = false
    },
  })
}

/* Subscription periods */
const periodOpen = ref(false)
const editing = ref<SubscriptionRow | null>(null)
const periodForm = useForm({ startDate: '', endDate: '', status: 'active', notes: '' })

function openPeriod(period: SubscriptionRow | null) {
  editing.value = period
  periodForm.clearErrors()
  periodForm.startDate = period?.startDate ?? ''
  periodForm.endDate = period?.endDate ?? ''
  periodForm.status = period?.status ?? 'active'
  periodForm.notes = period?.notes ?? ''
  periodOpen.value = true
}

function savePeriod() {
  if (!props.child) return
  const url = `${base.value}/${props.child.id}/subscriptions`
  const options = {
    preserveScroll: true,
    preserveState: true,
    onSuccess: () => (periodOpen.value = false),
  }
  if (editing.value) periodForm.put(`${url}/${editing.value.id}`, options)
  else periodForm.post(url, options)
}

const removing = ref<SubscriptionRow | null>(null)
const removeOpen = ref(false)
const removeProcessing = ref(false)
function askRemove(period: SubscriptionRow) {
  removing.value = period
  removeOpen.value = true
}
function removePeriod() {
  if (!props.child || !removing.value) return
  router.delete(`${base.value}/${props.child.id}/subscriptions/${removing.value.id}`, {
    preserveScroll: true,
    onStart: () => (removeProcessing.value = true),
    onFinish: () => {
      removeProcessing.value = false
      removeOpen.value = false
    },
  })
}

const statusTone = (status: string) =>
  status === 'active' ? 'brand' : status === 'paused' ? 'warning' : 'neutral'

const day = (iso: string) => formatDate(iso, { dateStyle: 'medium' })
</script>

<template>
  <AdminLayout>
    <div>
      <Link :href="`/admin/parents/${parent.id}`" class="text-[13px] font-semibold">
        ← {{ t('families.child_form.back', { name: parent.fullName }) }}
      </Link>
    </div>
    <PageHeader
      :title="
        child
          ? t('families.child_form.edit_title', { name: childName })
          : t('families.child_form.create_title')
      "
      :eyebrow="parent.fullName"
    />

    <form class="card flex max-w-3xl flex-col gap-5 p-5 sm:p-6" novalidate @submit.prevent="submit">
      <h2 class="text-base font-extrabold">{{ t('families.child_form.details') }}</h2>
      <div class="grid gap-5 sm:grid-cols-2">
        <TextInput
          id="firstName"
          v-model="form.firstName"
          required
          autocomplete="off"
          :label="t('families.child_form.first_name')"
          :error="form.errors.firstName"
        />
        <TextInput
          id="lastName"
          v-model="form.lastName"
          required
          autocomplete="off"
          :label="t('families.child_form.last_name')"
          :error="form.errors.lastName"
        />
        <TextInput
          id="grade"
          v-model="form.grade"
          autocomplete="off"
          :label="t('families.child_form.grade')"
          :placeholder="t('families.child_form.grade_placeholder')"
          :error="form.errors.grade"
        />
        <TextInput
          id="className"
          v-model="form.className"
          autocomplete="off"
          :label="t('families.child_form.class_name')"
          :placeholder="t('families.child_form.class_name_placeholder')"
          :error="form.errors.className"
        />
      </div>

      <AllergenPicker
        v-model="form.allergies"
        :allergens="allergens"
        :label="t('families.child_form.allergies')"
        :hint="t('families.child_form.allergies_hint')"
        :error="allergyError"
      />

      <TextArea
        id="dietaryNotes"
        v-model="form.dietaryNotes"
        :maxlength="1000"
        :label="t('families.child_form.dietary_notes')"
        :hint="t('families.child_form.dietary_notes_hint')"
        :error="form.errors.dietaryNotes"
      />

      <CheckboxField
        id="isActive"
        v-model="form.isActive"
        :label="t('families.child_form.is_active')"
        :hint="t('families.child_form.is_active_hint')"
      />

      <div class="flex flex-wrap gap-2.5">
        <AppButton type="submit" :loading="form.processing">
          {{
            child ? t('families.child_form.submit_edit') : t('families.child_form.submit_create')
          }}
        </AppButton>
        <AppButton variant="secondary" :href="`/admin/parents/${parent.id}`">
          {{ t('families.parent_form.cancel') }}
        </AppButton>
      </div>
    </form>

    <section
      v-if="child"
      class="card flex max-w-3xl flex-col gap-4 p-5 sm:p-6"
      aria-labelledby="periods-title"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex flex-col gap-1">
          <h2 id="periods-title" class="text-base font-extrabold">
            {{ t('families.subscriptions.title') }}
          </h2>
          <p class="max-w-xl text-[13px] text-ink-4">
            {{ t('families.subscriptions.description') }}
          </p>
        </div>
        <AppButton size="sm" @click="openPeriod(null)">{{
          t('families.subscriptions.add')
        }}</AppButton>
      </div>

      <ul v-if="child.subscriptions.length" class="flex flex-col divide-y divide-line-soft">
        <li
          v-for="period in child.subscriptions"
          :key="period.id"
          class="flex flex-wrap items-center justify-between gap-3 py-3"
        >
          <div class="flex min-w-0 flex-col gap-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-bold tabular">
                {{
                  period.endDate
                    ? t('families.subscriptions.period', {
                        start: day(period.startDate),
                        end: day(period.endDate),
                      })
                    : t('families.subscriptions.period_open', { start: day(period.startDate) })
                }}
              </span>
              <StatusBadge :tone="statusTone(period.status)">
                {{ t(`families.subscriptions.statuses.${period.status}`) }}
              </StatusBadge>
            </div>
            <span v-if="period.notes" class="text-[13px] text-ink-4">{{ period.notes }}</span>
          </div>
          <div class="flex gap-2">
            <AppButton
              size="sm"
              variant="secondary"
              :aria-label="t('families.subscriptions.edit_label', { start: day(period.startDate) })"
              @click="openPeriod(period)"
            >
              {{ t('families.subscriptions.edit') }}
            </AppButton>
            <AppButton
              size="sm"
              variant="ghost"
              :aria-label="
                t('families.subscriptions.delete_label', { start: day(period.startDate) })
              "
              @click="askRemove(period)"
            >
              {{ t('families.subscriptions.delete') }}
            </AppButton>
          </div>
        </li>
      </ul>
      <EmptyState
        v-else
        :title="t('families.subscriptions.empty_title')"
        :description="t('families.subscriptions.empty_body')"
      />
    </section>

    <section v-if="child" class="card flex max-w-3xl flex-col gap-3 p-5 sm:p-6">
      <h2 class="text-base font-extrabold">{{ t('families.child_form.danger_zone') }}</h2>
      <div>
        <AppButton variant="danger" size="sm" @click="deleteOpen = true">
          {{ t('families.child_form.delete') }}
        </AppButton>
      </div>
    </section>

    <ModalDialog
      v-model:open="periodOpen"
      :title="
        editing ? t('families.subscriptions.edit_title') : t('families.subscriptions.add_title')
      "
    >
      <form
        id="period-form"
        class="flex flex-col gap-4 text-ink"
        novalidate
        @submit.prevent="savePeriod"
      >
        <div class="grid gap-4 sm:grid-cols-2">
          <TextInput
            id="startDate"
            v-model="periodForm.startDate"
            type="date"
            required
            :label="t('families.subscriptions.start')"
            :error="periodForm.errors.startDate"
          />
          <TextInput
            id="endDate"
            v-model="periodForm.endDate"
            type="date"
            :label="t('families.subscriptions.end')"
            :hint="t('families.subscriptions.end_hint')"
            :error="periodForm.errors.endDate"
          />
        </div>
        <SelectInput
          id="status"
          v-model="periodForm.status"
          required
          :label="t('families.subscriptions.status')"
          :options="
            subscriptionStatuses.map((status) => ({
              value: status,
              label: t(`families.subscriptions.statuses.${status}`),
            }))
          "
          :error="periodForm.errors.status"
        />
        <TextInput
          id="notes"
          v-model="periodForm.notes"
          :label="t('families.subscriptions.notes')"
          :error="periodForm.errors.notes"
        />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="periodOpen = false">{{ t('ui.cancel') }}</AppButton>
        <AppButton type="submit" form="period-form" :loading="periodForm.processing">
          {{ t('families.subscriptions.save') }}
        </AppButton>
      </template>
    </ModalDialog>

    <ConfirmDialog
      v-model:open="removeOpen"
      :title="t('families.subscriptions.delete_title')"
      :message="t('families.subscriptions.delete_body')"
      :confirm-label="t('families.subscriptions.delete')"
      danger
      :processing="removeProcessing"
      @confirm="removePeriod"
    />

    <ConfirmDialog
      v-model:open="deleteOpen"
      :title="t('families.child_form.delete_title')"
      :message="t('families.child_form.delete_body', { name: childName })"
      :confirm-label="t('families.child_form.delete')"
      danger
      :processing="deleting"
      @confirm="destroyChild"
    />
  </AdminLayout>
</template>
