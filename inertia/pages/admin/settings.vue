<script setup lang="ts">
/**
 * School settings (brief §6), admins only. The server validates every value
 * (and the cross-field rules) and redirects back here.
 */
import { computed } from 'vue'
import { useForm } from '@inertiajs/vue3'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import AppButton from '~/components/ui/app_button.vue'
import TextInput from '~/components/ui/text_input.vue'
import SelectInput from '~/components/ui/select_input.vue'
import CheckboxField from '~/components/ui/checkbox_field.vue'
import { useI18n } from '~/composables/use_i18n'

type Settings = {
  publish_weekday: number
  publish_time: string
  deadline_weekday: number
  deadline_time: string
  reminder_hours_before_deadline: number
  allow_parent_edits: boolean
  edit_mode: 'until_cutoff' | 'same_day_only'
  edit_cutoff_days_before: number
  edit_cutoff_time: string
  auto_assign_default_meal: boolean
  allergy_rule: 'block' | 'warn_confirm'
  generate_moroccan_holidays: boolean
  email_notifications: {
    enabled: boolean
    menu_published: boolean
    deadline_reminder: boolean
    holiday_cancellation: boolean
    order_changed_by_staff: boolean
    menu_change: boolean
  }
  subscription_required_for_main_meal: boolean
  supplement_max_quantity: number
  label_grid: { cols: number; rows: number }
}

const props = defineProps<{
  school: {
    name: string
    timezone: string
    schoolDays: number[]
    schoolYearStart: string
    schoolYearEnd: string
  }
  settings: Settings
}>()

const { t } = useI18n()

const form = useForm({
  schoolDays: [...props.school.schoolDays],
  schoolYearStart: props.school.schoolYearStart,
  schoolYearEnd: props.school.schoolYearEnd,
  settings: structuredClone(props.settings) as Settings,
})

const errors = computed(() => form.errors as Record<string, string | undefined>)
const err = (key: string) => errors.value[key]

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]
const weekdayOptions = computed(() =>
  WEEKDAYS.map((day) => ({ value: day, label: t(`settings.weekdays.${day}`) }))
)

function toggleDay(day: number, checked: boolean) {
  const days = new Set(form.schoolDays)
  if (checked) days.add(day)
  else days.delete(day)
  form.schoolDays = [...days].sort((a, b) => a - b)
}

const EMAIL_TYPES = [
  'menu_published',
  'deadline_reminder',
  'holiday_cancellation',
  'order_changed_by_staff',
  'menu_change',
] as const

function submit() {
  form
    .transform((data) => ({
      ...data,
      settings: {
        ...data.settings,
        publish_weekday: Number(data.settings.publish_weekday),
        deadline_weekday: Number(data.settings.deadline_weekday),
        reminder_hours_before_deadline: Number(data.settings.reminder_hours_before_deadline),
        edit_cutoff_days_before: Number(data.settings.edit_cutoff_days_before),
        supplement_max_quantity: Number(data.settings.supplement_max_quantity),
        label_grid: {
          cols: Number(data.settings.label_grid.cols),
          rows: Number(data.settings.label_grid.rows),
        },
      },
    }))
    .put('/admin/settings', { preserveScroll: true })
}
</script>

<template>
  <AdminLayout>
    <PageHeader
      :title="t('settings.title')"
      :description="t('settings.description', { school: school.name })"
    />

    <form class="flex max-w-3xl flex-col gap-5" @submit.prevent="submit">
      <section class="card flex flex-col gap-4 p-5">
        <div class="flex flex-col gap-1">
          <h2 class="text-lg font-bold">{{ t('settings.sections.calendar') }}</h2>
          <p class="text-[13px] text-ink-4">{{ t('settings.sections.calendar_hint') }}</p>
        </div>
        <fieldset class="flex flex-col gap-1.5">
          <legend class="mb-1.5 text-[13px] font-bold">
            {{ t('settings.fields.school_days') }}
          </legend>
          <div class="flex flex-wrap gap-x-4">
            <label
              v-for="day in WEEKDAYS"
              :key="day"
              class="flex min-h-11 items-center gap-2 text-sm font-semibold"
            >
              <input
                type="checkbox"
                class="size-[18px] accent-brand"
                :checked="form.schoolDays.includes(day)"
                @change="toggleDay(day, ($event.target as HTMLInputElement).checked)"
              />
              {{ t(`settings.weekdays.${day}`) }}
            </label>
          </div>
          <p v-if="err('schoolDays')" class="text-[13px] font-semibold text-danger" role="alert">
            {{ err('schoolDays') }}
          </p>
        </fieldset>
        <div class="grid gap-4 sm:grid-cols-2">
          <TextInput
            id="schoolYearStart"
            v-model="form.schoolYearStart"
            type="date"
            :label="t('settings.fields.school_year_start')"
            :error="err('schoolYearStart')"
            required
          />
          <TextInput
            id="schoolYearEnd"
            v-model="form.schoolYearEnd"
            type="date"
            :label="t('settings.fields.school_year_end')"
            :error="err('schoolYearEnd')"
            required
          />
        </div>
      </section>

      <section class="card flex flex-col gap-4 p-5">
        <div class="flex flex-col gap-1">
          <h2 class="text-lg font-bold">{{ t('settings.sections.menus') }}</h2>
          <p class="text-[13px] text-ink-4">{{ t('settings.sections.menus_hint') }}</p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <SelectInput
            id="publish_weekday"
            v-model="form.settings.publish_weekday"
            :options="weekdayOptions"
            :label="t('settings.fields.publish_weekday')"
            :error="err('settings.publish_weekday')"
            required
          />
          <TextInput
            id="publish_time"
            v-model="form.settings.publish_time"
            type="time"
            :label="t('settings.fields.publish_time')"
            :error="err('settings.publish_time')"
            required
          />
          <SelectInput
            id="deadline_weekday"
            v-model="form.settings.deadline_weekday"
            :options="weekdayOptions"
            :label="t('settings.fields.deadline_weekday')"
            :error="err('settings.deadline_weekday')"
            required
          />
          <TextInput
            id="deadline_time"
            v-model="form.settings.deadline_time"
            type="time"
            :label="t('settings.fields.deadline_time')"
            :error="err('settings.deadline_time')"
            required
          />
          <TextInput
            id="reminder_hours_before_deadline"
            v-model="form.settings.reminder_hours_before_deadline"
            type="number"
            :label="t('settings.fields.reminder_hours_before_deadline')"
            :error="err('settings.reminder_hours_before_deadline')"
            required
          />
        </div>
      </section>

      <section class="card flex flex-col gap-4 p-5">
        <h2 class="text-lg font-bold">{{ t('settings.sections.edits') }}</h2>
        <CheckboxField
          id="allow_parent_edits"
          v-model="form.settings.allow_parent_edits"
          :label="t('settings.fields.allow_parent_edits')"
        />
        <div class="grid gap-4 sm:grid-cols-2">
          <SelectInput
            id="edit_mode"
            v-model="form.settings.edit_mode"
            :options="[
              { value: 'until_cutoff', label: t('settings.fields.edit_mode_until_cutoff') },
              { value: 'same_day_only', label: t('settings.fields.edit_mode_same_day_only') },
            ]"
            :label="t('settings.fields.edit_mode')"
            :error="err('settings.edit_mode')"
            :disabled="!form.settings.allow_parent_edits"
            required
          />
          <TextInput
            id="edit_cutoff_days_before"
            v-model="form.settings.edit_cutoff_days_before"
            type="number"
            :label="t('settings.fields.edit_cutoff_days_before')"
            :hint="
              form.settings.edit_mode === 'same_day_only'
                ? t('settings.fields.edit_cutoff_days_before_not_applicable')
                : t('settings.fields.edit_cutoff_days_before_hint')
            "
            :error="err('settings.edit_cutoff_days_before')"
            :disabled="
              !form.settings.allow_parent_edits || form.settings.edit_mode === 'same_day_only'
            "
            required
          />
          <TextInput
            id="edit_cutoff_time"
            v-model="form.settings.edit_cutoff_time"
            type="time"
            :label="t('settings.fields.edit_cutoff_time')"
            :error="err('settings.edit_cutoff_time')"
            :disabled="!form.settings.allow_parent_edits"
            required
          />
        </div>
      </section>

      <section class="card flex flex-col gap-4 p-5">
        <h2 class="text-lg font-bold">{{ t('settings.sections.orders') }}</h2>
        <CheckboxField
          id="auto_assign_default_meal"
          v-model="form.settings.auto_assign_default_meal"
          :label="t('settings.fields.auto_assign_default_meal')"
        />
        <CheckboxField
          id="subscription_required_for_main_meal"
          v-model="form.settings.subscription_required_for_main_meal"
          :label="t('settings.fields.subscription_required_for_main_meal')"
        />
        <div class="grid gap-4 sm:grid-cols-2">
          <SelectInput
            id="allergy_rule"
            v-model="form.settings.allergy_rule"
            :options="[
              { value: 'block', label: t('settings.fields.allergy_rule_block') },
              { value: 'warn_confirm', label: t('settings.fields.allergy_rule_warn_confirm') },
            ]"
            :label="t('settings.fields.allergy_rule')"
            :error="err('settings.allergy_rule')"
            required
          />
          <TextInput
            id="supplement_max_quantity"
            v-model="form.settings.supplement_max_quantity"
            type="number"
            :label="t('settings.fields.supplement_max_quantity')"
            :error="err('settings.supplement_max_quantity')"
            required
          />
        </div>
      </section>

      <section class="card flex flex-col gap-4 p-5">
        <h2 class="text-lg font-bold">{{ t('settings.sections.kitchen') }}</h2>
        <p class="text-sm text-ink-3">{{ t('settings.sections.kitchen_hint') }}</p>
        <div class="grid gap-4 sm:grid-cols-2">
          <TextInput
            id="label_grid_cols"
            v-model="form.settings.label_grid.cols"
            type="number"
            :label="t('settings.fields.label_grid_cols')"
            :error="err('settings.label_grid.cols')"
            required
          />
          <TextInput
            id="label_grid_rows"
            v-model="form.settings.label_grid.rows"
            type="number"
            :label="t('settings.fields.label_grid_rows')"
            :error="err('settings.label_grid.rows')"
            required
          />
        </div>
      </section>

      <section class="card flex flex-col gap-4 p-5">
        <h2 class="text-lg font-bold">{{ t('settings.sections.holidays') }}</h2>
        <CheckboxField
          id="generate_moroccan_holidays"
          v-model="form.settings.generate_moroccan_holidays"
          :label="t('settings.fields.generate_moroccan_holidays')"
        />
      </section>

      <section class="card flex flex-col gap-3 p-5">
        <div class="flex flex-col gap-1">
          <h2 class="text-lg font-bold">{{ t('settings.sections.notifications') }}</h2>
          <p class="text-[13px] text-ink-4">{{ t('settings.sections.notifications_hint') }}</p>
        </div>
        <CheckboxField
          id="email_enabled"
          v-model="form.settings.email_notifications.enabled"
          :label="t('settings.fields.email_enabled')"
        />
        <div
          class="flex flex-col pl-7"
          :class="form.settings.email_notifications.enabled ? '' : 'opacity-60'"
        >
          <CheckboxField
            v-for="type in EMAIL_TYPES"
            :id="`email_${type}`"
            :key="type"
            v-model="form.settings.email_notifications[type]"
            :label="t(`settings.fields.email_${type}`)"
          />
        </div>
      </section>

      <div class="flex justify-end">
        <AppButton type="submit" :loading="form.processing">{{ t('settings.save') }}</AppButton>
      </div>
    </form>
  </AdminLayout>
</template>
