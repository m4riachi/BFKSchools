<script setup lang="ts">
/**
 * Create a holiday (one day or a range) or edit one: rename, change dates
 * (manual only), enable/disable, delete. Writes that would cancel orders
 * come back with a `confirmImpact` error: the confirmation dialog shows the
 * server's count and replays the request with `confirmImpact: true`.
 */
import { computed, ref, watch } from 'vue'
import { router, useForm } from '@inertiajs/vue3'
import ModalDialog from '~/components/ui/modal_dialog.vue'
import ConfirmDialog from '~/components/ui/confirm_dialog.vue'
import AppButton from '~/components/ui/app_button.vue'
import TextInput from '~/components/ui/text_input.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import { useI18n } from '~/composables/use_i18n'
import { useImpactConfirm } from '~/composables/use_impact_confirm'
import { SOURCE_STYLES, type EditorTarget } from '~/components/holidays/types'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ target: EditorTarget | null }>()

const { t, formatDate } = useI18n()
const impact = useImpactConfirm()
const impactOpen = impact.open
const impactMessage = impact.message

const form = useForm({
  name: '',
  startDate: '',
  endDate: '' as string | null,
  date: '',
  confirmImpact: false,
})

watch(
  () => [props.target, open.value] as const,
  ([target, isOpen]) => {
    if (!isOpen || !target) return
    form.clearErrors()
    form.confirmImpact = false
    if (target.kind === 'create') {
      form.name = ''
      form.startDate = target.startDate
      form.endDate = ''
      form.date = ''
    } else if (target.kind === 'single') {
      form.name = target.name
      form.date = target.date
    } else {
      form.name = target.name
      form.startDate = target.startDate
      form.endDate = target.endDate
    }
  },
  { immediate: true }
)

const title = computed(() => {
  if (!props.target || props.target.kind === 'create') return t('holidays.form.create_title')
  return props.target.kind === 'group'
    ? t('holidays.form.edit_range_title')
    : t('holidays.form.edit_title')
})

/** Generated/imported days keep their dates; manual ones can move. */
const datesEditable = computed(() => {
  const target = props.target
  if (!target) return false
  if (target.kind === 'create') return true
  return target.source === 'manual'
})

const baseUrl = computed(() => {
  const target = props.target
  if (!target || target.kind === 'create') return '/admin/holidays'
  return target.kind === 'group'
    ? `/admin/holidays/groups/${target.groupId}`
    : `/admin/holidays/${target.id}`
})

const options = {
  preserveScroll: true,
  preserveState: true,
  onSuccess: () => (open.value = false),
  onError: (errors: Record<string, string>) => {
    impact.handle(errors, () => {
      form.confirmImpact = true
      submit()
    })
  },
  onFinish: () => (form.confirmImpact = false),
}

function submit() {
  const target = props.target
  if (!target) return
  if (target.kind === 'create') {
    form
      .transform((data) => ({
        name: data.name,
        startDate: data.startDate,
        endDate: data.endDate || null,
        confirmImpact: data.confirmImpact,
      }))
      .post(baseUrl.value, options)
  } else if (target.kind === 'single') {
    form
      .transform((data) => ({
        name: data.name,
        date: datesEditable.value ? data.date : null,
        confirmImpact: data.confirmImpact,
      }))
      .put(baseUrl.value, options)
  } else {
    form
      .transform((data) => ({
        name: data.name,
        startDate: datesEditable.value ? data.startDate : null,
        endDate: datesEditable.value ? data.endDate || null : null,
        confirmImpact: data.confirmImpact,
      }))
      .put(baseUrl.value, options)
  }
}

const busy = ref(false)
function toggle(confirmImpact = false) {
  const target = props.target
  if (!target || target.kind === 'create') return
  router.post(
    `${baseUrl.value}/toggle`,
    { active: !target.isActive, confirmImpact },
    {
      preserveScroll: true,
      onStart: () => (busy.value = true),
      onFinish: () => (busy.value = false),
      onSuccess: () => (open.value = false),
      onError: (errors) => impact.handle(errors, () => toggle(true)),
    }
  )
}

const deleteOpen = ref(false)
function remove() {
  router.delete(baseUrl.value, {
    preserveScroll: true,
    onStart: () => (busy.value = true),
    onFinish: () => {
      busy.value = false
      deleteOpen.value = false
    },
    onSuccess: () => (open.value = false),
  })
}
</script>

<template>
  <ModalDialog v-model:open="open" :title="title">
    <form
      v-if="target"
      id="holiday-editor"
      class="flex flex-col gap-4"
      novalidate
      @submit.prevent="submit"
    >
      <div v-if="target.kind !== 'create'" class="flex flex-wrap items-center gap-2">
        <StatusBadge :tone="target.isActive ? 'brand' : 'neutral'">
          {{ target.isActive ? t('holidays.list.active') : t('holidays.list.disabled') }}
        </StatusBadge>
        <span class="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-3">
          <span
            class="size-2.5 rounded-full"
            :class="SOURCE_STYLES[target.source].dot"
            aria-hidden="true"
          />
          {{ t(`holidays.sources.${target.source}`) }}
        </span>
        <span v-if="target.kind === 'group'" class="text-xs font-semibold text-ink-3">
          · {{ t('holidays.form.days', { count: target.days }) }}
        </span>
      </div>

      <TextInput
        id="holiday-name"
        v-model="form.name"
        :label="t('holidays.form.name')"
        :placeholder="t('holidays.form.name_placeholder')"
        :error="form.errors.name"
        required
      />

      <template v-if="target.kind === 'single'">
        <TextInput
          v-if="datesEditable"
          id="holiday-date"
          v-model="form.date"
          type="date"
          :label="t('holidays.form.date')"
          :error="form.errors.date"
          required
        />
        <p v-else class="text-sm">
          <strong class="text-ink">{{ formatDate(target.date, { dateStyle: 'full' }) }}</strong>
        </p>
      </template>

      <template v-else>
        <div v-if="datesEditable" class="grid gap-4 sm:grid-cols-2">
          <TextInput
            id="holiday-start"
            v-model="form.startDate"
            type="date"
            :label="t('holidays.form.start_date')"
            :error="form.errors.startDate"
            required
          />
          <TextInput
            id="holiday-end"
            v-model="form.endDate"
            type="date"
            :label="t('holidays.form.end_date')"
            :error="form.errors.endDate"
          />
        </div>
        <p v-else-if="target.kind === 'group'" class="text-sm font-semibold text-ink">
          {{
            t('holidays.form.range', {
              start: formatDate(target.startDate, { dateStyle: 'medium' }),
              end: formatDate(target.endDate, { dateStyle: 'medium' }),
            })
          }}
        </p>
        <p v-if="datesEditable" class="text-xs text-ink-4">{{ t('holidays.form.range_hint') }}</p>
      </template>

      <p v-if="!datesEditable" class="text-xs text-ink-4">{{ t('holidays.form.locked_dates') }}</p>
    </form>

    <template #footer>
      <template v-if="target && target.kind !== 'create'">
        <AppButton
          variant="ghost"
          :disabled="busy || form.processing"
          class="mr-auto"
          @click="deleteOpen = true"
        >
          {{ t('holidays.actions.delete') }}
        </AppButton>
        <AppButton
          variant="secondary"
          :loading="busy"
          :disabled="form.processing"
          @click="toggle()"
        >
          {{ target.isActive ? t('holidays.actions.disable') : t('holidays.actions.enable') }}
        </AppButton>
      </template>
      <AppButton v-else variant="secondary" @click="open = false">{{
        t('holidays.form.cancel')
      }}</AppButton>
      <AppButton type="submit" form="holiday-editor" :loading="form.processing" :disabled="busy">
        {{ t('holidays.form.save') }}
      </AppButton>
    </template>
  </ModalDialog>

  <ConfirmDialog
    v-if="target && target.kind !== 'create'"
    v-model:open="deleteOpen"
    :title="t('holidays.delete.title', { name: target.name })"
    :message="
      target.generated ? t('holidays.delete.body_generated') : t('holidays.delete.body_manual')
    "
    :confirm-label="t('holidays.delete.confirm')"
    :processing="busy"
    danger
    @confirm="remove"
  />

  <ConfirmDialog
    v-model:open="impactOpen"
    :title="t('holidays.impact.title')"
    :message="impactMessage"
    :confirm-label="t('holidays.impact.confirm_button')"
    danger
    @confirm="impact.confirm"
  />
</template>
