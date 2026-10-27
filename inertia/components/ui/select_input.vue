<script setup lang="ts">
import FormField from '~/components/ui/form_field.vue'
import { useI18n } from '~/composables/use_i18n'

export type SelectOption = { value: string | number; label: string; disabled?: boolean }

const model = defineModel<string | number | null>()

withDefaults(
  defineProps<{
    id: string
    name?: string
    label?: string
    options: SelectOption[]
    error?: string
    hint?: string
    placeholder?: string
    required?: boolean
    disabled?: boolean
  }>(),
  {
    name: undefined,
    label: undefined,
    error: undefined,
    hint: undefined,
    placeholder: undefined,
    required: false,
    disabled: false,
  }
)

const { t } = useI18n()
</script>

<template>
  <FormField :id="id" :label="label" :error="error" :hint="hint" :required="required">
    <div class="relative">
      <select
        :id="id"
        v-model="model"
        :name="name ?? id"
        :required="required"
        :disabled="disabled"
        :aria-invalid="error ? 'true' : 'false'"
        :aria-describedby="error ? `${id}-error` : hint ? `${id}-hint` : undefined"
        class="h-[50px] w-full appearance-none rounded-xl border bg-surface pr-10 pl-3.5 text-base text-ink disabled:bg-subtle"
        :class="error ? 'border-danger' : 'border-line-input'"
      >
        <option value="" disabled>{{ placeholder ?? t('ui.select_placeholder') }}</option>
        <option
          v-for="option in options"
          :key="option.value"
          :value="option.value"
          :disabled="option.disabled"
        >
          {{ option.label }}
        </option>
      </select>
      <svg
        class="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-ink-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  </FormField>
</template>
