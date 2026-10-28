<script setup lang="ts">
import FormField from '~/components/ui/form_field.vue'

const model = defineModel<string | null>()

withDefaults(
  defineProps<{
    id: string
    label?: string
    error?: string
    hint?: string
    placeholder?: string
    rows?: number
    maxlength?: number
  }>(),
  {
    label: undefined,
    error: undefined,
    hint: undefined,
    placeholder: undefined,
    rows: 3,
    maxlength: undefined,
  }
)
</script>

<template>
  <FormField :id="id" :label="label" :error="error" :hint="hint">
    <textarea
      :id="id"
      v-model="model"
      :name="id"
      :rows="rows"
      :maxlength="maxlength"
      :placeholder="placeholder"
      :aria-invalid="error ? 'true' : 'false'"
      :aria-describedby="error ? `${id}-error` : hint ? `${id}-hint` : undefined"
      class="w-full rounded-xl border bg-surface px-3.5 py-3 text-base text-ink placeholder:text-ink-4/70"
      :class="error ? 'border-danger' : 'border-line-input'"
    />
  </FormField>
</template>
